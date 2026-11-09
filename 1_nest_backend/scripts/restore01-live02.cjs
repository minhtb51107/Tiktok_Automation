// One explicitly approved read-only target. Existing capture prevents accidental reruns.
const fs=require('node:fs'),p=require('node:path'),os=require('node:os');
const target='https://www.threads.com/@baongocghetmatcha/post/DfWJxiID7E5';
const base=p.resolve(__dirname,'../../../Tiktok_Automation_restore01_live02');
const root=p.resolve(process.argv[2]||'');
if(p.dirname(root)!==base||!/^run-[\w-]+$/.test(p.basename(root)))throw Error('NEW_ISOLATED_PILOT_DIRECTORY_REQUIRED');
if(fs.existsSync(root))throw Error('PILOT_ALREADY_EXISTS_NO_AUTOMATIC_RETRY');
if(os.freemem()<384*1024**2)throw Error('RESOURCE_GATE_BELOW_384MIB');
fs.mkdirSync(root,{recursive:true});
const started=Date.now();
for(const k of Object.keys(process.env))if(/TOKEN|SECRET|PASSWORD|API_KEY|DATABASE_URL/i.test(k))delete process.env[k];
const {extractPublicThreads}=require('../dist/studio/public-threads');
const {StudioService}=require('../dist/studio/studio.service');
const {cacheConversationImages}=require('../dist/data-engine/conversation-media');
(async()=>{
 const attempt=await extractPublicThreads(target,'WITH_CONTEXT',true);
 // Save the complete actual response before mapping or enrichment.
 fs.writeFileSync(p.join(root,'capture.json'),JSON.stringify(attempt,null,2));
 if(attempt.matchMethod!=='DOM_PERMALINK'||attempt.canonicalUrl!==target||attempt.matchedTargetId!=='DfWJxiID7E5')throw Error('EXACT_TARGET_NOT_CONFIRMED_CAPTURE_RETAINED');
 if(attempt.diagnostics.some(x=>/login|protection|captcha|blocked/i.test(x.message)))throw Error('ACCESS_GATE_CAPTURE_RETAINED');
 const bounded={...attempt,contextCandidates:(attempt.contextCandidates||[]).slice(0,20)};
 const store=p.join(root,'backend','.studio-data');fs.mkdirSync(store,{recursive:true});
 const service=new StudioService({});Object.assign(service,{root:store,extract:async()=>bounded});
 try{
  let session=await service.create();
  session=await service.mutate(session.id,{revision:session.revision,urls:[target],scope:'WITH_CONTEXT'},true);
  const attachments=await cacheConversationImages('DfWJxiID7E5',attempt.records[0].media||[],attempt.retrievedAt,p.join(store,'conversation-media'));
  session.items[0].localSourceMedia=attachments;
  // Only cache references change; raw source and metadata remain immutable.
  fs.writeFileSync(p.join(store,session.id+'.json'),JSON.stringify(session,null,2));
  const summary={mode:'LIVE02_SANDBOX',target,sessionId:session.id,store,startedAt:new Date(started).toISOString(),elapsedMs:Date.now()-started,availableMiB:Math.round(os.freemem()/1024**2),observedCards:bounded.contextCandidates.length,verifiedReplies:0,rootType:attempt.records[0].type,attachments,sessionRevision:session.revision,limits:{browserWorkers:1,maxCommentCards:20},warnings:['Observed cards are not parent-verified replies. No automatic approval, TTS, render or publish.']};
  fs.writeFileSync(p.join(root,'result.json'),JSON.stringify(summary,null,2));
  console.log(JSON.stringify({...summary,attachments:attachments.map(({sourceUrl,...x})=>x)},null,2));
 }finally{service.onModuleDestroy()}
})().catch(e=>{fs.writeFileSync(p.join(root,'error.json'),JSON.stringify({error:e.message,elapsedMs:Date.now()-started}));console.error(e.message);process.exitCode=1});
