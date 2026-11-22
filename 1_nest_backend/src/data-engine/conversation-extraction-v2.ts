import type { PublicRecord } from '../studio/public-types';
import type { observePublicContext } from '../studio/public-context-dom';
import { labelledCounts } from '../studio/metadata-fields';
import type {
  observePublicDocument,
  PublicConversationSnapshot,
} from './conversation-public';
import {
  canonicalPost,
  collectEvidence,
  type PublicDocument,
  type RelationshipCandidate,
} from './conversation-evidence';
import type {
  ConversationAcquisitionTrace,
  MembershipEvidence,
  PublicPost,
  ThreadCollection,
} from './conversation-contracts';
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
        avatar: (row as { avatarUrl?: string | null }).avatarUrl ?? null,
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

/**
 * Resolves conversation membership independently from direct parent edges.
 * Same-page presence, DOM order, author and semantic similarity are never enough.
 */
export function resolveConversationMembership(input: {
  rootUrl: string;
  observed: ReturnType<typeof observePublicDocument>;
  context: ReturnType<typeof observePublicContext>;
  snapshots: PublicConversationSnapshot[];
  acquisition: ConversationAcquisitionTrace;
}): MembershipEvidence[] {
  const root = canonicalPost(input.rootUrl);
  if (!root) throw Error('CONVERSATION_INVALID_ROOT');
  const byId = new Map<string, MembershipEvidence>();
  const put = (
    subjectUrl: string,
    status: MembershipEvidence['status'],
    evidenceType: string,
    sourceActionId: string | null,
    containerReference: string | null,
    observedAt: string,
  ) => {
    const subject = canonicalPost(subjectUrl);
    if (!subject || subject.url === root.url) return;
    const previous = byId.get(subject.id);
    // Recommendation evidence is contamination protection and wins conflicts.
    if (previous?.status === 'RECOMMENDED_POST') return;
    if (previous?.status === 'THREAD_UI_CONFIRMED' && status === 'UNKNOWN')
      return;
    byId.set(subject.id, {
      rootId: root.id,
      subjectId: subject.id,
      status,
      evidenceType,
      sourceActionId,
      containerReference,
      observedAt,
    });
  };

  for (const row of input.observed.rows) {
    if (!row.subjectUrl) continue;
    const region = input.context.regions.find(
      (candidate) =>
        canonicalPost(candidate.subjectUrl)?.url ===
        canonicalPost(row.subjectUrl)?.url,
    );
    const explicitReply = input.context.replies.find(
      (candidate) =>
        canonicalPost(candidate.subjectUrl)?.url ===
        canonicalPost(row.subjectUrl)?.url,
    );
    if (region?.kind === 'RECOMMENDATION_REGION')
      put(
        row.subjectUrl,
        'RECOMMENDED_POST',
        'EXPLICIT_RECOMMENDATION_REGION',
        row.observedActionId,
        region.conversationContainerPointer ?? region.pointer,
        row.capturedAt,
      );
    else if (region?.kind === 'DISCUSSION_REGION' || explicitReply)
      put(
        row.subjectUrl,
        'THREAD_UI_CONFIRMED',
        explicitReply
          ? 'EXPLICIT_PUBLIC_REPLY_RELATIONSHIP'
          : 'EXPLICIT_DISCUSSION_REGION',
        row.observedActionId,
        explicitReply?.conversationContainerPointer ??
          region?.conversationContainerPointer ??
          region?.pointer ??
          null,
        row.capturedAt,
      );
    else
      put(
        row.subjectUrl,
        'UNKNOWN',
        'NO_EXPLICIT_CONVERSATION_SURFACE_EVIDENCE',
        row.observedActionId,
        row.conversationContainer?.pointer ?? null,
        row.capturedAt,
      );
  }

  const seen = new Set<string>();
  for (const snapshot of input.snapshots) {
    const action = input.acquisition.actions.find(
      (candidate) => candidate.id === snapshot.actionId,
    );
    for (const row of snapshot.observed.rows) {
      const subject = canonicalPost(row.subjectUrl);
      if (!subject || subject.url === root.url || seen.has(subject.url))
        continue;
      seen.add(subject.url);
      if (
        !action ||
        !['EXPAND_NESTED', 'LOAD_MORE'].includes(action.kind) ||
        !action.containerIdentity ||
        !action.containerSubjectUrl
      )
        continue;
      const containerSubject = canonicalPost(action.containerSubjectUrl),
        containerMembership = containerSubject
          ? byId.get(containerSubject.id)?.status
          : null,
        trustedContainer =
          containerSubject?.url === root.url ||
          containerMembership === 'THREAD_UI_CONFIRMED',
        insideContainer =
          row.nodeIdentity === action.containerIdentity ||
          row.nodeIdentity.startsWith(`${action.containerIdentity}/`) ||
          row.parentContainerPath === action.containerIdentity ||
          row.parentContainerPath.startsWith(`${action.containerIdentity}/`);
      if (trustedContainer && insideContainer)
        put(
          subject.url,
          'THREAD_UI_CONFIRMED',
          'EXPANDED_FROM_CONFIRMED_CONVERSATION_CONTAINER',
          action.id,
          action.containerIdentity,
          row.capturedAt,
        );
    }
  }
  return [...byId.values()];
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
