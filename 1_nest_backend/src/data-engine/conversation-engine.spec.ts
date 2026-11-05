import {
  describe,
  test,
  expect,
  beforeEach,
  afterEach,
  jest,
} from '@jest/globals';
import { mkdtemp, rm } from 'fs/promises';
import { tmpdir } from 'os';
import * as path from 'path';
import { DataStore } from './store';
import { DataEngine } from './engine';
import { GoldShadowEngine } from './gold-shadow';
import {
  ConversationEngine,
  type ConversationProvider,
} from './conversation-engine';
import { collectEvidence } from './conversation-evidence';
import type { PublicPost, ThreadCollection } from './conversation-contracts';
const root: PublicPost = {
  id: 'POST',
  url: 'https://www.threads.com/@tester/post/POST',
  author: { handle: 'tester', name: 'SYNTHETIC TEST DATA' },
  originalText:
    'Tôi từng đi làm công ty, muốn chia sẻ trải nghiệm với công việc hằng ngày. Đây là dữ liệu kiểm thử tổng hợp.',
  publishedAt: '2026-11-01T00:00:00Z',
  engagement: { likes: 100, replies: 30, reposts: 10, shares: null },
  provenance: {
    documentUrl: 'https://www.threads.com/@tester/post/POST',
    observedAt: '2026-11-02T00:00:00Z',
    method: 'TEST DATA',
    synthetic: true,
  },
};
export function syntheticCollection(): ThreadCollection {
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
        text: 'Nhưng công ty sai vì không giải thích yêu cầu.',
      },
    ],
  });
}
describe('DATA04 persistence, recovery and review — isolated synthetic', () => {
  let dir: string,
    data: DataEngine,
    provider: ConversationProvider,
    engine: ConversationEngine;
  beforeEach(async () => {
    dir = await mkdtemp(path.join(tmpdir(), 'data04-'));
    data = new DataEngine(new DataStore(dir));
    provider = {
      execution: 'SYNTHETIC',
      discover: jest.fn(async () => [
        { url: root.url, observedOrder: 0, post: root },
      ]),
      enrich: jest.fn(async () => syntheticCollection()),
    };
    engine = new ConversationEngine(data, provider);
  });
  afterEach(async () => {
    if (
      path.dirname(dir) === path.resolve(tmpdir()) &&
      path.basename(dir).startsWith('data04-')
    )
      await rm(dir, { recursive: true, force: true });
  });
  test('idempotent start/restart does not collect or import twice; identities survive reopen', async () => {
    const input = { requestId: 'once', keyword: 'công việc', limit: 1 },
      r = await engine.start(input);
    expect(r.status).toBe('COMPLETED');
    expect(r.results).toHaveLength(1);
    expect((await engine.start(input)).id).toBe(r.id);
    const reopened = new ConversationEngine(
      new DataEngine(new DataStore(dir)),
      provider,
    );
    expect((await reopened.resume(r.id)).results).toHaveLength(1);
    expect(provider.enrich).toHaveBeenCalledTimes(1);
    expect((await data.catalog()).total).toBe(1);
    await expect(engine.start({ ...input, keyword: 'khác' })).rejects.toThrow(
      'CONFLICT',
    );
    const detail = await data.detail((await data.catalog()).rows[0].id);
    expect(detail.bronze!.originalBody).toBe(root.originalText);
    expect(detail.evaluation!.review).toBeNull();
    expect(detail.evaluation!.queue).toBeNull();
  });
  test('restart resumes saved capture after persistence failure without reopening browser', async () => {
    let fail = true;
    const write = data.store.write.bind(data.store);
    jest.spyOn(data.store, 'write').mockImplementation(async (k, v, i) => {
      if (k.startsWith('thread-collections/') && fail) {
        fail = false;
        throw Error('SIMULATED_POWER_LOSS');
      }
      return write(k, v, i);
    });
    const run = await engine.start({ requestId: 'recover', urls: [root.url] });
    expect(run.status).toBe('FAILED');
    expect(run.captures).toHaveLength(1);
    const resumed = await new ConversationEngine(data, provider).resume(run.id);
    expect(resumed.status).toBe('COMPLETED');
    expect(provider.enrich).toHaveBeenCalledTimes(1);
    expect((await data.catalog()).total).toBe(1);
  });
  test('DATA01 import checkpoint resumes an interrupted Bronze-to-Gold run, not just browser capture', async () => {
    const write = data.store.write.bind(data.store);
    let block = true;
    const spy = jest
      .spyOn(data.store, 'write')
      .mockImplementation(async (k, v, i) => {
        if (k.startsWith('evaluations/') && block)
          throw Error('SIMULATED_DISK_FAILURE');
        return write(k, v, i);
      });
    const first = await engine.start({
      requestId: 'import-recovery',
      urls: [root.url],
    });
    expect(first.status).toBe('FAILED');
    expect(first.captures[0].importRunId).toMatch(/^[a-f0-9]{64}$/);
    block = false;
    spy.mockRestore();
    const resumed = await new ConversationEngine(
      new DataEngine(new DataStore(dir)),
      provider,
    ).resume(first.id);
    expect(resumed.status).toBe('COMPLETED');
    expect(provider.enrich).toHaveBeenCalledTimes(1);
    const record = await engine.collection(resumed.results[0].collectionId);
    expect(record.sourceLink?.evaluationId).toBeTruthy();
    expect(
      (await data.detail(record.sourceLink!.postId)).evaluation!.gold,
    ).not.toBeNull();
    expect((await data.catalog()).total).toBe(1);
  });
  test('configuration mismatch and tampered saved collection cannot silently resume', async () => {
    const r = await engine.start({ requestId: 'versioned', urls: [root.url] });
    await data.store.write(`conversation-runs/${r.id}.json`, {
      ...r,
      status: 'FAILED',
      configHash: 'changed',
    });
    await expect(
      new ConversationEngine(data, provider).resume(r.id),
    ).rejects.toThrow('CONFIG_VERSION_MISMATCH');
    const record = await engine.collection(r.results[0].collectionId);
    await data.store.write(`thread-collections/${record.id}.json`, {
      ...record,
      collection: {
        ...record.collection,
        root: { ...record.collection.root, originalText: 'tampered' },
      },
    });
    await expect(engine.collection(record.id)).rejects.toThrow('INTEGRITY');
  });
  test('review revision, stable reply selection, retry and history; no production approval', async () => {
    const run = await engine.start({ requestId: 'review', urls: [root.url] }),
      id = run.results[0].collectionId;
    const b = {
      requestId: 'label',
      revision: 0,
      selectedReplyIds: ['R1'],
      decision: 'ACCEPT',
      reason: 'TEST DATA user quality assessment',
    };
    const r = await engine.feedback(id, b);
    expect(r.revision).toBe(1);
    expect(await engine.feedback(id, b)).toEqual(r);
    await expect(
      engine.feedback(id, { ...b, requestId: 'stale' }),
    ).rejects.toThrow('STALE_REVISION');
    await expect(
      engine.feedback(id, {
        ...b,
        revision: 1,
        requestId: 'bad',
        selectedReplyIds: ['OTHER'],
      }),
    ).rejects.toThrow('UNKNOWN_REPLY');
    const reopened = new ConversationEngine(data, provider);
    expect((await reopened.review(id)).selectedReplyIds).toEqual(['R1']);
    const bundle = await reopened.bundle(id);
    expect(bundle.replyReferences[0].id).toBe('R1');
    expect(bundle.productionApproved).toBe(false);
    expect(bundle.handoffEnabled).toBe(false);
  });
  test('double-click cannot execute concurrently and invalid inputs never navigate', async () => {
    let release!: () => void;
    provider.enrich = jest.fn(async () => {
      await new Promise<void>((r) => (release = r));
      return syntheticCollection();
    });
    const first = engine.start({ requestId: 'double', urls: [root.url] });
    while (!release) await new Promise((r) => setTimeout(r, 5));
    await expect(
      engine.start({ requestId: 'double', urls: [root.url] }),
    ).rejects.toThrow('BUSY');
    release();
    await first;
    await expect(
      engine.start({ requestId: 'bad', urls: ['https://127.0.0.1/private'] }),
    ).rejects.toThrow('INVALID_URL');
  });
  test('preserves current DATA01 review and Gold V2 records for existing roots', async () => {
    const r = await engine.start({ requestId: 'first', urls: [root.url] }),
      record = await engine.collection(r.results[0].collectionId),
      before = await data.detail(record.sourceLink!.postId);
    const shadow = await new GoldShadowEngine(data).evaluate(
      record.sourceLink!.postId,
      record.sourceLink!.evaluationId!,
      'WORK',
    );
    const savedShadow = await data.store.read(`gold-shadows/${shadow.id}.json`);
    await engine.start({ requestId: 'another', urls: [root.url] });
    expect(await data.detail(record.sourceLink!.postId)).toEqual(before);
    expect(await data.store.read(`gold-shadows/${shadow.id}.json`)).toEqual(
      savedShadow,
    );
  });
});
