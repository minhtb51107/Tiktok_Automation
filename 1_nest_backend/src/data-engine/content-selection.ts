import { hash, normalize, similarity, tokens } from './rules';
import { canonicalPost } from './conversation-evidence';
import { selectedReplies, estimatedDuration } from './editorial-feasibility';
import { evaluateConversation } from './conversation-quality';
import { analyzeSourceCardsV2, cleanSourceProjection } from '../studio/source-quality';
import type { PublicRecord } from '../studio/public-types';
import type { ThreadCollection } from './conversation-contracts';
import type { ContentStyle, ContentCandidate, StoryboardScene, VideoProject, MediaAsset } from '../video-pipeline/contracts';

export const CONTENT_SELECTION = {
  version:'content-selection/1',targetSeconds:[65,90] as [number,number],minimumSeconds:60,
  maxSelectedComments:8,nearDuplicate:0.85,readingSpeed:1.3,
  profiles:{SERIOUS:{root:15,discussion:35,coherence:25,hook:10,popularity:5,topic:10},FUNNY:{root:10,discussion:35,coherence:20,hook:20,popularity:5,topic:10}},
};
const spam=(s:string)=>/(inbox|zalo|liên hệ|đặt hàng)/iu.test(s)&&/(giá chỉ|sale|ship|đơn hàng|https?:\/\/|\b0\d{8,10}\b)/iu.test(s);
const repetitive=(s:string)=>{const clauses=s.split(/[.!?;\n]+/u).map(normalize).filter(x=>tokens(x).length>=4);return clauses.length>=4&&new Set(clauses).size/clauses.length<0.7};
function record(text:string,author:string,url:string|null):PublicRecord {
  return {text,bodyText:text,author,handle:author,avatar:null,createdAt:null,type:'UNKNOWN',parentReference:null,media:[],likeCount:null,replyCount:null,repostCount:null,shareCount:null,provenance:{text:'persisted conversation observation'},...(url?{url}:{})};
}
/** Source quotes only. This planner cannot approve, persist a project, synthesize or render. */
export function selectConversation(c:ThreadCollection,style:ContentStyle,asOf:string,topicTerms:string[]=[]){
  const identity=canonicalPost(c.root.url);
  if(!identity||identity.id!==c.root.id||identity.handle!==c.root.author.handle)throw Error('QUALITY_ROOT_IDENTITY_MISMATCH');
  const capture=c.sourceCapture;
  if(capture&&(canonicalPost(capture.canonicalUrl)?.url!==identity.url||capture.matchedTargetId!==identity.id||!['DOM_PERMALINK','PUBLIC_CANONICAL_METADATA'].includes(capture.matchMethod??'')))throw Error('QUALITY_CAPTURE_IDENTITY_MISMATCH');
  const rootRecord=capture?.records[0]??{...record(c.root.originalText,c.root.author.handle,c.root.url),type:c.root.itemType??'UNKNOWN',createdAt:c.root.publishedAt,topic:c.root.topic,likeCount:c.root.engagement.likes,replyCount:c.root.engagement.replies,repostCount:c.root.engagement.reposts,shareCount:c.root.engagement.shares,media:(c.root.attachments??[]).map(a=>({url:a.sourceUrl,kind:'IMAGE' as const}))};
  if(rootRecord.handle&&rootRecord.handle.replace(/^@/,'')!==identity.handle)throw Error('QUALITY_CAPTURE_AUTHOR_MISMATCH');
  const rootText=cleanSourceProjection(rootRecord).text;
  const imageNarration=(c.root.imageNarration??[]).filter(x=>['USER','AGENT_VISUAL'].includes(x.reviewer??'')&&x.text.trim()&&c.root.attachments?.some(a=>a.sha256===x.imageHash&&a.status==='DOWNLOADED'));
  const rootNarration=[rootText,...imageNarration.map(x=>x.text)].filter(Boolean).join('\n\n');
  const observed=(capture?.contextCandidates??[]).filter(r=>canonicalPost(r.url)?.url!==identity.url);
  const observedUrls=new Set(observed.map(r=>canonicalPost(r.url)?.url).filter(Boolean));
  for(const u of c.unverified)if(u.observation?.level==='OBSERVED_ON_TARGET_PAGE'&&canonicalPost(u.observation.targetUrl)?.url===identity.url){const url=canonicalPost(u.url)?.url;if(url)observedUrls.add(url)}
  const records=[...observed];
  for(const r of c.replies)if(!records.some(x=>canonicalPost(x.url)?.id===r.id))records.push({...record(r.originalText,r.author.handle,r.url),type:'COMMENT',likeCount:r.engagement.likes,replyCount:r.engagement.replies,repostCount:r.engagement.reposts,shareCount:r.engagement.shares,fields:Object.fromEntries(Object.entries(r.engagement).map(([key,value])=>[({likes:'likeCount',replies:'replyCount',reposts:'repostCount',shares:'shareCount'} as Record<string,string>)[key],{value,status:value===null?'UNAVAILABLE' as const:'AVAILABLE' as const,raw:null,source:'Persisted verified reply engagement observation'}]))});
  for(const u of c.unverified)if(u.observation&&observedUrls.has(canonicalPost(u.url)?.url)&&!records.some(x=>canonicalPost(x.url)?.url===canonicalPost(u.url)?.url))records.push(record(u.observation.originalText,u.observation.author.handle,u.url));
  const q=analyzeSourceCardsV2(records,rootNarration,style),seen=new Set<string>();
  const comments=records.map((raw,n)=>{
    const own=canonicalPost(raw.url),text=cleanSourceProjection(raw).text,key=normalize(text),reasons=[...q[n].reasons];
    let verified=false,parentId:string|null=null;
    if(own&&c.replies.some(r=>r.id===own.id)){try{const r=selectedReplies(c,[own.id])[0];verified=true;parentId=r.parentId}catch{reasons.push('INVALID_PARENT_EVIDENCE')}}
    const duplicate=!!key&&(seen.has(key)||key===normalize(rootText))||q[n].duplicateOf!==null||q[n].nearDuplicateOf!==null;seen.add(key);
    const hasMedia=!!raw.media?.length,words=tokens(text),shortArgument=words.length>=4&&q[n].lexicalOverlap>0&&/(không|nhưng|vì|nên)/iu.test(text);
    const low=(!words.length||words.length<5)&&!hasMedia&&!shortArgument,advertisement=spam(text);
    const relationship=verified?'PARENT_VERIFIED' as const:observedUrls.has(own?.url)?'OBSERVED_ON_TARGET_PAGE' as const:'UNKNOWN' as const;
    const authorMatches=!raw.handle||raw.handle.replace(/^@/,'')===own?.handle;
    const useful=!duplicate&&!low&&!advertisement&&!repetitive(text)&&!!own&&authorMatches&&relationship!=='UNKNOWN';
    if(!authorMatches)reasons.push('SOURCE_AUTHOR_IDENTITY_MISMATCH');
    if(repetitive(text))reasons.push('INTERNAL_REPETITION_NOT_DURATION_MATERIAL');
    if(duplicate)reasons.push('DUPLICATE');if(advertisement)reasons.push('COMMERCIAL_CALL_TO_ACTION');if(low)reasons.push('LOW_INFORMATION');
    if(hasMedia)reasons.push('MEDIA_CONTENT_NOT_TRANSCRIBED_NOT_COUNTED_IN_DURATION');
    if(!verified)reasons.push('OBSERVED_CONTEXT_NOT_A_VERIFIED_REPLY');
    return {id:own?.id??hash({url:raw.url,text,author:raw.author}),url:own?.url??null,author:raw.author,originalText:raw.text,displayText:text,raw,
      parentId,relationship,
      score:useful?q[n].score+(shortArgument?10:0):0,useful,relevance:q[n].lexicalOverlap,reasons,
      engagement:q[n].engagement,selected:false};
  });
  const eligible=comments.filter(x=>x.useful&&(x.relevance>0||x.raw.media.length>0)).sort((a,b)=>b.score-a.score||a.id.localeCompare(b.id));
  let narration=rootNarration;
  for(const r of eligible){if(comments.filter(x=>x.selected).length>=CONTENT_SELECTION.maxSelectedComments)break;
    const next=[narration,r.displayText].filter(Boolean).join('\n\n'),estimate=estimatedDuration(next,CONTENT_SELECTION.readingSpeed);
    const current=estimatedDuration(narration,CONTENT_SELECTION.readingSpeed);
    if(current.minimumSeconds>=65&&estimate.minimumSeconds>90)continue;
    r.selected=true;narration=next;if(estimate.minimumSeconds>=65)break;
  }
  const selected=comments.filter(x=>x.selected).sort((a,b)=>eligible.indexOf(a)-eligible.indexOf(b));
  const estimate={...estimatedDuration(narration,CONTENT_SELECTION.readingSpeed),targetSeconds:CONTENT_SELECTION.targetSeconds};
  const weights=CONTENT_SELECTION.profiles[style],quality=evaluateConversation(c,asOf);
  const topicCorpus=normalize([rootNarration,c.root.topic??'',...selected.map(x=>x.displayText)].join(' ')),matchedTopicTerms=[...new Set(topicTerms.map(normalize).filter(t=>t&&topicCorpus.includes(t)))];
  const reasoning=selected.filter(x=>x.reasons.includes('MULTI_CLAUSE_REASONING_SIGNAL')).length;
  const breakdown={root:Math.min(1,tokens(rootNarration).length/60)*weights.root,discussion:Math.min(1,selected.length/3)*weights.discussion,
    coherence:Math.min(1,(reasoning+selected.filter(x=>x.relevance>=2).length)/4)*weights.coherence,
    hook:/[?？]|tại sao|có ai|mâu thuẫn|không đồng ý/iu.test(rootText)?weights.hook:weights.hook/2,
    popularity:quality.popularity.score===null?null:quality.popularity.score/100*weights.popularity,topic:topicTerms.length?Math.min(1,matchedTopicTerms.length/3)*weights.topic:null};
  const reasons=['HEURISTIC_NOT_SEMANTIC_PROOF','ESTIMATED_NOT_MEASURED','ORIGINAL_COMMENTARY_REQUIRES_EDITOR','RIGHTS_UNKNOWN'];
  if(topicTerms.length)reasons.push(matchedTopicTerms.length?'TOPIC_LEXICAL_MATCH_NOT_SEMANTIC_PROOF':'TOPIC_RELEVANCE_UNCERTAIN');
  if(imageNarration.some(x=>x.reviewer==='AGENT_VISUAL'))reasons.push('AGENT_VISUAL_IMAGE_TEXT_REQUIRES_HUMAN_REVIEW');
  if(imageNarration.length!==(c.root.imageNarration?.length??0))reasons.push('IMAGE_TRANSCRIPTION_HASH_OR_REVIEW_MISMATCH');
  if(!selected.length)reasons.push('NO_USEFUL_DISCUSSION');if(estimate.minimumSeconds<60)reasons.push('INSUFFICIENT_NARRATION_FOR_60_SECONDS');
  if(estimate.maximumSeconds>90)reasons.push('OVER_TARGET_REQUIRES_CONCISE_EDIT');
  if(spam(rootText))reasons.push('ROOT_COMMERCIAL_SIGNAL_REQUIRES_REVIEW');
  if(repetitive(rootText))reasons.push('ROOT_REPETITION_REQUIRES_EDIT');
  if(selected.some(x=>x.relationship!=='PARENT_VERIFIED'))reasons.push('HUMAN_REVIEW_OBSERVED_CONTEXT_REQUIRED');
  const rootType=rootRecord.type,typed=rootType==='POST'&&selected.every(x=>x.relationship==='PARENT_VERIFIED'||x.raw.type==='COMMENT');
  if(!typed)reasons.push('SOURCE_TYPE_CONFIRMATION_REQUIRED_FOR_PROJECT_CONTRACT');
  const status=!rootText||!selected.length?'INSUFFICIENT_CONTENT':estimate.minimumSeconds<60||spam(rootText)||repetitive(rootText)?'NEEDS_EDITORIAL_ENRICHMENT':'READY_FOR_EDITORIAL_REVIEW';
  const candidate:ContentCandidate={id:hash({source:identity.url,selected:selected.map(x=>x.id),style}),style,status:'PENDING',selectedBy:'RULE',selectionReason:reasons.join('; '),sourceReferences:typed?[{entityType:'POST',entityId:identity.id},...selected.map(x=>({entityType:'COMMENT' as const,entityId:x.id}))]:[]};
  const quotes=[{id:identity.id,url:identity.url,text:rootText,narrationText:rootNarration,originalText:rootRecord.text,kind:'POST' as const},...selected.map(x=>({id:x.id,url:x.url!,text:x.displayText,narrationText:x.displayText,originalText:x.originalText,kind:'COMMENT' as const}))];
  const storyboard:StoryboardScene[]=quotes.map((q,order)=>({id:q.id,order,sourceReferences:typed?[{entityType:q.kind,entityId:q.id}]:[],displayText:q.text,narrationText:q.narrationText,...(order===0&&imageNarration.length?{imageNarration:structuredClone(imageNarration)}:{}),voice:{provider:'KOKORO',voiceId:'my_yen',language:'vi-VN'},mediaAssetIds:[],sfxAssetIds:[],subtitles:[],timing:{paddingBeforeMs:200,paddingAfterMs:300},styleProperties:style==='SERIOUS'?{style:'SERIOUS',template:'STORY_CARD',cardMode:order?'COMMENT':'POST',tone:'ANALYTICAL'}:{style:'FUNNY',template:'THREADS_CARD',emphasis:order?'COMMENT':'POST'},manualOverride:{lockedFields:[],revision:0}}));
  const mediaAssets:MediaAsset[]=[];
  quotes.forEach((quote,index)=>{const raw=index===0?rootRecord:selected[index-1].raw;
    const valid=(n:unknown)=>typeof n==='number'&&Number.isFinite(n)&&n>=0?n:null;
    storyboard[index].threadsCard={author:raw.author,handle:raw.handle,avatarUrl:raw.avatar,createdAt:raw.createdAt,dateLabel:null,sourceUrl:quote.url,topic:raw.topic??null,counts:{likes:valid(raw.likeCount),replies:valid(raw.replyCount),reposts:valid(raw.repostCount),shares:valid(raw.shareCount)},fieldStates:Object.fromEntries(Object.entries(raw.fields??{}).map(([key,value])=>[key,value.status]))};
    for(const media of raw.media){const id='quality-media-'+hash({sourceId:quote.id,url:media.url});mediaAssets.push({id,kind:media.kind,uri:media.url,availability:'MISSING',...(typed?{sourceReference:{entityType:quote.kind,entityId:quote.id}}:{})});storyboard[index].mediaAssetIds.push(id)}
  });
  const projectProposal:VideoProject|null=typed?{contractVersion:'1.0',id:candidate.id,style,title:rootText.slice(0,100),sources:[{id:identity.id,platform:'THREADS',canonicalUrl:identity.url,retrievedAt:c.root.provenance.observedAt,synthetic:c.root.provenance.synthetic}],posts:[{id:identity.id,sourceId:identity.id,author:{displayName:c.root.author.name??identity.handle,handle:identity.handle},text:rootRecord.text,mediaAssetIds:[],commentIds:selected.map(x=>x.id)}],comments:selected.map(x=>({id:x.id,sourceId:identity.id,postId:identity.id,...(x.parentId&&x.parentId!==identity.id?{parentCommentId:x.parentId}:{}),author:{displayName:x.author},text:x.originalText,relationshipStatus:x.relationship,observedTargetUrl:identity.url,mediaAssetIds:[]})),candidates:[candidate],storyboard,audioAssets:[],mediaAssets:[],publishing:{title:'',caption:'',hashtags:[],language:'vi',manualApprovalRequired:true}}:null;
  if(projectProposal){projectProposal.mediaAssets=mediaAssets;projectProposal.posts[0].mediaAssetIds=storyboard[0].mediaAssetIds;for(const comment of projectProposal.comments)comment.mediaAssetIds=storyboard.find(x=>x.id===comment.id)!.mediaAssetIds}
  return {version:CONTENT_SELECTION.version,configHash:hash({policy:CONTENT_SELECTION,topicTerms}),sourceUrl:identity.url,root:structuredClone(c.root),rootType,rightsStatus:'UNKNOWN' as const,style,status,score:Math.round(Object.values(breakdown).reduce<number>((a,b)=>a+(b??0),0)),breakdown,topicRelevance:{method:'LEXICAL_ONLY',matchedTerms:matchedTopicTerms,status:topicTerms.length?(matchedTopicTerms.length?'OBSERVED_LEXICAL_MATCH':'UNCERTAIN'):'UNKNOWN'},reasons,estimate,
    reportedReplies:c.reportedReplyCount,observedReplies:c.observedReplyCount,verifiedReplies:comments.filter(x=>x.relationship==='PARENT_VERIFIED').length,completeness:c.status,comments,quotes,scriptDraft:narration,candidate,storyboard,projectProposal,conversation:quality,accuracy:'NOT_MEASURED',productionApproved:false};
}
export function rankConversations(collections:ThreadCollection[],style:ContentStyle,asOf:string,topicTerms:string[]=[]){
  const rows=collections.map(c=>selectConversation(c,style,asOf,topicTerms));
  rows.forEach((r,index)=>{const prior=rows.slice(0,index).find(x=>x.sourceUrl===r.sourceUrl||normalize(x.quotes[0].text)===normalize(r.quotes[0].text)||similarity(x.quotes[0].text,r.quotes[0].text)>=CONTENT_SELECTION.nearDuplicate);if(prior){r.reasons.push('DUPLICATE_ROOT_OF '+prior.sourceUrl);r.score=0}});
  const ranked=rows.sort((a,b)=>b.score-a.score||a.sourceUrl.localeCompare(b.sourceUrl));
  return {version:CONTENT_SELECTION.version,ranked,topCandidates:ranked.filter(x=>x.status==='READY_FOR_EDITORIAL_REVIEW'&&!x.reasons.some(r=>r.startsWith('DUPLICATE_ROOT_OF'))).slice(0,5),precisionAt5:'NOT_MEASURED_NO_HUMAN_LABELS',productionApproved:false};
}
