import type {PublicRecord} from './public-types';
import {canonicalPost} from '../data-engine/conversation-identity';
export type ContextClass='PARENT_VERIFIED'|'OBSERVED_RELATIONSHIP_UNVERIFIED'|'RELATED_OR_RECOMMENDED'|'UNKNOWN';
export interface ContextRegionEvidence {
  kind:'DISCUSSION_REGION'|'RECOMMENDATION_REGION';
  documentUrl:string;targetUrl:string;subjectUrl:string;label:string;pointer:string;
}
export interface DomReplyEvidence {
  subjectUrl:string;parentUrl:string;documentUrl:string;authorUrl:string;
  bodyText:string;pointer:string;label:string;
  subjectTimePermalink:string;headerScoped:boolean;
}
export interface ContextAssessment {
  version:'context-classification/1';classification:ContextClass;
  basis:'PUBLIC_DOM_REGION'|'CONTENT_RISK_HEURISTIC'|'NO_SCOPED_REGION_EVIDENCE'|'VALIDATED_PARENT_CHAIN';
  reasons:string[];parentId:string|null;manualDraftAllowed:true;
}
/** Risk classification, never a parent assertion. Caller validates verified chains separately. */
export function classifyContext(raw:PublicRecord,targetUrl:string):ContextAssessment {
  const target=canonicalPost(targetUrl),own=canonicalPost(raw.url),signals=raw.contextEvidence??[];
  const scoped=signals.filter(e=>target&&own&&canonicalPost(e.documentUrl)?.url===target.url&&canonicalPost(e.targetUrl)?.url===target.url&&canonicalPost(e.subjectUrl)?.url===own.url&&!!e.pointer);
  const recommendation=scoped.find(e=>e.kind==='RECOMMENDATION_REGION'&&/^(suggested posts|related posts|more posts|bài viết (đề xuất|liên quan|khác))$/iu.test(e.label.trim()));
  const discussion=scoped.find(e=>e.kind==='DISCUSSION_REGION'&&/^(replies|comments|discussion|bình luận|trả lời|cuộc thảo luận)$/iu.test(e.label.trim()));
  if(recommendation)return {version:'context-classification/1',classification:'RELATED_OR_RECOMMENDED',basis:'PUBLIC_DOM_REGION',reasons:['EXPLICIT_RECOMMENDATION_REGION','PARENT_NOT_PROVEN'],parentId:null,manualDraftAllowed:true};
  // Content cue is a review warning, not proof this is a root rather than a reply.
  const text=(raw.bodyText??raw.text).trim(),lines=text.split('\n');
  const standalone=/\((?:phần\s+(?:\d+|cuối)|part\s+\d+)\)/iu.test(lines.slice(0,2).join(' '))&&/(sau\s+\d+\s+phần|các phần trước|previous parts)/iu.test(text);
  if(standalone)return {version:'context-classification/1',classification:'RELATED_OR_RECOMMENDED',basis:'CONTENT_RISK_HEURISTIC',reasons:['SELF_CONTAINED_SERIES_POST_SIGNAL','SUSPECTED_RECOMMENDATION_NOT_A_PARENT_VERDICT','HUMAN_REVIEW_OR_TOPIC_COMPILATION'],parentId:null,manualDraftAllowed:true};
  if(discussion)return {version:'context-classification/1',classification:'OBSERVED_RELATIONSHIP_UNVERIFIED',basis:'PUBLIC_DOM_REGION',reasons:['LABELLED_DISCUSSION_REGION_WITH_EXACT_TARGET','DIRECT_PARENT_NOT_PROVEN'],parentId:null,manualDraftAllowed:true};
  return {version:'context-classification/1',classification:'UNKNOWN',basis:'NO_SCOPED_REGION_EVIDENCE',reasons:['TARGET_PAGE_OBSERVATION_IS_NOT_A_PARENT_RELATION','NO_SAVED_SCOPED_REGION_EVIDENCE'],parentId:null,manualDraftAllowed:true};
}
