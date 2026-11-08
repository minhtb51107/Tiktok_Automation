// One explicitly approved local DRAFT attempt. No server, render, network or retry.
const fs=require('fs'),p=require('path'),cp=require('child_process'),assert=require('assert/strict'),{createHash,randomUUID}=require('crypto');
const backend=p.resolve(__dirname,'..'),base=p.resolve(backend,'../../Tiktok_Automation_e2e01');
const sourceRun=p.join(base,'run-media-narration02'),run=p.join(base,'run-media-narration03-tts01');
const planFile=p.join(base,'run-media-narration03-plan-1794160303822/plan.json');
const read=f=>JSON.parse(fs.readFileSync(f)),hash=x=>createHash('sha256').update(x).digest('hex');
const write=(name,data)=>fs.writeFileSync(p.join(run,name),JSON.stringify(data,null,2));
const expected='87ceca9ebeb418e37537166eaf89624df49bb7ab1eb089ffd1b0acb17756f7f5';
const plan=read(planFile),cfg=read(p.join(sourceRun,'config.json')),sourceFile=p.join(cfg.store,cfg.sessionId+'.json');
assert.equal(hash(fs.readFileSync(planFile)),'e860b8308c2aa3da2811acf7eb5314b524224ac7bbab51f8a18fbe95845c409c');
assert.equal(hash(fs.readFileSync(sourceFile)),plan.source.sha256);
const original=read(sourceFile),input=plan.inputs.find(i=>i.inclusion==='TARGET');
assert.equal(input.inputHash,expected);assert.equal(hash(input.text),expected);assert.equal([...input.text].length,591);
const {speechProjection}=require('../dist/studio/speech-dictionary'),{normalizeSpokenNumbers}=require('../dist/studio/spoken-numbers');
const target=original.items.find(i=>i.id===input.itemId);
assert.equal(hash(normalizeSpokenNumbers(speechProjection(target.spokenText,target.pronunciationOverrides).text).text),expected);
assert.equal(target.voiceSettings.voice,'my_yen');assert.equal(target.voiceSettings.speed,1.3);
assert.equal(Object.values(target.mediaOcr)[0].reviewer,'AGENT_VISUAL');
const local=read(p.join(sourceRun,'tts.local.json'));
for(const [key,value]of Object.entries(local))assert.ok(/^STUDIO_(PYTHON|KOKORO_SOURCE|KOKORO_MODEL|KOKORO_CONFIG|KOKORO_VOICE_DIR|TTS_DEVICE)$/.test(key)&&typeof value==='string');
assert.equal(local.STUDIO_TTS_DEVICE,'cpu');
const {TTS_RESOURCE_POLICY,DRAFT_TTS_LIMITS,TtsExecutionError,ttsFailureCategory}=require('../dist/studio/tts-resource-policy');
assert.equal(TTS_RESOURCE_POLICY.stopMiB,256);assert.equal(TTS_RESOURCE_POLICY.commitStopMiB,512);
assert.equal(DRAFT_TTS_LIMITS.workerTimeoutMs,240000);assert.equal(DRAFT_TTS_LIMITS.totalTimeoutMs,300000);
if(process.argv[2]==='check'){console.log('PASS_PLAN_INPUT_SOURCE_POLICY_CHECK_ONLY_NO_TTS');process.exit(0)}
if(process.argv[2]==='prepare'){
 if(fs.existsSync(run))throw Error('NO_OVERWRITE_EXISTING_ATTEMPT');fs.mkdirSync(p.join(run,'backend/.studio-data'),{recursive:true});
 const store=p.join(run,'backend/.studio-data');
 for(const dir of ['audio','conversation-media','source-images'])if(fs.existsSync(p.join(cfg.store,dir)))fs.cpSync(p.join(cfg.store,dir),p.join(store,dir),{recursive:true});
 fs.copyFileSync(sourceFile,p.join(store,original.id+'.json'));fs.copyFileSync(p.join(sourceRun,'tts.local.json'),p.join(run,'tts.local.json'));
 fs.symlinkSync(p.join(backend,'scripts'),p.join(run,'backend/scripts'),'junction');
 write('config.json',{sessionId:original.id,store,cwd:p.join(run,'backend'),sourceSession:original.id,sourceRoot:cfg.store,port:3110,speed:1.3});
 write('plan.json',plan);console.log(JSON.stringify({status:'SANDBOX_PREPARED_NO_TTS',run}));process.exit(0);
}
if(process.argv[2]!=='run')throw Error('USE_CHECK_PREPARE_OR_RUN');
const approval=read(p.join(run,'approval.json'));
assert.equal(approval.confirmed,true);assert.equal(approval.inputHash,expected);assert.equal(approval.scope,'MEDIA_NARRATION03_SINGLE_DRAFT');
assert.equal(approval.evidence,'EXPLICIT_USER_CONFIRMATION');assert.equal(approval.renderApproved,false);
assert.ok(Date.now()-Date.parse(approval.authorizedAt)<30*60*1000&&Date.parse(approval.authorizedAt)<=Date.now());
assert.equal(hash(fs.readFileSync(p.join(run,'plan.json'))),hash(JSON.stringify(plan,null,2)));
const outCfg=read(p.join(run,'config.json'));assert.equal(outCfg.store,p.join(run,'backend/.studio-data'));
const native=()=>JSON.parse(cp.execFileSync(local.STUDIO_PYTHON,['-B',p.join(__dirname,'kokoro_memory.py')],{encoding:'utf8',windowsHide:true,timeout:5000}));
(async()=>{
 const once=fs.openSync(p.join(run,'attempt.json'),'wx');fs.writeFileSync(once,JSON.stringify({at:new Date().toISOString(),approvalId:approval.approvalId,automaticRetry:false}));fs.closeSync(once);
 const {LOCAL_PROBE_LEASE}=require('../dist/studio/local-probe-lease'),token=randomUUID();
 const lock=fs.openSync(LOCAL_PROBE_LEASE,'wx');fs.writeFileSync(lock,JSON.stringify({pid:process.pid,token,approvalId:approval.approvalId}));fs.closeSync(lock);
 let service,before,after,error=null,result=null,timer,guard,started,elapsedMs,exitConfirmed=false,forcedStop=false,forcedTimeout=false;
 const events=[];
 try{
  before={audit:JSON.parse(cp.execFileSync('powershell.exe',['-NoProfile','-NonInteractive','-File',p.join(__dirname,'studio-resource-audit.ps1')],{encoding:'utf8',windowsHide:true,timeout:25000})),memory:native()};write('before.json',before);
  console.log(JSON.stringify({stage:'Fresh resource preflight',memory:before.memory,workers:before.audit.workers.map(w=>({pid:w.pid,role:w.role,kind:w.kind}))}));
  if(before.audit.workers.some(w=>/python/i.test(w.name)||['RENDER_WORKER','COLLECTOR_WORKER'].includes(w.role)))throw Error('CONFLICTING_WORKER_PRESENT_NO_TTS_STARTED');
  const jobsDir=p.join(cfg.store,'jobs');if(fs.existsSync(jobsDir)&&fs.readdirSync(jobsDir).filter(n=>n.endsWith('.json')).some(n=>['RUNNING','QUEUED'].includes(read(p.join(jobsDir,n)).status)))throw Error('ACTIVE_OR_UNRESOLVED_STUDIO_JOB');
  if(before.memory.availableMiB<256||before.memory.systemCommitAvailableMiB<512)throw new TtsExecutionError('RESOURCE_GUARD_STOP','Emergency reserve before start; no inference');
  for(const k of Object.keys(process.env))if(!/^(PATH|SYSTEMROOT|WINDIR|TEMP|TMP|USERPROFILE|APPDATA|LOCALAPPDATA|PROGRAMFILES(?:\(X86\))?|COMSPEC|PATHEXT|NUMBER_OF_PROCESSORS|PROCESSOR_ARCHITECTURE|OS|SYSTEMDRIVE)$/i.test(k))delete process.env[k];
  Object.assign(process.env,local,{STUDIO_DATA_ROOT:outCfg.store,STUDIO_DATA04_MEDIA_ROOT:p.join(outCfg.store,'conversation-media')});process.chdir(outCfg.cwd);
  const deny=()=>{throw Error('MEDIA03_NETWORK_DISABLED')};for(const mod of ['node:http','node:https']){require(mod).request=deny;require(mod).get=deny}global.fetch=deny;
  require('reflect-metadata');const {StudioService}=require('../dist/studio/studio.service');service=new StudioService({});
  service.voice.onStage=stage=>{events.push({at:new Date().toISOString(),stage});write('checkpoint.json',{events,diagnostics:service.voice.diagnostics()});console.log(JSON.stringify({stage,at:new Date().toISOString()}));};
  started=Date.now();timer=setTimeout(()=>{forcedTimeout=true;service.voice.close()},300000);
  guard=setInterval(()=>{if(require('os').freemem()/1024**2<256){forcedStop=true;service.voice.close()}},250);
  const execution={mode:'LOCAL_DRAFT_BATCH',approved:true,approvalId:approval.approvalId,leaseToken:token,inputHash:expected,deadlineAt:started+300000};
  const saved=await service.voiceAction(original.id,input.itemId,{action:'GENERATE',revision:original.revision,draft:true},execution);
  const job=saved.voiceJobs.at(-1);if(job.status==='ERROR')throw new TtsExecutionError(job.failureCategory||'UNKNOWN',job.error||'TTS failed');
  const asset=saved.voiceAssets.find(a=>a.id===job.assetId);assert.equal(asset.purpose,'DRAFT');assert.equal(asset.approvedAt,null);assert.equal(asset.ttsInputHash,expected);assert.equal(asset.synthesisPerformed,true);assert.equal(asset.synthesisMetrics.sentenceChunks,6);
  // Preserve every source item, OCR, lock and item revision; only sandbox audio state changes.
  assert.deepEqual(saved.items,original.items);result={asset,sessionRevision:saved.revision};
 }catch(e){error={category:forcedStop?'RESOURCE_GUARD_STOP':forcedTimeout?'TIMEOUT':ttsFailureCategory(e),message:e.message,evidence:e.evidence??null};}
 finally{
  clearTimeout(timer);clearInterval(guard);
  try{if(service)await service.voice.closeAndWait();exitConfirmed=true}catch(e){error??={category:'TIMEOUT',message:e.message}}
  elapsedMs=started?Date.now()-started:null;
  try{after={memory:native(),pagefiles:JSON.parse(cp.execFileSync('powershell.exe',['-NoProfile','-NonInteractive','-Command','@(Get-CimInstance Win32_PageFileUsage | Select-Object Name,AllocatedBaseSize,CurrentUsage,PeakUsage) | ConvertTo-Json -Compress'],{encoding:'utf8',windowsHide:true,timeout:10000}))}}catch{after={measurement:'UNAVAILABLE'}}
  const diagnostics=service?.voice.diagnostics()??null,sourcePreserved=hash(fs.readFileSync(sourceFile))===plan.source.sha256;
  const report={status:error?'FAILED':'WAV_DRAFT_GENERATED',elapsedMs,result,error,before,after,events,diagnostics,workerExitConfirmed:exitConfirmed,sourcePreserved,editorialApproval:false,render:'NOT_AUTHORIZED_NOT_RUN',automaticRetry:false,windowsOomEvidence:null};write('report.json',report);
  if(exitConfirmed&&read(LOCAL_PROBE_LEASE).token===token)fs.unlinkSync(LOCAL_PROBE_LEASE);
  console.log(JSON.stringify({status:report.status,error,elapsedMs,workerExitConfirmed:exitConfirmed,sourcePreserved,run}));if(error||!sourcePreserved)process.exitCode=1;
 }
})().catch(e=>{console.error(e.message);process.exitCode=1});
