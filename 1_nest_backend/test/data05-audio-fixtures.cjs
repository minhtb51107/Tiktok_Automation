// SYNTHETIC tones, not speech. No TTS, browser, model download or MP4 render.
const fs=require('node:fs'),p=require('node:path'),{execFileSync}=require('node:child_process');
const backend=p.resolve(__dirname,'..');if(!/Tiktok_Automation_data05[\\/]1_nest_backend$/.test(backend))throw Error('DATA05 worktree required');
const dir=p.join(backend,'.studio-data/reports/data05/audio-fixtures');fs.mkdirSync(dir,{recursive:true});
const durations=[14,18,16,25,8],rows=[];
for(const [index,seconds] of durations.entries()){
 const rate=16000,samples=rate*seconds,file=p.join(dir,`tone-${index}-${seconds}s.wav`);
 if(!fs.existsSync(file)){const b=Buffer.alloc(44+samples*2);b.write('RIFF');b.writeUInt32LE(b.length-8,4);b.write('WAVEfmt ',8);b.writeUInt32LE(16,16);b.writeUInt16LE(1,20);b.writeUInt16LE(1,22);b.writeUInt32LE(rate,24);b.writeUInt32LE(rate*2,28);b.writeUInt16LE(2,32);b.writeUInt16LE(16,34);b.write('data',36);b.writeUInt32LE(samples*2,40);for(let i=0;i<samples;i++)b.writeInt16LE(Math.round(4000*Math.sin(2*Math.PI*(220+index*55)*i/rate)),44+i*2);fs.writeFileSync(file,b,{flag:'wx'});}
 const info=JSON.parse(execFileSync('ffprobe',['-v','error','-show_entries','format=duration:stream=codec_name,sample_rate,channels','-of','json',file],{encoding:'utf8'}));rows.push({index,file,durationMs:Math.round(Number(info.format.duration)*1000),codec:info.streams[0].codec_name,source:'SYNTHETIC_FIXTURE',measurement:'FFPROBE'});
}
fs.writeFileSync(p.join(dir,'manifest.json'),JSON.stringify({fixture:true,narration:false,rows,totalMs:rows.reduce((n,x)=>n+x.durationMs,0)},null,2));console.log(JSON.stringify({source:'SYNTHETIC_FIXTURE',measurement:'FFPROBE',durationsMs:rows.map(x=>x.durationMs),totalMs:rows.reduce((n,x)=>n+x.durationMs,0)}));
