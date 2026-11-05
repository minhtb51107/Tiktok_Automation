import {hash} from './rules';
import type {MetricScore, PublicPost, PopularityCandidate} from './conversation-contracts';
export const POPULARITY_CONFIG = Object.freeze({version:'popularity/1', weights:{likes:15,replies:30,reposts:15,shares:15,freshness:15,velocity:10}, caps:{likes:10000,replies:500,reposts:500,shares:500},freshnessHours:168});
/** No follower/view estimates. Velocity requires two observations of exactly the same post. */
export function popularity(post: PublicPost, asOf: string, previous?: PublicPost): MetricScore {
  const c=POPULARITY_CONFIG, breakdown:MetricScore['breakdown']={};
  for(const field of ['likes','replies','reposts','shares'] as const){
    const n=post.engagement[field], valid=typeof n==='number'&&Number.isFinite(n)&&n>=0;
    breakdown[field]={value:valid?Math.min(1,Math.log1p(n)/Math.log1p(c.caps[field])):null,weight:c.weights[field],reason:valid?'Observed counter; log-scaled':'Counter unavailable or invalid'};
  }
  const age=(Date.parse(asOf)-Date.parse(post.publishedAt||''))/3600000;
  breakdown.freshness={value:Number.isFinite(age)&&age>=0?Math.max(0,1-age/c.freshnessHours):null,weight:c.weights.freshness,reason:'Observed publication time relative to explicit evaluation time'};
  const hours=previous?(Date.parse(post.provenance.observedAt)-Date.parse(previous.provenance.observedAt))/3600000:NaN;
  const delta=previous&&previous.id===post.id&&previous.url===post.url&&post.engagement.replies!==null&&previous.engagement.replies!==null?post.engagement.replies-previous.engagement.replies:NaN;
  breakdown.velocity={value:Number.isFinite(hours)&&hours>0&&Number.isFinite(delta)&&delta>=0?Math.min(1,Math.log1p(delta/hours)/Math.log1p(100)):null,weight:c.weights.velocity,reason:'Reply growth/hour only from two consistent observations, not an engagement rate'};
  const missing=Object.keys(breakdown).filter(k=>breakdown[k].value===null), observed=Object.values(breakdown).filter(x=>x.value!==null), denominator=observed.reduce((s,x)=>s+x.weight,0);
  const reliableCounters=['likes','replies','reposts','shares'].filter(k=>breakdown[k].value!==null).length;
  return {version:c.version,configHash:hash(c),score:denominator?Math.round(100*observed.reduce((s,x)=>s+x.value!*x.weight,0)/denominator):null,coverage:reliableCounters>=2&&breakdown.freshness.value!==null?'SUFFICIENT':denominator?'PARTIAL':'UNKNOWN',breakdown,missing,reasons:['Observed weighted engagement and freshness; not a HOT/viral prediction','Missing metrics are excluded, never converted to zero']};
}
export function rankCandidates(candidates: PopularityCandidate[], limit: number, asOf: string){
  const scored=candidates.map(x=>({candidate:x,metric:x.post?popularity(x.post,asOf):null}));
  // Avoid ranking incomparable sparse observations as if they were popularity evidence.
  const keys=scored.map(x=>x.metric?Object.keys(x.metric.breakdown).filter(k=>x.metric!.breakdown[k].value!==null).sort().join(','):'');
  const sufficient=scored.length>0&&scored.every(x=>x.metric?.coverage==='SUFFICIENT')&&new Set(keys).size===1;
  scored.sort((a,b)=>sufficient?(b.metric!.score!-a.metric!.score!||a.candidate.observedOrder-b.candidate.observedOrder):a.candidate.observedOrder-b.candidate.observedOrder);
  return {status:sufficient?'SUFFICIENT' as const:'PARTIAL' as const,reasons:[sufficient?'Comparable observed metrics; ranked by popularity/1':'Insufficient comparable metadata; preserving observed order. HOT status unproven'],selected:scored.slice(0,limit).map(x=>x.candidate.url)};
}
