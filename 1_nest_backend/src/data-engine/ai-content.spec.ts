import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from '@jest/globals';
import { mkdtemp, rm } from 'fs/promises';
import { tmpdir } from 'os';
import * as path from 'path';
import { DataStore } from './store';
import { DataEngine } from './engine';
import {
  ConversationEngine,
  type ConversationProvider,
} from './conversation-engine';
import { collectEvidence } from './conversation-evidence';
import type { PublicPost } from './conversation-contracts';
import { AiContentEvaluator, AiResearchAgent } from './ai-content';
import type { AiCompletion, AiProviderConfig } from './ai-contracts';
import type { AiJsonRequest, ContentAiProvider } from './ai-provider';

const root: PublicPost = {
  id: 'ROOT_AI_TEST',
  url: 'https://www.threads.com/@tester/post/ROOT_AI_TEST',
  author: { handle: 'tester', name: 'SYNTHETIC TEST DATA' },
  originalText: 'Câu chuyện công việc này cần một góc nhìn có dẫn chứng.',
  publishedAt: '2026-11-01T00:00:00Z',
  engagement: { likes: 10, replies: 2, reposts: null, shares: null },
  provenance: {
    documentUrl: 'https://www.threads.com/@tester/post/ROOT_AI_TEST',
    observedAt: '2026-11-02T00:00:00Z',
    method: 'SYNTHETIC TEST DATA',
    synthetic: true,
  },
};

class FakeProvider implements ContentAiProvider {
  readonly name = 'HUGGING_FACE' as const;
  calls: AiJsonRequest[] = [];
  invalidSource = false;
  config(): AiProviderConfig {
    return {
      model: 'test/model',
      provider: 'auto',
      timeoutMs: 5_000,
      maxTokens: 1_000,
      requestBudget: 8,
      tokenBudget: 4_000,
      costBudgetUsd: 0.5,
      credential: 'present',
      reasoningMode: 'DISABLED',
    };
  }
  async completeJson(request: AiJsonRequest): Promise<AiCompletion> {
    this.calls.push(request);
    const input = request.input as any;
    const isPlan = Array.isArray(input.collections),
      isScript = Array.isArray(input.sources),
      isCandidateBatch = Array.isArray(input.candidates),
      isSummary = Array.isArray(input.candidateAssessments);
    const content = isPlan
      ? JSON.stringify({
          selectedCollectionId: input.collections[0].collectionId,
          rationale: ['Nguồn kiểm thử có nội dung rõ ràng'],
          steps: [
            'search_threads',
            'get_post_details',
            'get_conversation',
            'evaluate_candidates',
            'propose_script',
          ],
        })
      : isScript
        ? JSON.stringify({
            hook: 'Một câu chuyện công việc đáng bàn',
            sections: [
              {
                kind: 'QUOTE',
                sourceIds: [input.sources[0].sourceId],
                text: 'Nguồn kiểm thử.',
                purpose: 'context',
              },
              {
                kind: 'COMMENTARY',
                sourceIds: [],
                text: 'Phần bình luận nguyên tác cần người dùng duyệt.',
                purpose: 'analysis',
              },
            ],
            warnings: ['SYNTHETIC TEST DATA'],
          })
        : isCandidateBatch
          ? JSON.stringify({
              candidates: input.candidates.map((row: any) => ({
                sourceId: this.invalidSource ? 'INVENTED_SOURCE' : row.sourceId,
                disposition: 'SELECT',
                contentRole: 'COUNTERPOINT',
                contextRelation: 'SAME_CONTEXT',
                relevance: 90,
                usefulness: 85,
                quality: {
                  informationValue: 88,
                  novelty: 80,
                  argumentation: 90,
                  experienceValue: 70,
                  audienceAppeal: 82,
                  videoUsefulness: 86,
                },
                strengths: ['Có phản biện và thông tin mới'],
                risks: [],
                reasons: ['Có lập luận'],
                missingEvidence: [],
              })),
            })
          : isSummary
            ? JSON.stringify({
                topic: 'Công việc',
                contentFocus: 'Góc nhìn có dẫn chứng',
                missingInformation: [],
                feasibility: {
                  status: 'READY_FOR_SCRIPT',
                  estimatedMinimumSeconds: 65,
                  estimatedMaximumSeconds: 80,
                  reasons: ['Đủ cấu trúc'],
                },
                editorialRecommendation: {
                  hook: 'Vì sao?',
                  structure: ['Bối cảnh', 'Phản biện'],
                  warnings: [],
                },
              })
            : JSON.stringify({ error: 'unexpected-input' });
    return {
      provider: 'HUGGING_FACE',
      model: 'test/model',
      providerRoute: 'mock-test',
      content,
      usage: {
        inputTokens: 100,
        outputTokens: 50,
        totalTokens: 150,
        estimatedCostUsd: null,
        costSource: 'UNAVAILABLE',
      },
      latencyMs: 5,
      requestId: 'synthetic-request',
      finishReason: 'stop',
    };
  }
}

describe('AI-AGENT-01 content intelligence — isolated synthetic', () => {
  let dir: string;
  let data: DataEngine;
  let conversations: ConversationEngine;
  let provider: FakeProvider;
  let collectionId: string;
  beforeEach(async () => {
    dir = await mkdtemp(path.join(tmpdir(), 'ai-agent01-'));
    data = new DataEngine(new DataStore(dir));
    const source: ConversationProvider = {
      execution: 'SYNTHETIC',
      discover: jest.fn(async () => [
        { url: root.url, observedOrder: 0, post: root },
      ]),
      enrich: jest.fn(async () =>
        collectEvidence(root, {
          url: root.url,
          observedAt: root.provenance.observedAt,
          synthetic: true,
          visibleUrls: ['https://www.threads.com/@reply/post/REPLY_AI_TEST'],
          jsonLd: [
            {
              '@type': 'Comment',
              url: 'https://www.threads.com/@reply/post/REPLY_AI_TEST',
              parentItem: root.url,
              author: { url: 'https://www.threads.com/@reply' },
              text: 'Một phản biện ngắn nhưng có lý do rõ ràng.',
            },
          ],
        }),
      ),
    };
    conversations = new ConversationEngine(data, source);
    collectionId = (
      await conversations.start({ requestId: 'ai-test', urls: [root.url] })
    ).results[0].collectionId;
    provider = new FakeProvider();
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  test('validates source identity, preserves heuristic state and never approves', async () => {
    const record = await conversations.collection(collectionId);
    const assessment = await new AiContentEvaluator(data, provider).evaluate({
      collectionId,
      collection: record.collection,
      style: 'SERIOUS',
      heuristic: record.evaluation,
    });
    expect(assessment.status).toBe('WAITING_REVIEW');
    expect(assessment.approval).toBe('PENDING');
    expect(assessment.ruleSnapshot).toBeDefined();
    expect(assessment.selectedSourceIds).toEqual(['REPLY_AI_TEST']);
    expect(assessment.candidates[0].relationshipEvidence).toBe(
      'PARENT_VERIFIED',
    );
    expect(assessment.candidates[0].editorialStatus).toBe('SELECT_VERIFIED');
    expect((await data.catalog()).rows[0].review ?? null).toBeNull();
  });

  test('rejects invented source IDs and persists no assessment', async () => {
    provider.invalidSource = true;
    const record = await conversations.collection(collectionId);
    await expect(
      new AiContentEvaluator(data, provider).evaluate({
        collectionId,
        collection: record.collection,
        style: 'SERIOUS',
        heuristic: record.evaluation,
      }),
    ).rejects.toThrow('AI_SCHEMA_SOURCE_ID');
    expect(await new AiContentEvaluator(data, provider).list()).toEqual([]);
  });

  test('cache prevents duplicate provider spend for identical input', async () => {
    const record = await conversations.collection(collectionId);
    const evaluator = new AiContentEvaluator(data, provider);
    const input = {
      collectionId,
      collection: record.collection,
      style: 'SERIOUS' as const,
      heuristic: record.evaluation,
    };
    expect((await evaluator.evaluate(input)).id).toBe(
      (await evaluator.evaluate(input)).id,
    );
    expect(provider.calls).toHaveLength(1);
  });

  test('observed target-page context may be recommended but remains human-review-required', async () => {
    const record = await conversations.collection(collectionId),
      reply = record.collection.replies[0];
    record.collection.replies = [];
    record.collection.verifiedReplyCount = 0;
    record.collection.unverified = [
      {
        url: reply.url,
        reason: 'NO_PARENT_EVIDENCE',
        observation: {
          level: 'OBSERVED_ON_TARGET_PAGE',
          targetUrl: record.collection.root.url,
          observedAt: root.provenance.observedAt,
          author: reply.author,
          originalText: reply.originalText,
        },
      },
    ];
    const assessment = await new AiContentEvaluator(data, provider).evaluate({
      collectionId,
      collection: record.collection,
      style: 'SERIOUS',
      heuristic: record.evaluation,
    });
    expect(assessment.selectedSourceIds).toEqual(['REPLY_AI_TEST']);
    expect(assessment.candidates[0]).toMatchObject({
      relationshipEvidence: 'OBSERVED_RELATIONSHIP_UNVERIFIED',
      editorialStatus: 'SELECT_REQUIRES_HUMAN_REVIEW',
      requiresHumanReview: true,
    });
  });

  test('model planner invokes bounded tools and returns only a DRAFT', async () => {
    const evaluator = new AiContentEvaluator(data, provider);
    const agent = new AiResearchAgent(data, conversations, evaluator, provider);
    const body = {
      requestId: 'agent-once',
      instruction: 'Đánh giá và đề xuất bản nháp.',
      style: 'SERIOUS',
      targetDurationSeconds: 75,
      collectionIds: [collectionId],
    };
    const run = await agent.run(body);
    expect(run.error).toBeNull();
    expect(run.status).toBe('WAITING_REVIEW');
    expect(run.mode).toBe('MODEL_PLANNER_VALIDATED_TOOLS_V1');
    expect(run.plan?.selectedCollectionId).toBe(collectionId);
    expect(run.toolCalls.map((x) => x.tool)).toEqual([
      'search_threads',
      'get_post_details',
      'get_conversation',
      'evaluate_candidates',
      'propose_script',
    ]);
    expect(run.proposal?.status).toBe('DRAFT_REQUIRES_HUMAN_REVIEW');
    expect(run.proposal?.selectionRevision).toBeNull();
    expect(run.productionApproved).toBe(false);
    const feedback = await evaluator.saveFeedback(run.assessmentIds[0], {
      requestId: 'feedback-1',
      expectedRevision: 0,
      decision: 'NEEDS_REVIEW',
      selectedSourceIds: ['REPLY_AI_TEST'],
      reason: 'Cần người dùng xác minh quan hệ nguồn.',
    });
    expect(feedback.revision).toBe(1);
    expect(feedback.productionApproved).toBe(false);
    expect((await evaluator.feedback(run.assessmentIds[0]))?.reason).toContain(
      'xác minh',
    );
    const review = await agent.saveReview(run.proposal!.id, {
      requestId: 'script-review-1',
      expectedRevision: 0,
      hook: 'Hook do người dùng chỉnh sửa',
      sections: run.proposal!.sections,
      feedback: 'Giữ ở trạng thái DRAFT.',
    });
    expect(review.revision).toBe(1);
    expect(review.productionApproved).toBe(false);
    expect((await agent.review(run.proposal!.id))?.hook).toContain(
      'người dùng',
    );
    const accepted = await evaluator.saveFeedback(run.assessmentIds[0], {
      requestId: 'feedback-2',
      expectedRevision: 1,
      decision: 'ACCEPT',
      selectedSourceIds: ['REPLY_AI_TEST'],
      reason: 'Chấp nhận selection cho Script DRAFT, không phải production.',
    });
    const reviewed = await agent.proposeReviewed(run.assessmentIds[0], {
      requestId: 'reviewed-proposal-1',
      expectedFeedbackRevision: accepted.revision,
      targetDurationSeconds: 75,
      instruction: 'Tạo Script DRAFT từ selection đã duyệt.',
    });
    expect(reviewed.selectionRevision).toBe(2);
    expect(reviewed.status).toBe('DRAFT_REQUIRES_HUMAN_REVIEW');
    expect(
      (await agent.latestProposalForAssessment(run.assessmentIds[0]))?.id,
    ).toBe(reviewed.id);
    await expect(
      agent.latestProposalForAssessment('0'.repeat(64)),
    ).rejects.toThrow('AI_ASSESSMENT_NOT_FOUND');
    expect((await agent.run(body)).id).toBe(run.id);
    expect(provider.calls).toHaveLength(4);
  });
});
