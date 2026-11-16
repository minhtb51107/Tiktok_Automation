import { autonomousDiscoveryErrors, autonomousProductRequest, ProductPipelineService, productStageSnapshot } from './product-pipeline';
import { describe, expect, it, jest } from '@jest/globals';
import { mkdtemp, writeFile, rm } from 'fs/promises';
import * as os from 'os';
import * as path from 'path';

const session = (overrides: any = {}) => ({
  id: '00000000-0000-4000-8000-000000000001',
  title: 'Product flow',
  revision: 1,
  updatedAt: '2026-11-14T00:00:00.000Z',
  status: 'READY',
  errors: [],
  project: {
    contractVersion: '1.0',
    id: '00000000-0000-4000-8000-000000000001',
    style: 'SERIOUS',
    title: 'Product flow',
    sources: [],
    posts: [],
    comments: [],
    candidates: [],
    storyboard: [],
    audioAssets: [],
    mediaAssets: [],
    publishing: {
      title: '',
      caption: '',
      hashtags: [],
      language: 'vi',
      manualApprovalRequired: true,
    },
  },
  items: [],
  ...overrides,
});

describe('product pipeline snapshot', () => {
  it('bounds an autonomous SERIOUS DRAFT batch without widening production authority', () => {
    expect(autonomousProductRequest({ topic: 'công việc', targetVideos: 3 })).toMatchObject({
      style: 'SERIOUS', targetVideos: 3, maxCandidates: 30, maxEnrich: 10,
      voice: 'my_yen', speed: 1.3,
    });
    expect(() => autonomousProductRequest({ topic: 'công việc', targetVideos: 4 })).toThrow('Invalid autonomous DRAFT request');
    expect(() => autonomousProductRequest({ topic: 'công việc', style: 'FUNNY' })).toThrow('Invalid autonomous DRAFT request');
  });

  it('preserves failed live discovery evidence instead of reporting an empty failure', () => {
    expect(autonomousDiscoveryErrors({
      status: 'PARTIAL', collections: [], errors: ['CONVERSATION_NAVIGATION_FAILED'],
      diagnosis: { stage: 'DISCOVERY', outcome: 'UNKNOWN' },
    })).toEqual(['CONVERSATION_NAVIGATION_FAILED', 'DISCOVERY_UNKNOWN_AT_DISCOVERY']);
  });
  it('never calls an observed context verified and waits for explicit review', () => {
    const value = productStageSnapshot(
      session({
        items: [
          {
            id: 'root',
            inclusion: 'TARGET',
            selected: true,
            spokenText: 'Root',
            order: 0,
          },
          {
            id: 'context',
            inclusion: 'EXPLICIT_CONTEXT',
            selected: false,
            spokenText: 'Observed',
            order: 1,
            observationEvidence: { level: 'OBSERVED_ON_TARGET_PAGE' },
          },
        ],
      }) as any,
      'SUCCEEDED',
      [],
    );
    expect(value.stages.SOURCE.status).toBe('COMPLETED');
    expect(value.stages.HUMAN_REVIEW.status).toBe('WAITING_USER');
    expect(value.stages.HUMAN_REVIEW.evidence).toContain('1/2 selected');
    expect(value.warnings.join(' ')).toContain('unverified');
  });

  it('uses measured current audio, saved timeline and real render evidence', () => {
    const text = 'Nội dung đã duyệt để dựng bản nháp';
    const crypto = require('crypto');
    const value = productStageSnapshot(
      session({
        items: [
          {
            id: 'root',
            inclusion: 'TARGET',
            selected: true,
            spokenText: text,
            order: 0,
          },
        ],
        voiceAssets: [
          {
            id: 'audio',
            itemId: 'root',
            status: 'GENERATED',
            textHash: crypto.createHash('sha256').update(text).digest('hex'),
            durationMs: 65000,
          },
        ],
        project: {
          ...session().project,
          timeline: { totalFrames: 2100, fps: 30, scenes: [{ scene: { id: 'root' } }] },
        },
      }) as any,
      'SUCCEEDED',
      [
        {
          jobId: 'render-1',
          status: 'COMPLETED',
          completedAt: '2026-11-14T01:00:00.000Z',
          expectedDurationSeconds: 70,
          width: 720,
          height: 1280,
        } as any,
      ],
    );
    expect(value.stages.VOICE.status).toBe('COMPLETED');
    expect(value.stages.EDITOR.status).toBe('COMPLETED');
    expect(value.stages.MP4.status).toBe('COMPLETED');
    expect(value.nextStage).toBe('AI_QUALITY');
    expect(value.latestRenderJobId).toBe('render-1');
  });

  it('materializes a reviewed AI proposal into the same project without upgrading observed evidence', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'product-materialize-'));
    try {
      const rootUrl = 'https://www.threads.com/@root/post/ROOT';
      const observedUrl = 'https://www.threads.com/@observer/post/OBS';
      const collection: any = {
        version: 'threads-conversation/1',
        root: {
          id: 'ROOT', url: rootUrl, author: { handle: 'root', name: null },
          originalText: 'Câu hỏi gốc', publishedAt: null,
          engagement: { likes: null, replies: null, reposts: null, shares: null },
          provenance: { documentUrl: rootUrl, observedAt: '2026-11-14T00:00:00Z', method: 'TEST', synthetic: true },
        },
        replies: [],
        unverified: [{
          url: observedUrl,
          reason: 'parent unavailable',
          observation: { level: 'OBSERVED_ON_TARGET_PAGE', targetUrl: rootUrl, observedAt: '2026-11-14T00:00:00Z', author: { handle: 'observer', name: null }, originalText: 'Góc nhìn quan sát được' },
        }],
        reportedReplyCount: null, observedReplyCount: 1, verifiedReplyCount: 0,
        unverifiedCandidateCount: 1, startedAt: '2026-11-14T00:00:00Z',
        completedAt: '2026-11-14T00:00:01Z', status: 'PARTIAL', warnings: [],
      };
      let activeSession: any = session({
        id: '00000000-0000-4000-8000-000000000002',
        items: [{ id: 'ROOT', inclusion: 'TARGET', selected: true, spokenText: 'Câu hỏi gốc', order: 0 }],
      });
      const plan: any = {
        id: 'a'.repeat(64), revision: 0, collectionId: 'collection', selectionRevision: 1,
        selectedReplyIds: [], selectedObservedUrls: [observedUrl],
        bundle: { collection, quality: {}, sourceLink: null },
        sections: [
          { id: 'hook', stage: 'HOOK', kind: 'COMMENTARY', sourceId: null, originalText: '', displayText: '', narrationText: '', sourceEvidence: 'AI_COMMENTARY' },
          { id: 'root', stage: 'CONTEXT', kind: 'QUOTE', sourceId: 'ROOT', originalText: 'Câu hỏi gốc', displayText: 'Câu hỏi gốc', narrationText: 'Câu hỏi gốc', sourceEvidence: 'ROOT_VERIFIED' },
          { id: 'observed-OBS', stage: 'DISCUSSION', kind: 'QUOTE', sourceId: 'OBS', originalText: 'Góc nhìn quan sát được', displayText: 'Góc nhìn quan sát được', narrationText: 'Góc nhìn quan sát được', sourceEvidence: 'OBSERVED_RELATIONSHIP_UNVERIFIED' },
          { id: 'commentary', stage: 'COMMENTARY', kind: 'COMMENTARY', sourceId: null, originalText: '', displayText: '', narrationText: '', sourceEvidence: 'AI_COMMENTARY' },
          { id: 'resolution', stage: 'RESOLUTION', kind: 'COMMENTARY', sourceId: null, originalText: '', displayText: '', narrationText: '', sourceEvidence: 'AI_COMMENTARY' },
        ],
      };
      const savedPlans: any[] = [];
      const studio: any = {
        load: jest.fn(async () => activeSession),
        renders: { list: jest.fn(async () => []) },
        jobs: { load: jest.fn() },
        applyEditorialDraft: jest.fn(async (_id: any, _revision: any, saved: any) => {
          activeSession = { ...activeSession, revision: 2, project: { ...activeSession.project, editorialPlan: saved }, items: saved.sections.filter((row: any) => row.narrationText).map((row: any, index: number) => ({ id: row.id, selected: true, spokenText: row.narrationText, order: index })) };
          return activeSession;
        }),
      };
      const conversations: any = { engine: {
        review: jest.fn(async () => ({ revision: 1, decision: 'ACCEPT', selectedReplyIds: [], selectedObservedUrls: [observedUrl] })),
        collection: jest.fn(async () => ({ collection })),
      } };
      const ai: any = {
        evaluator: { list: jest.fn(async () => [{ id: 'assessment', collectionId: 'collection', createdAt: '2026-11-14T00:00:00Z' }]) },
        agent: {
          proposal: jest.fn(async () => ({ id: 'b'.repeat(64), assessmentId: 'assessment' })),
          review: jest.fn(async () => ({ revision: 1, hook: 'Hook đã duyệt', sections: [
            { kind: 'QUOTE', sourceIds: ['ROOT'], text: 'Câu hỏi gốc', purpose: 'CONTEXT' },
            { kind: 'PARAPHRASE', sourceIds: ['OBS'], text: 'Góc nhìn đã biên tập', purpose: 'DISCUSSION' },
            { kind: 'COMMENTARY', sourceIds: [], text: 'Phân tích biên tập', purpose: 'ANALYSIS' },
            { kind: 'COMMENTARY', sourceIds: [], text: 'Kết luận biên tập', purpose: 'CONCLUSION' },
          ] })),
        },
      };
      const editorial: any = { engine: { list: jest.fn(async () => []) }, create: jest.fn(async () => plan), save: jest.fn(async (_id: any, body: any) => {
        const saved = { ...plan, revision: 1, sections: body.sections };
        savedPlans.push(saved);
        return saved;
      }) };
      const service = new ProductPipelineService(studio, conversations, ai, editorial);
      (service as any).root = dir;
      const id = '11111111-1111-4111-8111-111111111111';
      await writeFile(path.join(dir, id + '.json'), JSON.stringify({
        schemaVersion: 'product-pipeline/1', id, requestKey: 'key', sourceUrl: rootUrl,
        sessionId: activeSession.id, createdAt: '2026-11-14T00:00:00Z', updatedAt: '2026-11-14T00:00:00Z',
        sourceJobId: null, collectionId: 'collection', assessmentId: 'assessment', appliedReviewRevision: 1,
        editorialPlanId: null, scriptProposalId: null, scriptReviewRevision: null,
        stages: {}, nextStage: 'SCRIPT', latestRenderJobId: null, warnings: [],
      }));
      const result = await service.materializeScript(id, { proposalId: 'b'.repeat(64), reviewRevision: 1, sessionRevision: 1 });
      expect(savedPlans[0].sections.find((row: any) => row.id === 'observed-OBS')).toMatchObject({ kind: 'PARAPHRASE', narrationText: 'Góc nhìn đã biên tập', sourceEvidence: 'OBSERVED_RELATIONSHIP_UNVERIFIED' });
      expect(savedPlans[0].sections.find((row: any) => row.id === 'resolution').narrationText).toBe('Kết luận biên tập');
      expect(studio.applyEditorialDraft).toHaveBeenCalledTimes(1);
      expect(result.job.scriptProposalId).toBe('b'.repeat(64));
      expect(result.session.id).toBe(activeSession.id);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
