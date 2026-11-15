import type { PublicRecord } from '../studio/public-types';
import type { observePublicContext } from '../studio/public-context-dom';
import { labelledCounts } from '../studio/metadata-fields';
import type { observePublicDocument } from './conversation-public';
import {
  canonicalPost,
  collectEvidence,
  type PublicDocument,
  type RelationshipCandidate,
} from './conversation-evidence';
import type { PublicPost, ThreadCollection } from './conversation-contracts';
import { normalizeConversation } from './conversation-normalizer';
import {
  projectParseforgeRows,
  type ParseforgeReplyRow,
} from './conversation-provider-parseforge';

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
            nodeIdentity: row.nodeIdentity,
            parentContainerPath: row.parentContainerPath,
            conversationContainer: row.conversationContainer,
            relationshipSignals: row.relationshipSignals,
            observedActionId: row.observedActionId,
            capturedAt: row.capturedAt,
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
  candidates: RelationshipCandidate[] = [],
): ThreadCollection {
  return collectEvidence(
    root,
    {
      ...document,
      relationshipCandidates: [
        ...(document.relationshipCandidates ?? []),
        ...candidates,
      ],
    },
    maxReplies,
  );
}

/** Deterministic UNKNOWN fallback plan; execution stays bounded by the caller. */
export function planPermalinkDetailValidation(
  rootUrl: string,
  cards: PublicRecord[],
  context: ReturnType<typeof observePublicContext>,
  budget = 2,
) {
  if (!Number.isInteger(budget) || budget < 0 || budget > 2)
    throw Error('CONVERSATION_INVALID_DETAIL_BUDGET');
  const root = canonicalPost(rootUrl);
  if (!root || budget === 0) return [];
  const alreadyExplicit = new Set(
      context.replies
        .map((row) => canonicalPost(row.subjectUrl)?.url)
        .filter((url): url is string => !!url),
    ),
    recommended = new Set(
      context.regions
        .filter((row) => row.kind === 'RECOMMENDATION_REGION')
        .map((row) => canonicalPost(row.subjectUrl)?.url)
        .filter((url): url is string => !!url),
    );
  return cards
    .map((card) => canonicalPost(card.url)?.url)
    .filter(
      (url): url is string =>
        !!url &&
        url !== root.url &&
        !alreadyExplicit.has(url) &&
        !recommended.has(url),
    )
    .filter((url, index, rows) => rows.indexOf(url) === index)
    .slice(0, budget);
}

export function sourceQualityAdapter(
  collection: ThreadCollection,
  style: 'SERIOUS' | 'FUNNY' = 'SERIOUS',
) {
  return normalizeConversation(collection, style);
}

/** Optional paid-provider import. It never invokes Apify and still uses collectEvidence(). */
export function adaptParseforgeCollection(
  root: PublicPost,
  rows: ParseforgeReplyRow[],
  observedAt: string,
  maxReplies = 20,
  providerRun?: { runId: string; datasetId: string; approvalId: string },
) {
  const projected = projectParseforgeRows(root, rows, observedAt),
    collection = resolveRelationships(
      root,
      {
        url: root.url,
        observedAt,
        synthetic: false,
        visibleUrls: projected.cards
          .map((card) => canonicalPost(card.url)?.url)
          .filter((url): url is string => !!url),
        jsonLd: [],
        relationshipCandidates: projected.candidates,
        cardObservations: projected.cards.map((card) => ({
          url: canonicalPost(card.url)!.url,
          publishedAt: card.createdAt,
          engagement: {
            likes: card.likeCount,
            replies: card.replyCount,
            reposts: card.repostCount,
            shares: card.shareCount ?? null,
          },
        })),
      },
      maxReplies,
    );
  collection.observedCards = projected.cards;
  collection.externalEvidence = projected.externalEvidence;
  if (providerRun)
    Object.assign(collection.externalEvidence, {
      runId: providerRun.runId,
      datasetId: providerRun.datasetId,
      approvalId: providerRun.approvalId,
    });
  collection.observationSummary = {
    subjectPermalinks: new Set(projected.cards.map((card) => card.url)).size,
    materializedCards: projected.cards.length,
    missingBody: 0,
    parentVerified: collection.verifiedReplyCount,
  };
  collection.warnings.push(
    'EXTERNAL_PROVIDER_EVIDENCE_REQUIRES_EXPLICIT_AUTHORIZATION_AND_INDEPENDENT_GRAPH_VALIDATION',
  );
  return collection;
}
