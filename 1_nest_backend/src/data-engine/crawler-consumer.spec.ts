import { describe, it, expect, jest, afterEach } from '@jest/globals';
import { promises as fs } from 'fs';
import * as path from 'path';
import * as os from 'os';
import { DataEngine } from './engine';
import { DataStore } from './store';
import { PublicCrawlerConsumer, crawlerRequest } from './crawler-consumer';
import { crawlerInput } from './crawler-adapter';
import {
  discoveryUrl,
  checkDiscovery,
  publicResource,
} from '../modules/core/scraper/public-discovery';
import type { SourceAttempt } from '../studio/public-threads';
const roots: string[] = [];
const url = 'https://www.threads.com/@synthetic_test/post/TEST02B001';
const text =
  'SYNTHETIC TEST DATA. Mình chia sẻ kinh nghiệm công việc trong công ty. Những người mới đi làm có gặp khó khăn khi trao đổi với đồng nghiệp không? Đây là một câu chuyện về cách học hỏi và tìm được công việc phù hợp với bản thân.';
const attempt = (): SourceAttempt => ({
  originalUrl: url,
  resolvedUrl: url,
  canonicalUrl: url,
  status: 'SUCCESS',
  scope: 'TARGET_ONLY',
  matchedTargetId: 'TEST02B001',
  matchMethod: 'DOM_PERMALINK',
  elapsedMs: 0,
  diagnostics: [],
  redirects: [],
  retrievedAt: '2026-11-03T00:00:00Z',
  records: [
    {
      text,
      author: 'SYNTHETIC TEST DATA',
      handle: 'synthetic_test',
      avatar: null,
      createdAt: '2026-11-01T00:00:00Z',
      type: 'POST',
      parentReference: null,
      media: [],
      likeCount: 0,
      replyCount: null,
      repostCount: null,
      shareCount: null,
      provenance: { text: 'SYNTHETIC TEST DATA' },
    },
  ],
});
async function fixture() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'data02b-test-'));
  roots.push(root);
  const data = new DataEngine(new DataStore(root));
  const scrape = jest.fn(async (_scrolls?: number, _options?: unknown) => [
      { url },
    ]),
    extract = jest.fn(
      async (_url: string, _scope?: 'TARGET_ONLY' | 'WITH_CONTEXT') =>
        attempt(),
    );
  const collector = new PublicCrawlerConsumer(
    data,
    { scrapeForYouFeed: scrape },
    extract as any,
    'MOCK',
  );
  return {
    root,
    data,
    scrape,
    extract,
    collector,
    input: {
      mode: 'SEARCH',
      keyword: 'chuyện đi làm',
      requestId: 'unit-first',
    },
  };
}
afterEach(async () => {
  jest.restoreAllMocks();
  for (const root of roots.splice(0)) {
    if (
      !path.resolve(root).startsWith(path.resolve(os.tmpdir()) + path.sep) ||
      !path.basename(root).startsWith('data02b-test-')
    )
      throw Error('Unsafe test cleanup');
    await fs.rm(root, { recursive: true, force: true });
  }
});
describe('Legacy public crawler adapter — MOCK / SYNTHETIC TEST DATA', () => {
  it('does not import metadata fallback when the browser encounters an access challenge', async () => {
    const f = await fixture();
    const a = attempt();
    a.diagnostics = [
      {
        stage: 'browser',
        code: 'BROWSER_FAILURE',
        message: 'Public access protection encountered; stopped without bypass',
      },
    ];
    f.extract.mockResolvedValueOnce(a);
    const r = await f.collector.start(f.input);
    expect(r.status).toBe('BLOCKED_ACCESS');
    expect((await f.data.catalog()).total).toBe(0);
  });
  it('keeps search query intact, validates budgets/hosts and forbids credential links', () => {
    expect(
      new URL(discoveryUrl('SEARCH', 'công việc')).searchParams.get('q'),
    ).toBe('công việc');
    expect(() =>
      checkDiscovery({
        url: 'https://localhost/search?q=test',
        limit: 1,
        timeoutMs: 1000,
      }),
    ).toThrow();
    expect(publicResource('http://www.threads.com/')).toBe(false);
    expect(publicResource('https://threads.com.attacker.test/')).toBe(false);
    expect(publicResource('https://www.threads.com/')).toBe(true);
    expect(() =>
      crawlerRequest({
        mode: 'URLS',
        urls: [url + '?access_token=synthetic'],
        requestId: 'test',
      }),
    ).toThrow('CREDENTIAL');
    expect(() =>
      crawlerRequest({
        mode: 'URLS',
        urls: [url, url, url],
        requestId: 'test',
      }),
    ).toThrow('URLS');
  });
  it('uses controlled legacy discovery then exact extraction, DATA-01 review gate and raw preservation', async () => {
    const f = await fixture(),
      r = await f.collector.start(f.input),
      report = await f.collector.report(r.id);
    expect(r.status).toBe('COMPLETED');
    expect(report).toMatchObject({
      execution: 'MOCK',
      matched: 1,
      bronze: 1,
      silver: 1,
      gold: 1,
      newPosts: 1,
      scheduled: false,
    });
    expect(f.scrape).toHaveBeenCalledWith(
      1,
      expect.objectContaining({
        url: discoveryUrl('SEARCH', 'chuyện đi làm'),
        limit: 2,
      }),
    );
    expect(f.extract).toHaveBeenCalledWith(url, 'TARGET_ONLY');
    const list = await f.data.catalog(),
      d = await f.data.detail(list.rows[0].id);
    expect(d.bronze!.originalBody).toBe(text);
    expect(d.bronze!.engagement).toMatchObject({ likes: 0, replies: null });
    expect(d.bronze!.rightsStatus).toBe('UNKNOWN');
    expect(d.bronze!.provenance.synthetic).toBe(true);
    expect(d.evaluation!.review).toBeNull();
    expect(d.evaluation!.queue).toBeNull();
    expect(d.evaluation!.gold!.eligibility).toBe('NEEDS_REVIEW');
  });
  it('does not substitute unrelated candidates or invent source identity', () => {
    const x = attempt();
    x.matchedTargetId = 'OTHER';
    expect(crawlerInput(x, 'test')).toBeNull();
    x.matchedTargetId = 'TEST02B001';
    x.matchMethod = 'UNVERIFIED';
    expect(crawlerInput(x, 'test')).toBeNull();
  });
  it('same request and restart never refetch; new observation deduplicates source post', async () => {
    const f = await fixture(),
      a = await f.collector.start(f.input);
    const restart = new PublicCrawlerConsumer(
      f.data,
      { scrapeForYouFeed: f.scrape },
      f.extract as any,
      'MOCK',
    );
    expect((await restart.start(f.input)).id).toBe(a.id);
    expect(f.extract).toHaveBeenCalledTimes(1);
    const b = await restart.start({
      ...f.input,
      requestId: 'second-observation',
    });
    expect(await restart.report(b.id)).toMatchObject({
      newPosts: 0,
      duplicates: 1,
    });
    expect((await f.data.catalog()).total).toBe(1);
    await expect(
      restart.start({ ...f.input, keyword: 'different' }),
    ).rejects.toThrow('CONFLICT');
  });
  it('stops at login/CAPTCHA/access gates without retries or source import', async () => {
    const f = await fixture();
    f.scrape.mockRejectedValueOnce(Error('CRAWLER_ACCESS_BLOCKED'));
    const r = await f.collector.start(f.input);
    expect(r.status).toBe('BLOCKED_ACCESS');
    expect(f.extract).not.toHaveBeenCalled();
    await f.collector.resume(r.id);
    expect(f.scrape).toHaveBeenCalledTimes(1);
    expect((await f.data.catalog()).total).toBe(0);
  });
  it('recovers a captured target after interruption without another navigation', async () => {
    const f = await fixture(),
      write = f.data.store.write.bind(f.data.store);
    let fail = true;
    jest.spyOn(f.data.store, 'write').mockImplementation(async (k, v, imm) => {
      await write(k, v, imm);
      if (
        fail &&
        k.startsWith('crawler-runs/') &&
        (v as any).captures?.length === 1
      ) {
        fail = false;
        throw Error('SYNTHETIC interruption');
      }
    });
    const r = await f.collector.start(f.input);
    expect(r.status).toBe('FAILED');
    const restart = new PublicCrawlerConsumer(
      new DataEngine(new DataStore(f.root)),
      { scrapeForYouFeed: f.scrape },
      f.extract as any,
      'MOCK',
    );
    expect((await restart.resume(r.id)).status).toBe('COMPLETED');
    expect(f.extract).toHaveBeenCalledTimes(1);
    expect((await f.data.catalog()).total).toBe(1);
  });
  it('replays DATA-01 failed import checkpoint, retaining exactly one source post', async () => {
    const f = await fixture(),
      write = f.data.store.write.bind(f.data.store);
    let fail = true;
    jest.spyOn(f.data.store, 'write').mockImplementation(async (k, v, imm) => {
      await write(k, v, imm);
      if (fail && (v as any).state === 'SCORED') {
        fail = false;
        throw Error('SYNTHETIC after score');
      }
    });
    const r = await f.collector.start(f.input);
    expect(r.status).toBe('FAILED');
    expect((await f.collector.resume(r.id)).status).toBe('COMPLETED');
    expect(f.extract).toHaveBeenCalledTimes(1);
    expect((await f.data.catalog()).total).toBe(1);
  });
  it('resumes an old discovery checkpoint with a fresh bounded execution budget', async () => {
    const f = await fixture();
    f.extract.mockRejectedValueOnce(Error('SYNTHETIC interruption'));
    const r = await f.collector.start(f.input);
    expect(r.status).toBe('FAILED');
    r.startedAt = '2020-01-01T00:00:00Z';
    await f.data.store.write('crawler-runs/' + r.id + '.json', r);
    const restart = new PublicCrawlerConsumer(
      new DataEngine(new DataStore(f.root)),
      { scrapeForYouFeed: f.scrape },
      f.extract as any,
      'MOCK',
    );
    expect((await restart.resume(r.id)).status).toBe('COMPLETED');
    expect(f.scrape).toHaveBeenCalledTimes(1);
    expect(f.extract).toHaveBeenCalledTimes(2);
    expect((await f.data.catalog()).total).toBe(1);
  });
  it('has no startup collection and rejects concurrent manual runs', async () => {
    const f = await fixture();
    expect(f.scrape).not.toHaveBeenCalled();
    let release!: () => void;
    const wait = new Promise<void>((r) => (release = r));
    f.scrape.mockImplementationOnce(async () => {
      await wait;
      return [{ url }];
    });
    const first = f.collector.start(f.input);
    await new Promise((r) => setTimeout(r, 20));
    await expect(
      f.collector.start({ ...f.input, requestId: 'concurrent' }),
    ).rejects.toThrow('BUSY');
    release();
    await first;
  });
});
