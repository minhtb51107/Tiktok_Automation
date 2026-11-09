// Single-use authorized read-only live pilot. Default is PLAN, never auto-retry.
const fs=require('fs'),p=require('path'),os=require('os'),cp=require('child_process');
const {randomUUID}=require('crypto');
const backend=p.resolve(__dirname,'..'),original=p.resolve(backend,'../../Tiktok_Automation/1_nest_backend');
const out=p.join(backend,'.studio-data/reports/discovery-access-02');
const plan={id:'discovery-access-02',maxApiRequests:6,maxApiRows:10,maxCandidates:10,maxBrowserCandidates:5,maxSearchPages:2,maxEnrichedRoots:2,maxVerifiedRepliesPerRoot:20,apiBudgetMs:60000,browserBudgetMs:180000,ramFloorMiB:384,retry:false,tts:false,render:false,publishing:false};
if(process.argv[2]!=='run'){console.log(JSON.stringify({mode:'PLAN_NO_NETWORK',plan},null,2));process.exit(0)}
const write=(name,x)=>fs.writeFileSync(p.join(out,name),JSON.stringify(x,null,2),{mode:0o600});
const memory=()=>os.freemem()/1024**2;
const safeError=e=>({kind:/^[A-Z0-9_]+$/.test(e?.kind??'')?e.kind:null,httpStatus:e?.httpStatus??null,apiCode:e?.apiCode??null,detail:/^[A-Z0-9_]+$/.test(e?.detail??'')?e.detail:null,code:/^[A-Z0-9_]+$/.test(e?.message??'')?e.message:'PILOT_OPERATION_FAILED'});

async function run(){
 fs.mkdirSync(out,{recursive:true});
 if(fs.existsSync(p.join(out,'attempt.json')))throw Error('SINGLE_USE_ATTEMPT_ALREADY_CONSUMED');
 const before=JSON.parse(cp.execFileSync('powershell.exe',['-NoProfile','-NonInteractive','-File',p.join(__dirname,'studio-resource-audit.ps1')],{encoding:'utf8',windowsHide:true,timeout:25000}));write('before.json',before);
 const python=p.join(process.env.LOCALAPPDATA||'','Programs/Python/Python314/python.exe');
 if(before.availableMiB<384||memory()<384){write('not-run.json',{reason:'RESOURCE_GUARD_STOP',before});console.log('NOT_RUN_RESOURCE_GUARD_STOP');return}
 if(before.workers.some(w=>/python/i.test(w.name)||['RENDER_WORKER','COLLECTOR_WORKER','KOKORO_WORKER'].includes(w.role)))throw Error('CONFLICTING_WORKER');
 if(!fs.existsSync(python))throw Error('RESOURCE_MONITOR_PYTHON_UNAVAILABLE');
 const leaseToken=randomUUID(),held=[],locks=[p.join(backend,'.local-bounded-probe.lock'),p.resolve(backend,'../../Tiktok_Automation_uiops02/1_nest_backend/.local-bounded-probe.lock')];
 let monitor,guard,browserDeadline,phase='PREFLIGHT',stop=null,minimum=memory(),apiStarted=0,apiCalls=0,browserStarted=0,launches=0;
 const instances=new Set(),browserPids=[],emergency=new AbortController(),requests=[],audits=[],httpReads=[],captures=[],candidates=new Map(),pages=[];
 const result={plan,execution:'LIVE_NOT_REPLAY',startedAt:new Date().toISOString(),status:'RUNNING',api:{requests,searches:[],token:null},browser:{audits,ownedPids:browserPids,httpReads},counts:{},error:null};
 const check=()=>{if(memory()<384)stop='CONVERSATION_RESOURCE_BELOW_384MIB';if(stop)throw Error(stop)};
 const checkpoint=()=>write('checkpoint.json',{...result,phase,minimumAvailableMiB:minimum});
 let patchedPuppeteer,originalLaunch,https,originalRequest;
 try{
  for(const file of locks){fs.writeFileSync(file,JSON.stringify({pid:process.pid,token:leaseToken,purpose:plan.id}),{flag:'wx'});held.push(file)}
  fs.writeFileSync(p.join(out,'attempt.json'),JSON.stringify({plan,approvedBy:'EXPLICIT_CURRENT_USER_MESSAGE',startedAt:result.startedAt,pid:process.pid,retries:0}),{flag:'wx',mode:0o600});
  monitor=cp.spawn(python,['-B',p.join(__dirname,'discovery-memory.py'),String(process.pid),p.join(out,'memory.ndjson'),p.join(out,'monitor.stop')],{windowsHide:true,stdio:'ignore'});
  monitor.on('error',()=>{stop='RESOURCE_MONITOR_FAILED'});
  guard=setInterval(()=>{minimum=Math.min(minimum,memory());if(minimum<384&&!stop){stop='CONVERSATION_RESOURCE_BELOW_384MIB';emergency.abort();for(const b of instances)void b.close().catch(()=>{})}},250);
  const cfg=require('../dist/threads-api/config').threadsConfig(require('dotenv').parse(fs.readFileSync(p.join(original,'.env'))));
  const {ThreadsProvider}=require('../dist/threads-api/provider'),{ThreadsAuth}=require('../dist/threads-api/auth'),{ThreadsStore}=require('../dist/threads-api/local-store');
  const {safePage,pageCursor}=require('../dist/threads-api/adapter'),{inspectSearchPage,discoveryFailure}=require('../dist/data-engine/discovery-diagnostics');
  const provider=new ThreadsProvider(async(url,options)=>{const record={route:new URL(url).pathname,at:new Date().toISOString(),httpStatus:null};requests.push(record);checkpoint();const response=await fetch(url,{...options,signal:AbortSignal.any([options.signal,emergency.signal])});record.httpStatus=response.status;checkpoint();return response});
  const auth=new ThreadsAuth(new ThreadsStore(p.join(original,'.studio-data/threads-api')),provider,()=>cfg),token=await auth.token();
  if(!token)throw Error('BLOCKED_AUTH');
  phase='API';apiStarted=Date.now();
  const hooks={before:async()=>{check();if(apiCalls>=6||Date.now()-apiStarted>=60000)throw Error('API_BUDGET_EXHAUSTED');apiCalls++},remainingMs:()=>Math.max(1,60000-(Date.now()-apiStarted))};
  const debug=await provider.debug(token.value,hooks),d=debug.data;
  const appMatches=d?.app_id!==undefined?String(d.app_id)===cfg.appId:token.source==='OAUTH_VAULT'&&token.exchangeBound===true;
  result.api.token={valid:d?.is_valid===true,scopes:Array.isArray(d?.scopes)?d.scopes.filter(s=>typeof s==='string'&&/^threads_[a-z_]+$/.test(s)):[],expiresAt:Number.isFinite(d?.expires_at)?new Date(d.expires_at*1000).toISOString():null,appBinding:appMatches,appBindingMethod:d?.app_id!==undefined?'DEBUG_APP_ID':'OAUTH_EXCHANGE_RECEIPT',advancedAccess:'UNKNOWN'};
  if(!result.api.token.valid||!appMatches||!Number.isFinite(d?.expires_at)||d.expires_at*1000<=Date.now()||!d?.user_id)throw Error('BLOCKED_AUTH');
  if(!['threads_basic','threads_keyword_search'].every(s=>result.api.token.scopes.includes(s)))throw Error('BLOCKED_PERMISSION');
  let apiRows=0,paging=null,apiDuplicate=0,replyRows=0;
  async function search(q,type,after=null){
   const response=await provider.search(token.value,q,type,Math.min(2,10-apiRows),after,hooks),clean=safePage(response,[token.value,cfg.appSecret]);
   const assessment=inspectSearchPage(clean);if(!Array.isArray(clean.data))throw Error('API_INVALID_RESPONSE');
   if(clean.data.length>Math.min(2,10-apiRows))throw Error('API_RESULT_BUDGET_NOT_HONORED');
   apiRows+=clean.data.length;const pageIndex=pages.length;pages.push(clean);write('api-page-'+pageIndex+'.json',clean);
   result.api.searches.push({q,type,mode:'KEYWORD',assessment,pageIndex,afterUsed:after!==null});
   const {canonicalPost}=require('../dist/data-engine/conversation-evidence');
   for(const row of clean.data){if(row.is_reply===true){replyRows++;continue}const c=canonicalPost(row.permalink);if(!c)continue;if(candidates.has(c.url)){apiDuplicate++;continue}if(candidates.size<10)candidates.set(c.url,{url:c.url,observedOrder:candidates.size,post:null,source:'OFFICIAL_API',nativeId:row.id,itemType:row.is_reply===false?'POST':'UNKNOWN'})}
   if(clean.data.length){const cursor=pageCursor(clean);if(cursor&&!paging)paging={q,type,cursor}}
   checkpoint();check();
  }
  for(const q of ['công việc','gia đình'])for(const type of ['TOP','RECENT'])await search(q,type);
  if(paging&&apiRows<10&&apiCalls<6)await search(paging.q,paging.type,paging.cursor);
  result.api.rows=apiRows;result.api.duplicateRows=apiDuplicate;result.api.replyRows=replyRows;result.api.uniqueRootCandidates=candidates.size;check();
  // Credentials stay in closure only. Browser never receives credentials/environment config.
  for(const key of Object.keys(process.env))if(!/^(PATH|SYSTEMROOT|WINDIR|TEMP|TMP|USERPROFILE|APPDATA|LOCALAPPDATA|PROGRAMFILES(?:\(X86\))?|COMSPEC|PATHEXT|NUMBER_OF_PROCESSORS|PROCESSOR_ARCHITECTURE|OS|SYSTEMDRIVE)$/i.test(key))delete process.env[key];
  process.env.STUDIO_DATA_ROOT=p.join(out,'store');process.env.STUDIO_DATA04_MEDIA_ROOT=p.join(out,'media');
  phase='BROWSER';browserStarted=Date.now();check();
  const pptr=require('puppeteer');patchedPuppeteer=pptr.default??pptr;originalLaunch=patchedPuppeteer.launch;
  patchedPuppeteer.launch=async function(options){check();if(launches>=6||Date.now()-browserStarted>=180000||instances.size)throw Error('BROWSER_BUDGET_EXHAUSTED');launches++;const b=await originalLaunch.call(this,options);instances.add(b);const pid=b.process()?.pid;if(pid)browserPids.push(pid);b.once('disconnected',()=>instances.delete(b));checkpoint();if(stop){await b.close();throw Error(stop)}return b};
  browserDeadline=setTimeout(()=>{stop='BROWSER_TIME_BUDGET';for(const b of instances)void b.close().catch(()=>{})},180000);
  https=require('https');originalRequest=https.request;https.request=function(...args){httpReads.push({stage:phase,at:new Date().toISOString()});return originalRequest.apply(this,args)};
  const publicApi=require('../dist/data-engine/conversation-public'),audit=a=>{audits.push(a);write('public-access.json',audits)};
  let browserCandidates=0,browserDuplicate=0;
  if(candidates.size<5)for(const keyword of ['công việc','gia đình']){
   check();if(browserCandidates>=5||candidates.size>=10)break;
   const rows=await publicApi.discoverConversations(keyword,audit,Math.min(5-browserCandidates,10-candidates.size));
   for(const row of rows){if(candidates.has(row.url)){browserDuplicate++;continue}candidates.set(row.url,{...row,source:'PUBLIC_BROWSER',itemType:'UNKNOWN'});browserCandidates++}checkpoint();
  }
  result.browser.discovered=browserCandidates;result.browser.duplicates=browserDuplicate;write('candidates.json',[...candidates.values()]);
  const {rankCandidates}=require('../dist/data-engine/conversation-popularity');
  const selected=rankCandidates([...candidates.values()],2,new Date().toISOString()).selected;
  for(const url of selected){check();if(Date.now()-browserStarted>=180000)throw Error('BROWSER_TIME_BUDGET');phase='EXACT_ROOT_AND_REPLIES';const collection=await publicApi.enrichConversation(url,audit);captures.push(collection);write('collection-'+(captures.length-1)+'.json',collection);checkpoint();check()}
  const {DataEngine}=require('../dist/data-engine/engine'),{DataStore}=require('../dist/data-engine/store'),{crawlerInput}=require('../dist/data-engine/crawler-adapter'),{GoldShadowEngine}=require('../dist/data-engine/gold-shadow');
  const data=new DataEngine(new DataStore(p.join(out,'store/data-engine')));
  phase='OFFLINE_QUALITY';for(const c of captures){const input=crawlerInput(c.sourceCapture,plan.id);if(input){const imported=await data.import([input],c.root.provenance.observedAt);await new GoldShadowEngine(data).evaluateImport(imported.id)}}
  write('catalog.json',await data.catalog());result.status='COMPLETED_WAITING_HUMAN_REVIEW';
 }catch(e){result.status=stop||/RESOURCE|AUTH|PERMISSION|HTTP_40[13]|HTTP_429|ACCESS_BLOCKED/.test(e.message||'')?'BLOCKED':'PARTIAL';result.error={...safeError(e),...(stop?{code:stop}:{})};result.failedStage=phase;}
 finally{
  clearInterval(guard);clearTimeout(browserDeadline);for(const b of instances)await b.close().catch(()=>{});
  if(patchedPuppeteer&&originalLaunch)patchedPuppeteer.launch=originalLaunch;if(https&&originalRequest)https.request=originalRequest;
  fs.writeFileSync(p.join(out,'monitor.stop'),'stop');if(monitor&&!monitor.exitCode){await Promise.race([new Promise(r=>monitor.once('exit',r)),new Promise(r=>setTimeout(r,4000))])}
  for(const file of held){const l=JSON.parse(fs.readFileSync(file));if(l.pid===process.pid&&l.token===leaseToken)fs.unlinkSync(file)}
  const {rankConversations}=require('../dist/data-engine/content-selection');result.quality=rankConversations(captures,'SERIOUS',new Date().toISOString(),['công việc','gia đình']);
  write('collections.json',captures);write('candidates.json',[...candidates.values()]);
  const samples=fs.existsSync(p.join(out,'memory.ndjson'))?fs.readFileSync(p.join(out,'memory.ndjson'),'utf8').trim().split('\n').filter(Boolean).map(s=>JSON.parse(s)):[],valid=samples.filter(s=>s.system);
  result.resources={beforeMiB:before.availableMiB,minimumAvailableMiB:minimum,availableAfterMiB:memory(),ownedBrowserPids:browserPids,ownedBrowserPidsStillAlive:browserPids.filter(pid=>{try{process.kill(pid,0);return true}catch{return false}}),monitorSamples:valid.length,peakSampledBrowserRssMiB:valid.length?Math.max(...valid.map(s=>s.browserRssMiB)):null,peakSampledBrowserPrivateMiB:valid.length?Math.max(...valid.map(s=>s.browserPrivateMiB)):null,peakSampledCommitUsedMiB:valid.length?Math.max(...valid.map(s=>s.system.systemCommitUsedMiB)):null,minimumSampledCommitReserveMiB:valid.length?Math.min(...valid.map(s=>s.system.systemCommitAvailableMiB)):null,monitorExited:monitor?monitor.exitCode!==null:null};
  result.counts={apiRequests:requests.length,rootCandidates:candidates.size,exactRoots:captures.length,observedReplies:captures.reduce((n,c)=>n+c.observedReplyCount,0),parentVerified:captures.reduce((n,c)=>n+c.verifiedReplyCount,0),unverified:captures.reduce((n,c)=>n+c.unverifiedCandidateCount,0),candidatesOver60Estimated:result.quality.topCandidates.length,browserLaunches:launches};result.completedAt=new Date().toISOString();result.elapsedMs=Date.parse(result.completedAt)-Date.parse(result.startedAt);result.productionModified=false;result.precisionAt5='NOT_MEASURED';write('report.json',result);
  console.log(JSON.stringify({status:result.status,error:result.error,counts:result.counts,api:result.api,resources:result.resources,elapsedMs:result.elapsedMs,artifacts:out},null,2));
 }
}
run().catch(e=>{console.error(JSON.stringify(safeError(e)));process.exitCode=1});
