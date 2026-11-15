import { existsSync, readFileSync } from 'fs';
import * as path from 'path';
import { describe, expect, jest, test } from '@jest/globals';
import type { PublicRecord } from '../studio/public-types';
import type { PublicPost, ThreadCollection } from './conversation-contracts';
import { collectEvidence } from './conversation-evidence';
import { normalizeConversation } from './conversation-normalizer';
import {
  collectPublicCards,
  planPermalinkDetailValidation,
  resolveConversationMembership,
  resolveExactRoot,
} from './conversation-extraction-v2';
import { ConversationStudioService } from './conversation.controller';

const root: PublicPost = {
  id: 'ROOT',
  url: 'https://www.threads.com/@tester/post/ROOT',
  author: { handle: 'tester', name: 'TEST DATA' },
  originalText: 'SYNTHETIC TEST DATA chia sẻ trải nghiệm công việc.',
  publishedAt: null,
  engagement: { likes: 10, replies: 3, reposts: null, shares: null },
  provenance: {
    documentUrl: 'https://www.threads.com/@tester/post/ROOT',
    observedAt: '2026-11-15T00:00:00.000Z',
    method: 'SYNTHETIC TEST DATA',
    synthetic: true,
  },
};

function syntheticCollection() {
  return collectEvidence(root, {
    url: root.url,
    observedAt: root.provenance.observedAt,
    synthetic: true,
    visibleUrls: ['https://www.threads.com/@tester/post/R1'],
    jsonLd: [
      {
        '@type': 'Comment',
        url: 'https://www.threads.com/@tester/post/R1',
        parentItem: root.url,
        author: { url: 'https://www.threads.com/@tester' },
        text: 'Tôi có trải nghiệm bổ sung đủ rõ ràng cho dữ liệu kiểm thử.',
      },
    ],
  });
}

function card(
  id: string,
  text: string,
  evidence: PublicRecord['contextEvidence'] = [],
): PublicRecord {
  return {
    url: `https://www.threads.com/@tester/post/${id}`,
    text,
    bodyText: text,
    author: 'tester',
    handle: 'tester',
    avatar: null,
    createdAt: null,
    type: 'UNKNOWN',
    parentReference: null,
    media: [],
    likeCount: null,
    replyCount: null,
    repostCount: null,
    shareCount: null,
    provenance: { text: 'SYNTHETIC TEST DATA' },
    contextEvidence: evidence,
  };
}

describe('Conversation Extraction V2 normalization', () => {
  test('root resolver and card collector use exact subject identity, preserving full body', () => {
    expect(
      resolveExactRoot({
        targetUrl: root.url,
        sourcePostId: root.id,
        sourceUrl: root.url,
        authorHandle: root.author.handle,
        originalBody: root.originalText,
      }).id,
    ).toBe(root.id);
    expect(() =>
      resolveExactRoot({
        targetUrl: root.url,
        sourcePostId: 'OTHER',
        sourceUrl: root.url,
        authorHandle: root.author.handle,
        originalBody: root.originalText,
      }),
    ).toThrow('EXACT_ROOT');
    const replyUrl = 'https://www.threads.com/@reply/post/RICH';
    const rows: any = {
      rows: [
        {
          urls: [replyUrl, root.url],
          subjectUrl: replyUrl,
          authorHandle: 'reply',
          controls: [],
          date: '2026-11-15T00:00:00.000Z',
          text: 'Đoạn thứ nhất.\nĐoạn thứ hai vẫn thuộc nội dung tác giả.',
          rawText:
            'reply · 2 giờ\nĐoạn thứ nhất.\nĐoạn thứ hai vẫn thuộc nội dung tác giả.',
          media: [{ url: 'https://example.com/image.jpg', kind: 'IMAGE' }],
          pointer: '/dom/card/1',
        },
      ],
      jsonLd: [],
      diagnostics: {},
    };
    const cards = collectPublicCards(
      rows,
      {
        replies: [],
        regions: [
          {
            kind: 'DISCUSSION_REGION',
            documentUrl: root.url,
            targetUrl: root.url,
            subjectUrl: replyUrl,
            label: 'Bình luận',
            pointer: '/dom/card/1/region',
          },
        ],
      },
      root.url,
      root.provenance.observedAt,
    );
    expect(cards).toHaveLength(1);
    expect(cards[0].text).toContain('Đoạn thứ hai');
    expect(cards[0].media).toHaveLength(1);
    expect(cards[0].contextEvidence?.[0].kind).toBe('DISCUSSION_REGION');
  });

  test('separates verified, discussion, recommendation and missing-body observations', () => {
    const collection = syntheticCollection();
    const rootUrl = collection.root.url;
    collection.observedCards = [
      card(
        'OBS',
        'Tôi đã trải nghiệm công việc tương tự và có thêm một góc nhìn.',
        [
          {
            kind: 'DISCUSSION_REGION',
            documentUrl: rootUrl,
            targetUrl: rootUrl,
            subjectUrl: 'https://www.threads.com/@tester/post/OBS',
            label: 'Bình luận',
            pointer: '/dom/discussion/1',
          },
        ],
      ),
      card('RELATED', 'Một bài viết độc lập được giao diện đề xuất.', [
        {
          kind: 'RECOMMENDATION_REGION',
          documentUrl: rootUrl,
          targetUrl: rootUrl,
          subjectUrl: 'https://www.threads.com/@tester/post/RELATED',
          label: 'Bài viết đề xuất',
          pointer: '/dom/recommended/1',
        },
      ]),
    ];
    collection.unverified.push(
      {
        url: 'https://www.threads.com/@tester/post/OBS',
        reason: 'DOM_CONTEXT_WITHOUT_RELATIONSHIP_EVIDENCE',
      },
      {
        url: 'https://www.threads.com/@tester/post/RELATED',
        reason: 'DOM_CONTEXT_WITHOUT_RELATIONSHIP_EVIDENCE',
      },
      {
        url: 'https://www.threads.com/@tester/post/URL_ONLY',
        reason: 'MISSING_CARD_BODY',
      },
    );
    const normalized = normalizeConversation(collection);
    expect(normalized.counts).toMatchObject({
      verified: 1,
      observedConversation: 1,
      related: 1,
      incompleteObservations: 1,
      missingBody: 1,
      materialized: 3,
    });
    expect(normalized.groups.PARENT_VERIFIED[0].parentId).toBe('ROOT');
    expect(normalized.groups.RELATED_OR_RECOMMENDED[0].id).toBe('RELATED');
    expect(normalized.groups.INCOMPLETE[0].id).toBe('URL_ONLY');
    expect(normalized.automation.status).toMatch(
      /READY_FOR_QUALITY|EXCEPTION_REVIEW|NOT_ENOUGH_EVIDENCE/,
    );
  });

  test('replays saved gnrtth LIVE evidence when the local report is available', () => {
    const report = path.resolve(
      process.cwd(),
      '.studio-data/reports/data-quality02-live-smoke01/collection.json',
    );
    if (!existsSync(report)) return;
    const saved = JSON.parse(readFileSync(report, 'utf8')) as ThreadCollection;
    const before = JSON.stringify(saved.sourceCapture);
    const normalized = normalizeConversation(saved);
    expect(saved.root.id).toBe('DeI-TuzEc_9');
    expect(saved.unverifiedCandidateCount).toBe(26);
    expect(normalized.counts.materialized).toBe(10);
    expect(normalized.counts.incompleteObservations).toBe(16);
    expect(normalized.counts.missingBody).toBe(0);
    expect(normalized.counts.verified).toBe(0);
    expect(normalized.automation.candidateStatus).toBe('EXCEPTION_REVIEW');
    expect(normalized.automation.continueDiscovery).toBe(true);
    expect(normalized.rootDisplayText).not.toMatch(/^\d{2}\/\d{2}\/\d{4}\n/);
    expect(saved.root.originalText).toMatch(/^\d{2}\/\d{2}\/\d{4}\n/);
    expect(JSON.stringify(saved.sourceCapture)).toBe(before);
  });

  test('keeps acquisition-03 LIVE cards UNKNOWN when saved actions contain no conversation-surface evidence', () => {
    const report = path.resolve(
      process.cwd(),
      '.studio-data/reports/threads-acquisition03-live01/collection.json',
    );
    if (!existsSync(report)) return;
    const saved = JSON.parse(readFileSync(report, 'utf8')) as ThreadCollection;
    const before = JSON.stringify(saved);
    const normalized = normalizeConversation(saved);
    expect(saved.root.id).toBe('DeI-TuzEc_9');
    expect(normalized.counts).toMatchObject({
      subjectPermalinks: 29,
      materialized: 29,
      verified: 0,
      observedConversation: 0,
      related: 1,
      unknown: 28,
      incompleteObservations: 0,
    });
    expect(normalized.automation.selectedConversationIds).toEqual([]);
    expect(normalized.automation.candidateStatus).toBe('EXCEPTION_REVIEW');
    for (const author of ['_rachel_darryl', 'h_nah254'])
      expect(
        normalized.cards
          .filter((card) => card.author === author)
          .every((card) => card.membership === 'UNKNOWN'),
      ).toBe(true);
    expect(
      normalized.cards.find((card) => card.author === 'tuan27020'),
    ).toMatchObject({
      group: 'RELATED_OR_RECOMMENDED',
      membership: 'UNKNOWN',
    });
    expect(JSON.stringify(saved)).toBe(before);
  });

  test('replays saved pngkhatu collection without upgrading relationship evidence', () => {
    const report = path.resolve(
      process.cwd(),
      '.studio-data/reports/ai-agent01/live-acceptance02/data-engine/thread-collections/56c120bbe3189b7fee7eadc0de6b8452651e62f543add3a1c6c074f9d73bebe3.json',
    );
    if (!existsSync(report)) return;
    const saved = JSON.parse(readFileSync(report, 'utf8')) as {
      collection: ThreadCollection;
    };
    const before = JSON.stringify(saved.collection);
    const normalized = normalizeConversation(saved.collection);
    expect(saved.collection.root.id).toBe('DaNZphhgU_i');
    expect(normalized.counts.subjectPermalinks).toBe(13);
    expect(normalized.counts.materialized).toBe(12);
    expect(normalized.counts.incompleteObservations).toBe(1);
    expect(normalized.counts.verified).toBe(0);
    expect(JSON.stringify(saved.collection)).toBe(before);
  });

  test('records baongoc saved-capture limits instead of inventing a conversation graph', () => {
    const report = path.resolve(
      process.cwd(),
      '.studio-data/reports/data-quality01/replay-with-reviewed-image.json',
    );
    if (!existsSync(report)) return;
    const saved = JSON.parse(readFileSync(report, 'utf8')) as any;
    const candidate = saved.result?.ranked?.find((row: any) =>
      row.sourceUrl?.includes('/DfWJxiID7E5'),
    );
    expect(candidate).toMatchObject({
      observedReplies: 8,
      verifiedReplies: 0,
      status: 'READY_FOR_EDITORIAL_REVIEW',
    });
    expect(candidate.estimate.authoritative).toBe(false);
    expect(candidate.reasons).toContain(
      'AGENT_VISUAL_IMAGE_TEXT_REQUIRES_HUMAN_REVIEW',
    );
    // This artifact has the selection result, not the original DOM graph.
    expect(candidate.conversation?.root).toBeUndefined();
  });

  test('fallback skips explicit/recommended evidence and remains budget bounded', () => {
    const cards = [
      card('UNKNOWN1', 'Unknown one'),
      card('EXPLICIT', 'Explicit'),
      card('RELATED', 'Related'),
      card('UNKNOWN2', 'Unknown two'),
      card('UNKNOWN3', 'Unknown three'),
    ];
    const context: any = {
      replies: [{ subjectUrl: cards[1].url }],
      regions: [{ kind: 'RECOMMENDATION_REGION', subjectUrl: cards[2].url }],
    };
    expect(planPermalinkDetailValidation(root.url, cards, context, 2)).toEqual([
      cards[0].url,
      cards[3].url,
    ]);
    expect(() =>
      planPermalinkDetailValidation(root.url, cards, context, 3),
    ).toThrow('DETAIL_BUDGET');
  });

  test('auto-selects only verified quality content and reports the 65-second gate', () => {
    const longBody = Array.from(
      { length: 34 },
      (_, index) =>
        `Vì công việc văn phòng có nhiều áp lực nhưng trải nghiệm số ${index + 1} cho thấy cần nói rõ kỳ vọng và phối hợp với đồng nghiệp.`,
    ).join(' ');
    const collection = collectEvidence(root, {
      url: root.url,
      observedAt: root.provenance.observedAt,
      synthetic: true,
      visibleUrls: ['https://www.threads.com/@tester/post/LONG'],
      jsonLd: [
        {
          '@type': 'Comment',
          url: 'https://www.threads.com/@tester/post/LONG',
          parentItem: root.url,
          author: { url: 'https://www.threads.com/@tester' },
          text: longBody,
        },
      ],
    });
    const normalized = normalizeConversation(collection);
    expect(normalized.automation.selectedVerifiedReplyIds).toEqual(['LONG']);
    expect(normalized.automation.candidateStatus).toBe('READY_FOR_DRAFT');
    expect(normalized.automation.durationEstimate.source).toBe(
      'ESTIMATED_TEXT_ONLY',
    );
    expect(
      normalized.automation.durationEstimate.maximumSeconds,
    ).toBeGreaterThanOrEqual(65);
    expect(normalized.automation.continueDiscovery).toBe(false);
  });

  test('confirms membership from a bounded reply expansion without inventing parentId', () => {
    const rootRow = {
        subjectUrl: root.url,
        nodeIdentity: '/root-card',
        parentContainerPath: '/thread',
        conversationContainer: { pointer: '/thread' },
        observedActionId: 'initial',
        capturedAt: root.provenance.observedAt,
      },
      replyUrl = 'https://www.threads.com/@tester/post/MEMBER',
      replyRow = {
        ...rootRow,
        subjectUrl: replyUrl,
        nodeIdentity: '/root-card/replies/member',
        parentContainerPath: '/root-card/replies',
        observedActionId: 'action-1',
      },
      blank = { rows: [rootRow], jsonLd: [], diagnostics: {} },
      expanded = { rows: [rootRow, replyRow], jsonLd: [], diagnostics: {} },
      acquisition: any = {
        version: 'conversation-browser-acquisition/1',
        transitions: [],
        actions: [
          {
            id: 'action-1',
            kind: 'EXPAND_NESTED',
            label: 'View replies',
            containerIdentity: '/root-card',
            containerSubjectUrl: root.url,
            beforeSubjects: 1,
            afterSubjects: 2,
            changed: true,
            at: root.provenance.observedAt,
          },
        ],
        snapshots: [],
        stopReason: 'ACTION_BUDGET_REACHED',
      };
    const result = resolveConversationMembership({
      rootUrl: root.url,
      observed: expanded as any,
      context: { regions: [], replies: [] },
      snapshots: [
        {
          actionId: 'initial',
          at: root.provenance.observedAt,
          observed: blank,
          context: { regions: [], replies: [] },
        },
        {
          actionId: 'action-1',
          at: root.provenance.observedAt,
          observed: expanded,
          context: { regions: [], replies: [] },
        },
      ] as any,
      acquisition,
    });
    expect(result).toEqual([
      expect.objectContaining({
        subjectId: 'MEMBER',
        status: 'THREAD_UI_CONFIRMED',
        evidenceType: 'EXPANDED_FROM_CONFIRMED_CONVERSATION_CONTAINER',
        sourceActionId: 'action-1',
      }),
    ]);
  });

  test('auto-selects quality THREAD_UI_CONFIRMED content without asserting a parent', () => {
    const longBody = Array.from(
        { length: 34 },
        (_, index) =>
          `Vì trải nghiệm công việc số ${index + 1} có áp lực nhưng người lao động cần hiểu rõ trách nhiệm và cách phối hợp.`,
      ).join(' '),
      member = card('MEMBER_LONG', longBody),
      memberUrl = String(member.url),
      collection = collectEvidence(root, {
        url: root.url,
        observedAt: root.provenance.observedAt,
        synthetic: true,
        visibleUrls: [memberUrl],
        jsonLd: [],
        cardObservations: [
          {
            url: memberUrl,
            publishedAt: null,
            engagement: {
              likes: null,
              replies: null,
              reposts: null,
              shares: null,
            },
          },
        ],
      });
    collection.observedCards = [member];
    collection.membershipEvidence = [
      {
        rootId: root.id,
        subjectId: 'MEMBER_LONG',
        status: 'THREAD_UI_CONFIRMED',
        evidenceType: 'EXPLICIT_DISCUSSION_REGION',
        sourceActionId: null,
        containerReference: '/thread/replies',
        observedAt: root.provenance.observedAt,
      },
    ];
    const normalized = normalizeConversation(collection);
    expect(normalized.groups.OBSERVED_CONVERSATION[0]).toMatchObject({
      id: 'MEMBER_LONG',
      parentId: null,
      membership: 'THREAD_UI_CONFIRMED',
    });
    expect(normalized.automation.selectedThreadUiIds).toEqual(['MEMBER_LONG']);
    expect(normalized.automation.selectedVerifiedReplyIds).toEqual([]);
    expect(normalized.automation.candidateStatus).toBe('READY_FOR_DRAFT');
    expect(
      normalized.automation.durationEstimate.maximumSeconds,
    ).toBeGreaterThanOrEqual(65);
  });

  test('materializes an automatic membership selection as DRAFT input without changing review approval', async () => {
    const memberUrl = 'https://www.threads.com/@tester/post/AUTO_MEMBER',
      member = card(
        'AUTO_MEMBER',
        Array.from(
          { length: 34 },
          (_, index) =>
            `Vì trải nghiệm công việc số ${index + 1} có áp lực nhưng người lao động cần hiểu rõ trách nhiệm và cách phối hợp.`,
        ).join(' '),
      ),
      collection = collectEvidence(root, {
        url: root.url,
        observedAt: root.provenance.observedAt,
        synthetic: true,
        visibleUrls: [memberUrl],
        jsonLd: [],
      });
    collection.observedCards = [member];
    collection.membershipEvidence = [
      {
        rootId: root.id,
        subjectId: 'AUTO_MEMBER',
        status: 'THREAD_UI_CONFIRMED',
        evidenceType: 'EXPANDED_FROM_CONFIRMED_CONVERSATION_CONTAINER',
        sourceActionId: 'action-1',
        containerReference: '/root/replies',
        observedAt: root.provenance.observedAt,
      },
    ];
    const review = {
        revision: 3,
        selectedReplyIds: [],
        selectedObservedUrls: [],
        decision: 'NEEDS_REVIEW',
      },
      createConversationDraft = jest.fn(
        async (_collection: ThreadCollection, selection: any) => ({
          id: 'draft-id',
          selection,
        }),
      ),
      service = Object.create(
        ConversationStudioService.prototype,
      ) as ConversationStudioService;
    Object.assign(service, {
      engine: {
        collection: async () => ({ collection }),
        review: async () => review,
      },
      data: { studio: { createConversationDraft } },
    });
    await expect(
      service.draft('collection-id', { confirmDraft: true, revision: 3 }),
    ).resolves.toMatchObject({ id: 'draft-id' });
    expect(createConversationDraft).toHaveBeenCalledWith(
      collection,
      expect.objectContaining({
        decision: 'NEEDS_REVIEW',
        selectedReplyIds: [],
        selectedObservedUrls: [memberUrl],
      }),
    );
    expect(review).toEqual({
      revision: 3,
      selectedReplyIds: [],
      selectedObservedUrls: [],
      decision: 'NEEDS_REVIEW',
    });
  });
});
