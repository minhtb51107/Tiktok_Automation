// One approved render, through existing RenderStore/Remotion and measured timeline.
const fs=require('fs'),p=require('path'),cp=require('child_process'),assert=require('assert/strict'),{randomUUID,createHash}=require('crypto');
const backend=p.resolve(__dirname,'..'),base=p.resolve(backend,'../../Tiktok_Automation_e2e01'),source=p.join(base,'run-media-narration03-tts01'),run=p.join(base,'run-media-narration03-render01');
const read=f=>JSON.parse(fs.readFileSync(f)),hash=x=>createHash('sha256').update(x).digest('hex'),write=(n,x)=>fs.writeFileSync(p.join(run,n),JSON.stringify(x,null,2));
const sourceCfg=read(p.join(source,'config.json')),v=read(p.join(source,'verification.json')),sourceFile=p.join(sourceCfg.store,sourceCfg.sessionId+'.json'),s=read(sourceFile);
assert.equal(v.status,'PASS_ACTUAL_DRAFT_WAV_NO_RENDER');assert.equal(v.timeline.totalFrames,1137);assert.equal(v.inputHash,'87ceca9ebeb418e37537166eaf89624df49bb7ab1eb089ffd1b0acb17756f7f5');
assert.equal(hash(fs.readFileSync(v.wav)),v.sha256);
if(process.argv[2]==='prepare'){
 if(fs.existsSync(run))throw Error('NO_OVERWRITE');fs.mkdirSync(p.join(run,'backend/.studio-data'),{recursive:true});
 const store=p.join(run,'backend/.studio-data');for(const dir of ['audio','conversation-media','source-images'])if(fs.existsSync(p.join(sourceCfg.store,dir)))fs.cpSync(p.join(sourceCfg.store,dir),p.join(store,dir),{recursive:true});
 fs.copyFileSync(sourceFile,p.join(store,s.id+'.json'));for(const dir of ['scripts','src','dist'])fs.symlinkSync(p.join(backend,dir),p.join(run,'backend',dir),'junction');fs.symlinkSync(p.resolve(backend,'../2_Remotion_Video'),p.join(run,'2_Remotion_Video'),'junction');
 const cached=p.join(base,'run-vid-quality02/backend/.studio-data/render-bundles');if(fs.existsSync(cached))fs.cpSync(cached,p.join(store,'render-bundles'),{recursive:true});
 write('config.json',{sessionId:s.id,store,cwd:p.join(run,'backend'),port:3111,sourceSessionHash:hash(fs.readFileSync(sourceFile))});console.log('SANDBOX_PREPARED_NO_RENDER');process.exit(0);
}
if(process.argv[2]!=='run')throw Error('USE_PREPARE_OR_RUN');
const cfg=read(p.join(run,'config.json')),approval=read(p.join(run,'approval.json'));
assert.equal(approval.confirmed,true);assert.equal(approval.scope,'MEDIA03_SINGLE_DRAFT_RENDER');assert.equal(approval.frames,1137);assert.equal(approval.tts,false);assert.equal(approval.evidence,'EXPLICIT_USER_CONFIRMATION');assert.ok(Date.now()-Date.parse(approval.authorizedAt)<1800000);
const local=read(p.join(source,'tts.local.json'));
const native=()=>JSON.parse(cp.execFileSync(local.STUDIO_PYTHON,['-B',p.join(backend,'scripts/kokoro_memory.py')],{encoding:'utf8',windowsHide:true,timeout:5000}));
(async()=>{
 const attempt=fs.openSync(p.join(run,'attempt.json'),'wx');fs.writeFileSync(attempt,JSON.stringify({at:new Date().toISOString(),approvalId:approval.id,retry:false}));fs.closeSync(attempt);
 const {LOCAL_PROBE_LEASE}=require('../dist/studio/local-probe-lease'),token=randomUUID();fs.writeFileSync(LOCAL_PROBE_LEASE,JSON.stringify({pid:process.pid,token,purpose:'APPROVED_MEDIA03_RENDER'}),{flag:'wx'});
 let observer,guard,timer,jobs,job,report={status:'NOT_STARTED',sourceHash:cfg.sourceSessionHash,events:[],samples:[]},workerDone=false;
 try{
  const audit=JSON.parse(cp.execFileSync('powershell.exe',['-NoProfile','-NonInteractive','-File',p.join(backend,'scripts/studio-resource-audit.ps1')],{encoding:'utf8',windowsHide:true,timeout:25000})),memory=native();report.before={audit,memory};write('before.json',report.before);
  console.log(JSON.stringify({stage:'Pre-render resources',memory}));
  if(audit.workers.some(w=>/python/i.test(w.name)||['RENDER_WORKER','COLLECTOR_WORKER'].includes(w.role)))throw Error('CONFLICTING_HEAVY_WORKER');
  if(memory.availableMiB<256||memory.systemCommitAvailableMiB<512)throw Error('RESOURCE_GUARD_STOP_BEFORE_RENDER');
  const disk=fs.statfsSync(run);assert.ok(Number(disk.bavail)*Number(disk.bsize)>3*1024**3,'3 GiB disk required');
  const browser=['C:/Program Files/Google/Chrome/Application/chrome.exe','C:/Program Files (x86)/Google/Chrome/Application/chrome.exe','C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(f=>fs.existsSync(f));assert.ok(browser,'NO_BROWSER_NO_DOWNLOAD');
  for(const k of Object.keys(process.env))if(!/^(PATH|SYSTEMROOT|WINDIR|TEMP|TMP|USERPROFILE|APPDATA|LOCALAPPDATA|PROGRAMFILES(?:\(X86\))?|COMSPEC|PATHEXT|NUMBER_OF_PROCESSORS|PROCESSOR_ARCHITECTURE|OS|SYSTEMDRIVE)$/i.test(k))delete process.env[k];
  process.chdir(cfg.cwd);process.env.STUDIO_DATA_ROOT=cfg.store;
  const {prepareEditor}=require('../dist/studio/editor-adapter'),{renderValidation}=require('../dist/studio/render-policy'),{RenderStore}=require('../dist/studio/render-store'),{StudioJobs}=require('../dist/studio/progress');
  const copy=read(p.join(cfg.store,s.id+'.json'));assert.equal(hash(JSON.stringify(copy)),hash(JSON.stringify(s)));
  const props=prepareEditor(copy,[]).preview.request.inputProps,validation=renderValidation(copy,props);assert.deepEqual(validation.blockers,[]);assert.equal(props.timeline.totalFrames,1137);assert.equal(props.timeline.fps,30);assert.ok(props.timeline.scenes.every(t=>t.subtitles.length===0));
  // Exact approved root WAV and the two original cache files, all local and unchanged.
  for(const a of props.audioAssets){const asset=copy.voiceAssets.find(x=>x.id===a.id);assert.ok(asset);assert.ok(fs.existsSync(p.join(cfg.store,asset.filePath)));}
  assert.equal(hash(fs.readFileSync(p.join(cfg.store,v.wav.slice(sourceCfg.store.length+1)))),v.sha256);
  const store=new RenderStore();jobs=new StudioJobs();
  job=await jobs.submit(copy.id,'render',{revision:copy.revision,requestId:approval.id,mode:'DRAFT',preset:'720P'},async(tick,id)=>{
   const manifest={schemaVersion:1,backgroundMode:'SAVED',jobId:id,sessionId:copy.id,projectId:copy.project.id,revision:copy.revision,timelineHash:hash(JSON.stringify(props.timeline)),previewHash:hash(JSON.stringify(props)),mode:'DRAFT',publishable:false,status:'QUEUED',width:720,height:1280,fps:30,totalFrames:1137,frameRange:[0,1136],expectedDurationSeconds:37.9,sceneCount:3,codec:'h264',audioCodec:'aac',pixelFormat:'yuv420p',concurrency:1,startedAt:new Date().toISOString(),completedAt:null,bytes:null,warnings:['DRAFT: not approved for publishing',...validation.finalBlockers],error:null,metrics:{}};
   write('approved-snapshot.json',{props,manifest});report.jobId=id;
   const out=await store.run({props,manifest,browserExecutable:browser,appOrigin:'http://127.0.0.1:3111'},jobs,async(step,completed,total)=>{await tick(step,completed,total);report.events.push({at:new Date().toISOString(),step,completed,total});write('checkpoint.json',{jobId:id,events:report.events,samples:report.samples.slice(-8)});if(step!=='Encoding')console.log(JSON.stringify({stage:step,completed,total}));});
   return {revision:copy.revision,warnings:out.warnings};
  });
  // Lightweight native observer only, not Kokoro. Full resource guard, independent of render samples.
  const code='import sys,time,json\nsys.path.insert(0,sys.argv[1])\nfrom kokoro_memory import memory_sample\nfor _ in range(2400):\n print(json.dumps(memory_sample()),flush=True)\n time.sleep(0.25)';
  observer=cp.spawn(local.STUDIO_PYTHON,['-u','-B','-c',code,p.join(backend,'scripts')],{windowsHide:true});let buffer='';
  observer.stdout.on('data',b=>{buffer+=b.toString();let n;while((n=buffer.indexOf('\n'))>=0){const sample=JSON.parse(buffer.slice(0,n));buffer=buffer.slice(n+1);report.samples.push(sample);if(sample.availableMiB<256||sample.systemCommitAvailableMiB<512){report.guardStop=true;void jobs.cancel(job.jobId)}}});
  guard=setInterval(()=>{if(require('os').freemem()<256*1024**2){report.guardStop=true;void jobs.cancel(job.jobId)}},250);
  timer=setTimeout(()=>{report.timeout=true;void jobs.cancel(job.jobId)},600000);
  while(true){const state=await jobs.load(job.jobId);if(!['QUEUED','RUNNING'].includes(state.status)){report.job=state;break}await new Promise(r=>setTimeout(r,1000));}
  workerDone=true;report.manifest=await store.load(copy.id,job.jobId);report.status=report.manifest.status;if(report.status!=='COMPLETED')throw Error(report.guardStop?'RESOURCE_GUARD_STOP':report.timeout?'TIMEOUT':report.manifest.error||report.status);
 }catch(e){report.error=e.message;report.status=report.guardStop?'RESOURCE_GUARD_STOP':report.timeout?'TIMEOUT':'FAILED';process.exitCode=1;}
 finally{
  clearInterval(guard);clearTimeout(timer);if(observer){const exited=new Promise(resolve=>observer.once('close',resolve));observer.kill();await exited;}
  report.after=native();report.sourceUnchanged=hash(fs.readFileSync(sourceFile))===cfg.sourceSessionHash;report.workerDone=workerDone;write('report.json',report);
  if((workerDone||!job)&&read(LOCAL_PROBE_LEASE).token===token)fs.unlinkSync(LOCAL_PROBE_LEASE);
  console.log(JSON.stringify({status:report.status,error:report.error,jobId:report.jobId,sourceUnchanged:report.sourceUnchanged,after:report.after}));
 }
})().catch(e=>{console.error(e.message);process.exitCode=1});
