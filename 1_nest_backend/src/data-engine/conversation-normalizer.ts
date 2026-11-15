import type { PublicRecord } from '../studio/public-types';
import { classifyContext } from '../studio/context-classification';
import {
  analyzeSourceCardsV2,
  cleanSourceProjection,
} from '../studio/source-quality';
import type {
  ConversationMembership,
  MembershipEvidence,
  ThreadCollection,
  VerifiedReply,
} from './conversation-contracts';
import { canonicalPost } from './conversation-identity';
import { estimatedDuration } from './editorial-feasibility';

export type NormalizedConversationGroup =
  | 'PARENT_VERIFIED'
  | 'OBSERVED_CONVERSATION'
  | 'RELATED_OR_RECOMMENDED'
  | 'UNKNOWN'
  | 'INCOMPLETE';

export interface NormalizedConversationCard {
  id: string;
  url: string;
  author: string | null;
  originalText: string | null;
  displayText: string | null;
  group: NormalizedConversationGroup;
  parentId: string | null;
  membership: ConversationMembership;
  membershipEvidence: MembershipEvidence | null;
  evidence: string[];
  raw: PublicRecord | null;
  quality: ReturnType<typeof analyzeSourceCardsV2>[number] | null;
  mediaCount: number;
  engagement: {
    likes: number | null;
    replies: number | null;
    reposts: number | null;
    shares: number | null;
  };
}

export interface NormalizedConversation {
  version: 'conversation-normalized/2';
  root: ThreadCollection['root'];
  /** Clean projection only; root.originalText remains immutable evidence. */
  rootDisplayText: string;
  cards: NormalizedConversationCard[];
  groups: Record<NormalizedConversationGroup, NormalizedConversationCard[]>;
  counts: {
    subjectPermalinks: number;
    materialized: number;
    verified: number;
    observedConversation: number;
    related: number;
    unknown: number;
    incompleteObservations: number;
    missingBody: number;
  };
  automation: {
    selectedVerifiedReplyIds: string[];
    selectedThreadUiIds: string[];
    selectedConversationIds: string[];
    selectedObservedUrls: string[];
    status: 'READY_FOR_QUALITY' | 'EXCEPTION_REVIEW' | 'NOT_ENOUGH_EVIDENCE';
    reasons: string[];
    candidateStatus:
      | 'READY_FOR_DRAFT'
      | 'NOT_ENOUGH_CONTENT'
      | 'EXCEPTION_REVIEW';
    durationEstimate: Omit<
      ReturnType<typeof estimatedDuration>,
      'source' | 'targetSeconds'
    > & {
      source: 'ESTIMATED_TEXT_ONLY';
      targetSeconds: [65, 90];
    };
    continueDiscovery: boolean;
  };
}

function replyRecord(reply: VerifiedReply): PublicRecord {
  return {
    url: reply.url,
    text: reply.originalText,
    bodyText: reply.originalText,
    author: reply.author.name ?? reply.author.handle,
    handle: reply.author.handle,
    avatar: null,
    createdAt: reply.publishedAt,
    type: 'COMMENT',
    parentReference: reply.evidence.parentUrl,
    media: [],
    likeCount: reply.engagement.likes,
    replyCount: reply.engagement.replies,
    repostCount: reply.engagement.reposts,
    shareCount: reply.engagement.shares,
    provenance: {
      text: reply.provenance.method,
      type: reply.evidence.kind,
    },
  };
}

/**
 * V2 projection over the immutable capture. Canonical identity is the only merge key.
 * Relationship groups are evidence classes; text quality can never upgrade them.
 */
export function normalizeConversation(
  collection: ThreadCollection,
  style: 'SERIOUS' | 'FUNNY' = 'SERIOUS',
): NormalizedConversation {
  const root = canonicalPost(collection.root.url);
  if (!root) throw Error('CONVERSATION_INVALID_ROOT');
  const capturedRoot = collection.sourceCapture?.records.find(
    (row) => canonicalPost(row.url)?.url === root.url,
  );
  const rootDisplayText = cleanSourceProjection(
    capturedRoot ?? {
      url: root.url,
      text: collection.root.originalText,
      bodyText: collection.root.originalText,
      author: collection.root.author.name ?? collection.root.author.handle,
      handle: collection.root.author.handle,
      avatar: null,
      createdAt: collection.root.publishedAt,
      type: collection.root.itemType ?? 'UNKNOWN',
      parentReference: null,
      media: [],
      likeCount: collection.root.engagement.likes,
      replyCount: collection.root.engagement.replies,
      repostCount: collection.root.engagement.reposts,
      shareCount: collection.root.engagement.shares,
      provenance: { text: collection.root.provenance.method },
    },
  ).text;
  const raw = new Map<string, PublicRecord>();
  for (const row of [
    ...(collection.sourceCapture?.contextCandidates ?? []),
    ...(collection.observedCards ?? []),
  ]) {
    const own = canonicalPost(row.url);
    if (!own || own.url === root.url) continue;
    const previous = raw.get(own.url);
    // Prefer the richest direct card, never merge authored text from two observations.
    if (
      !previous ||
      (row.bodyText ?? row.text).length >
        (previous.bodyText ?? previous.text).length
    )
      raw.set(own.url, row);
  }
  const verifiedByUrl = new Map(
    collection.replies.map((reply) => [canonicalPost(reply.url)!.url, reply]),
  );
  for (const [url, reply] of verifiedByUrl)
    if (!raw.has(url)) raw.set(url, replyRecord(reply));
  const observedByUrl = new Map(
    collection.unverified
      .filter((row) => row.url)
      .map((row) => [canonicalPost(row.url!)?.url, row] as const)
      .filter(
        (row): row is [string, ThreadCollection['unverified'][number]] =>
          !!row[0],
      ),
  );
  const membershipById = new Map(
    (collection.membershipEvidence ?? []).map((evidence) => [
      evidence.subjectId,
      evidence,
    ]),
  );
  const legacyObservationByUrl = new Map(
    [...observedByUrl]
      .filter(([, row]) => !!row.observation)
      .map(([url, row]) => [url, row.observation!] as const),
  );
  const qualityRows = [...raw.values()];
  const quality = analyzeSourceCardsV2(
    qualityRows,
    collection.root.originalText,
    style,
  );
  const qualityByUrl = new Map(
    qualityRows.map((row, index) => [
      canonicalPost(row.url)!.url,
      quality[index],
    ]),
  );
  const urls = new Set<string>([
    ...raw.keys(),
    ...verifiedByUrl.keys(),
    ...observedByUrl.keys(),
  ]);
  const cards: NormalizedConversationCard[] = [];
  for (const url of urls) {
    const verified = verifiedByUrl.get(url);
    const source = raw.get(url) ?? (verified ? replyRecord(verified) : null);
    const unresolved = observedByUrl.get(url);
    const legacyObservation = legacyObservationByUrl.get(url);
    const own = canonicalPost(url)!;
    const membershipEvidence = membershipById.get(own.id) ?? null;
    let group: NormalizedConversationGroup;
    let evidence: string[];
    if (verified) {
      group = 'PARENT_VERIFIED';
      evidence = [verified.evidence.kind, verified.evidence.pointer];
    } else if (!source || !(source.bodyText ?? source.text).trim()) {
      group = 'INCOMPLETE';
      evidence = [
        unresolved?.reason ?? 'MISSING_CARD_BODY',
        legacyObservation?.originalText.trim()
          ? 'LEGACY_OBSERVATION_PROJECTION_WITHOUT_FULL_CARD'
          : 'BODY_NOT_RECOVERABLE_FROM_SAVED_CAPTURE',
      ];
    } else {
      const assessment = classifyContext(source, root.url);
      group =
        membershipEvidence?.status === 'THREAD_UI_CONFIRMED'
          ? 'OBSERVED_CONVERSATION'
          : membershipEvidence?.status === 'RECOMMENDED_POST'
            ? 'RELATED_OR_RECOMMENDED'
            : assessment.classification === 'OBSERVED_RELATIONSHIP_UNVERIFIED'
              ? 'OBSERVED_CONVERSATION'
              : assessment.classification === 'RELATED_OR_RECOMMENDED'
                ? 'RELATED_OR_RECOMMENDED'
                : 'UNKNOWN';
      evidence = [
        membershipEvidence?.evidenceType,
        unresolved?.reason,
        ...assessment.reasons,
      ].filter((value): value is string => !!value);
    }
    const projection = source ? cleanSourceProjection(source) : null;
    cards.push({
      id: own.id,
      url,
      author:
        source?.author ??
        verified?.author.handle ??
        legacyObservation?.author.handle ??
        null,
      originalText:
        source?.text ??
        verified?.originalText ??
        legacyObservation?.originalText ??
        null,
      displayText:
        projection?.text || legacyObservation?.originalText.trim() || null,
      group,
      parentId: verified?.parentId ?? null,
      membership: membershipEvidence?.status ?? 'UNKNOWN',
      membershipEvidence,
      evidence,
      raw: source,
      quality: qualityByUrl.get(url) ?? null,
      mediaCount: source?.media.length ?? 0,
      engagement: {
        likes: source?.likeCount ?? verified?.engagement.likes ?? null,
        replies: source?.replyCount ?? verified?.engagement.replies ?? null,
        reposts: source?.repostCount ?? verified?.engagement.reposts ?? null,
        shares: source?.shareCount ?? verified?.engagement.shares ?? null,
      },
    });
  }
  const groups: NormalizedConversation['groups'] = {
    PARENT_VERIFIED: [],
    OBSERVED_CONVERSATION: [],
    RELATED_OR_RECOMMENDED: [],
    UNKNOWN: [],
    INCOMPLETE: [],
  };
  for (const card of cards) groups[card.group].push(card);
  const selectedVerifiedReplyIds = groups.PARENT_VERIFIED.filter(
      (card) => card.quality?.bucket === 'RECOMMENDED',
    ).map((card) => card.id),
    selectedThreadUiIds = groups.OBSERVED_CONVERSATION.filter(
      (card) =>
        card.membership === 'THREAD_UI_CONFIRMED' &&
        card.quality?.bucket === 'RECOMMENDED',
    ).map((card) => card.id),
    selectedObservedUrls = groups.OBSERVED_CONVERSATION.filter((card) =>
      selectedThreadUiIds.includes(card.id),
    ).map((card) => card.url),
    selectedConversationIds = [
      ...selectedVerifiedReplyIds,
      ...selectedThreadUiIds,
    ];
  const exceptionCount = groups.UNKNOWN.length + groups.INCOMPLETE.length;
  const reasons: string[] = [];
  if (!groups.PARENT_VERIFIED.length)
    reasons.push('NO_PARENT_VERIFIED_REPLIES');
  if (selectedThreadUiIds.length)
    reasons.push('THREAD_UI_MEMBERSHIP_SELECTED_WITHOUT_DIRECT_PARENT_CLAIM');
  if (groups.INCOMPLETE.length) reasons.push('INCOMPLETE_CARD_OBSERVATIONS');
  const selectedNarration = [
    rootDisplayText,
    ...groups.PARENT_VERIFIED.filter((card) =>
      selectedVerifiedReplyIds.includes(card.id),
    ).map((card) => card.displayText),
    ...groups.OBSERVED_CONVERSATION.filter((card) =>
      selectedThreadUiIds.includes(card.id),
    ).map((card) => card.displayText),
  ]
    .filter((value): value is string => !!value)
    .join('\n\n');
  const duration = estimatedDuration(selectedNarration, 1.3),
    candidateStatus = selectedConversationIds.length
      ? duration.maximumSeconds >= 65
        ? ('READY_FOR_DRAFT' as const)
        : ('NOT_ENOUGH_CONTENT' as const)
      : exceptionCount
        ? ('EXCEPTION_REVIEW' as const)
        : ('NOT_ENOUGH_CONTENT' as const);
  if (candidateStatus === 'NOT_ENOUGH_CONTENT')
    reasons.push('SELECTED_CONVERSATION_CONTENT_BELOW_65_SECOND_TARGET');
  return {
    version: 'conversation-normalized/2',
    root: collection.root,
    rootDisplayText,
    cards,
    groups,
    counts: {
      subjectPermalinks: cards.length,
      materialized: cards.filter((card) => card.group !== 'INCOMPLETE').length,
      verified: groups.PARENT_VERIFIED.length,
      observedConversation: groups.OBSERVED_CONVERSATION.length,
      related: groups.RELATED_OR_RECOMMENDED.length,
      unknown: groups.UNKNOWN.length,
      incompleteObservations: groups.INCOMPLETE.length,
      missingBody: groups.INCOMPLETE.filter((card) => !card.displayText).length,
    },
    automation: {
      selectedVerifiedReplyIds,
      selectedThreadUiIds,
      selectedConversationIds,
      selectedObservedUrls,
      status: selectedConversationIds.length
        ? exceptionCount
          ? 'EXCEPTION_REVIEW'
          : 'READY_FOR_QUALITY'
        : 'NOT_ENOUGH_EVIDENCE',
      reasons,
      candidateStatus,
      durationEstimate: {
        ...duration,
        source: 'ESTIMATED_TEXT_ONLY',
        targetSeconds: [65, 90],
      },
      continueDiscovery: candidateStatus !== 'READY_FOR_DRAFT',
    },
  };
}
