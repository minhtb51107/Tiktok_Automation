import {canonicalTarget,targetType} from '../data-engine/studio-integration';
import type {ThreadCollection,VerifiedReply} from '../data-engine/conversation-contracts';
/** Catalog classification is never derived from a VideoProject or SessionScene. */
export function catalogType(bronze:any,evaluation:any){return targetType(bronze?.itemType,undefined,evaluation?.review?.confirmedType);}
/** Browser-safe relationship check. Author and DOM order are deliberately irrelevant. */
export function verifiedLibraryReplies(c:ThreadCollection):VerifiedReply[]{
 if(!c?.root||canonicalTarget(c.root.url)!==c.root.id)return [];
 const rows=new Map(c.replies.map(r=>[r.id,r]));
 function chain(r:VerifiedReply,seen:Set<string>):boolean{
  if(!r||seen.has(r.id)||r.extractionStatus!=='VERIFIED'||r.rootId!==c.root.id||r.id===c.root.id||canonicalTarget(r.url)!==r.id)return false;
  const e=r.evidence;if(!e||!['JSON_LD_PARENT_ITEM','JSON_LD_COMMENT'].includes(e.kind)||canonicalTarget(e.subjectUrl)!==r.id||canonicalTarget(e.parentUrl)!==r.parentId||!e.documentHash||!e.pointer||!canonicalTarget(e.documentUrl))return false;
  seen.add(r.id);return r.parentId===c.root.id||chain(rows.get(r.parentId)!,seen);
 }
 return c.replies.filter(r=>chain(r,new Set()));
}
export function reportMarkdown(report:any){return '# Discovery batch report\n\n'+Object.entries(report).map(([k,v])=>'## '+k+'\n\n'+(typeof v==='string'?v:'```json\n'+JSON.stringify(v,null,2)+'\n```')).join('\n\n');}
