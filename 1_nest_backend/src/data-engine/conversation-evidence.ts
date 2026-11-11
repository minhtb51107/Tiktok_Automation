import { hash } from './rules';
import {
  CONVERSATION_VERSION,
  type PublicPost,
  type RelationshipEvidence,
  type ThreadCollection,
} from './conversation-contracts';
import {canonicalPost} from './conversation-identity';
export {canonicalPost} from './conversation-identity';
export interface PublicDocument {
  domReplies?:import('../studio/context-classification').DomReplyEvidence[];
  url: string;
  observedAt: string;
  synthetic: boolean;
  /** Public DOM permalink observations. Structured records must also have their own visible permalink. */
  visibleUrls: string[];
  jsonLd: unknown[];
  cardObservations?: Array<{
    url: string;
    publishedAt: string | null;
    engagement: PublicPost['engagement'];
  }>;
}
const text = (x: unknown): string | null =>
  typeof x === 'string' && x.trim() ? x : null;
function date(x: unknown) {
  const s = text(x);
  return s && /^\d{4}-\d{2}-\d{2}T/.test(s) && Number.isFinite(Date.parse(s))
    ? new Date(s).toISOString()
    : null;
}
function ownUrl(x: any) {
  return canonicalPost(typeof x === 'string' ? x : x?.url || x?.['@id']);
}
/** Strict, public Schema.org relationship graph. Never infer parent from author or DOM position. */
export function collectEvidence(
  root: PublicPost,
  doc: PublicDocument,
  maxReplies = 20,
): ThreadCollection {
  const identity = canonicalPost(root.url),
    documentIdentity = canonicalPost(doc.url);
  if (
    !identity ||
    identity.id !== root.id ||
    identity.handle !== root.author.handle ||
    documentIdentity?.id !== root.id ||
    documentIdentity.handle !== identity.handle
  )
    throw Error('CONVERSATION_ROOT_IDENTITY_MISMATCH');
  if (!Number.isInteger(maxReplies) || maxReplies < 1 || maxReplies > 20)
    throw Error('CONVERSATION_INVALID_LIMIT');
  const visible = new Set(
    doc.visibleUrls.map((x) => canonicalPost(x)?.url).filter(Boolean),
  );
  const nodes = new Map<
    string,
    Array<{
      node: any;
      pointer: string;
      parent: any;
      kind: RelationshipEvidence['kind'];
    }>
  >();
  const unverified: ThreadCollection['unverified'] = [];
  let visited = 0;
  function walk(x: any, pointer: string, parent?: any) {
    if (++visited > 2000) return;
    if (Array.isArray(x)) {
      x.slice(0, 100).forEach((v, i) => walk(v, pointer + '/' + i, parent));
      return;
    }
    if (!x || typeof x !== 'object') return;
    const types = Array.isArray(x['@type']) ? x['@type'] : [x['@type']],
      isComment = types.includes('Comment');
    const id = ownUrl(x),
      explicit = x.parentItem;
    if (isComment && id) {
      const list = nodes.get(id.url) || [];
      list.push({
        node: x,
        pointer,
        parent: explicit || parent,
        kind: explicit ? 'JSON_LD_PARENT_ITEM' : 'JSON_LD_COMMENT',
      });
      nodes.set(id.url, list);
    }
    if (Array.isArray(x['@graph'])) walk(x['@graph'], pointer + '/@graph');
    if (x.comment) walk(x.comment, pointer + '/comment', id?.url);
  }
  doc.jsonLd.slice(0, 20).forEach((x, i) => walk(x, '/' + i));
  for(const r of (doc.domReplies??[]).slice(0,40)){
    const own=canonicalPost(r.subjectUrl),parent=canonicalPost(r.parentUrl);
    if(!own||!parent||canonicalPost(r.documentUrl)?.url!==identity.url||r.headerScoped!==true||canonicalPost(r.subjectTimePermalink)?.url!==own.url||!r.pointer||!/^(replying to|đang trả lời)(?:\s+@[\w.-]+)?$/iu.test(r.label.trim()))continue;
    // Existing conflicting structured records remain conservative; do not pick the convenient one.
    const previous=nodes.get(own.url)||[];
    if(previous.some(o=>o.kind!=='DOM_EXPLICIT_REPLY_TARGET'))continue;
    nodes.set(own.url,[...previous,{node:{'@type':'Comment',url:own.url,text:r.bodyText,author:{url:r.authorUrl}},pointer:r.pointer,parent:parent.url,kind:'DOM_EXPLICIT_REPLY_TARGET'}]);
  }
  // Conflicting handles for one stable post ID are not separate verified identities.
  const identityCounts = new Map<string, number>();
  for (const url of nodes.keys()) {
    const id = canonicalPost(url)!.id;
    identityCounts.set(id, (identityCounts.get(id) || 0) + 1);
  }
  const accepted = new Map<string, ThreadCollection['replies'][number]>(),
    pending = new Map(nodes);
  const documentHash = hash({jsonLd:doc.jsonLd,domReplies:doc.domReplies??[]});
  for (let pass = 0; pass < 21 && pending.size; pass++) {
    let progressed = false;
    for (const [url, observations] of pending) {
      const node = observations[0].node,
        id = canonicalPost(url)!,
        parents = observations.map((o) => ownUrl(o.parent)?.url || null);
      const parent = canonicalPost(parents[0]);
      let reason: string | null = null;
      if (identityCounts.get(id.id) !== 1)
        reason = 'CONFLICTING_PERMALINK_IDENTITY';
      else if (id.id === root.id) reason = 'ROOT_IS_NOT_A_REPLY';
      else if (!visible.has(url))
        reason = 'REPLY_PERMALINK_NOT_OBSERVED_IN_DOM';
      else if (
        observations.some((o) => hash(o.node) !== hash(node)) ||
        new Set(parents).size > 1
      )
        reason = 'AMBIGUOUS_REPLY_RECORD';
      else if (!parent) reason = 'MISSING_PARENT_EVIDENCE';
      else if (parent.id === id.id) reason = 'CYCLIC_PARENT';
      const body = text(node.articleBody) || text(node.text),
        author = ownAuthor(node.author);
      if (!body) reason = reason || 'MISSING_ORIGINAL_CONTENT';
      if (!author || author !== id.handle)
        reason = reason || 'AUTHOR_IDENTITY_UNVERIFIED';
      if (reason) {
        unverified.push({ url, reason });
        pending.delete(url);
        progressed = true;
        continue;
      }
      // The exact root URL or an already verified parent chain is required, not merely a matching handle.
      if (parent!.url !== identity!.url && !accepted.has(parent!.url)) continue;
      if (accepted.size >= maxReplies) {
        unverified.push({ url, reason: 'VERIFIED_REPLY_BUDGET_EXCEEDED' });
        pending.delete(url);
        continue;
      }
      const observation = observations[0];
      accepted.set(url, {
        id: id.id,
        url,
        author: { handle: id.handle, name: text(node.author?.name) },
        originalText: body!,
        publishedAt: date(node.datePublished),
        engagement: { likes: null, replies: null, reposts: null, shares: null },
        provenance: {
          documentUrl: identity!.url,
          observedAt: doc.observedAt,
          synthetic: doc.synthetic,
          method: observation.kind==='DOM_EXPLICIT_REPLY_TARGET'?'PUBLIC_HEADER_REPLY_LINK_AND_DOM_PERMALINK':'PUBLIC_JSON_LD_AND_DOM_PERMALINK',
        },
        parentId: parent!.id,
        rootId: root.id,
        extractionStatus: 'VERIFIED',
        evidence: {
          kind: observation.kind,
          documentUrl: identity!.url,
          documentHash,
          pointer: observation.pointer,
          subjectUrl: url,
          parentUrl: parent!.url,
        },
      });
      const matching =
        doc.cardObservations?.filter(
          (x) => canonicalPost(x.url)?.url === url,
        ) || [];
      if (matching.length === 1) {
        accepted.get(url)!.engagement = matching[0].engagement;
        accepted.get(url)!.publishedAt ??= date(matching[0].publishedAt);
        accepted.get(url)!.provenance.method +=
          ';UNIQUE_CARD_LABELLED_COUNTERS';
      }
      pending.delete(url);
      progressed = true;
    }
    if (!progressed) break;
  }
  for (const [url] of pending)
    unverified.push({ url, reason: 'PARENT_CHAIN_NOT_VERIFIED_TO_EXACT_ROOT' });
  const known = new Set([...nodes.keys(), identity.url]);
  for (const url of visible)
    if (url && !known.has(url))
      unverified.push({
        url,
        reason: 'DOM_CONTEXT_WITHOUT_RELATIONSHIP_EVIDENCE',
      });
  const replies = [...accepted.values()];
  return {
    version: CONVERSATION_VERSION,
    root,
    replies,
    unverified,
    reportedReplyCount: root.engagement.replies,
    observedReplyCount: replies.length + unverified.length,
    verifiedReplyCount: replies.length,
    unverifiedCandidateCount: unverified.length,
    startedAt: doc.observedAt,
    completedAt: doc.observedAt,
    status: replies.length ? 'PARTIAL' : 'UNKNOWN',
    warnings: [
      'Observed candidate count includes unverified context, not confirmed thread replies',
      'Public DOM observation cannot prove complete thread coverage',
      'Zero verified replies does not establish zero actual replies',
      ...(visited > 2000 ? ['STRUCTURED_DATA_BUDGET_EXCEEDED'] : []),
    ],
  };
}
function ownAuthor(a: any): string | null {
  if (Array.isArray(a) || !a) return null;
  try {
    const u = new URL(typeof a === 'string' ? a : a.url || a['@id']);
    return [
      'www.threads.com',
      'threads.com',
      'www.threads.net',
      'threads.net',
    ].includes(u.hostname) &&
      u.protocol === 'https:' &&
      !u.username &&
      !u.password &&
      !u.port
      ? u.pathname.match(/^\/@([\w.-]+)\/?$/)?.[1] || null
      : null;
  } catch {
    return null;
  }
}
