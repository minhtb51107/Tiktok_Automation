import type { PublicRecord } from '../studio/public-types';
import type { observePublicContext } from '../studio/public-context-dom';
import { labelledCounts } from '../studio/metadata-fields';
import type { observePublicDocument } from './conversation-public';
import {
  canonicalPost,
  collectEvidence,
  type PublicDocument,
} from './conversation-evidence';
import type { PublicPost, ThreadCollection } from './conversation-contracts';
import { normalizeConversation } from './conversation-normalizer';

export function resolveExactRoot(input: {
  targetUrl: string;
  sourcePostId: string | null | undefined;
  sourceUrl: string | null | undefined;
  authorHandle: string | null | undefined;
  originalBody: string | null | undefined;
}) {
  const target = canonicalPost(input.targetUrl),
    source = canonicalPost(input.sourceUrl);
  if (
    !target ||
    !source ||
    target.url !== source.url ||
    target.id !== input.sourcePostId ||
    target.handle !== input.authorHandle ||
    !input.originalBody?.trim()
  )
    throw Error('CONVERSATION_EXACT_ROOT_BODY_UNVERIFIED');
  return target;
}

/** Materializes only exact card subjects. Other post links remain raw evidence, not cards. */
export function collectPublicCards(
  observed: ReturnType<typeof observePublicDocument>,
  context: ReturnType<typeof observePublicContext>,
  rootUrl: string,
  observedAt: string,
): PublicRecord[] {
  const root = canonicalPost(rootUrl);
  if (!root) throw Error('CONVERSATION_INVALID_ROOT');
  return observed.rows
    .filter(
      (row) =>
        !!row.subjectUrl &&
        !!row.authorHandle &&
        !!row.text.trim() &&
        canonicalPost(row.subjectUrl)?.url !== root.url,
    )
    .map((row) => {
      const fields = labelledCounts(row.controls, observedAt),
        value = (key: string) =>
          fields[key]?.status === 'AVAILABLE'
            ? Number(fields[key].value)
            : null,
        url = canonicalPost(row.subjectUrl)!.url;
      return {
        url,
        text: row.text,
        bodyText: row.text,
        author: row.authorHandle!,
        handle: row.authorHandle!,
        avatar: null,
        createdAt:
          row.date && Number.isFinite(Date.parse(row.date))
            ? new Date(row.date).toISOString()
            : null,
        type: 'UNKNOWN' as const,
        parentReference: null,
        media: row.media,
        likeCount: value('likeCount'),
        replyCount: value('replyCount'),
        repostCount: value('repostCount'),
        shareCount: value('shareCount'),
        fields,
        provenance: {
          text: 'bounded public card subject and structural body projection',
          handle: 'canonical subject permalink',
          media: 'owned DOM card media',
          createdAt: 'owned DOM card time[datetime]',
          type: 'relationship resolved separately',
          rawEvidence: JSON.stringify({
            pointer: row.pointer,
            rawText: row.rawText,
            linkedPostUrls: row.urls,
          }),
        },
        contextEvidence: context.regions.filter(
          (region) => canonicalPost(region.subjectUrl)?.url === url,
        ),
      };
    });
}

export function resolveRelationships(
  root: PublicPost,
  document: PublicDocument,
  maxReplies = 20,
): ThreadCollection {
  return collectEvidence(root, document, maxReplies);
}

export function sourceQualityAdapter(
  collection: ThreadCollection,
  style: 'SERIOUS' | 'FUNNY' = 'SERIOUS',
) {
  return normalizeConversation(collection, style);
}
