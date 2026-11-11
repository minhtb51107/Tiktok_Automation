// Read-only replay of saved LIVE evidence. No network, sessions, approvals, TTS or render.
const fs=require('fs'),p=require('path'),crypto=require('crypto');
const input=process.env.DATA_QUALITY02_CAPTURE||p.resolve(__dirname,'../.studio-data/reports/browser-policy-live01/report.json');
const out=p.resolve(__dirname,'../.studio-data/reports/data-quality02');
const bytes=fs.readFileSync(input),source=JSON.parse(bytes),hash=b=>crypto.createHash('sha256').update(b).digest('hex');
const {selectConversation}=require('../dist/data-engine/content-selection');
const planFile=p.join(out,'preview-selections.json'),plans=fs.existsSync(planFile)?JSON.parse(fs.readFileSync(planFile)):{};
const result={execution:'OFFLINE_REPLAY_OF_SAVED_REAL_LIVE',inputHash:hash(bytes),userApproved:false,qualityAccuracy:'NOT_MEASURED',targets:[]};
for(const c of source.captures){
 const automatic=selectConversation(c,'SERIOUS',source.completedAt,['công việc']);
 const ids=plans[c.root.id]||[];
 const preview=selectConversation(c,'SERIOUS',source.completedAt,['công việc'],{mode:'THREAD_DISCUSSION',selectedIds:ids});
 result.targets.push({sourceUrl:c.root.url,rootOriginal:c.root.originalText,rootClean:automatic.quotes[0].text,rootType:c.root.itemType,rawCandidates:c.unverified.length,
   before:source.quality.ranked.find(q=>q.sourceUrl===c.root.url),automatic,editorialPreview:{label:'OFFLINE_PROPOSAL_ONLY_NOT_USER_APPROVAL',selectedIds:ids,result:preview}});
}
if(hash(fs.readFileSync(input))!==result.inputHash)throw Error('RAW_CAPTURE_CHANGED');
fs.mkdirSync(out,{recursive:true});fs.writeFileSync(p.join(out,'replay.json'),JSON.stringify(result,null,2));
const md=['# DATA-QUALITY-02 — saved real capture replay','',`Input SHA-256: ${result.inputHash}`,'No new LIVE. No human approval. Duration is ESTIMATED, never WAV-measured.'];
for(const t of result.targets){
 const r=t.automatic,e=t.editorialPreview.result;
 md.push('','## '+t.sourceUrl,'### Original root',t.rootOriginal,'### Clean root',t.rootClean,`Source type ${t.rootType}; parent verified ${r.verifiedReplies}; candidates retained ${r.comments.length}.`,
  `Automatic THREAD_DISCUSSION: ${r.status}; selected ${r.comments.filter(x=>x.selected).length}.`,`Before estimate ${t.before.estimate.minimumSeconds}–${t.before.estimate.maximumSeconds}s; explicit preview ${e.estimate.minimumSeconds}–${e.estimate.maximumSeconds}s.`,
  '### Full editorial preview — proposal only, not user approval',e.scriptDraft,'### All retained candidates, selected/excluded with reasons');
 for(const x of e.comments)md.push('',`#### ${x.author} | ${x.url||'URL unavailable'}`,`Preview selected=${x.selected}; ${x.context.classification}; basis=${x.context.basis}; parent=${x.parentId??'UNKNOWN'}; score=${x.score}`,
  'Reasons: '+x.reasons.join('; '),'Original:',x.originalText,'Clean:',x.displayText||'[MISSING CONTENT]');
}
fs.writeFileSync(p.join(out,'report.md'),md.join('\n'));
console.log(JSON.stringify({execution:result.execution,inputHash:result.inputHash,rawUnchanged:true,targets:result.targets.map(t=>({url:t.sourceUrl,candidates:t.automatic.comments.length,classes:t.automatic.comments.reduce((a,x)=>(a[x.context.classification]=(a[x.context.classification]||0)+1,a),{}),autoSelected:t.automatic.comments.filter(x=>x.selected).length,previewSelected:t.editorialPreview.selectedIds,estimate:t.editorialPreview.result.estimate,verified:t.automatic.verifiedReplies}))},null,2));
