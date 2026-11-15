// Single-use browser-only acceptance. No API/provider/AI/TTS/render/publishing calls.
const fs=require('fs'),fsp=fs.promises,p=require('path'),cp=require('child_process');
const {createHash,randomUUID}=require('crypto');
const backend=p.resolve(__dirname,'..'),out=p.join(backend,'.studio-data/reports/threads-acquisition03-live01');
const target='https://www.threads.com/@gnrtth/post/DeI-TuzEc_9';
const plan={id:'threads-acquisition03-live01',target,browserWorkers:1,totalBudgetMs:180000,maxActions:4,maxAdmittedRequests:150,maxSubjectCards:40,maxPermalinkDetails:2,retry:false,apify:false,qwen:false,tts:false,render:false,publishing:false};
const write=(name,value)=>fs.writeFileSync(p.join(out,name),JSON.stringify(value,null,2),{mode:0o600});
const read=name=>JSON.parse(fs.readFileSync(p.join(out,name),'utf8'));
const sha=value=>createHash('sha256').update(typeof value==='string'?value:JSON.stringify(value)).digest('hex');
async function files(root){const out=[];async function visit(dir){if(!fs.existsSync(dir))return;for(const entry of await fsp.readdir(dir,{withFileTypes:true})){const file=p.join(dir,entry.name);if(entry.isDirectory())await visit(file);else if(entry.isFile())out.push(file)}}await visit(root);return out.sort()}
async function fileHash(file){return new Promise((resolve,reject)=>{const h=createHash('sha256'),s=fs.createReadStream(file);s.on('data',b=>h.update(b));s.on('error',reject);s.on('end',()=>resolve(h.digest('hex')))})}
async function manifest(root){const rows=[];for(const file of await files(root)){const stat=await fsp.stat(file);rows.push({file:p.relative(root,file).replace(/\\/g,'/'),bytes:stat.size,sha256:await fileHash(file)})}return {root,fileCount:rows.length,hash:sha(rows),rows}}
if(process.argv[2]!=='run'){console.log(JSON.stringify({mode:'PLAN_ONLY_NO_NETWORK',plan,authorization:'The attached THREADS-ACQUISITION-03 request authorizes exactly one browser-only run.'},null,2));process.exit(0)}
(async()=>{
 fs.mkdirSync(out,{recursive:true});
 if(fs.existsSync(p.join(out,'attempt.json')))throw Error('THREADS_ACQUISITION03_ATTEMPT_ALREADY_CONSUMED');
 if(process.env.THREADS_ACQUISITION03_APPROVED!==target)throw Error('THREADS_ACQUISITION03_EXACT_TARGET_AUTHORIZATION_REQUIRED');
 const audit=JSON.parse(cp.execFileSync('powershell.exe',['-NoProfile','-NonInteractive','-File',p.join(__dirname,'studio-resource-audit.ps1')],{encoding:'utf8',windowsHide:true,timeout:25000}));
 write('resource-before.json',audit);
 const reserve=audit.commitLimitMiB-audit.commitUsedMiB;
 if(audit.availableMiB<256||reserve<512)throw Error('THREADS_ACQUISITION03_RESOURCE_PREFLIGHT_STOP');
 if(audit.workers.some(w=>['RENDER_WORKER','KOKORO_WORKER','COLLECTOR_WORKER'].includes(w.role)))throw Error('THREADS_ACQUISITION03_CONFLICTING_WORKER');
 const production=p.resolve(backend,'../../Tiktok_Automation/1_nest_backend/.studio-data'),before=await manifest(production);write('production-before.json',before);
 const token=randomUUID(),lock=p.join(backend,'.threads-acquisition03.lock');
 fs.writeFileSync(lock,JSON.stringify({pid:process.pid,token,purpose:plan.id}),{flag:'wx'});
 const report={plan,status:'RUNNING',execution:'LIVE_BROWSER_ONLY_NOT_REPLAY',startedAt:new Date().toISOString(),visits:[],error:null,productionPreserved:null};
 try{
  for(const key of Object.keys(process.env))if(!/^(PATH|SYSTEMROOT|WINDIR|TEMP|TMP|USERPROFILE|APPDATA|LOCALAPPDATA|COMSPEC|PATHEXT|STUDIO_PYTHON|STUDIO_BROWSER)$/i.test(key))delete process.env[key];
  process.env.STUDIO_DATA_ROOT=p.join(out,'studio-store');process.env.STUDIO_DATA04_MEDIA_ROOT=p.join(out,'media');
  write('attempt.json',{plan,authorizationSource:'USER_ATTACHED_THREADS_ACQUISITION_03',at:report.startedAt,pid:process.pid,retries:0});
  const {enrichConversation}=require('../dist/data-engine/conversation-public');
  const evidence=async(page,snapshot)=>{
   write('browser-evidence.json',{...snapshot,capturedAt:new Date().toISOString(),classification:'RAW_PUBLIC_BROWSER_EVIDENCE',credentialsCaptured:false,cookiesCaptured:false,storageCaptured:false});
   await page.screenshot({path:p.join(out,'conversation-surface.png'),type:'png',captureBeyondViewport:false});
  };
  const collection=await enrichConversation(target,event=>{report.visits.push(event);write('report.json',report)},evidence);
  write('collection.json',collection);
  const {sourceQualityAdapter}=require('../dist/data-engine/conversation-extraction-v2'),normalized=sourceQualityAdapter(collection,'SERIOUS');
  const initialSubjects=collection.acquisition?.snapshots[0]?.subjectCards||0,finalSubjects=collection.observationSummary?.subjectPermalinks||0;
  const rawRows=collection.acquisition?read('browser-evidence.json').observed.rows:[];
  const innerLinks=[...new Set(rawRows.flatMap(row=>(row.urls||[]).filter(url=>url!==row.subjectUrl)))];
  const observedAcross=(collection.acquisition?.snapshots||[]).reduce((sum,row)=>sum+row.subjectCards,0);
  report.metrics={reportedReplies:collection.reportedReplyCount,subjectCards:finalSubjects,fullCards:collection.observationSummary?.materializedCards||0,fullBodyExtractionRate:finalSubjects?Number(((collection.observationSummary.materializedCards/finalSubjects)*100).toFixed(2)):null,newSubjectsAfterActions:Math.max(0,finalSubjects-initialSubjects),verifiedReplies:collection.verifiedReplyCount,observedConversation:normalized.counts.observedConversation,relatedRecommended:normalized.counts.related,unknown:normalized.counts.unknown,incomplete:normalized.counts.incompleteObservations,missingBody:normalized.counts.missingBody,duplicateSnapshotObservations:Math.max(0,observedAcross-finalSubjects),innerPostLinksExcluded:innerLinks.length,qualitySelected:normalized.automation.selectedVerifiedReplyIds.length,candidateStatus:normalized.automation.candidateStatus,durationEstimate:normalized.automation.durationEstimate};
  report.relationship={observations:collection.relationshipObservations||[],diagnostics:collection.relationshipDiagnostics||[],outcome:collection.verifiedReplyCount?'VERIFIED_RELATIONSHIPS_PRESENT':'NO_PUBLIC_PARENT_EVIDENCE'};
  report.visualAssessment={classification:'VISUAL_ASSESSMENT',screenshot:'conversation-surface.png',note:'Screenshot is corroborating visual context only; it does not create a parent edge.'};
  const {DataStore}=require('../dist/data-engine/store'),{DataEngine}=require('../dist/data-engine/engine'),{ConversationEngine}=require('../dist/data-engine/conversation-engine');
  const data=new DataEngine(new DataStore()),engine=new ConversationEngine(data,{execution:'LIVE',discover:async()=>{throw Error('DISCOVERY_NOT_ALLOWED')},enrich:async url=>{if(url!==target)throw Error('TARGET_MISMATCH');return collection}});
  const run=await engine.start({requestId:plan.id,urls:[target],limit:1,priority:'HOT',minInteractions:0});
  if(run.status!=='COMPLETED'||run.results.length!==1)throw Error(run.error||'THREADS_ACQUISITION03_PERSISTENCE_FAILED');
  report.persistence={runId:run.id,collectionId:run.results[0].collectionId,store:'ISOLATED_SANDBOX',quality:run.results[0].evaluation,review:await engine.review(run.results[0].collectionId),reopenPassed:(await engine.collection(run.results[0].collectionId)).collection.root.url===target};
  report.status=collection.verifiedReplyCount?'PASS_LIVE':'PARTIAL_NO_PUBLIC_PARENT_EVIDENCE';
 }catch(error){report.status='FAILED_NO_RETRY';report.error=/^[A-Z0-9_]+$/.test(error?.message||'')?error.message:'THREADS_ACQUISITION03_FAILED';}
 finally{
  report.completedAt=new Date().toISOString();report.elapsedMs=Date.parse(report.completedAt)-Date.parse(report.startedAt);
  const after=await manifest(production);write('production-after.json',after);report.productionPreserved=before.hash===after.hash;report.productionHashBefore=before.hash;report.productionHashAfter=after.hash;
  const lease=JSON.parse(fs.readFileSync(lock,'utf8'));if(lease.pid===process.pid&&lease.token===token)fs.unlinkSync(lock);
  write('report.json',report);console.log(JSON.stringify({status:report.status,error:report.error,metrics:report.metrics||null,relationship:report.relationship?.outcome||null,elapsedMs:report.elapsedMs,productionPreserved:report.productionPreserved,visits:report.visits.map(v=>({outcome:v.outcome,admitted:v.requestTelemetry?.admittedRequests,events:v.requestTelemetry?.interceptionEvents,actions:v.interactionActions,minimumAvailableMiB:v.minimumAvailableMiB,cleanup:v.resources?.cleanupVerified}))},null,2));
 }
})().catch(error=>{console.error(/^[A-Z0-9_]+$/.test(error?.message||'')?error.message:'THREADS_ACQUISITION03_PREFLIGHT_FAILED_NO_ATTEMPT');process.exitCode=1});
