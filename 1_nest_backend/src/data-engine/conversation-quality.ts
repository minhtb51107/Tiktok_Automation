import {hash} from './rules';
import {popularity} from './conversation-popularity';
import type {MetricScore, ThreadCollection, ReplyQuality, ConversationEvaluation} from './conversation-contracts';
export const CONVERSATION_CONFIG=Object.freeze({version:'conversation-quality/1',nearDuplicate:0.85,replyWeights:{relevance:25,experience:20,argument:20,context:20,novelty:15},conversationWeights:{substance:40,relevance:20,novelty:15,viewpointProxy:15,cleanliness:10},videoWeights:{discussion:55,material:30,readability:15}});
export function normalizeReply(s:string){return s.normalize('NFC').toLocaleLowerCase('vi').replace(/https?:\/\/\S+/g,' URL ').replace(/[^\p{L}\p{N}]+/gu,' ').trim().replace(/\s+/g,' ');}
const tokens=(s:string)=>new Set(normalizeReply(s).split(' ').filter(x=>x.length>1));
function overlap(a:Set<string>,b:Set<string>){return [...a].filter(x=>b.has(x)).length/Math.max(1,Math.min(a.size,b.size));}
function jaccard(a:Set<string>,b:Set<string>){const intersection=[...a].filter(x=>b.has(x)).length;return intersection/Math.max(1,new Set([...a,...b]).size);}
function metric(version:string,values:Record<string,{value:number|null;weight:number;reason:string}>,coverage:MetricScore['coverage'],reasons:string[]):MetricScore{
  const available=Object.values(values).filter(x=>x.value!==null),weight=available.reduce((s,x)=>s+x.weight,0);
  return {version,configHash:hash(CONVERSATION_CONFIG),score:weight?Math.round(100*available.reduce((s,x)=>s+x.value!*x.weight,0)/weight):null,coverage,breakdown:values,missing:Object.keys(values).filter(k=>values[k].value===null),reasons};
}
export function evaluateConversation(collection:ThreadCollection,asOf:string):ConversationEvaluation{
 const c=CONVERSATION_CONFIG,rootTokens=tokens(collection.root.originalText),seen:Array<{id:string;text:string;tokens:Set<string>}>=[];
 const quality:ReplyQuality[]=collection.replies.map(reply=>{
  const raw=reply.originalText,t=normalizeReply(raw),words=tokens(raw);
  const duplicate=seen.find(x=>x.text===t||(words.size>=8&&x.tokens.size>=8&&jaccard(words,x.tokens)>=c.nearDuplicate));
  const relevance=overlap(words,rootTokens),experience=/\b(tôi|mình|em|anh|chị)\b/iu.test(t)&&/(đã|từng|trải nghiệm|hồi|năm|tháng|ngày|chỗ|công ty)/iu.test(t);
  const argument=/(nhưng|tuy nhiên|không đồng ý|vì|bởi|thực ra|không hẳn|ngược lại)/iu.test(t);
  const low=!/[\p{L}\p{N}]/u.test(raw)||/^(haha|hihi|kkk|wow|đúng rồi|chuẩn|hay quá|chấm| hóng|hóng|trời ơi)[ !.]*$/iu.test(t);
  const spam=/(mua ngay|giảm giá|ưu đãi|tuyển gấp|kiếm tiền nhanh)/iu.test(t)&&/(inbox|liên hệ|zalo|https?:\/\/|0\d[\d .]{7,})/iu.test(raw);
  const novelty=words.size?[...words].filter(x=>!rootTokens.has(x)).length/words.size:0;
  const values={relevance:{value:relevance,weight:c.replyWeights.relevance,reason:'Lexical overlap only; disagreement/sarcasm may not share words'},experience:{value:experience?1:0,weight:c.replyWeights.experience,reason:'Personal experience markers, not verified factual truth'},argument:{value:argument?1:0,weight:c.replyWeights.argument,reason:'Contrast/reason markers; short counterarguments can qualify'},context:{value:words.size>=5?1:words.size/5,weight:c.replyWeights.context,reason:'Context proxy, never a length-only decision'},novelty:{value:novelty,weight:c.replyWeights.novelty,reason:'Lexical novelty, not semantic novelty'}};
  const label=duplicate?'DUPLICATE':spam?'SPAM':low?'LOW_INFORMATION':(argument&&words.size>=3&&relevance>0)||(experience&&relevance>0)?'SUBSTANTIVE':'UNCERTAIN';
  seen.push({id:reply.id,text:t,tokens:words});
  return {replyId:reply.id,label,duplicateOf:duplicate?.id||null,metric:metric('reply-quality/1',values,label==='UNCERTAIN'?'PARTIAL':'SUFFICIENT',[label,duplicate?'Exact/near content duplicate retained for audit':'Rules cannot establish semantics, irony or factual accuracy'])};
 });
 const n=quality.length,sub=quality.filter(x=>x.label==='SUBSTANTIVE').length,low=quality.filter(x=>x.label==='LOW_INFORMATION').length,bad=quality.filter(x=>['SPAM','DUPLICATE'].includes(x.label)).length;
 const mean=(key:string)=>n?quality.reduce((s,x)=>s+(x.metric.breakdown[key].value||0),0)/n:null;
 const ratio=(v:number)=>n?v/n:null;
 const discussion=metric(c.version,{
  substance:{value:ratio(sub),weight:c.conversationWeights.substance,reason:'Substantive ratio of verified observed sample'},
  relevance:{value:mean('relevance'),weight:c.conversationWeights.relevance,reason:'Lexical relevance proxy'},
  novelty:{value:mean('novelty'),weight:c.conversationWeights.novelty,reason:'Lexical novelty proxy'},
  viewpointProxy:{value:n?Math.min(1,quality.filter(x=>(x.metric.breakdown.argument.value||0)>0).length/3):null,weight:c.conversationWeights.viewpointProxy,reason:'Argument-marker variety proxy; not verified viewpoint diversity'},
  cleanliness:{value:n?1-bad/n:null,weight:c.conversationWeights.cleanliness,reason:'Non-spam/non-duplicate sample ratio'}
 },n?'PARTIAL':'UNKNOWN',['Applies to verified observed sample only, never the entire reported thread',...collection.warnings]);
 const suitability=metric('video-suitability/1',{
  discussion:{value:discussion.score===null?null:discussion.score/100,weight:c.videoWeights.discussion,reason:'Conversation heuristic, not production approval'},
  material:{value:n?Math.min(1,sub/5):null,weight:c.videoWeights.material,reason:'Substantive material availability; no fabricated narration'},
  readability:{value:n?quality.filter(x=>!['SPAM','LOW_INFORMATION','DUPLICATE'].includes(x.label)).length/n:null,weight:c.videoWeights.readability,reason:'Rule-based dialogue suitability proxy; human review required'}
 },n?'PARTIAL':'UNKNOWN',['Rights remain UNKNOWN; human content/audio/production gates unchanged']);
 return {version:c.version,configHash:hash(c),asOf,popularity:popularity(collection.root,asOf),replyQuality:quality,conversation:discussion,videoSuitability:suitability,sample:{verified:n,substantive:sub,lowInformation:low,spamDuplicate:bad,substantiveRatio:ratio(sub),lowInformationRatio:ratio(low),spamDuplicateRatio:ratio(bad),denominator:'VERIFIED_OBSERVED_SAMPLE',collectionStatus:collection.status},precisionAt10:{status:'NOT_MEASURED',reason:'No complete, independent human ground truth for a ranked top 10'}};
}
