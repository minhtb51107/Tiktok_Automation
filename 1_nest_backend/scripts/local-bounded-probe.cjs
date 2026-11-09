// PREPARE/REFRESH never imports Torch. RUN requires a separately recorded user approval.
const fs=require('fs'),p=require('path'),{execFileSync}=require('child_process'),{createHash,randomUUID}=require('crypto');
const backend=p.resolve(__dirname,'..'),base=p.resolve(backend,'../../Tiktok_Automation_e2e01'),root=p.resolve(process.argv[2]||''),mode=process.argv[3]||'prepare',source=p.join(base,'run-media-narration02');
if(p.dirname(root)!==base||!/^run-local-bounded-probe[\w-]*$/.test(p.basename(root)))throw Error('DEDICATED_PROBE_SANDBOX_REQUIRED');
const read=f=>JSON.parse(fs.readFileSync(f)),hash=x=>createHash('sha256').update(x).digest('hex'),write=(name,x)=>fs.writeFileSync(p.join(root,name),JSON.stringify(x,null,2));
const {KokoroRuntime,textHash}=require('../dist/studio/kokoro-runtime'),{TTS_RESOURCE_POLICY,ttsResourceWarnings,ttsResourceBlock,ttsFailureCategory,TtsExecutionError}=require('../dist/studio/tts-resource-policy'),{LOCAL_PROBE_LEASE}=require('../dist/studio/local-probe-lease');
const {speechProjection,SPEECH_DICTIONARY_VERSION}=require('../dist/studio/speech-dictionary'),{normalizeSpokenNumbers,NUMBER_READING_VERSION}=require('../dist/studio/spoken-numbers');
function localConfig(){const cfg=read(p.join(source,'tts.local.json'));for(const [k,v]of Object.entries(cfg))if(!/^STUDIO_(PYTHON|KOKORO_SOURCE|KOKORO_MODEL|KOKORO_CONFIG|KOKORO_VOICE_DIR|TTS_DEVICE)$/.test(k)||typeof v!=='string')throw Error('INVALID_LOCAL_CONFIGURATION');return cfg;}
function native(cfg){return JSON.parse(execFileSync(cfg.STUDIO_PYTHON,['-B',p.join(__dirname,'kokoro_memory.py')],{encoding:'utf8',windowsHide:true,timeout:5000}));}
function disclose(cfg,approval='NOT_GRANTED'){const audit=JSON.parse(execFileSync('powershell.exe',['-NoProfile','-NonInteractive','-File',p.join(__dirname,'studio-resource-audit.ps1')],{encoding:'utf8',windowsHide:true,timeout:20000}));const memory={...native(cfg),measurementRole:'OBSERVER_NOT_KOKORO'};return {at:new Date().toISOString(),audit,memory,warnings:ttsResourceWarnings(memory.availableMiB*1024**2),benchmark:'NOT_RUN',approval};}
function sourceSession(){const cfg=read(p.join(source,'config.json')),file=p.join(cfg.store,cfg.sessionId+'.json');return {cfg,file,s:read(file),sha:hash(fs.readFileSync(file))};}
(async()=>{
 const cfg=localConfig();
 if(mode==='prepare'){
  if(fs.existsSync(root))throw Error('NO_OVERWRITE');const original=sourceSession(),item=original.s.items.find(i=>i.inclusion==='TARGET'),ocr=Object.values(item.mediaOcr||{}).find(o=>o.review==='REVIEWED'&&o.mode==='READ_FULL');if(!ocr)throw Error('REVIEWED_IMAGE_TEXT_REQUIRED');
  const excerpt=ocr.correctedText.replace(/^[“"\s]+/u,'').split(/(?<=[.!?])\s/u)[0],normalized=normalizeSpokenNumbers(speechProjection(excerpt,item.pronunciationOverrides).text);if(normalized.warnings.length||[...normalized.text].length>TTS_RESOURCE_POLICY.probeMaxCharacters)throw Error('SHORT_UNAMBIGUOUS_PROBE_TEXT_REQUIRED');
  fs.mkdirSync(root,{recursive:false});const plan={version:'local-bounded-probe/1',planId:randomUUID(),probeSessionId:randomUUID(),createdAt:new Date().toISOString(),mode:'LOCAL_BOUNDED_PROBE',purpose:'DRAFT_PROBE_NOT_SCENE_AUDIO',sourceSessionId:original.s.id,sourceRevision:original.s.revision,sourceHash:original.sha,sourceItemId:item.id,ocrReviewer:ocr.reviewer,inputText:normalized.text,inputHash:textHash(normalized.text),normalizationVersion:NUMBER_READING_VERSION+' / '+SPEECH_DICTIONARY_VERSION,voice:'my_yen',speed:1.3,workerLimit:1,inferenceLimit:1,modelTimeoutMs:90000,totalTimeoutMs:120000,policy:TTS_RESOURCE_POLICY};
  write('plan.json',plan);fs.copyFileSync(p.join(source,'tts.local.json'),p.join(root,'tts.local.json'));fs.mkdirSync(p.join(root,'backend'));fs.symlinkSync(p.join(backend,'scripts'),p.join(root,'backend','scripts'),'junction');write('disclosure.json',disclose(cfg));console.log(JSON.stringify({plan,disclosure:read(p.join(root,'disclosure.json')),status:'AWAITING_EXPLICIT_USER_APPROVAL'},null,2));return;
 }
 const plan=read(p.join(root,'plan.json'));
 if(mode==='refresh'){
  if(sourceSession().sha!==plan.sourceHash)throw Error('SOURCE_CHANGED: prepare a new plan; do not rewrite the old selection');
  if(fs.existsSync(p.join(root,'approval.json'))||fs.existsSync(p.join(root,'attempt.json')))throw Error('CANNOT_REWRITE_APPROVED_OR_ATTEMPTED_DISCLOSURE');write('disclosure.json',disclose(cfg));console.log(JSON.stringify({planId:plan.planId,disclosure:read(p.join(root,'disclosure.json')),status:'AWAITING_EXPLICIT_USER_APPROVAL'},null,2));return;
 }
 if(mode!=='run')throw Error('UNKNOWN_MODE');
 // Only a human/operator records this AFTER an actual user confirmation; prepare never does.
 if(!fs.existsSync(p.join(root,'approval.json')))throw Error('EXPLICIT_USER_APPROVAL_REQUIRED: no worker started');
 const approval=read(p.join(root,'approval.json')),disclosure=read(p.join(root,'disclosure.json'));
 if(approval.confirmed!==true||approval.scope!=='LOCAL_BOUNDED_PROBE'||approval.planId!==plan.planId||approval.planHash!==hash(JSON.stringify(plan))||approval.inputHash!==plan.inputHash||approval.disclosureHash!==hash(JSON.stringify(disclosure))||approval.evidence!=='EXPLICIT_USER_CONFIRMATION'||!Number.isFinite(Date.parse(approval.authorizedAt))||Date.now()-Date.parse(approval.authorizedAt)>30*60*1000||Date.parse(approval.authorizedAt)>Date.now()+5000)throw Error('VALID_EXPLICIT_USER_APPROVAL_REQUIRED');
 if(sourceSession().sha!==plan.sourceHash||textHash(plan.inputText)!==plan.inputHash||plan.voice!=='my_yen'||plan.speed!==1.3||plan.mode!=='LOCAL_BOUNDED_PROBE'||[...plan.inputText].length>TTS_RESOURCE_POLICY.probeMaxCharacters)throw Error('APPROVED_PLAN_OR_SOURCE_CHANGED');
 const once=fs.openSync(p.join(root,'attempt.json'),'wx');fs.writeFileSync(once,JSON.stringify({startedAt:new Date().toISOString(),planId:plan.planId,automaticRetry:false}));fs.closeSync(once);
 const token=randomUUID(),lease={pid:process.pid,token,planId:plan.planId,createdAt:new Date().toISOString()};const lock=fs.openSync(LOCAL_PROBE_LEASE,'wx');fs.writeFileSync(lock,JSON.stringify(lease));fs.closeSync(lock);
 const runtime=new KokoroRuntime(),events=[];let forcedStop=false,forcedTimeout=false,result=null,error=null,exitConfirmed=false,before=null,after=null,timer,metadata=null;const started=Date.now(),deadline=setTimeout(()=>{forcedTimeout=true;runtime.close()},120000);
 try{
  before=disclose(cfg,'USER_APPROVED_BOUNDED_PROBE');write('before.json',before);
  if(before.audit.workers.some(w=>/python/i.test(w.name)))throw Error('OTHER_PYTHON_WORKER_PRESENT: no probe started');
  if(before.audit.workers.some(w=>['RENDER_WORKER','COLLECTOR_WORKER'].includes(w.role)))throw Error('OTHER_HEAVY_PROJECT_WORKER_PRESENT: no probe started');
  const jobsDir=p.join(sourceSession().cfg.store,'jobs');if(fs.existsSync(jobsDir)&&fs.readdirSync(jobsDir).filter(n=>n.endsWith('.json')).some(n=>['RUNNING','QUEUED'].includes(read(p.join(jobsDir,n)).status)))throw Error('ACTIVE_OR_UNRESOLVED_STUDIO_JOB: no probe started');
  const block=ttsResourceBlock(before.memory.availableMiB*1024**2);if(block||before.memory.systemCommitAvailableMiB<TTS_RESOURCE_POLICY.commitStopMiB)throw new TtsExecutionError('RESOURCE_GUARD_STOP',block||'System commit emergency floor');
  // Isolated environment and CWD: no .env, OAuth vault, API token or project mutation.
  for(const k of Object.keys(process.env))if(!/^(PATH|SYSTEMROOT|WINDIR|TEMP|TMP|USERPROFILE|APPDATA|LOCALAPPDATA|PROGRAMFILES(?:\(X86\))?|COMSPEC|PATHEXT|NUMBER_OF_PROCESSORS|PROCESSOR_ARCHITECTURE|OS|SYSTEMDRIVE)$/i.test(k))delete process.env[k];Object.assign(process.env,cfg);process.chdir(p.join(root,'backend'));process.env.STUDIO_DATA_ROOT=p.join(root,'backend/.studio-data');
  runtime.onStage=stage=>{events.push({at:new Date().toISOString(),stage});write('checkpoint.json',{planId:plan.planId,events,diagnostics:runtime.diagnostics()});};
  timer=setInterval(()=>{if(require('os').freemem()/1024**2<TTS_RESOURCE_POLICY.stopMiB){forcedStop=true;runtime.close();}},250);
  metadata=await runtime.preflight();if(metadata.status!=='READY')throw Error('CONFIGURATION_NOT_READY: no inference started');if(forcedTimeout)throw new TtsExecutionError('TIMEOUT','Probe total deadline exceeded before inference');
  result=await runtime.generate(plan.probeSessionId,plan.inputText,plan.voice,plan.speed,metadata,true,{itemId:plan.sourceItemId,normalizationVersion:plan.normalizationVersion},{mode:'LOCAL_BOUNDED_PROBE',approved:true,approvalId:plan.planId,leaseToken:token});
 }catch(e){error={category:forcedStop?'RESOURCE_GUARD_STOP':forcedTimeout?'TIMEOUT':ttsFailureCategory(e),message:e.message,evidence:e.evidence||null};}
 finally{
  clearTimeout(deadline);if(timer)clearInterval(timer);
  try{await runtime.closeAndWait();exitConfirmed=true;}catch(e){error??={category:'TIMEOUT',message:e.message};}
  const elapsedMs=Date.now()-started;
  try{after={systemObserver:native(cfg),pagefiles:JSON.parse(execFileSync('powershell.exe',['-NoProfile','-NonInteractive','-Command','@(Get-CimInstance Win32_PageFileUsage | Select-Object Name,AllocatedBaseSize,CurrentUsage,PeakUsage) | ConvertTo-Json -Compress'],{encoding:'utf8',windowsHide:true,timeout:10000})),workerExited:exitConfirmed,workerRssAfterExit:null};}catch{after={measurement:'UNAVAILABLE',workerExited:exitConfirmed,workerRssAfterExit:null};}
  const diagnostics=runtime.diagnostics(),out={status:error?(diagnostics.ownedWorkerPid?'FAILED':'NOT_RUN'):'AUDIO_GENERATED_DRAFT_PROBE',planId:plan.planId,purpose:plan.purpose,executionConsent:true,editorialApproval:false,audioApproval:false,publishing:false,elapsedMs,events,before,after,runtimeMetadata:metadata,result,error,diagnostics,windowsOomEvidence:null,windowsEventCheck:'NOT_PERFORMED',automaticRetry:false,thresholdBenchmark:'NO_GENERAL_MINIMUM_ESTABLISHED',productionModified:false};
  out.leaseRetained=!exitConfirmed;
  try{write('report.json',out);}finally{if(exitConfirmed&&fs.existsSync(LOCAL_PROBE_LEASE)){const current=read(LOCAL_PROBE_LEASE);if(current.token===token&&current.pid===process.pid)fs.unlinkSync(LOCAL_PROBE_LEASE);}}
  console.log(JSON.stringify(out,null,2));if(error)process.exitCode=1;
 }
})().catch(e=>{console.error(e.message);process.exitCode=1});
