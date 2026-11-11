// Offline-only recovery/acceptance over the immutable capture produced by the single LIVE attempt.
const fs=require('fs'),p=require('path');
const backend=p.resolve(__dirname,'..'),out=p.join(backend,'.studio-data/reports/data-quality02-live-smoke01');
const target='https://www.threads.com/@gnrtth/post/DeI-TuzEc_9';
const read=n=>JSON.parse(fs.readFileSync(p.join(out,n))),write=(n,x)=>fs.writeFileSync(p.join(out,n),JSON.stringify(x,null,2),{mode:0o600});
(async()=>{
 if(!fs.existsSync(p.join(out,'attempt.json'))||!fs.existsSync(p.join(out,'collection.json')))throw Error('SAVED_LIVE_CAPTURE_REQUIRED');
 const collection=read('collection.json'),report=read('report.json');
 process.env.STUDIO_DATA_ROOT=p.join(out,'studio-store-final');
 require('reflect-metadata');
 const {classifyContext}=require('../dist/studio/context-classification');
 const observedAssessments=collection.unverified.filter(x=>x.observation?.originalText&&x.url).map(x=>classifyContext({url:x.url,text:x.observation.originalText,bodyText:x.observation.originalText,author:x.observation.author.handle,handle:x.observation.author.handle,avatar:null,createdAt:null,type:'UNKNOWN',parentReference:null,media:[],likeCount:null,replyCount:null,repostCount:null,provenance:{text:'saved LIVE DOM observation',type:'relationship unavailable'},contextEvidence:x.observation.contextEvidence||[]},target));
 const allCounts=observedAssessments.reduce((a,x)=>(a[x.classification]=(a[x.classification]||0)+1,a),{});
 const {StudioService}=require('../dist/studio/studio.service');
 const studio=new StudioService({});Object.assign(studio,{extract:async()=>structuredClone(collection.sourceCapture)});
 let session=await studio.create();session=await studio.mutate(session.id,{revision:session.revision,urls:[target],scope:'WITH_CONTEXT'},true);
 const contexts=session.items.filter(i=>i.inclusion==='EXPLICIT_CONTEXT'),picked=contexts.find(i=>i.displayText.trim()&&i.spokenText.trim());
 if(picked)session=await studio.mutate(session.id,{revision:session.revision,title:'DATA-QUALITY-02 LIVE smoke',items:session.items.map(i=>({...i,selected:i.inclusion==='TARGET'||i.id===picked.id}))});
 const reopened=await studio.load(session.id);
 const studioResult={sessionId:session.id,store:'ISOLATED_SANDBOX',items:reopened.items.length,contextItems:reopened.items.filter(i=>i.inclusion==='EXPLICIT_CONTEXT').length,testDraftSelectedId:picked?.id||null,testSelectionOnly:true,autoAccepted:false,rawPreserved:reopened.items.every(i=>!!i.rawExtraction&&i.originalText===i.rawExtraction.text),reopenPassed:reopened.revision===session.revision&&(!picked||reopened.items.find(i=>i.id===picked.id)?.selected===true)};
 report.initialPostCollectionError=report.error;report.error=null;report.status='COLLECTED_WAITING_HUMAN_REVIEW';report.studio=studioResult;report.collection.allObservedClassificationCounts=allCounts;report.postCollectionRecovery='OFFLINE_FROM_IMMUTABLE_SAVED_LIVE_COLLECTION_NO_NETWORK';
 write('report.json',report);console.log(JSON.stringify({status:report.status,allObservedClassificationCounts:allCounts,studio:studioResult},null,2));
})().catch(e=>{console.error(e.stack);process.exitCode=1});
