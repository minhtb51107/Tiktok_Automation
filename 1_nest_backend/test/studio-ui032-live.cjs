// Explicit local LIVE TTS smoke. New labelled project only; no AI, scraping or rendering.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const {execFileSync,execFile} = require('node:child_process');
const root = path.resolve('.studio-data/reports/ui032');
const base = 'http://127.0.0.1:3000/api/studio/sessions';
async function api(url='', method='GET', body) {
  const r = await fetch(base+url,{method,headers:{'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined});
  const j=await r.json(); if(!r.ok)throw Error(JSON.stringify(j)); return j.data??j;
}
function waveform(file) {
  const b=execFileSync('ffmpeg',['-v','error','-i',file,'-f','s16le','-ac','1','-ar','24000','pipe:1'],{maxBuffer:8000000,windowsHide:true});
  let peak=0,sum=0; for(let i=0;i+1<b.length;i+=2){const v=b.readInt16LE(i)/32768;peak=Math.max(peak,Math.abs(v));sum+=v*v;}
  assert(peak>0.0001,'silent audio');return {peak,rms:Math.sqrt(sum/(b.length/2)),samples:b.length/2};
}
(async()=>{
  fs.mkdirSync(root,{recursive:true});
  let monitoring=false; const memory=[];
  const timer=setInterval(()=>{
    if(monitoring)return;monitoring=true;
    execFile('powershell.exe',['-NoProfile','-Command',"$m=Get-CimInstance Win32_PerfFormattedData_PerfOS_Memory; $p=@(Get-CimInstance Win32_Process -Filter \"name='python.exe'\" | Where-Object CommandLine -Match 'kokoro-studio'); @{availableMB=$m.AvailableMBytes;commitBytes=$m.CommittedBytes;pagesPerSec=$m.PagesPersec;workers=$p.Count;workerRssBytes=($p | Measure-Object WorkingSetSize -Sum).Sum} | ConvertTo-Json -Compress"],{windowsHide:true},(e,out)=>{monitoring=false;if(!e)try{memory.push(JSON.parse(out));}catch{}});
  },5000);
  let s;
  try {
    s=await api('','POST');
    s=await api('/'+s.id,'PUT',{revision:s.revision,title:'UI-03.2 LIVE smoke — synthetic short narration',items:[]});
    const text='Xin chào, hôm nay chúng ta cùng thử giọng đọc tiếng Việt. Hãy lắng nghe và chọn giọng phù hợp.';
    for(const author of ['Nữ — Mỹ Yến','Nam — Hưng Thịnh'])s=await api('/'+s.id,'PUT',{revision:s.revision,manual:{text,author,comments:''}});
    s=await api('/'+s.id+'/voice-runtime','POST');assert.equal(s.voiceRuntime.status,'READY');assert.equal(s.voiceRuntime.voices.length,5);
    const [female,male]=s.items.map(i=>i.id);
    const action=async(item,body)=>s=await api(`/${s.id}/voice/${item}`,'POST',{revision:s.revision,...body});
    const batch=async(body)=>s=await api(`/${s.id}/voice-batch`,'POST',{revision:s.revision,...body});
    await batch({action:'APPROVE_ALL_SPOKEN'});
    for(const [id,voice] of [[female,'my_yen'],[male,'hung_thinh']])await action(id,{action:'SETTINGS',voice,speed:1});
    const batchStart=Date.now();await batch({action:'GENERATE_ALL'});const batchElapsedMs=Date.now()-batchStart;assert(s.voiceBatch.results.every(r=>r.outcome==='GENERATED'),JSON.stringify(s.voiceBatch));
    const multiVoice=s.voiceAssets.map(a=>({voice:a.voice,durationMs:a.durationMs,latencyMs:s.voiceJobs.find(j=>j.assetId===a.id).elapsedMs,...waveform(path.resolve('.studio-data',a.filePath)),uri:a.uri}));
    const speeds=[]; const normal=s.voiceAssets.find(a=>a.itemId===female).durationMs;
    for(const speed of [0.5,1,1.2,1.5,2,2.5,3]){
      await action(female,{action:'GENERATE',voice:'my_yen',speed});
      const job=s.voiceJobs.at(-1);assert.notEqual(job.status,'ERROR',job.error);
      const a=s.voiceAssets.find(a=>a.id===job.assetId);assert(a);
      const ratio=a.durationMs/(normal/speed);assert(Math.abs(ratio-1)<0.08,`duration ratio ${speed}: ${ratio}`);
      if(speed!==1)assert.equal(a.synthesisPerformed,false,'speed-only invoked model');
      speeds.push({speed,durationMs:a.durationMs,expectedMs:normal/speed,ratio,latencyMs:job.elapsedMs,synthesisPerformed:a.synthesisPerformed,baseCacheHit:a.baseCacheHit,reused:job.reused??false,...waveform(path.resolve('.studio-data',a.filePath)),uri:a.uri,assetId:a.id});
    }
    const count=s.voiceAssets.length;await action(female,{action:'GENERATE',voice:'my_yen',speed:3});assert.equal(s.voiceAssets.length,count);assert(s.voiceJobs.at(-1).reused);
    await action(female,{action:'GENERATE',voice:'my_yen',speed:1.2});assert.equal(s.voiceAssets.length,count);assert(s.voiceJobs.at(-1).reused);
    assert(s.items[0].spokenApproval.valid);
    const reopened=await api('/'+s.id);assert.equal(reopened.items[0].voiceSettings.speed,1.2);
    const report=await api('/'+s.id+'/report?stage=VOICE');fs.writeFileSync(path.join(root,'voice-report.json'),JSON.stringify(report.report,null,2));fs.writeFileSync(path.join(root,'voice-report.md'),report.markdown);
    assert(memory.every(m=>m.workers<=1),'multiple Kokoro workers');
    const result={PASS:true,mode:'LIVE',sessionId:s.id,text,voices:s.voiceRuntime.voices,multiVoice,batchElapsedMs,speeds,manifestCount:count,cacheReuse:true,spokenApprovalRetained:true,persistence:true,memory,subjectiveListening:'NEEDS USER REVIEW; browser playback checked separately'};
    fs.writeFileSync(path.join(root,'live-results.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result));
  }catch(e){fs.writeFileSync(path.join(root,'live-error.json'),JSON.stringify({error:e.message,sessionId:s?.id,memory},null,2));throw e;}
  finally{clearInterval(timer);}
})().catch(e=>{console.error(e);process.exitCode=1;});
