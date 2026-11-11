// PREPARED ONLY. Default PLAN never opens a browser/network connection.
const fs=require('fs'),p=require('path'),cp=require('child_process'),{randomUUID}=require('crypto');
const backend=p.resolve(__dirname,'..'),out=p.join(backend,'.studio-data/reports/browser-policy-live01');
const plan={id:'browser-policy-live01',keyword:'công việc',searchPages:1,maxCandidates:5,maxEnrichedRoots:2,maxVerifiedRepliesPerRoot:20,oneBrowserWorker:true,retry:false,apiRequests:0,tts:false,render:false,publishing:false,operationBudgetMs:180000,discoveryVisitMs:30000,extractorMs:20000,relationshipVisitMs:30000};
if(process.argv[2]!=='run'){console.log(JSON.stringify({mode:'PLAN_ONLY_NO_NETWORK',plan,approval:'A NEW explicit user approval is required. Do not reuse discovery-access-02.'},null,2));process.exit(0)}
const read=f=>JSON.parse(fs.readFileSync(f)),write=(n,x)=>fs.writeFileSync(p.join(out,n),JSON.stringify(x,null,2),{mode:0o600});
(async()=>{
 // An operator records this ONLY after an actual new user approval; this script never fabricates it.
 const approval=read(p.join(out,'approval.json'));
 if(approval.id!==plan.id||approval.approved!==true)throw Error('EXPLICIT_NEW_LIVE_APPROVAL_REQUIRED');
 if(fs.existsSync(p.join(out,'attempt.json')))throw Error('ATTEMPT_ALREADY_CONSUMED');
 const audit=JSON.parse(cp.execFileSync('powershell.exe',['-NoProfile','-NonInteractive','-File',p.join(__dirname,'studio-resource-audit.ps1')],{encoding:'utf8',windowsHide:true,timeout:25000}));write('before.json',audit);
 if(audit.workers.some(w=>/python/i.test(w.name)||['RENDER_WORKER','KOKORO_WORKER','COLLECTOR_WORKER'].includes(w.role)))throw Error('CONFLICTING_WORKER_NO_LIVE_STARTED');
 const token=randomUUID(),held=[],locks=[p.join(backend,'.local-bounded-probe.lock'),p.resolve(backend,'../../Tiktok_Automation_uiops02/1_nest_backend/.local-bounded-probe.lock')];
 const report={plan,status:'NOT_RUN',execution:'LIVE_BROWSER_ONLY_NOT_REPLAY',startedAt:new Date().toISOString(),visits:[],captures:[],error:null};
 try{
  for(const f of locks){fs.writeFileSync(f,JSON.stringify({pid:process.pid,token,purpose:plan.id}),{flag:'wx'});held.push(f)}
  // Browser helper gets an OS-only environment. No .env or vault/API client is read.
  for(const key of Object.keys(process.env))if(!/^(PATH|SYSTEMROOT|WINDIR|TEMP|TMP|USERPROFILE|APPDATA|LOCALAPPDATA|COMSPEC|PATHEXT|STUDIO_PYTHON|STUDIO_BROWSER)$/i.test(key))delete process.env[key];
  process.env.STUDIO_DATA_ROOT=p.join(out,'store');process.env.STUDIO_DATA04_MEDIA_ROOT=p.join(out,'media');
  fs.writeFileSync(p.join(out,'attempt.json'),JSON.stringify({plan,approved:true,at:report.startedAt,pid:process.pid,retries:0}),{flag:'wx'});
  const {discoverConversations,enrichConversation}=require('../dist/data-engine/conversation-public');
  const deadline=Date.now()+plan.operationBudgetMs,checkpoint=()=>write('report.json',report),visit=v=>{report.visits.push(v);checkpoint()};
  const check=()=>{if(Date.now()>=deadline)throw Error('CONVERSATION_TIME_BUDGET')};
  check();const candidates=await discoverConversations(plan.keyword,visit,plan.maxCandidates);write('candidates.json',candidates);report.candidates=candidates.length;
  const {rankCandidates}=require('../dist/data-engine/conversation-popularity');
  for(const url of rankCandidates(candidates,plan.maxEnrichedRoots,new Date().toISOString()).selected){
   check();const collection=await enrichConversation(url,visit);report.captures.push(collection);checkpoint();check();
  }
  const {rankConversations}=require('../dist/data-engine/content-selection');report.quality=rankConversations(report.captures,'SERIOUS',new Date().toISOString(),[plan.keyword]);
  report.status='COLLECTED_WAITING_HUMAN_REVIEW';
 }catch(e){report.status='STOPPED_NO_RETRY';report.error=/^CONVERSATION_[A-Z0-9_]+$/.test(e?.message??'')?e.message:'BROWSER_PILOT_FAILED';}
 finally{
  report.completedAt=new Date().toISOString();report.parentVerified=report.captures.reduce((n,c)=>n+c.verifiedReplyCount,0);report.observed=report.captures.reduce((n,c)=>n+c.observedReplyCount,0);report.productionModified=false;report.precision='NOT_MEASURED';
  write('report.json',report);
  // Retain our lease if cleanup cannot be verified. Never unlink another owner's lease.
  report.cleanupVerified=!/CLEANUP_UNVERIFIED/.test(report.error??'')&&!report.visits.some(v=>v.resources&&!v.resources.cleanupVerified);
  if(report.cleanupVerified)for(const f of held){const lease=read(f);if(lease.pid===process.pid&&lease.token===token)fs.unlinkSync(f)}
  write('report.json',report);console.log(JSON.stringify({status:report.status,error:report.error,candidates:report.candidates??0,roots:report.captures.length,parentVerified:report.parentVerified,cleanupVerified:report.cleanupVerified},null,2));
 }
})().catch(e=>{console.error(/^[A-Z0-9_]+$/.test(e?.message??'')?e.message:'PILOT_PREFLIGHT_FAILED_NO_NETWORK_STARTED');process.exitCode=1});
