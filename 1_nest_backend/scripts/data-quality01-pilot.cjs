// Explicit, single controlled pilot. No server, cron, credentials, TTS or publishing.
const fs=require('fs'),p=require('path'),cp=require('child_process'),{randomUUID}=require('crypto');
const backend=p.resolve(__dirname,'..'),reportDir=p.join(backend,'.studio-data/reports/data-quality01');fs.mkdirSync(reportDir,{recursive:true});
const write=(f,x)=>fs.writeFileSync(p.join(reportDir,f),JSON.stringify(x,null,2));
const {ContentDiscovery}=require('../dist/data-engine/content-discovery'),{DataEngine}=require('../dist/data-engine/engine'),{DataStore}=require('../dist/data-engine/store');
const publicApi=require('../dist/data-engine/conversation-public');
const request={requestId:'data-quality01-pilot-20261109',style:'SERIOUS',topic:'WORK_LIFE_FAMILY',keywords:['chuyện đi làm','bài học cuộc sống','chuyện gia đình','trải nghiệm công việc','áp lực đồng trang lứa'],maxPosts:30,maxRunMs:300000};
if(process.argv[2]!=='run'){console.log(JSON.stringify({mode:'PLAN_ONLY_NO_NETWORK',request,browserWorkers:1,maxPerDiscovery:6,maxVerifiedRepliesPerRoot:20,resourceStopMiB:384,scheduler:false,tts:false,render:false,approval:'Current user explicitly authorized controlled 30-50 post benchmark'}));process.exit(0)}
(async()=>{
 fs.writeFileSync(p.join(reportDir,'pilot-attempt.json'),JSON.stringify({at:new Date().toISOString(),evidence:'EXPLICIT_USER_APPROVAL',request,retries:0}),{flag:'wx'});
 const token=randomUUID(),locks=[p.join(backend,'.local-bounded-probe.lock'),p.resolve(backend,'../../Tiktok_Automation_uiops02/1_nest_backend/.local-bounded-probe.lock')],held=[];let result,error=null;const audits=[];
 try{
  for(const file of locks){fs.writeFileSync(file,JSON.stringify({pid:process.pid,token,purpose:'APPROVED_DATA_QUALITY01_DISCOVERY'}),{flag:'wx'});held.push(file)}
  const before=JSON.parse(cp.execFileSync('powershell.exe',['-NoProfile','-NonInteractive','-File',p.join(backend,'scripts/studio-resource-audit.ps1')],{encoding:'utf8',windowsHide:true,timeout:25000}));write('pilot-before.json',before);
  if(before.availableMiB<384)throw Error('CONVERSATION_RESOURCE_BELOW_384MIB');
  if(before.workers.some(w=>/python/i.test(w.name)||['RENDER_WORKER','COLLECTOR_WORKER','KOKORO_WORKER'].includes(w.role)))throw Error('QUALITY_CONFLICTING_WORKER');
  for(const key of Object.keys(process.env))if(!/^(PATH|SYSTEMROOT|WINDIR|TEMP|TMP|USERPROFILE|APPDATA|LOCALAPPDATA|PROGRAMFILES(?:\(X86\))?|COMSPEC|PATHEXT|NUMBER_OF_PROCESSORS|PROCESSOR_ARCHITECTURE|OS|SYSTEMDRIVE)$/i.test(key))delete process.env[key];
  process.env.STUDIO_DATA_ROOT=p.join(reportDir,'store');process.env.STUDIO_DATA04_MEDIA_ROOT=p.join(reportDir,'media');
  const audit=x=>{audits.push(x);write('public-access.json',audits);console.log(JSON.stringify(x))};
  const data=new DataEngine(new DataStore(p.join(reportDir,'store/data-engine'))),provider={execution:'LIVE',discover:keyword=>publicApi.discoverConversations(keyword,audit),enrich:url=>publicApi.enrichConversation(url,audit)};
  result=await new ContentDiscovery(data,provider).start(request);write('pilot-run.json',result);write('pilot-catalog.json',await data.catalog());
 }catch(e){error=/^[A-Z0-9_]+$/.test(e.message||'')?e.message:'QUALITY_PREFLIGHT_OR_RUN_FAILED';write('pilot-error.json',{error,at:new Date().toISOString()});process.exitCode=1}
 finally{for(const file of held){const current=JSON.parse(fs.readFileSync(file));if(current.pid===process.pid&&current.token===token)fs.unlinkSync(file)}}
 const summary={status:result?.status??'NOT_RUN',error,request,execution:'LIVE_ATTEMPT_NOT_SYNTHETIC',discoveryCalls:audits.length,observedRequests:audits.reduce((n,a)=>n+a.requests,0),requestCoverage:'Public visit request events; exact-target HTTP extractor requests not included',discoveredPermalinks:result?.candidates.length??0,exactRoots:result?.collections.length??0,verifiedReplies:result?.collections.reduce((n,c)=>n+c.verifiedReplyCount,0)??0,observedReplies:result?.collections.reduce((n,c)=>n+c.observedReplyCount,0)??0,topCandidates:result?.result?.topCandidates.length??0,elapsedMs:result?.elapsedMs??null,errors:result?.errors??[],minimumAvailableMiB:audits.length?Math.min(...audits.map(a=>a.minimumAvailableMiB)):null,precisionAt5:'NOT_MEASURED',productionApproval:false,scheduler:false,tts:false,render:false};write('pilot-summary.json',summary);console.log(JSON.stringify(summary,null,2));
})().catch(e=>{console.error(e.code||'PILOT_ABORTED_NO_AUTOMATIC_RETRY');process.exitCode=1});
