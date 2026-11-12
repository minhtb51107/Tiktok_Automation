import type { ThreadCollection } from './conversation-contracts';
import type { PublicRecord } from '../studio/public-types';
import { canonicalPost } from './conversation-identity';
import { classifyContext } from '../studio/context-classification';
import {
  analyzeSourceCardsV2,
  cleanSourceProjection,
} from '../studio/source-quality';
export interface ObservedContextView {
  id: string;
  url: string;
  author: string;
  originalText: string;
  displayText: string;
  raw: PublicRecord;
  relationship:
    | 'OBSERVED_RELATIONSHIP_UNVERIFIED'
    | 'RELATED_OR_RECOMMENDED'
    | 'UNKNOWN';
  reasons: string[];
  quality: ReturnType<typeof analyzeSourceCardsV2>[number];
  selectable: true;
  recommended: boolean;
}
function fallback(
  url: string,
  text: string,
  author: string,
  evidence: any[],
): PublicRecord {
  return {
    url,
    text,
    bodyText: text,
    author,
    handle: author,
    avatar: null,
    createdAt: null,
    type: 'UNKNOWN',
    parentReference: null,
    media: [],
    likeCount: null,
    replyCount: null,
    repostCount: null,
    shareCount: null,
    fields: {
      likeCount: {
        status: 'UNAVAILABLE',
        value: null,
        raw: null,
        source: 'not persisted in observation',
      },
      replyCount: {
        status: 'UNAVAILABLE',
        value: null,
        raw: null,
        source: 'not persisted in observation',
      },
      repostCount: {
        status: 'UNAVAILABLE',
        value: null,
        raw: null,
        source: 'not persisted in observation',
      },
      shareCount: {
        status: 'UNAVAILABLE',
        value: null,
        raw: null,
        source: 'not persisted in observation',
      },
    },
    provenance: {
      text: 'persisted target-page observation; parent unavailable',
      type: 'relationship unavailable',
    },
    contextEvidence: evidence,
  };
}
/** Canonical URL merge. Source cards win because they retain media and direct labelled counters. */
export function observedContextViews(
  c: ThreadCollection,
  style: 'SERIOUS' | 'FUNNY' = 'SERIOUS',
): ObservedContextView[] {
  const root = canonicalPost(c.root.url);
  if (!root) throw Error('CONVERSATION_INVALID_ROOT');
  const records = new Map<string, PublicRecord>();
  for (const raw of c.sourceCapture?.contextCandidates || []) {
    const own = canonicalPost(raw.url);
    if (own && own.url !== root.url) records.set(own.url, raw);
  }
  for (const candidate of c.unverified) {
    const own = canonicalPost(candidate.url);
    const o = candidate.observation;
    if (
      !own ||
      own.url === root.url ||
      !o?.originalText.trim() ||
      canonicalPost(o.targetUrl)?.url !== root.url
    )
      continue;
    if (!records.has(own.url))
      records.set(
        own.url,
        fallback(
          own.url,
          o.originalText,
          o.author.handle,
          o.contextEvidence || [],
        ),
      );
  }
  const rows = [...records.values()],
    quality = analyzeSourceCardsV2(rows, c.root.originalText, style);
  return rows.map((raw, index) => {
    const own = canonicalPost(raw.url)!;
    const assessment = classifyContext(raw, root.url),
      displayText = cleanSourceProjection(raw).text;
    return {
      id: own.id,
      url: own.url,
      author: raw.author,
      originalText: raw.text,
      displayText,
      raw,
      relationship:
        assessment.classification === 'PARENT_VERIFIED'
          ? 'UNKNOWN'
          : assessment.classification,
      reasons: [...assessment.reasons, ...quality[index].reasons],
      quality: quality[index],
      selectable: true,
      recommended:
        assessment.classification !== 'RELATED_OR_RECOMMENDED' &&
        quality[index].bucket === 'RECOMMENDED',
    };
  });
}
