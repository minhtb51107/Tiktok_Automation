import { DATA_SCHEMA, type DataRun } from './contracts';
import { DataEngine } from './engine';
import { hash } from './rules';
import { ScraperService } from '../modules/core/scraper/scraper.service';
import { discoveryUrl } from '../modules/core/scraper/public-discovery';
import {
  extractPublicThreads,
  threadsUrl,
  type SourceAttempt,
} from '../studio/public-threads';
import { crawlerInput } from './crawler-adapter';
import { GoldShadowEngine } from './gold-shadow';
import { DISCOVERY_TOPICS, topic } from './gold-v2';
import type { CrawlerRequest, CrawlerRun } from "./discovery-contracts";
export type { CrawlerRequest,CrawlerRun } from "./discovery-contracts";
export function crawlerRequest(b: any): CrawlerRequest {
  if (
    !b ||
    !['SEARCH', 'FEED', 'URLS'].includes(b.mode) ||
    typeof b.requestId !== 'string' ||
    !/^[A-Za-z0-9-]{1,100}$/.test(b.requestId)
  )
    throw Error('CRAWLER_INVALID_REQUEST');
  if(b.limit !== undefined && (!Number.isInteger(b.limit)||b.limit<1||b.limit>2))throw Error('CRAWLER_INVALID_LIMIT');
  const selected=topic(b.topic), options={...(b.limit!==undefined?{limit:b.limit}:{}),...(b.topic!==undefined?{topic:selected}:{})};
  if (b.mode === 'SEARCH') {
    const keyword=b.keyword ?? (selected!=='ALL'?DISCOVERY_TOPICS[selected].keyword:undefined);
    discoveryUrl('SEARCH', keyword);
    return {
      mode: 'SEARCH',
      keyword: keyword.trim(),
      requestId: b.requestId,
      ...options,
    };
  }
  if (b.mode === 'FEED') return { mode: 'FEED', requestId: b.requestId, ...options };
  if (!Array.isArray(b.urls) || !b.urls.length || b.urls.length > 2)
    throw Error('CRAWLER_INVALID_URLS');
  const urls = [
    ...new Set<string>(
      b.urls.map((v: unknown) => {
        const x = threadsUrl(v),
          u = new URL(x);
        if (
          [...u.searchParams.keys()].some((k) =>
            /token|secret|code|state|auth|cookie/i.test(k),
          )
        )
          throw Error('CRAWLER_CREDENTIAL_URL_REJECTED');
        return x;
      }),
    ),
  ];
  if(b.limit!==undefined && urls.length>b.limit)throw Error('CRAWLER_URL_LIMIT_MISMATCH');
  return { mode: 'URLS', urls, requestId: b.requestId,...options };
}
/** Explicit bounded run. No imports of Hunter/Prisma/AI/Discord or active timers. */
export class PublicCrawlerConsumer {
  private busy = false;
  constructor(
    readonly data: DataEngine,
    private scraper: Pick<ScraperService, 'scrapeForYouFeed'>,
    private extract: typeof extractPublicThreads = extractPublicThreads,
    private execution: 'LIVE' | 'MOCK' = 'LIVE',
  ) {}
  private key(id: string) {
    if (!/^[a-f0-9]{64}$/.test(id)) throw Error('CRAWLER_INVALID_RUN_ID');
    return 'crawler-runs/' + id + '.json';
  }
  private async save(r: CrawlerRun) {
    r.elapsedMs = Date.now() - Date.parse(r.startedAt);
    r.history.push({
      at: new Date().toISOString(),
      stage: r.stage,
      status: r.status,
    });
    await this.data.store.write(this.key(r.id), r);
  }
  async get(id: string) {
    const r = await this.data.store.read<CrawlerRun>(this.key(id));
    if (!r || r.crawlerVersion !== 'legacy-public-crawler/1')
      throw Error('CRAWLER_UNKNOWN_RUN');
    return r;
  }
  async list() {
    const rows: any[] = [];
    for await (const r of this.data.store.rows<CrawlerRun>('crawler-runs'))
      rows.push({
        id: r.id,
        input: r.input,
        status: r.status,
        stage: r.stage,
        startedAt: r.startedAt,
        elapsedMs: r.elapsedMs,
        captured: r.captures.length,
        error: r.error,
      });
    return rows;
  }
  private async exclusive<T>(fn: () => Promise<T>) {
    if (this.busy) throw Error('CRAWLER_BUSY');
    this.busy = true;
    try {
      return await fn();
    } finally {
      this.busy = false;
    }
  }
  async start(body: any) {
    return this.exclusive(async () => {
      const input = crawlerRequest(body),
        id = hash({ requestId: input.requestId }),
        old = await this.data.store.read<CrawlerRun>(this.key(id));
      if (old) {
        if (hash(old.input) !== hash(input))
          throw Error('CRAWLER_IDEMPOTENCY_CONFLICT');
        return old;
      }
      const r: CrawlerRun = {
        execution: this.execution,
        schemaVersion: DATA_SCHEMA,
        crawlerVersion: 'legacy-public-crawler/1',
        id,
        input,
        status: 'RUNNING',
        stage: 'DISCOVERY',
        startedAt: new Date().toISOString(),
        completedAt: null,
        elapsedMs: 0,
        urls: input.mode === 'URLS' ? input.urls! : null,
        cursor: 0,
        captures: [],
        error: null,
        warnings: [],
        history: [],
      };
      await this.save(r);
      return this.execute(r);
    });
  }
  async resume(id: string) {
    return this.exclusive(async () => {
      const r = await this.get(id);
      if (r.status === 'COMPLETED' || r.status === 'BLOCKED_ACCESS') return r;
      return this.execute(r);
    });
  }
  private async execute(r: CrawlerRun) {
    const executionStartedAt = Date.now();
    r.status = 'RUNNING';
    r.error = null;
    try {
      if (!r.urls) {
        r.stage = 'DISCOVERY';
        await this.save(r);
        const rows = await this.scraper.scrapeForYouFeed(1, {
          url: discoveryUrl(r.input.mode as 'SEARCH' | 'FEED', r.input.keyword),
          limit: r.input.limit ?? 2,
          timeoutMs: 20000,
        });
        r.urls = [...new Set<string>(rows.map((x) => threadsUrl(x.url)))].slice(
          0,
          r.input.limit ?? 2,
        );
        await this.save(r);
      }
      while (r.cursor < r.urls.length) {
        let capture = r.captures[r.cursor];
        if (!capture) {
          if (Date.now() - executionStartedAt > 180000)
            throw Error('CRAWLER_TIME_BUDGET_EXHAUSTED');
          r.stage = 'EXACT_TARGET';
          await this.save(r);
          const attempt = await this.extract(r.urls[r.cursor], 'TARGET_ONLY');
          capture = {
            url: r.urls[r.cursor],
            attempt,
            input: crawlerInput(attempt, r.id, r.execution === 'MOCK'),
            importRunId: null,
            done: false,
            captureHash: '',
          };
          capture.captureHash = hash({
            url: capture.url,
            attempt: capture.attempt,
            input: capture.input,
          });
          r.captures[r.cursor] = capture;
          await this.save(r);
        }
        if (!capture.done) {
          if (
            capture.attempt.diagnostics.some((d) =>
              /requires login|protection encountered|captcha|challenge/i.test(
                d.message,
              ),
            )
          )
            throw Error('CRAWLER_ACCESS_BLOCKED');
          if (
            capture.captureHash !==
            hash({
              url: capture.url,
              attempt: capture.attempt,
              input: capture.input,
            })
          )
            throw Error('CRAWLER_CHECKPOINT_INTEGRITY');
          if (capture.input) {
            r.stage = 'DATA01_IMPORT';
            await this.save(r);
            let imported: Omit<DataRun, 'inputs'> & { inputCount: number };
            imported = capture.importRunId
              ? await this.data.resume(capture.importRunId)
              : await this.data.import(
                  [capture.input],
                  capture.attempt.retrievedAt,
                );
            capture.importRunId = imported.id;
            await this.save(r);
            if (imported.status !== 'COMPLETED')
              throw Error('CRAWLER_IMPORT_FAILED');
            r.stage='GOLD_SHADOW';
            await this.save(r);
            capture.shadowIds=(await new GoldShadowEngine(this.data).evaluateImport(imported.id,r.input.topic)).map(s=>s.id);
            await this.save(r);
          } else {
            r.warnings.push('UNRESOLVED_EXACT_TARGET: ' + capture.url);
            if (
              capture.attempt.diagnostics.some((d) =>
                /requires login|protection encountered|captcha|challenge/i.test(
                  d.message,
                ),
              )
            )
              throw Error('CRAWLER_ACCESS_BLOCKED');
          }
          capture.done = true;
          await this.save(r);
        }
        r.cursor++;
        await this.save(r);
      }
      r.status = 'COMPLETED';
      r.stage = 'WAITING_HUMAN_REVIEW';
      r.completedAt = new Date().toISOString();
    } catch (e: any) {
      const code = /^CRAWLER_[A-Z0-9_]+$/.test(e.message || '')
        ? e.message
        : 'CRAWLER_FAILED';
      r.error = code;
      r.status = /ACCESS_BLOCKED|HTTP_(401|403|429)(?:$|_)/.test(code)
        ? 'BLOCKED_ACCESS'
        : 'FAILED';
      r.stage = 'STOPPED';
    }
    await this.save(r);
    return r;
  }
  async report(id: string) {
    const r = await this.get(id);
    let imported = 0,
      newPosts = 0,
      duplicates = 0,
      silver = 0,
      gold = 0,
      quarantine = 0;
    const states: Record<string, number> = {},
      reasons: Record<string, number> = {};
    const shadow = new GoldShadowEngine(this.data), comparisons:any[]=[], buckets:Record<string,number>={};
    for (const c of r.captures) {
      for(const id of c.shadowIds||[]) {
        const s=await shadow.get(id); comparisons.push(s);
        buckets[s.result.bucket]=(buckets[s.result.bucket]||0)+1;
      }
      if (!c.importRunId) continue;
      const run = await this.data.store.read<DataRun>(
        'runs/' + c.importRunId + '.json',
      );
      for (const result of run?.results || []) {
        imported++;
        if (result.newPost) newPosts++;
        else duplicates++;
        const e = await this.data.history(
          result.postId,
          hash({ bronzeId: result.bronzeId, configHash: run!.configHash }),
        );
        if (e?.silver) silver++;
        if (e?.gold) gold++;
        if (e?.state === 'QUARANTINED') quarantine++;
        const state = e?.state || result.state;
        states[state] = (states[state] || 0) + 1;
        for (const reason of [
          ...(e?.silver?.quarantineReasons || []),
          ...(e?.gold?.reasons || []),
        ])
          reasons[reason] = (reasons[reason] || 0) + 1;
      }
    }
    return {
      execution: r.execution,
      id: r.id,
      status: r.status,
      stage: r.stage,
      input: r.input,
      discovered: r.urls?.length || 0,
      captured: r.captures.length,
      matched: r.captures.filter((c) => c.input).length,
      unresolved: r.captures.filter((c) => !c.input).length,
      bronze: imported,
      silver,
      gold,
      quarantine,
      newPosts,
      duplicates,
      errors: r.captures.filter(c=>!c.input).length + (r.error?1:0),
      quality: {buckets,comparisons,mode:'SHADOW',automaticAcceptance:false},
      states,
      reasons,
      elapsedMs: r.elapsedMs,
      warnings: r.warnings,
      error: r.error,
      rightsStatus: 'UNKNOWN',
      publishingAllowed: false,
      scheduled: false,
    };
  }
}
