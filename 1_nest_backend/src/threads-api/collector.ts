import { randomUUID } from 'crypto';
import { DataEngine } from '../data-engine/engine';
import type { DataRun, DataState } from '../data-engine/contracts';
import { hash } from '../data-engine/rules';
import { ThreadsAuth } from './auth';
import { ThreadsStore } from './local-store';
import { ThreadsApiError, type ApiHooks } from './provider';
import { pilotInput, type PilotInput } from './config';
import { apiInput, pageCursor } from './adapter';
import { inspectSearchPage } from '../data-engine/discovery-diagnostics';
export interface CollectorRun {
  searchDiagnostics?:Array<{pageId:string;queryIndex:number;assessment:ReturnType<typeof inspectSearchPage>}>;
  schemaVersion: 'threads-collector/1';
  execution: 'LIVE' | 'MOCK';
  id: string;
  input: PilotInput;
  status: string;
  stage: string;
  startedAt: string;
  completedAt: string | null;
  deadlineAt: number;
  queryIndex: number;
  counts: number[];
  cursor: string | null;
  seenCursors: string[];
  pages: string[];
  inFlight: string | null;
  attempts: Record<string, number>;
  requestAttempts: number;
  responsesReceived: number;
  newPosts: number;
  sourceDuplicates: number;
  returned: number;
  imported: number;
  dataStates: Record<string, number>;
  reviewReasons: Record<string, number>;
  items: {
    postId: string;
    sourceUrl: string | null;
    author: string | null;
    state: DataState;
    score: number | null;
    reasons: string[];
  }[];
  errors: string[];
  warnings: string[];
  cooldownUntil: number;
  metrics: {
    elapsedMs: number;
    observedPeakProcessRssBytes: number;
    cpuUserMicros: number;
    cpuSystemMicros: number;
    storedPageBytes: number;
  };
}
interface SavedPage {
  id: string;
  queryIndex: number;
  query: string;
  fetchedAt: string;
  response: any;
  nextCursor: string | null;
  importRunId: string | null;
  imported: boolean;
}
export class ThreadsCollector {
  private active = false;
  constructor(
    readonly data: DataEngine,
    readonly auth: ThreadsAuth,
    readonly store: ThreadsStore = auth.store,
    private now = () => Date.now(),
    private sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms)),
    private execution: 'LIVE' | 'MOCK' = 'LIVE',
  ) {}
  isActive() {
    return this.active;
  }
  private async exclusive<T>(fn: () => Promise<T>) {
    if (this.active) throw Error('COLLECTOR_BUSY: concurrency is one');
    this.active = true;
    try {
      return await fn();
    } finally {
      this.active = false;
    }
  }
  private save(r: CollectorRun) {
    r.metrics.elapsedMs = this.now() - Date.parse(r.startedAt);
    r.metrics.observedPeakProcessRssBytes = Math.max(
      r.metrics.observedPeakProcessRssBytes,
      process.memoryUsage().rss,
    );
    return this.store.write('runs/' + r.id + '.json', r);
  }
  async list() {
    return (await this.store.rows<CollectorRun>('runs')).sort((a, b) =>
      b.startedAt.localeCompare(a.startedAt),
    );
  }
  async get(id: string) {
    if (!/^[a-f0-9-]{36}$/.test(id)) throw Error('Invalid run ID');
    const r = await this.store.read<CollectorRun>('runs/' + id + '.json');
    if (!r) throw Error('Unknown collector run');
    return r;
  }
  async start(body: any) {
    return this.exclusive(async () => {
      const input = pilotInput(body);
      await this.auth.assertQueries(input.keywords);
      const all = await this.list(),
        old = all.find((r) => r.input.requestId === input.requestId);
      if (old) {
        if (hash(old.input) !== hash(input))
          throw Error('IDEMPOTENCY_CONFLICT');
        return old;
      }
      if (
        all.some(
          (r) =>
            r.status === 'RUNNING' ||
            ([
              'FAILED',
              'RATE_LIMITED',
              'BLOCKED_AUTH',
              'BLOCKED_PERMISSION',
            ].includes(r.status) &&
              r.inFlight),
        )
      )
        throw Error(
          'RECOVERY_REQUIRED: resume/finish the existing captured-page run first',
        );
      const now = this.now(),
        r: CollectorRun = {
          schemaVersion: 'threads-collector/1',
          execution: this.execution,
          id: randomUUID(),
          input,
          status: 'RUNNING',
          stage: 'AUTH_PREFLIGHT',
          startedAt: new Date(now).toISOString(),
          completedAt: null,
          deadlineAt: now + input.maxRunMs,
          queryIndex: 0,
          counts: input.keywords.map(() => 0),
          cursor: null,
          seenCursors: [],
          pages: [],
          inFlight: null,
          attempts: {},
          requestAttempts: 0,
          responsesReceived: 0,
          newPosts: 0,
          sourceDuplicates: 0,
          returned: 0,
          imported: 0,
          dataStates: {},
          reviewReasons: {},
          items: [],
          errors: [],
          warnings: [
            'Heuristic scores are not measured quality; public search coverage/App Review is not inferred from granted scopes.',
          ],
          cooldownUntil: 0,
          metrics: {
            elapsedMs: 0,
            observedPeakProcessRssBytes: 0,
            cpuUserMicros: 0,
            cpuSystemMicros: 0,
            storedPageBytes: 0,
          },
        };
      await this.save(r);
      return this.execute(r);
    });
  }
  async resume(id: string) {
    return this.exclusive(async () => {
      const r = await this.get(id);
      if (r.status === 'COMPLETED') return r;
      if (r.cooldownUntil > this.now()) throw Error('COOLDOWN_ACTIVE');
      return this.execute(r);
    });
  }
  private hooks(r: CollectorRun, pageId?: string): ApiHooks {
    return {
      timeoutMs: Math.max(1, Math.min(15000, r.deadlineAt - this.now())),
      remainingMs: () => r.deadlineAt - this.now(),
      before: async () => {
        if (
          this.now() >= r.deadlineAt ||
          r.requestAttempts >= r.input.maxRequests
        )
          throw Error('BUDGET_EXHAUSTED');
        if (pageId && (r.attempts[pageId] || 0) >= 3)
          throw Error('RETRY_BUDGET_EXHAUSTED');
        r.requestAttempts++;
        if (pageId) r.attempts[pageId] = (r.attempts[pageId] || 0) + 1;
        await this.save(r);
      },
      after: async () => {
        r.responsesReceived++;
        await this.save(r);
      },
    };
  }
  private async importPage(r: CollectorRun, p: SavedPage, resuming: boolean) {
    if (p.imported) return;
    r.stage = 'DATA01_IMPORT';
    await this.save(r);
    const inputs = p.response.data.map((row) =>
      apiInput(row, p.query, p.fetchedAt, r.id, r.execution === 'MOCK'),
    );
    if (!inputs.length) {
      p.imported = true;
      await this.store.write('pages/' + p.id + '.json', p);
      return;
    }
    let result: Omit<DataRun, 'inputs'> & { inputCount: number };
    if (p.importRunId) result = await this.data.resume(p.importRunId);
    else result = await this.data.import(inputs, p.fetchedAt);
    p.importRunId = result.id;
    await this.store.write('pages/' + p.id + '.json', p);
    if (result.status === 'FAILED' && resuming)
      result = await this.data.resume(result.id);
    if (result.status !== 'COMPLETED')
      throw Error('DATA01_IMPORT_FAILED: resume the saved import checkpoint');
    // The page marker is committed after DATA-01. Replaying the same dataset never
    // recreates posts; summary is reconstructed from saved DataRun results below.
    p.imported = true;
    await this.store.write('pages/' + p.id + '.json', p);
  }
  private async reconcile(r: CollectorRun) {
    r.returned = 0;
    r.imported = 0;
    r.newPosts = 0;
    r.sourceDuplicates = 0;
    r.dataStates = {};
    r.reviewReasons = {};
    r.items = [];
    r.metrics.storedPageBytes = 0;
    r.counts = r.input.keywords.map(() => 0);
    for (const id of r.pages) {
      const p = (await this.store.read<SavedPage>('pages/' + id + '.json'))!;
      r.returned += p.response.data.length;
      r.metrics.storedPageBytes += Buffer.byteLength(JSON.stringify(p));
      if (!p.imported) continue;
      r.counts[p.queryIndex] += p.response.data.length;
      r.imported += p.response.data.length;
      if (p.importRunId) {
        const dr = await this.data.store.read<DataRun>(
          'runs/' + p.importRunId + '.json',
        );
        for (const result of dr?.results || []) {
          if (result.newPost) r.newPosts++;
          else r.sourceDuplicates++;
          const e = await this.data.history(
            result.postId,
            hash({ bronzeId: result.bronzeId, configHash: dr!.configHash }),
          );
          const state = e?.state || result.state;
          r.dataStates[state] = (r.dataStates[state] || 0) + 1;
          for (const reason of [
            ...(e?.silver?.quarantineReasons || []),
            ...(e?.gold?.reasons || []),
          ])
            r.reviewReasons[reason] = (r.reviewReasons[reason] || 0) + 1;

          const bronze = (await this.data.observation(
            result.postId,
            result.bronzeId,
          ))!;
          r.items.push({
            postId: result.postId,
            sourceUrl: bronze.sourceUrl,
            author: bronze.author.handle,
            state,
            score: e?.gold?.score ?? null,
            reasons: [
              ...(e?.silver?.quarantineReasons || []),
              ...(e?.gold?.reasons || []),
            ],
          });
        }
      }
    }
  }
  private async execute(r: CollectorRun) {
    const cpu = process.cpuUsage();
    r.status = 'RUNNING';
    r.completedAt = null;
    r.errors = [];
    await this.save(r);
    try {
      // A page saved before a crash is imported offline before any new API call.
      if (r.inFlight) {
        const p = await this.store.read<SavedPage>(
          'pages/' + r.inFlight + '.json',
        );
        if (p) {
          if (!r.pages.includes(p.id)) r.pages.push(p.id);
          await this.importPage(r, p, true);
          await this.reconcile(r);
          r.cursor = p.nextCursor;
          r.queryIndex = p.queryIndex;
          if (!r.cursor || r.counts[r.queryIndex] >= r.input.perKeyword) {
            r.queryIndex++;
            r.cursor = null;
            r.seenCursors = [];
          }
          r.inFlight = null;
          await this.save(r);
        }
      }
      let token: string | null = null;
      while (r.queryIndex < r.input.keywords.length) {
        if (
          this.now() >= r.deadlineAt ||
          r.requestAttempts >= r.input.maxRequests
        )
          throw Error('BUDGET_EXHAUSTED');
        if (!token) {
          r.stage = 'VERIFY_TOKEN';
          await this.save(r);
          token = await this.auth.context(this.hooks(r));
        }
        const qi = r.queryIndex,
          pageId =
            r.inFlight || hash({ run: r.id, query: qi, cursor: r.cursor });
        r.inFlight = pageId;
        r.stage = 'KEYWORD_SEARCH';
        await this.save(r);
        let response: any;
        for (;;) {
          try {
            response = await this.auth.provider.search(
              token,
              r.input.keywords[qi],
              r.input.searchType,
              r.input.perKeyword - r.counts[qi],
              r.cursor,
              this.hooks(r, pageId),
            );
            break;
          } catch (e) {
            if (
              !(e instanceof ThreadsApiError) ||
              e.kind !== 'TRANSIENT' ||
              (r.attempts[pageId] || 0) >= 3
            )
              throw e;
            const wait = Math.min(
              4000,
              500 * 2 ** ((r.attempts[pageId] || 1) - 1),
            );
            if (this.now() + wait >= r.deadlineAt)
              throw Error('BUDGET_EXHAUSTED');
            await this.sleep(wait);
          }
        }
        if (
          !Array.isArray(response?.data) ||
          response.data.length > r.input.perKeyword - r.counts[qi]
        )
          throw Error('INVALID_RESPONSE: API result limit was not honored');
        const clean = this.auth.preparePage(response, token),
          next = pageCursor(clean);
        const assessment=inspectSearchPage(clean);
        r.searchDiagnostics??=[];
        if(!r.searchDiagnostics.some(d=>d.pageId===pageId))r.searchDiagnostics.push({pageId,queryIndex:qi,assessment});
        if(!clean.data.length&&!r.warnings.includes('ACCESS_EMPTY: empty API response; public scope and cause remain UNKNOWN'))r.warnings.push('ACCESS_EMPTY: empty API response; public scope and cause remain UNKNOWN');
        if (next && (next === r.cursor || r.seenCursors.includes(next)))
          throw Error('INVALID_RESPONSE: pagination cursor loop');
        const p: SavedPage = {
          id: pageId,
          queryIndex: qi,
          query: r.input.keywords[qi],
          fetchedAt: new Date(this.now()).toISOString(),
          response: clean,
          nextCursor: clean.data.length ? next : null,
          importRunId: null,
          imported: false,
        };
        await this.store.write('pages/' + pageId + '.json', p);
        if (!r.pages.includes(pageId)) r.pages.push(pageId);
        await this.save(r);
        await this.importPage(r, p, false);
        await this.reconcile(r);
        if (r.cursor) r.seenCursors.push(r.cursor);
        r.cursor = p.nextCursor;
        r.inFlight = null;
        if (!r.cursor || r.counts[qi] >= r.input.perKeyword) {
          r.queryIndex++;
          r.cursor = null;
          r.seenCursors = [];
        }
        await this.save(r);
      }
      r.status = 'COMPLETED';
      r.stage = 'WAITING_MANUAL_REVIEW';
      r.completedAt = new Date(this.now()).toISOString();
    } catch (e) {
      const message =
        e instanceof ThreadsApiError
          ? e.message
          : /^(BUDGET_|RETRY_|DATA01_|INVALID_RESPONSE)/.test(
                (e as Error).message,
              )
            ? (e as Error).message
            : 'COLLECTOR_FAILED: inspect saved checkpoint; no raw authentication diagnostics exposed';
      r.errors = [message];
      r.status =
        e instanceof ThreadsApiError
          ? e.kind
          : message.includes('BUDGET')
            ? 'BUDGET_EXHAUSTED'
            : 'FAILED';
      if (e instanceof ThreadsApiError && e.kind === 'RATE_LIMITED')
        r.cooldownUntil = this.now() + Math.max(3600000, e.retryAfterMs);
      r.stage = 'STOPPED';
      await this.reconcile(r);
    }
    const used = process.cpuUsage(cpu);
    r.metrics.cpuUserMicros += used.user;
    r.metrics.cpuSystemMicros += used.system;
    await this.save(r);
    return r;
  }
}
