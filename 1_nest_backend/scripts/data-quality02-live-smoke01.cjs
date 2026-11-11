// Single-use, exact-target LIVE smoke. Default invocation is plan-only and performs no network access.
const fs=require('fs'),p=require('path'),cp=require('child_process'),{randomUUID,createHash}=require('crypto');
const backend=p.resolve(__dirname,'..'),out=p.join(backend,'.studio-data/reports/data-quality02-live-smoke01');
const target='https://www.threads.com/@gnrtth/post/DeI-TuzEc_9';
const plan={id:'data-quality02-live-smoke01',target,oneBrowserWorkerAtATime:true,retry:false,apiRequests:0,tts:false,render:false,publishing:false,operationBudgetMs:120000,maxObservedCards:80,maxVerifiedReplies:20};
const read=f=>JSON.parse(fs.readFileSync(f)),write=(n,x)=>fs.writeFileSync(p.join(out,n),JSON.stringify(x,null,2),{mode:0o600});
const sha=f=>createHash('sha256').update(fs.readFileSync(f)).digest('hex');
if(process.argv[2]!=='run'){console.log(JSON.stringify({mode:'PLAN_ONLY_NO_NETWORK',plan,approval:'Single-use explicit approval required.'},null,2));process.exit(0)}
(async()=>{
 fs.mkdirSync(out,{recursive:true});
 const approval=read(p.join(out,'approval.json'));
 if(approval.id!==plan.id||approval.approved!==true||approval.target!==target)throw Error('EXPLICIT_LIVE_APPROVAL_REQUIRED');
 if(fs.existsSync(p.join(out,'attempt.json')))throw Error('ATTEMPT_ALREADY_CONSUMED');
 const before=JSON.parse(cp.execFileSync('powershell.exe',['-NoProfile','-NonInteractive','-File',p.join(__dirname,'studio-resource-audit.ps1')],{encoding:'utf8',windowsHide:true,timeout:25000}));
 write('before.json',before);
 if(before.workers.some(w=>/python/i.test(w.name)||['RENDER_WORKER','KOKORO_WORKER','COLLECTOR_WORKER'].includes(w.role)))throw Error('CONFLICTING_WORKER_NO_LIVE_STARTED');
 const token=randomUUID(),held=[],locks=[p.join(backend,'.local-bounded-probe.lock')];
 const report={plan,status:'NOT_RUN',execution:'LIVE_BROWSER_ONLY_NOT_REPLAY',startedAt:new Date().toISOString(),visits:[],error:null,productionModified:false,acceptance:{autoAccepted:false,tts:false,render:false,publishing:false}};
 try{
  for(const f of locks){fs.writeFileSync(f,JSON.stringify({pid:process.pid,token,purpose:plan.id}),{flag:'wx'});held.push(f)}
  for(const key of Object.keys(process.env))if(!/^(PATH|SYSTEMROOT|WINDIR|TEMP|TMP|USERPROFILE|APPDATA|LOCALAPPDATA|COMSPEC|PATHEXT|STUDIO_PYTHON|STUDIO_BROWSER)$/i.test(key))delete process.env[key];
  process.env.STUDIO_DATA_ROOT=p.join(out,'studio-store');process.env.STUDIO_DATA04_MEDIA_ROOT=p.join(out,'media');
  fs.writeFileSync(p.join(out,'attempt.json'),JSON.stringify({plan,approved:true,at:report.startedAt,pid:process.pid,retries:0}),{flag:'wx'});
  const oldFile=p.join(backend,'.studio-data/reports/browser-policy-live01/report.json');
  const oldHash=sha(oldFile),old=read(oldFile),oldCapture=old.captures.find(c=>c.root?.url===target);
  const {enrichConversation}=require('../dist/data-engine/conversation-public');
  const evidence=async(page,snapshot)=>{
    write('dom-evidence.json',{...snapshot,capturedAt:new Date().toISOString(),credentialsCaptured:false,cookiesCaptured:false,storageCaptured:false});
    await page.evaluate(()=>scrollTo(0,0));
    await new Promise(r=>setTimeout(r,250));
    await page.screenshot({path:p.join(out,'target-page.png'),type:'png',captureBeyondViewport:false});
  };
  const collection=await enrichConversation(target,v=>{report.visits.push(v);write('report.json',report)},evidence);
  write('collection.json',collection);
  const {classifyContext}=require('../dist/studio/context-classification');
  const contexts=collection.sourceCapture?.contextCandidates||[];
  const classifications=contexts.map((x,index)=>({index,url:x.url||null,author:x.author||null,text:x.bodyText||x.text,assessment:classifyContext(x,target)}));
  const counts=classifications.reduce((a,x)=>(a[x.assessment.classification]=(a[x.assessment.classification]||0)+1,a),{});
  const oldUrls=new Set((oldCapture?.sourceCapture?.contextCandidates||[]).map(x=>x.url));
  report.comparison={oldCaptureSha256:oldHash,oldObserved:oldCapture?.observedReplyCount??null,oldSourceCards:oldCapture?.sourceCapture?.contextCandidates?.length??null,currentSourceCards:contexts.length,sharedSourceUrls:contexts.filter(x=>oldUrls.has(x.url)).length};
  report.collection={root:collection.root,reportedReplyCount:collection.reportedReplyCount,observedReplyCount:collection.observedReplyCount,verifiedReplyCount:collection.verifiedReplyCount,unverifiedCandidateCount:collection.unverifiedCandidateCount,classificationCounts:counts,contexts:classifications};
  require('reflect-metadata');
  const {StudioService}=require('../dist/studio/studio.service');
  const studio=new StudioService({});Object.assign(studio,{extract:async()=>structuredClone(collection.sourceCapture)});
  let session=await studio.create();session=await studio.mutate(session.id,{revision:session.revision,urls:[target],scope:'WITH_CONTEXT'},true);
  const contextItems=session.items.filter(i=>i.inclusion==='EXPLICIT_CONTEXT');
  const testSelected=contextItems.find(i=>i.displayText.trim()&&i.spokenText.trim());
  if(testSelected){session=await studio.mutate(session.id,{revision:session.revision,title:'DATA-QUALITY-02 LIVE smoke',items:session.items.map(i=>({...i,selected:i.id===testSelected.id||i.inclusion==='TARGET'}))});}
  const reopened=await studio.load(session.id);
  report.studio={sessionId:session.id,store:'ISOLATED_SANDBOX',items:reopened.items.length,contextItems:reopened.items.filter(i=>i.inclusion==='EXPLICIT_CONTEXT').length,testDraftSelectedId:testSelected?.id||null,testSelectionOnly:true,autoAccepted:false,rawPreserved:reopened.items.every(i=>!!i.rawExtraction&&i.originalText===i.rawExtraction.text),reopenPassed:reopened.revision===session.revision&&(!testSelected||reopened.items.find(i=>i.id===testSelected.id)?.selected===true)};
  report.status='COLLECTED_WAITING_HUMAN_REVIEW';
 }catch(e){report.status='STOPPED_NO_RETRY';report.error=/^CONVERSATION_[A-Z0-9_]+$/.test(e?.message||'')?e.message:'LIVE_SMOKE_FAILED';}
 finally{
  report.completedAt=new Date().toISOString();report.elapsedMs=Date.parse(report.completedAt)-Date.parse(report.startedAt);
  report.cleanupVerified=!/CLEANUP_UNVERIFIED/.test(report.error||'')&&!report.visits.some(v=>v.resources&&!v.resources.cleanupVerified);
  if(report.cleanupVerified)for(const f of held){const lease=read(f);if(lease.pid===process.pid&&lease.token===token)fs.unlinkSync(f)}
  write('report.json',report);console.log(JSON.stringify({status:report.status,error:report.error,observed:report.collection?.observedReplyCount??0,sourceCards:report.collection?.contexts?.length??0,verified:report.collection?.verifiedReplyCount??0,classifications:report.collection?.classificationCounts??{},studio:report.studio??null,cleanupVerified:report.cleanupVerified,elapsedMs:report.elapsedMs},null,2));
 }
})().catch(e=>{console.error(/^[A-Z0-9_]+$/.test(e?.message||'')?e.message:'LIVE_SMOKE_PREFLIGHT_FAILED_NO_NETWORK_STARTED');process.exitCode=1});
