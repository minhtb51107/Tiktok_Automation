import {
  describe,
  test,
  expect,
  beforeEach,
  afterEach,
  jest,
} from '@jest/globals';
import { mkdtemp, rm } from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { DataStore } from './store';
import { DataEngine } from './engine';
import { ConversationEngine } from './conversation-engine';
import { EditorialEngine } from './editorial-engine';
import { ProductionConsumer } from './production-consumer';
import { StudioService } from '../studio/studio.service';
import { editorialFixture, TEST_COMMENTARY } from './editorial-test.fixture';
import { EditorialStudioService } from './editorial.controller';

describe('DATA05 actual DATA03/Studio handoff — isolated SYNTHETIC', () => {
  let dir: string,
    data: DataEngine,
    conversation: ConversationEngine,
    editorial: EditorialEngine,
    studio: StudioService,
    production: ProductionConsumer,
    collectionId: string;
  beforeEach(async () => {
    dir = await mkdtemp(path.join(os.tmpdir(), 'data05-'));
    data = new DataEngine(new DataStore(path.join(dir, 'data')));
    const f = editorialFixture();
    conversation = new ConversationEngine(data, {
      execution: 'SYNTHETIC',
      discover: async () => [],
      enrich: async () => f.collection,
    });
    editorial = new EditorialEngine(conversation);
    studio = new StudioService({} as any);
    (studio as any).root = path.join(dir, 'sessions');
    production = new ProductionConsumer(data, studio);
    const run = await conversation.start({
      requestId: 'fixture',
      urls: [f.collection.root.url],
    });
    collectionId = run.results[0].collectionId;
    await conversation.feedback(collectionId, {
      requestId: 'selection',
      revision: 0,
      selectedReplyIds: ['REPLY'],
      decision: 'NEEDS_REVIEW',
      reason: 'SYNTHETIC explicit reply selection, not quality ACCEPT',
    });
  });
  afterEach(async () => {
    jest.restoreAllMocks();
    if (
      path.dirname(dir) === path.resolve(os.tmpdir()) &&
      path.basename(dir).startsWith('data05-')
    )
      await rm(dir, { recursive: true, force: true });
  });
  async function plan() {
    let p = await editorial.create({
      collectionId,
      selectionRevision: 1,
      selectionConfirmed: true,
      requestId: 'plan',
    });
    p = await editorial.save(p.id, {
      revision: p.revision,
      sections: p.sections.map((s) =>
        s.kind === 'COMMENTARY'
          ? {
              ...s,
              displayText:
                s.stage === 'COMMENTARY'
                  ? TEST_COMMENTARY
                  : s.stage === 'HOOK'
                    ? 'Điều gì tạo ra khoảng cách giữa kỳ vọng công việc và trải nghiệm của mỗi người? Hãy nhìn vào câu chuyện và góc nhìn được chia sẻ.'
                    : 'Bạn sẽ đặt thêm câu hỏi nào trước khi đưa ra kết luận? Hãy giữ sự khác biệt giữa trải nghiệm cá nhân, lời khuyên và dữ kiện đã xác minh.',
              narrationText:
                s.stage === 'COMMENTARY'
                  ? TEST_COMMENTARY
                  : s.stage === 'HOOK'
                    ? 'Điều gì tạo ra khoảng cách giữa kỳ vọng công việc và trải nghiệm của mỗi người? Hãy nhìn vào câu chuyện và góc nhìn được chia sẻ.'
                    : 'Bạn sẽ đặt thêm câu hỏi nào trước khi đưa ra kết luận? Hãy giữ sự khác biệt giữa trải nghiệm cá nhân, lời khuyên và dữ kiện đã xác minh.',
            }
          : s,
      ),
    });
    return p;
  }
  async function queue() {
    const record = await conversation.collection(collectionId),
      id = record.sourceLink!.postId;
    let d = await data.detail(id);
    d = await data.review(
      id,
      d.evaluation!.revision,
      'ACCEPT',
      'SYNTHETIC DATA01 approval only',
      'POST',
    );
    await data.enqueue(id, d.evaluation!.revision);
    d = await data.detail(id);
    return {
      postId: id,
      evaluationId: d.evaluation!.id,
      queueId: d.evaluation!.queue!.id,
      revision: d.evaluation!.revision,
      requestId: 'production',
      confirmDraftCreation: true,
    };
  }
  test('planner creates only quoted sources and empty original slots; idempotent and stale-safe', async () => {
    const args = {
      collectionId,
      selectionRevision: 1,
      selectionConfirmed: true,
      requestId: 'plan',
    };
    const p = await editorial.create(args);
    expect(p.scriptStatus).toBe('DRAFT');
    expect(
      p.sections
        .filter((s) => s.kind === 'COMMENTARY')
        .every((s) => s.narrationText === ''),
    ).toBe(true);
    expect(p.feasibility.status).toBe('NEEDS_EDITORIAL_ENRICHMENT');
    expect((await editorial.create(args)).id).toBe(p.id);
    await expect(
      editorial.create({ ...args, selectionRevision: 0 }),
    ).rejects.toThrow('STALE');
    await expect(
      editorial.save(p.id, { revision: 99, sections: p.sections }),
    ).rejects.toThrow('STALE');
  });
  test('explicit original commentary can justify advisory READY, never live duration/approval', async () => {
    const p = await plan();
    expect(p.feasibility.status).toBe('READY_FOR_SCRIPT');
    expect(p.feasibility.estimate.minimumSeconds).toBeGreaterThan(60);
    expect(p.feasibility.estimate.authoritative).toBe(false);
    expect(p.rightsStatus).toBe('UNKNOWN');
    expect(p.scriptStatus).toBe('DRAFT');
  });
  test('quality/selection alone cannot create production; queued DATA01 and separate confirmation required', async () => {
    const p = await plan();
    await expect(
      editorial.handoff(
        p.id,
        {
          planRevision: p.revision,
          confirmDraftCreation: true,
          postId: p.bundle.sourceLink!.postId,
          requestId: 'p',
        },
        (b, s) => production.start(b, s),
      ),
    ).rejects.toThrow();
    const input = await queue();
    await expect(
      editorial.handoff(
        p.id,
        { ...input, confirmDraftCreation: false, planRevision: p.revision },
        (b, s) => production.start(b, s),
      ),
    ).rejects.toThrow('CONFIRMATION');
    expect(await production.list()).toHaveLength(0);
  });
  test('one project preserves root/replies/commentary, idempotent retry and reopen', async () => {
    const p = await plan(),
      input = await queue(),
      args = { ...input, planRevision: p.revision };
    const job = await editorial.handoff(p.id, args, (b, s) =>
      production.start(b, s),
    );
    expect(job.status).toBe('SUCCEEDED');
    const repeat = await editorial.handoff(p.id, args, (b, s) =>
      production.start(b, s),
    );
    expect(repeat.projectId).toBe(job.projectId);
    expect(await production.list()).toHaveLength(1);
    const s = await studio.load(job.projectId);
    expect(s.project.comments.map((c) => c.id)).toEqual(['REPLY']);
    expect(s.project.comments[0].text).toBe(
      p.bundle.collection.replies[0].originalText,
    );
    expect(s.items.find((i) => i.id === 'root')!.originalText).toBe(
      p.bundle.collection.root.originalText,
    );
    expect(s.items.find((i) => i.id === 'commentary')!.originalText).toBe('');
    expect(s.productionOrigin?.conversation?.selectedReplyIds).toEqual([
      'REPLY',
    ]);
    expect(s.voiceAssets || []).toHaveLength(0);
    expect(s.items.every((i) => !i.spokenApproval)).toBe(true);
    expect(s.project.editorialPlan!.bundleHash).toBe(p.bundleHash);
  });
  test('failed materialization resumes without duplicating session', async () => {
    const p = await plan(),
      input = await queue();
    const ensure = studio.ensureProductionSession.bind(studio);
    jest
      .spyOn(studio, 'ensureProductionSession')
      .mockRejectedValueOnce(Error('SIMULATED_INTERRUPT'))
      .mockImplementation(ensure);
    let j = await editorial.handoff(
      p.id,
      { ...input, planRevision: p.revision },
      (b, s) => production.start(b, s),
    );
    expect(j.status).toBe('FAILED');
    j = await new ProductionConsumer(data, studio).resume(j.id);
    expect(j.status).toBe('SUCCEEDED');
    expect(await studio.list()).toHaveLength(1);
  });
  test('changed selection blocks handoff; bundle corruption rejected; raw source immutable', async () => {
    const p = await plan(),
      before = await data.detail(p.bundle.sourceLink!.postId);
    await conversation.feedback(collectionId, {
      requestId: 'changed',
      revision: 1,
      selectedReplyIds: [],
      decision: 'REJECT',
      reason: 'SYNTHETIC quality decision only',
    });
    await expect(
      editorial.handoff(
        p.id,
        { planRevision: p.revision, confirmDraftCreation: true },
        async () => {},
      ),
    ).rejects.toThrow('SELECTION_CHANGED');
    expect(await data.detail(p.bundle.sourceLink!.postId)).toEqual(before);
    p.bundle.collection.root.originalText = 'tampered';
    await data.store.write('editorial-plans/' + p.id + '.json', p);
    await expect(editorial.get(p.id)).rejects.toThrow('INTEGRITY');
  });
  test('manual script approval is separate, preserves original and becomes stale after edits', async () => {
    const p = await plan(),
      input = await queue(),
      j = await editorial.handoff(
        p.id,
        { ...input, planRevision: p.revision },
        (b, s) => production.start(b, s),
      );
    let s = await studio.load(j.projectId);
    s = await studio.approveEditorialScript(s.id, {
      revision: s.revision,
      confirmUserReview: true,
      reason: 'SYNTHETIC explicit script review',
    });
    expect(s.project.editorialApproval?.status).toBe('APPROVED');
    expect(s.items.every((i) => !i.spokenApproval)).toBe(true);
    const raw = s.items.find((i) => i.id === 'root')!.originalText;
    s = await studio.mutate(s.id, {
      revision: s.revision,
      title: s.title,
      items: s.items.map((i) => ({
        id: i.id,
        selected: i.selected,
        displayText: i.displayText,
        spokenText:
          i.spokenText + (i.id === 'root' ? ' Đây là lời diễn giải thêm.' : ''),
      })),
    });
    expect(s.project.editorialApproval?.status).toBe('STALE');
    expect(s.items.find((i) => i.id === 'root')!.editorial?.kind).toBe(
      'PARAPHRASE',
    );
    expect(s.items.find((i) => i.id === 'root')!.originalText).toBe(raw);
  });
  test('manual locks and quoted wording cannot silently be overwritten', async () => {
    const p = await plan();
    let locked = await editorial.save(p.id, {
      revision: p.revision,
      sections: p.sections.map((s) =>
        s.id === 'commentary' ? { ...s, locked: true } : s,
      ),
    });
    await expect(
      editorial.save(p.id, {
        revision: locked.revision,
        sections: locked.sections.map((s) =>
          s.id === 'commentary' ? { ...s, narrationText: 'changed' } : s,
        ),
      }),
    ).rejects.toThrow('LOCKED');
    await expect(
      editorial.save(p.id, {
        revision: locked.revision,
        sections: locked.sections.map((s) =>
          s.id === 'root' ? { ...s, narrationText: 'invented quote' } : s,
        ),
      }),
    ).rejects.toThrow('PARAPHRASE_LABEL');
  });
  test('service orchestration does not take the Studio lock twice during DATA03 materialization', async () => {
    const p = await plan(),
      input = await queue();
    const service = new EditorialStudioService(
      { engine: conversation } as any,
      { engine: data, studio, production } as any,
    );
    const job = await service.project(p.id, {
      ...input,
      planRevision: p.revision,
    });
    expect(job.status).toBe('SUCCEEDED');
    expect(await studio.list()).toHaveLength(1);
    await expect(
      production.start({ ...input, requestId: 'root-only-duplicate' }),
    ).rejects.toThrow('EXISTING_PROJECT');
  });
});
