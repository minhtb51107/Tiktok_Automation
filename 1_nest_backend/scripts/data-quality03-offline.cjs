/* Offline acceptance helper. Replays a persisted LIVE capture into an isolated store; never launches a browser collector. */
require('ts-node/register/transpile-only');
const fs=require('fs'),path=require('path'),assert=require('assert/strict');
const {DataStore}=require('../src/data-engine/store');
const {DataEngine}=require('../src/data-engine/engine');
const {ConversationEngine}=require('../src/data-engine/conversation-engine');
const {observedContextViews}=require('../src/data-engine/conversation-context');
const {StudioService}=require('../src/studio/studio.service');

async function main(){
 const root=path.resolve(process.argv[2]||'.studio-data/reports/data-quality03-offline/runtime');
 const fixture=path.resolve(process.argv[3]||'.studio-data/reports/data-quality02-live-smoke01/collection.json');
 if(!fs.existsSync(fixture))throw Error('SAVED_LIVE_CAPTURE_MISSING');
 fs.mkdirSync(root,{recursive:true});process.env.STUDIO_DATA_ROOT=root;
 const collection=JSON.parse(fs.readFileSync(fixture,'utf8')),data=new DataEngine(new DataStore(path.join(root,'data-engine')));
 const engine=new ConversationEngine(data,{execution:'LIVE',discover:async()=>[{url:collection.root.url,observedOrder:0,post:collection.root}],enrich:async()=>structuredClone(collection)});
 const run=await engine.start({requestId:'data-quality03-saved-live-replay',keyword:'công việc',limit:1,priority:'HOT',minInteractions:0});
 const id=run.results[0].collectionId,rows=observedContextViews(collection),choice=rows.find(x=>x.author==='myhao1103')||rows.find(x=>x.relationship!=='RELATED_OR_RECOMMENDED');assert(choice);
 let review=await engine.review(id);
 if(!review.selectedObservedUrls?.includes(choice.url))review=await engine.feedback(id,{requestId:'data-quality03-editorial-selection-'+review.revision,revision:review.revision,selectedReplyIds:review.selectedReplyIds,selectedObservedUrls:[choice.url],replyLabels:review.replyLabels,decision:'NEEDS_REVIEW',reason:'Offline replay: explicit observed-card editorial selection'});
 const studio=new StudioService({});Object.assign(studio,{root});
 const existing=(await studio.list()).find(x=>x.derivedFrom==='conversation:'+id);const draft=existing||await studio.createConversationDraft(collection,review);
 const result={mode:'PERSISTED_LIVE_REPLAY_OFFLINE',networkCalls:0,fixture,store:root,runId:run.id,collectionId:id,observedContexts:rows.length,materialized:collection.sourceCapture?.contextCandidates?.length||0,selectedObserved:review.selectedObservedUrls,draftSessionId:draft.id,draftItems:draft.items.length,selectedItems:draft.items.filter(x=>x.selected).length};
 fs.writeFileSync(path.join(root,'verification.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result));
}
main().catch(e=>{console.error(e.message);process.exitCode=1});
