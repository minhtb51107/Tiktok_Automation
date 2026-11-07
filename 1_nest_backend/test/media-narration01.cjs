// Real saved LIVE02 replay + explicitly SYNTHETIC image-comment metadata.
const fs=require('fs'),p=require('path'),os=require('os'),assert=require('assert/strict');
const {analyzeSourceCardsV2}=require('../dist/studio/source-quality'),{imageNarration}=require('../dist/studio/media-ocr'),{StudioService}=require('../dist/studio/studio.service');
const {contextLabelledCounts}=require('../dist/studio/metadata-fields');
(async()=>{
 const run=p.resolve(__dirname,'../../../Tiktok_Automation_e2e01/run-media-narration01'),cfg=JSON.parse(fs.readFileSync(p.join(run,'config.json'))),s=JSON.parse(fs.readFileSync(p.join(cfg.store,cfg.sessionId+'.json'))),item=s.items.find(i=>i.inclusion==='TARGET'),sha=item.localSourceMedia[0].sha256;
 const capture=JSON.parse(fs.readFileSync(p.resolve(__dirname,'../../../Tiktok_Automation_restore01_live02/run-20261107-01/capture.json')));assert.equal(capture.contextCandidates.length,8);const raw=JSON.stringify(capture);
 const mk=text=>({...capture.records[0],text,bodyText:text,media:[],fields:{}});
 const good='Tôi không đồng ý vì học phí không phản ánh năng lực. Ví dụ, kinh nghiệm công việc và sản phẩm thực tế cũng rất quan trọng.';
 const records=[mk('Mọi người nghĩ sao?'),{...mk('Xem ảnh'),media:[{kind:'IMAGE',url:'test://SYNTHETIC-screenshot'}]}, {...mk('👍'),fields:{likeCount:{status:'AVAILABLE',value:10000,source:'SYNTHETIC direct labelled control',raw:'10000'}}},mk(good),mk('ok'),mk(good)];
 const q=analyzeSourceCardsV2(records,'học phí năng lực công việc','SERIOUS',{1:{reviewed:true,text:'Ảnh kiểm thử tổng hợp: học phí đại học tăng theo từng năm. Gia đình cần lập ngân sách và tìm học bổng trước khi chọn trường.'}},0);
 assert.equal(q[0].bucket,'RECOMMENDED');assert.notEqual(q[1].bucket,'LOW_VALUE');assert.equal(q[2].bucket,'LOW_VALUE');assert.equal(q[3].bucket,'RECOMMENDED');assert.equal(q[3].engagement.likes,null);assert.equal(q[5].bucket,'LOW_VALUE');assert.ok(q[3].score>q[2].score);assert.equal(analyzeSourceCardsV2(records,'học phí','FUNNY').length,6);
 assert.equal(analyzeSourceCardsV2(capture.contextCandidates,capture.records[0].text).length,8);assert.equal(JSON.stringify(capture),raw);
 const temp=fs.mkdtempSync(p.join(os.tmpdir(),'media-narration01-')),service=new StudioService({});Object.assign(service,{root:temp});process.env.STUDIO_DATA04_MEDIA_ROOT=p.join(cfg.store,'conversation-media');
 try{
  for(const key of ['mediaOcr','mediaNarrationBaseText','mediaNarrationAppliedHash','mediaNarrationApplied'])delete item[key];
  fs.writeFileSync(p.join(temp,s.id+'.json'),JSON.stringify(s));const before=JSON.stringify({raw:item.rawExtraction,original:item.originalText,display:item.displayText,locks:item.manualLocks});
  let state=await service.mediaOcr(s.id,item.id,sha,{revision:s.revision,action:'OCR'}),o=state.items.find(i=>i.id===item.id).mediaOcr[sha];assert.equal(o.confidence,null);assert.ok(o.blocks.length>0);assert.equal(o.review,'NEEDS_REVIEW');
  assert.throws(()=>imageNarration({x:{...o,mode:'READ_FULL'}}),/OCR_REVIEW_REQUIRED/);assert.deepEqual(imageNarration({x:o}),[]);
  await assert.rejects(service.mediaOcr(s.id,item.id,sha,{revision:s.revision,action:'SAVE'}),/STALE_REVISION/);
  state=await service.mediaOcr(s.id,item.id,sha,{revision:state.revision,action:'SAVE',ocrRevision:o.revision,text:'Nội dung ảnh đã kiểm tra. Học phí không phản ánh năng lực.',summary:'Tóm tắt thử nghiệm.',mode:'READ_FULL',confirmReview:true,reviewer:'AGENT_VISUAL'});
  o=state.items.find(i=>i.id===item.id).mediaOcr[sha];assert.deepEqual(imageNarration({x:{...o,mode:'SUMMARIZE'}}),['Tóm tắt thử nghiệm.']);
  if(item.manualLocks.includes('NARRATION_TEXT'))await assert.rejects(service.mediaOcr(s.id,item.id,sha,{revision:state.revision,action:'APPLY',ocrRevision:o.revision}),/locked/);
  state=await service.mediaOcr(s.id,item.id,sha,{revision:state.revision,action:'APPLY',ocrRevision:o.revision,confirmReplaceLocked:true});
  let changed=state.items.find(i=>i.id===item.id);assert.ok(changed.spokenText.endsWith(o.correctedText));assert.equal(changed.mediaOcr[sha].rawText,o.rawText);assert.equal(JSON.stringify({raw:changed.rawExtraction,original:changed.originalText,display:changed.displayText,locks:changed.manualLocks}),before);
  const text=changed.spokenText;state=await service.mediaOcr(s.id,item.id,sha,{revision:state.revision,action:'APPLY',ocrRevision:o.revision,confirmReplaceLocked:true});assert.equal(state.items.find(i=>i.id===item.id).spokenText,text);
  const reopened=await service.load(s.id);assert.equal(reopened.items.find(i=>i.id===item.id).mediaOcr[sha].reviewer,'AGENT_VISUAL');assert.ok(reopened.voiceAssets.filter(a=>a.itemId===item.id).every(a=>a.status==='STALE'));
  state=await service.mutate(s.id,{revision:reopened.revision,title:reopened.title,items:reopened.items.map(i=>i.id===item.id?{...i,spokenText:i.spokenText+' Chỉnh tay.'}:i)});
  await assert.rejects(service.mediaOcr(s.id,item.id,sha,{revision:state.revision,action:'APPLY',ocrRevision:o.revision,confirmReplaceLocked:true}),/manually changed/);
  // A comment uses the same image service by its own item identity, never by assumed parent.
  const comment=state.items.find(i=>i.inclusion==='EXPLICIT_CONTEXT');assert.ok(comment);comment.localSourceMedia=structuredClone(item.localSourceMedia);fs.writeFileSync(p.join(temp,s.id+'.json'),JSON.stringify(state));
  state=await service.mediaOcr(s.id,comment.id,sha,{revision:state.revision,action:'OCR'});assert.equal(state.items.find(i=>i.id===comment.id).mediaOcr[sha].review,'NEEDS_REVIEW');assert.equal(state.items.find(i=>i.id===comment.id).observationEvidence.level,'OBSERVED_ON_TARGET_PAGE');
  const controls=[{label:'Thích',text:'Thích12'}];assert.equal(contextLabelledCounts(controls,1).likeCount.value,12);assert.equal(contextLabelledCounts(controls,2).likeCount.value,null);assert.equal(contextLabelledCounts(controls,undefined).likeCount.value,null);assert.equal(contextLabelledCounts([],1).likeCount.value,null);
  assert.deepEqual(imageNarration({a:{...o,correctedText:'first'},b:{...o,correctedText:'second'}},['b','a']),['second','first']);
  console.log('PASS OFFLINE: real LIVE02 8-card replay; synthetic root question/image comment/high-like reaction/low-like argument/missing metrics/duplicates; real local OCR; review/mode/revision/locks/original/stale/save-reopen/manual-change protection/comment image; scoped engagement and image ordering. No TTS or render.');
 }finally{service.onModuleDestroy();if(p.dirname(temp)!==os.tmpdir()||!p.basename(temp).startsWith('media-narration01-'))throw Error('Unsafe cleanup');fs.rmSync(temp,{recursive:true,force:true})}
})().catch(e=>{console.error(e);process.exitCode=1});
