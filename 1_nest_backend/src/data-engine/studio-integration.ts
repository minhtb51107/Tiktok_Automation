/** Browser-safe integration gates. No Node, model or service imports. */
export type TargetType = 'POST' | 'COMMENT' | 'UNKNOWN';
export function canonicalTarget(value: unknown): string | null {
  try {
    if(typeof value!=='string')return null;
    const u=new URL(value),m=u.pathname.match(/^\/@[\w.-]+\/post\/([A-Za-z0-9_-]{3,128})\/?$/);
    return u.protocol==='https:'&&!u.username&&!u.password&&!u.port&&['threads.com','www.threads.com','threads.net','www.threads.net'].includes(u.hostname)&&m?m[1]:null;
  }catch{return null;}
}
export function matchCatalogIdentity<T extends {sourceUrl:string|null;sourcePostId:string|null}>(url:string,rows:T[]):T|null {
  const id=canonicalTarget(url);if(!id)return null;
  const matches=rows.filter(r=>r.sourcePostId===id&&canonicalTarget(r.sourceUrl)===id);
  return matches.length===1?matches[0]:null;
}
export function targetType(raw:unknown,chosen?:unknown,prior?:unknown):TargetType {
  const known=(v:unknown):v is 'POST'|'COMMENT'=>v==='POST'||v==='COMMENT';
  if(known(raw)&&known(chosen)&&raw!==chosen)throw Error('TARGET_TYPE_CONFLICT');
  return known(chosen)?chosen:known(raw)?raw:known(prior)?prior:'UNKNOWN';
}
export function reviewPayload(revision:number,decision:string,reason:string,type:TargetType) {
  if(!Number.isSafeInteger(revision)||revision<0)throw Error('STALE_REVISION');
  if(!['ACCEPT','REJECT','NEEDS_REVIEW'].includes(decision)||!reason.trim())throw Error('REVIEW_REASON_REQUIRED');
  if(decision==='ACCEPT'&&type==='UNKNOWN')throw Error('TARGET_CONFIRMATION_REQUIRED');
  return {revision,decision,reason:reason.trim(),...(type!=='UNKNOWN'?{confirmedType:type}:{})};
}
export function feedbackPayload(revision:number,requestId:string,decision:string,reason:string) {
  if(!Number.isSafeInteger(revision)||revision<0||!requestId||!['ACCEPT','REJECT','NEEDS_REVIEW'].includes(decision)||!reason.trim())throw Error('INVALID_QUALITY_FEEDBACK');
  return {revision,requestId,decision,reason:reason.trim()};
}
