// OFFLINE ONLY. Actual Studio persistence; source response is explicitly synthetic.
const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),p=require('node:path');
const {StudioService}=require('../dist/studio/studio.service');
const url='https://www.threads.com/@test/post/ROOT';
const raw=(id,text)=>({url:'https://www.threads.com/@test/post/'+id,text,author:'test',handle:'test',avatar:null,createdAt:null,type:'UNKNOWN',parentReference:null,media:[],likeCount:null,replyCount:null,repostCount:null,provenance:{text:'SYNTHETIC TEST DATA'}});
(async()=>{const root=fs.mkdtempSync(p.join(os.tmpdir(),'restore01-'));const service=new StudioService({});Object.assign(service,{root,extract:async()=>({originalUrl:url,canonicalUrl:url,resolvedUrl:url,matchedTargetId:'ROOT',matchMethod:'DOM_PERMALINK',status:'PARTIAL',records:[raw('ROOT','Root TEST DATA')],contextCandidates:[raw('R1','Observed TEST DATA comment')],retrievedAt:new Date().toISOString(),diagnostics:[],redirects:[],elapsedMs:1})});
try{
 let s=await service.create();s=await service.mutate(s.id,{revision:s.revision,urls:[url],scope:'WITH_CONTEXT'},true);
 assert.equal(s.items.length,2);assert.equal(s.project.posts.length,1);assert.equal(s.project.comments.length,1);assert.equal(s.items[1].selected,false);assert.equal(s.items[1].observationEvidence.level,'OBSERVED_ON_TARGET_PAGE');assert.equal(s.items[1].observationEvidence.parentId,null);assert.equal(s.items[1].originalText,'Observed TEST DATA comment');
 s=await service.mutate(s.id,{revision:s.revision,title:s.title,items:s.items.map(i=>({...i,selected:true}))});assert.equal((await service.load(s.id)).items[1].selected,true);
 let t=await service.create();t=await service.mutate(t.id,{revision:t.revision,urls:[url],scope:'TARGET_ONLY'},true);assert.equal(t.items.length,1);t=await service.mutate(t.id,{revision:t.revision,addContext:{originalUrl:url,index:0}});assert.equal(t.project.posts.length,1);assert.equal(t.items[1].sourceReference.entityType,'COMMENT');assert.equal(t.project.comments[0].relationshipStatus,'OBSERVED_ON_TARGET_PAGE');
 const rev=t.revision;t=await service.mutate(t.id,{revision:rev,addContext:{originalUrl:url,index:0}});assert.equal(t.items.length,2);
 console.log('PASS: WITH_CONTEXT import, explicit selection/save/reopen, TARGET_ONLY add-context, dedup; parent remains unverified. LIVE/TTS/render NOT_RUN');
}finally{service.onModuleDestroy();if(p.dirname(root)!==os.tmpdir()||!p.basename(root).startsWith('restore01-'))throw Error('Unsafe temp path');fs.rmSync(root,{recursive:true,force:true});}})().catch(e=>{console.error(e);process.exitCode=1});
