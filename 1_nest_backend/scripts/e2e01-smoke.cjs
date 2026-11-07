const fs=require('fs'),p=require('path'),os=require('os'),{randomUUID}=require('crypto');
const backend=p.resolve(__dirname,'..'),base=p.resolve(backend,'../../Tiktok_Automation_e2e01'),run=p.resolve(process.argv[2]||''),phase=process.argv[3];
if(p.dirname(run)!==base)throw Error('ISOLATED_E2E01_REQUIRED');
const configFile=p.join(run,'config.json');
if(phase==='init'){
 if(fs.existsSync(run))throw Error('NO_OVERWRITE');fs.mkdirSync(p.join(run,'backend'),{recursive:true});
 const source=p.resolve(backend,'../../Tiktok_Automation_restore01_live02/run-20261107-01/backend/.studio-data'),original=JSON.parse(fs.readFileSync(p.join(source,'e7e17c42-46d5-43ab-bc73-2ef4066935f5.json')));
 const s=structuredClone(original),id=randomUUID(),store=p.join(run,'backend/.studio-data');s.id=id;s.project.id=id;s.derivedFrom=original.id;s.title='E2E-01 DRAFT smoke — saved LIVE02';s.project.title=s.title;s.revision=0;s.voiceAssets=[];s.voiceJobs=[];delete s.editor;delete s.voiceRuntime;
 const {cleanSourceProjection}=require('../dist/studio/source-quality');
 const handles=['baongocghetmatcha','duy_the_homosapiens','chandler.1000'];
 for(const i of s.items){i.selected=handles.includes(i.author.handle);if(i.selected){const clean=cleanSourceProjection(i.rawExtraction).text;i.displayText=clean;i.spokenText=clean.replace(/-\)\)\)/g,'').trim();i.voiceSettings={voice:'my_yen',speed:1.2};i.revision++;}}
 fs.mkdirSync(store,{recursive:true});fs.writeFileSync(p.join(store,id+'.json'),JSON.stringify(s,null,2));
 fs.cpSync(p.join(source,'conversation-media'),p.join(store,'conversation-media'),{recursive:true,errorOnExist:true});
 for(const name of ['scripts','dist','src'])fs.symlinkSync(p.join(backend,name),p.join(run,'backend',name),'junction');
 fs.symlinkSync(p.resolve(backend,'../2_Remotion_Video'),p.join(run,'2_Remotion_Video'),'junction');
 fs.writeFileSync(configFile,JSON.stringify({sessionId:id,store,cwd:p.join(run,'backend'),sourceSession:original.id,sourceRoot:source},null,2));console.log(JSON.stringify({run,id,selected:s.items.filter(i=>i.selected).map(i=>({author:i.author.handle,text:i.spokenText}))},null,2));process.exit(0);
}
const cfg=JSON.parse(fs.readFileSync(configFile));process.chdir(cfg.cwd);
for(const k of Object.keys(process.env))if(/TOKEN|SECRET|PASSWORD|API_KEY|DATABASE_URL/i.test(k))delete process.env[k];
const localFile=p.join(run,'tts.local.json');
if(fs.existsSync(localFile)){const local=JSON.parse(fs.readFileSync(localFile));for(const [key,value] of Object.entries(local)){if(!/^STUDIO_(PYTHON|KOKORO_SOURCE|KOKORO_MODEL|KOKORO_CONFIG|KOKORO_VOICE_DIR|TTS_DEVICE)$/.test(key)||typeof value!=='string')throw Error('INVALID_LOCAL_TTS_SETTING');process.env[key]=value;}}
Object.assign(process.env,{STUDIO_DATA_ROOT:cfg.store,PORT:'3108'});
const {StudioService}=require('../dist/studio/studio.service');
(async()=>{const service=new StudioService({});try{let s=await service.load(cfg.sessionId);
 if(phase==='tts'||phase==='speed'){
  if(os.freemem()<384*1024**2)throw Error('RESOURCE_BEFORE_TTS');
  s=await service.runtime(s.id);console.log(JSON.stringify({runtime:s.voiceRuntime.status,voices:s.voiceRuntime.voices.map(v=>v.id),freeMiB:Math.round(os.freemem()/1024**2)}));if(s.voiceRuntime.status!=='READY')throw Error(s.voiceRuntime.blockers.join(';'));
  const memory=[];let resourceStop=false;const timer=setInterval(()=>{const free=Math.round(os.freemem()/1024**2);memory.push({at:Date.now(),freeMiB:free});if(free<128){resourceStop=true;service.voice.close();}},1000);
  try{for(const item of s.items.filter(i=>i.selected)){if(resourceStop||os.freemem()<384*1024**2)throw Error('RESOURCE_STOP_SEQUENTIAL_TTS');const t=Date.now();console.log('Generating DRAFT '+item.author.handle);s=await service.voiceAction(s.id,item.id,{revision:s.revision,action:'GENERATE',draft:true,voice:'my_yen',speed:phase==='speed'?1:1.2});const job=s.voiceJobs.at(-1);console.log(JSON.stringify({author:item.author.handle,job,elapsedMs:Date.now()-t,freeMiB:Math.round(os.freemem()/1024**2)}));if(job.status==='ERROR')throw Error(job.error);}}
  finally{clearInterval(timer);fs.writeFileSync(p.join(run,phase+'-memory.json'),JSON.stringify(memory,null,2));}
 }else if(phase==='preview'){
  const {prepareEditor}=require('../dist/studio/editor-adapter');const built=prepareEditor(s,[]);fs.writeFileSync(p.join(run,'preview.json'),JSON.stringify(built,null,2));console.log(JSON.stringify({duration:built.preview.request.inputProps.timeline.totalFrames/30,frames:built.preview.request.inputProps.timeline.totalFrames,missing:built.preview.missingAudioItemIds,warnings:built.preview.warnings},null,2));
 }else throw Error('UNKNOWN_PHASE');
}finally{service.onModuleDestroy()}})().catch(e=>{console.error('E2E01_STOP',e.message);process.exitCode=1});
