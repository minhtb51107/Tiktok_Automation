import { describe, it, expect, jest, afterEach } from '@jest/globals';
import { promises as fs } from 'fs';
import * as path from 'path';
import * as os from 'os';
import { ThreadsStore } from './local-store';
import { ThreadsProvider } from './provider';
import { ThreadsAuth } from './auth';
import { ThreadsCollector } from './collector';
import { DiscoveryScheduler } from './scheduler';
import { DataEngine } from '../data-engine/engine';
import { DataStore } from '../data-engine/store';
import { DEFAULT_PILOT } from './config';
import { apiInput, safePage, pageCursor } from './adapter';
const roots: string[] = [],
  token = 'synthetic-collector-token',
  secret = 'synthetic-collector-secret';
const text =
  'SYNTHETIC TEST DATA. Mình chia sẻ kinh nghiệm công việc trong công ty để những người mới có thể học hỏi và trao đổi cùng nhau. Công việc cần phù hợp với cuộc sống và gia đình.';
const row = (id = 'TEST001') => ({
  id: '180000000000001',
  username: 'SYNTHETIC_TEST_DATA',
  permalink: 'https://www.threads.com/@test_data/post/' + id,
  timestamp: '2026-11-01T00:00:00Z',
  text,
  is_reply: false,
  synthetic_test_data: true,
});
async function fixture(
  search?: (q: URL, n: number) => Promise<Response> | Response,
) {
  const root = await fs.mkdtemp(
    path.join(os.tmpdir(), 'threads-collector-test-'),
  );
  roots.push(root);
  let now = Date.parse('2026-11-03T00:00:00Z'),
    n = 0;
  const calls: string[] = [],
    waits: number[] = [],
    store = new ThreadsStore(path.join(root, 'collector'));
  const cfg = {
      appId: '123456789',
      appSecret: secret,
      accessToken: token,
      redirectUri:
        'https://threads-studio.test:3443/api/studio/threads/oauth/callback',
    },
    provider = new ThreadsProvider((async (url: string) => {
      const u = new URL(url);
      calls.push(u.pathname);
      if (u.pathname.endsWith('/debug_token'))
        return Response.json({
          data: {
            app_id: cfg.appId,
            user_id: 'test-user',
            is_valid: true,
            expires_at: now / 1000 + 3600,
            scopes: ['threads_basic', 'threads_keyword_search'],
          },
        });
      if (u.pathname.endsWith('/me')) return Response.json({ id: 'test-user' });
      if (u.pathname.endsWith('/keyword_search'))
        return search ? search(u, ++n) : Response.json({ data: [row()] });
      throw Error('Unexpected Meta route');
    }) as any);
  const auth = new ThreadsAuth(
      store,
      provider,
      () => cfg,
      () => now,
    ),
    data = new DataEngine(new DataStore(path.join(root, 'data'))),
    collector = new ThreadsCollector(
      data,
      auth,
      store,
      () => now,
      async (ms) => {
        waits.push(ms);
        now += ms;
      },
      'MOCK',
    );
  return {
    root,
    calls,
    waits,
    auth,
    data,
    collector,
    store,
    cfg,
    setNow: (v: number) => {
      now = v;
    },
    now: () => now,
    input: (extra: any = {}) => ({
      ...DEFAULT_PILOT,
      keywords: ['công việc'],
      requestId: 'synthetic-request',
      ...extra,
    }),
  };
}
afterEach(async () => {
  jest.restoreAllMocks();
  for (const r of roots.splice(0)) {
    if (
      !path.resolve(r).startsWith(path.resolve(os.tmpdir()) + path.sep) ||
      !path.basename(r).startsWith('threads-collector-test-')
    )
      throw Error('Unsafe cleanup');
    await fs.rm(r, { recursive: true, force: true });
  }
});
describe('Threads collector / DATA-01 integration — MOCK ONLY, SYNTHETIC TEST DATA', () => {
  it('persists empty-search diagnosis without inferring public permission or retrying',async()=>{
    const f=await fixture(()=>Response.json({data:[]}));
    const r=await f.collector.start(f.input());
    expect(r.status).toBe('COMPLETED');
    expect(r.returned).toBe(0);
    expect(r.searchDiagnostics?.[0].assessment).toMatchObject({outcome:'ACCESS_EMPTY',count:0,paging:'NOT_PRESENT',publicAccess:'UNKNOWN'});
    expect(r.warnings.some(x=>x.startsWith('ACCESS_EMPTY:'))).toBe(true);
    expect(f.calls.filter(x=>x.endsWith('/keyword_search'))).toHaveLength(1);
    expect((await f.collector.get(r.id)).searchDiagnostics).toEqual(r.searchDiagnostics);
  });
  it('retains native ID and canonical shortcode without quarantining valid API records; no auto-queue', async () => {
    const f = await fixture(),
      r = await f.collector.start(f.input());
    expect(r.status).toBe('COMPLETED');
    expect(r.execution).toBe('MOCK');
    expect(r.requestAttempts).toBe(3);
    expect(r.responsesReceived).toBe(3);
    expect(r.newPosts).toBe(1);
    expect(r.dataStates.SCORED).toBe(1);
    const c = await f.data.catalog(),
      d = await f.data.detail(c.rows[0].id);
    expect(d.bronze).toMatchObject({
      sourcePostId: 'TEST001',
      nativeSourceId: '180000000000001',
      rightsStatus: 'UNKNOWN',
      originalBody: text,
    });
    expect(d.evaluation!.gold!.eligibility).toBe('NEEDS_REVIEW');
    expect(d.evaluation!.queue).toBeNull();
    expect(d.bronze!.provenance.synthetic).toBe(true);
  });
  it('deduplicates overlapping keywords and request IDs, preserving observations', async () => {
    const f = await fixture(),
      input = f.input({ keywords: ['công việc', 'tâm sự'] }),
      a = await f.collector.start(input),
      before = f.calls.length,
      b = await f.collector.start(input);
    expect(a.id).toBe(b.id);
    expect(f.calls).toHaveLength(before);
    expect(a.newPosts).toBe(1);
    expect(a.sourceDuplicates).toBe(1);
    expect((await f.data.catalog()).total).toBe(1);
    expect((await f.data.catalog()).observations).toBe(2);
    await expect(
      f.collector.start({ ...input, perKeyword: 4 }),
    ).rejects.toThrow('IDEMPOTENCY_CONFLICT');
  });
  it('paginates via a cursor without following credential-bearing next URLs', async () => {
    const f = await fixture((u, n) =>
      n === 1
        ? Response.json({
            data: [row('TEST001')],
            paging: {
              next:
                'https://graph.threads.com/v1.0/keyword_search?after=cursor-a&access_token=' +
                token,
            },
          })
        : Response.json({ data: [row('TEST002')] }),
    );
    const r = await f.collector.start(f.input());
    expect(r.status).toBe('COMPLETED');
    expect(r.returned).toBe(2);
    expect(r.requestAttempts).toBe(4);
    for (const id of r.pages) {
      const saved = JSON.stringify(await f.store.read('pages/' + id + '.json'));
      expect(saved).not.toContain(token);
      expect(saved).not.toContain(secret);
    }
  });
  it('caps each keyword at five and total at ten; validates budgets', async () => {
    const f = await fixture((u) =>
      Response.json({
        data: Array.from(
          { length: Number(u.searchParams.get('limit')) },
          (_, n) =>
            row(
              (u.searchParams.get('q') === 'công việc' ? 'WORK' : 'LIFE') + n,
            ),
        ),
      }),
    );
    const r = await f.collector.start(
      f.input({ keywords: ['công việc', 'tâm sự'] }),
    );
    expect(r.returned).toBe(10);
    expect(r.imported).toBe(10);
    expect(r.requestAttempts).toBe(4);
    for (const extra of [
      { perKeyword: 6 },
      { keywords: ['a', 'b', 'c'] },
      { maxRequests: 100 },
      { maxRunMs: 999999 },
    ])
      await expect(
        f.collector.start(f.input({ ...extra, requestId: 'invalid' })),
      ).rejects.toThrow('Invalid pilot');
  });
  it('stops at request and time budgets, including auth calls', async () => {
    const f = await fixture(),
      r = await f.collector.start(
        f.input({ keywords: ['công việc', 'tâm sự'], maxRequests: 3 }),
      );
    expect(r.status).toBe('BUDGET_EXHAUSTED');
    expect(r.requestAttempts).toBe(3);
    expect(r.imported).toBe(1);
    f.setNow(r.deadlineAt + 1);
    expect((await f.collector.resume(r.id)).requestAttempts).toBe(3);
  });
  it('bounds transient retries and exponential waits; never retries 401/403/429', async () => {
    const f = await fixture(() =>
        Response.json({ error: { code: 1, message: token } }, { status: 500 }),
      ),
      r = await f.collector.start(f.input());
    expect(r.status).toBe('TRANSIENT');
    expect(r.requestAttempts).toBe(5);
    expect(f.waits).toEqual([500, 1000]);
    for (const [status, code, kind] of [
      [401, 190, 'BLOCKED_AUTH'],
      [403, 10, 'BLOCKED_PERMISSION'],
      [429, 4, 'RATE_LIMITED'],
    ] as const) {
      const x = await fixture(() =>
          Response.json(
            { error: { code, message: secret } },
            { status, headers: { 'Retry-After': '2' } },
          ),
        ),
        result = await x.collector.start(x.input());
      expect(result.status).toBe(kind);
      expect(result.requestAttempts).toBe(3);
      expect(x.waits).toEqual([]);
      expect(JSON.stringify(result)).not.toContain(token);
      expect(JSON.stringify(result)).not.toContain(secret);
      if (status === 429)
        await expect(x.collector.resume(result.id)).rejects.toThrow('COOLDOWN');
    }
  });
  it('recovers a captured page after interruption without another API request', async () => {
    const f = await fixture(),
      write = f.store.write.bind(f.store);
    let fail = true;
    jest.spyOn(f.store, 'write').mockImplementation(async (k, v) => {
      await write(k, v);
      if (fail && k.startsWith('pages/')) {
        fail = false;
        throw Error('SYNTHETIC interruption after raw-page commit');
      }
    });
    const a = await f.collector.start(f.input());
    expect(a.status).toBe('FAILED');
    const requests = f.calls.length,
      restored = new ThreadsCollector(
        f.data,
        f.auth,
        new ThreadsStore(f.store.root),
        f.now,
        async () => {},
        'MOCK',
      ),
      b = await restored.resume(a.id);
    expect(b.status).toBe('COMPLETED');
    expect(f.calls).toHaveLength(requests);
    expect(b.newPosts).toBe(1);
    expect((await f.data.catalog()).total).toBe(1);
  });
  it('recovers a DATA-01 checkpoint failure without double-counting newly inserted posts', async () => {
    const f = await fixture(),
      write = f.data.store.write.bind(f.data.store);
    let fail = true;
    jest.spyOn(f.data.store, 'write').mockImplementation(async (k, v, imm) => {
      await write(k, v, imm);
      if (fail && (v as any).state === 'SCORED') {
        fail = false;
        throw Error('SYNTHETIC DATA01 failure after score saved');
      }
    });
    const a = await f.collector.start(f.input());
    expect(a.status).toBe('FAILED');
    const requests = f.calls.length,
      b = await f.collector.resume(a.id);
    expect(b.status).toBe('COMPLETED');
    expect(b.newPosts).toBe(1);
    expect(b.sourceDuplicates).toBe(0);
    expect(f.calls).toHaveLength(requests);
  });
  it('concurrency=1 rejects overlapping manual triggers', async () => {
    const f = await fixture();
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const original = f.auth.context.bind(f.auth);
    jest.spyOn(f.auth, 'context').mockImplementation(async (hooks) => {
      await gate;
      return original(hooks);
    });
    const first = f.collector.start(f.input());
    await new Promise((r) => setTimeout(r, 20));
    await expect(
      f.collector.start(f.input({ requestId: 'second' })),
    ).rejects.toThrow('BUSY');
    release();
    await first;
  });
  it('never scrapes/follows arbitrary URLs or rewrites leaked credential text', () => {
    expect(() =>
      pageCursor({ paging: { next: 'http://127.0.0.1/private?after=x' } }),
    ).toThrow('unsafe');
    expect(() => safePage({ data: [{ text: token }] }, [token])).toThrow(
      'credential',
    );
    const x = apiInput(
      { ...row(), permalink: 'not-a-url' },
      'test',
      '2026-11-03T00:00:00Z',
      'test',
    );
    expect(x.sourcePostId).toBeNull();
    expect(x.nativeSourceId).toBe('180000000000001');
    expect(x.engagement.likes).toBeNull();
  });
});
describe('Discovery policy — disabled/manual tick only, MOCK ONLY', () => {
  it('is disabled/paused by default, validates policy and respects a six-hour interval', async () => {
    const f = await fixture(),
      s = new DiscoveryScheduler(f.collector, f.store, f.now);
    expect((await s.status()).enabled).toBe(false);
    expect((await s.tick()).decision).toBe('DISABLED');
    expect(f.calls).toHaveLength(0);
    await expect(s.configure({ intervalMs: 100 })).rejects.toThrow('policy');
    await s.configure({
      enabled: true,
      paused: false,
      keywords: ['công việc'],
    });
    expect((await s.tick()).decision).toBe('TRIGGERED');
    expect((await s.tick()).decision).toBe('NOT_DUE');
    await s.pause();
    expect((await s.tick()).decision).toBe('PAUSED');
  });
  it('skips sufficient inventory/review backlog and backs off low qualification yield', async () => {
    const f = await fixture(),
      s = new DiscoveryScheduler(f.collector, f.store, f.now);
    await s.configure({
      enabled: true,
      paused: false,
      keywords: ['công việc'],
      minimumInventory: 1,
    });
    const catalog = await f.data.catalog();
    const spy = jest
      .spyOn(f.data, 'catalog')
      .mockResolvedValue({ ...catalog, counts: { QUALIFIED: 1 } });
    expect((await s.tick()).decision).toBe('INVENTORY_SUFFICIENT');
    spy.mockResolvedValue({ ...catalog, counts: { SCORED: 20 } });
    expect((await s.tick()).decision).toBe('MANUAL_REVIEW_BACKLOG');
    spy.mockRestore();
    const x = await fixture(() =>
        Response.json({
          data: Array.from({ length: 5 }, (_, n) => row('LOW' + n)),
        }),
      ),
      scheduler = new DiscoveryScheduler(x.collector, x.store, x.now);
    await scheduler.configure({
      enabled: true,
      paused: false,
      keywords: ['công việc'],
    });
    await scheduler.tick();
    const p = await scheduler.status();
    expect(p.blockedReason).toBe('LOW_QUALIFICATION_YIELD_REVIEW_REQUIRED');
    expect(p.nextCheckAt - x.now()).toBe(12 * 3600000);
  });
});
