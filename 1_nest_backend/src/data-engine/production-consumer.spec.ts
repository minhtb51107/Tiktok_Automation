import { describe, it, expect, jest, afterEach } from '@jest/globals';
import { promises as fs } from 'fs';
import * as path from 'path';
import * as os from 'os';
import { Test } from '@nestjs/testing';
import request = require('supertest');
import { DataEngine } from './engine';
import { DataStore } from './store';
import { ProductionConsumer } from './production-consumer';
import { StudioService } from '../studio/studio.service';
import { StudioController } from '../studio/studio.controller';
import { DataController, DataStudioService } from './data.controller';
import { hash } from './rules';
import type { SourceInput } from './contracts';
import { buildStudioPreview } from '../video-pipeline/studio-preview';
import { productionSession } from './production-adapter';
import { renderValidation } from '../studio/render-policy';
const roots: string[] = [];
const text =
  'SYNTHETIC TEST DATA. Mình chia sẻ kinh nghiệm công việc trong công ty. Những người mới đi làm có gặp khó khăn khi trao đổi với đồng nghiệp không? Đây là một câu chuyện về cách học hỏi và tìm được công việc phù hợp với bản thân.';
async function fixture(type: SourceInput['itemType'] = 'POST') {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'data03-test-'));
  roots.push(root);
  const data = new DataEngine(new DataStore(path.join(root, 'data')));
  const studio = new StudioService({} as any);
  (studio as any).root = path.join(root, 'sessions');
  const input: SourceInput = {
    sourcePlatform: 'THREADS',
    sourcePostId: 'TESTDATA03',
    sourceUrl: 'https://www.threads.com/@synthetic_test/post/TESTDATA03',
    author: {
      name: 'SYNTHETIC TEST DATA',
      handle: 'synthetic_test',
      avatarUrl: null,
    },
    originalBody: text,
    topic: null,
    itemType: type,
    parentReference: null,
    publishedAt: '2026-11-01T00:00:00Z',
    fetchedAt: '2026-11-02T00:00:00Z',
    engagement: { likes: 0, replies: null, reposts: null, shares: null },
    fetch: { source: 'SYNTHETIC_TEST_FIXTURE', query: null },
    rawPayload: { text, synthetic: true },
    provenance: { synthetic: true, discoveryReviewRequired: true },
  };
  const r = await data.import([input], '2026-11-03T00:00:00Z');
  const postId = r.results[0].postId;
  const consumer = new ProductionConsumer(data, studio);
  const queued = async () => {
    let d = await data.detail(postId);
    d = await data.review(
      postId,
      d.evaluation!.revision,
      'ACCEPT',
      'SYNTHETIC TEST APPROVAL ONLY',
      'POST',
    );
    await data.enqueue(postId, d.evaluation!.revision);
    d = await data.detail(postId);
    return {
      postId,
      evaluationId: d.evaluation!.id,
      queueId: d.evaluation!.queue!.id,
      revision: d.evaluation!.revision,
      requestId: 'synthetic-creation',
    };
  };
  return { root, data, studio, consumer, postId, input, queued };
}
afterEach(async () => {
  jest.restoreAllMocks();
  for (const p of roots.splice(0)) {
    if (
      !path.resolve(p).startsWith(path.resolve(os.tmpdir()) + path.sep) ||
      !path.basename(p).startsWith('data03-test-')
    )
      throw Error('Unsafe test cleanup');
    await fs.rm(p, { recursive: true, force: true });
  }
});
describe('DATA-03 production — isolated real persistence, SYNTHETIC TEST DATA only', () => {
  it('does not enqueue heuristic qualification without a human ACCEPT', async () => {
    const f = await fixture(),
      d = await f.data.detail(f.postId);
    d.evaluation!.state = 'QUALIFIED';
    d.evaluation!.gold!.eligibility = 'ELIGIBLE';
    await f.data.store.write(
      'evaluations/' + d.evaluation!.id + '.json',
      d.evaluation,
    );
    await expect(
      f.data.enqueue(f.postId, d.evaluation!.revision),
    ).rejects.toThrow('ACCEPT');
  });
  it('detects a colliding session and a corrupted saved job without overwriting either source', async () => {
    const f = await fixture(),
      input = await f.queued();
    jest
      .spyOn(f.studio, 'ensureProductionSession')
      .mockRejectedValueOnce(Error('SYNTHETIC before write'));
    const job = await f.consumer.start(input),
      seed = productionSession(job);
    seed.productionOrigin!.jobId = 'f'.repeat(64);
    seed.project.productionOrigin = seed.productionOrigin;
    await f.studio.ensureProductionSession(seed);
    const before = await f.studio.load(seed.id);
    expect((await f.consumer.resume(job.id)).error).toBe(
      'PRODUCTION_SESSION_COLLISION',
    );
    expect(await f.studio.load(seed.id)).toEqual(before);
    const saved = await f.consumer.get(job.id);
    saved.snapshot.bronze.originalBody = 'SYNTHETIC tampered checkpoint';
    await f.data.store.write('production-jobs/' + saved.id + '.json', saved);
    expect((await f.consumer.resume(saved.id)).error).toBe(
      'PRODUCTION_CHECKPOINT_INTEGRITY',
    );
  });
  it('requires ACCEPT, confirmed type and queued eligibility before creating anything', async () => {
    const f = await fixture('UNKNOWN'),
      d = await f.data.detail(f.postId);
    await expect(
      f.data.review(f.postId, d.evaluation!.revision, 'ACCEPT', 'TEST REVIEW'),
    ).rejects.toThrow('Confirm target');
    await expect(
      f.consumer.start({
        postId: f.postId,
        evaluationId: d.evaluation!.id,
        queueId: 'a'.repeat(64),
        revision: d.evaluation!.revision,
        requestId: 'unreviewed',
      }),
    ).rejects.toThrow('NOT_QUEUED');
    expect(await f.consumer.list()).toHaveLength(0);
    expect(await f.studio.list()).toHaveLength(0);
    const input = await f.queued();
    const job = await f.consumer.start(input);
    expect(job.status).toBe('SUCCEEDED');
    const session = await f.studio.load(job.projectId);
    expect(session.items[0].rawExtraction!.type).toBe('UNKNOWN');
    expect(session.items[0].sourceReference.entityType).toBe('POST');
  });
  it('rejects stale revision and legacy queued snapshots with no ACCEPT review', async () => {
    const f = await fixture(),
      input = await f.queued();
    await expect(
      f.consumer.start({ ...input, revision: input.revision - 1 }),
    ).rejects.toThrow('STALE_REVISION');
    const d = await f.data.detail(f.postId);
    d.evaluation!.review = null;
    await f.data.store.write(
      'evaluations/' + d.evaluation!.id + '.json',
      d.evaluation,
    );
    await expect(f.consumer.start(input)).rejects.toThrow('REQUIRES_ACCEPT');
    expect(await f.studio.list()).toHaveLength(0);
  });
  it('materializes one editable project, immutable source and unapproved script/voice gates', async () => {
    const f = await fixture(),
      input = await f.queued(),
      d = await f.data.detail(f.postId),
      bronzeHash = hash(d.bronze);
    const j = await f.consumer.start(input),
      s = await f.studio.load(j.projectId);
    expect(j.status).toBe('SUCCEEDED');
    expect((await f.consumer.ready()).total).toBe(0);
    expect(s.project.style).toBe('SERIOUS');
    expect(s.items[0].originalText).toBe(text);
    expect(s.items[0].metadata!.likeCount).toBe(0);
    expect(s.items[0].metadata!.replyCount).toBeNull();
    expect(s.items[0].spokenApproval).toBeUndefined();
    expect(s.voiceAssets || []).toHaveLength(0);
    expect(s.productionOrigin).toMatchObject({
      bronzeId: d.bronze!.id,
      evaluationId: input.evaluationId,
      evaluationRevision: input.revision,
      queueId: input.queueId,
    });
    const preview = buildStudioPreview(s);
    expect(preview.preview.request.compositionId).toBe(
      'SeriousTimelinePreview',
    );
    expect(preview.preview.missingAudioItemIds).toEqual([s.items[0].id]);
    expect(
      renderValidation(
        s,
        preview.preview.request.inputProps,
      ).finalBlockers.some((x) => x.includes('DATA03_DRAFT_ONLY_PROJECT')),
    ).toBe(true);
    expect(await f.consumer.readiness(j.id)).toMatchObject({
      items: [{ script: 'DRAFT', voice: 'MISSING' }],
      publishingAllowed: false,
    });
    expect(hash((await f.data.detail(f.postId)).bronze)).toBe(bronzeHash);
  });
  it('double-click, distinct request keys and restart reuse exactly one session', async () => {
    const f = await fixture(),
      input = await f.queued();
    const [a, b] = await Promise.all([
      f.consumer.start(input),
      f.consumer.start(input),
    ]);
    expect(a.id).toBe(b.id);
    const restart = new ProductionConsumer(
      new DataEngine(new DataStore(f.data.store.root)),
      f.studio,
    );
    expect(
      (await restart.start({ ...input, requestId: 'second-key' })).projectId,
    ).toBe(a.projectId);
    expect(await f.studio.list()).toHaveLength(1);
    expect(await restart.list()).toHaveLength(1);
    await expect(
      restart.start({ ...input, queueId: 'b'.repeat(64) }),
    ).rejects.toThrow('IDEMPOTENCY_CONFLICT');
  });
  it('recovers after session write and preserves edits/locks made before retry', async () => {
    const f = await fixture(),
      input = await f.queued(),
      ensure = f.studio.ensureProductionSession.bind(f.studio);
    let fail = true;
    jest
      .spyOn(f.studio, 'ensureProductionSession')
      .mockImplementation(async (s) => {
        const result = await ensure(s);
        if (fail) {
          fail = false;
          throw Error('SYNTHETIC crash after session write');
        }
        return result;
      });
    const a = await f.consumer.start(input);
    expect(a.status).toBe('FAILED');
    const s = await f.studio.load(a.projectId);
    const edited = await f.studio.mutate(s.id, {
      revision: s.revision,
      title: s.title,
      items: s.items.map((i) => ({ ...i, displayText: 'Manual test edit' })),
    });
    const restart = new ProductionConsumer(f.data, f.studio),
      b = await restart.resume(a.id);
    expect(b.status).toBe('SUCCEEDED');
    const reopened = await f.studio.load(b.projectId);
    expect(reopened.revision).toBe(edited.revision);
    expect(reopened.items[0].displayText).toBe('Manual test edit');
    expect(reopened.items[0].manualLocks).toContain('DISPLAY_TEXT');
    expect(reopened.items[0].originalText).toBe(text);
    expect(await f.studio.list()).toHaveLength(1);
  });
  it('revalidates source on resume and never overwrites a colliding session', async () => {
    const f = await fixture(),
      input = await f.queued();
    jest
      .spyOn(f.studio, 'ensureProductionSession')
      .mockRejectedValueOnce(Error('SYNTHETIC before write'));
    const a = await f.consumer.start(input);
    const d = await f.data.detail(f.postId);
    d.evaluation!.revision++;
    await f.data.store.write(
      'evaluations/' + d.evaluation!.id + '.json',
      d.evaluation,
    );
    expect((await f.consumer.resume(a.id)).error).toBe('STALE_REVISION');
    expect(await f.studio.list()).toHaveLength(0);
  });
  it('keeps proven topic mapping separate from body/narration without changing Bronze', async () => {
    const f = await fixture();
    const body = text;
    const x = {
      ...f.input,
      sourcePostId: 'TOPICDATA03',
      sourceUrl: 'https://www.threads.com/@synthetic_test/post/TOPICDATA03',
      originalBody: 'công việc tphcm\n' + body,
      topic: 'công việc tphcm',
      provenance: {
        ...f.input.provenance,
        bodyMapping: {
          body,
          topic: 'công việc tphcm',
          evidence: 'DOM: synthetic topic-link test evidence',
          sourceUrl: 'https://www.threads.com/@synthetic_test/post/TOPICDATA03',
        },
      },
    };
    const r = await f.data.import([x], '2026-11-03T00:00:00Z');
    let d = await f.data.detail(r.results[0].postId);
    d = await f.data.review(
      d.post.id,
      d.evaluation!.revision,
      'ACCEPT',
      'SYNTHETIC ONLY',
      'POST',
    );
    await f.data.enqueue(d.post.id, d.evaluation!.revision);
    d = await f.data.detail(d.post.id);
    const j = await f.consumer.start({
        postId: d.post.id,
        evaluationId: d.evaluation!.id,
        queueId: d.evaluation!.queue!.id,
        revision: d.evaluation!.revision,
        requestId: 'topic',
      }),
      s = await f.studio.load(j.projectId);
    expect(s.items[0].spokenText).toBe(body);
    expect(s.items[0].originalText).toBe(x.originalBody);
    expect(s.items[0].metadata!.topic).toBe('công việc tphcm');
  });
  it('serves the project through existing Studio/session/editor and production HTTP APIs', async () => {
    const f = await fixture(),
      input = await f.queued();
    const m = await Test.createTestingModule({
      controllers: [DataController, StudioController],
      providers: [
        {
          provide: DataStudioService,
          useValue: { engine: f.data, production: f.consumer },
        },
        { provide: StudioService, useValue: f.studio },
      ],
    }).compile();
    const app = m.createNestApplication();
    await app.init();
    try {
      await request(app.getHttpServer())
        .get('/api/studio/data/production/ready')
        .expect(200);
      const result = await request(app.getHttpServer())
          .post('/api/studio/data/production/jobs')
          .send(input)
          .expect(201),
        id = result.body.projectId;
      await request(app.getHttpServer())
        .get('/api/studio/sessions/' + id)
        .expect(200)
        .expect((r) =>
          expect(r.body.project.productionOrigin.jobId).toBe(result.body.id),
        );
      await request(app.getHttpServer())
        .get('/api/studio/sessions/' + id + '/editor')
        .expect(200)
        .expect((r) => expect(r.body.settings.scenes).toHaveLength(1));
      await request(app.getHttpServer())
        .get('/studio?session=' + id)
        .expect(200);
      await request(app.getHttpServer())
        .post('/api/studio/data/production/jobs')
        .set('Origin', 'https://untrusted.test')
        .send(input)
        .expect(403);
    } finally {
      await app.close();
    }
  });
});
