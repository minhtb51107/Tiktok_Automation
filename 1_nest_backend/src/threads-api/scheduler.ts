import { randomUUID } from 'crypto';
import { ThreadsCollector } from './collector';
import { DEFAULT_PILOT, pilotInput } from './config';
import { ThreadsStore } from './local-store';
export interface DiscoveryPolicy {
  enabled: boolean;
  paused: boolean;
  intervalMs: number;
  minimumInventory: number;
  reviewBacklogLimit: number;
  keywords: string[];
  searchType: 'TOP' | 'RECENT';
  perKeyword: number;
  maxRequests: number;
  maxRunMs: number;
  nextCheckAt: number;
  lastRunId: string | null;
  blockedReason: string | null;
}
export class DiscoveryScheduler {
  private pending = false;
  constructor(
    readonly collector: ThreadsCollector,
    readonly store: ThreadsStore = collector.store,
    private now = () => Date.now(),
  ) {}
  async status(): Promise<DiscoveryPolicy> {
    return (
      (await this.store.read<DiscoveryPolicy>('scheduler.json')) || {
        ...DEFAULT_PILOT,
        enabled: false,
        paused: true,
        intervalMs: 6 * 3600000,
        minimumInventory: 10,
        reviewBacklogLimit: 20,
        nextCheckAt: 0,
        lastRunId: null,
        blockedReason: null,
      }
    );
  }
  private async audit(decision: string, detail: string) {
    await this.store.write('audit/' + randomUUID() + '.json', {
      at: new Date(this.now()).toISOString(),
      decision,
      detail,
    });
  }
  async configure(body: any) {
    if (this.pending) throw Error('SCHEDULER_BUSY');
    this.pending = true;
    try {
      const p = await this.status(),
        candidate = { ...p, ...body };
      pilotInput({ ...candidate, requestId: 'scheduler-validation' });
      if (
        typeof candidate.enabled !== 'boolean' ||
        typeof candidate.paused !== 'boolean' ||
        !Number.isInteger(candidate.intervalMs) ||
        candidate.intervalMs < 6 * 3600000 ||
        candidate.intervalMs > 7 * 86400000 ||
        !Number.isInteger(candidate.minimumInventory) ||
        candidate.minimumInventory < 1 ||
        candidate.minimumInventory > 1000 ||
        !Number.isInteger(candidate.reviewBacklogLimit) ||
        candidate.reviewBacklogLimit < 1 ||
        candidate.reviewBacklogLimit > 1000
      )
        throw Error('Invalid scheduler policy');
      const allowed = [
        'enabled',
        'paused',
        'intervalMs',
        'minimumInventory',
        'reviewBacklogLimit',
        'keywords',
        'searchType',
        'perKeyword',
        'maxRequests',
        'maxRunMs',
      ];
      for (const k of Object.keys(body))
        if (!allowed.includes(k)) throw Error('Unknown scheduler setting');
      await this.store.write('scheduler.json', candidate);
      await this.audit('CONFIGURED', 'No timer was installed or started');
      return candidate;
    } finally {
      this.pending = false;
    }
  }
  async pause() {
    return this.configure({ paused: true });
  }
  async resume() {
    return this.configure({ paused: false });
  }
  async tick() {
    if (this.pending || this.collector.isActive()) return { decision: 'BUSY' };
    this.pending = true;
    try {
      const p = await this.status();
      let reason: string | null = !p.enabled
        ? 'DISABLED'
        : p.paused
          ? 'PAUSED'
          : p.nextCheckAt > this.now()
            ? 'NOT_DUE'
            : null;
      if (p.blockedReason?.startsWith('BLOCKED_')) reason = p.blockedReason;
      const c = await this.collector.data.catalog(),
        inventory = (c.counts.QUALIFIED || 0) + (c.counts.QUEUED || 0),
        review = c.counts.SCORED || 0;
      if (!reason && inventory >= p.minimumInventory)
        reason = 'INVENTORY_SUFFICIENT';
      if (!reason && review >= p.reviewBacklogLimit)
        reason = 'MANUAL_REVIEW_BACKLOG';
      if (reason) {
        await this.audit('SKIPPED', reason);
        return { decision: reason, inventory, reviewBacklog: review };
      }
      // Reserve the entire cycle before dispatch; crashes cannot trigger an immediate second cycle.
      p.nextCheckAt = this.now() + p.intervalMs;
      await this.store.write('scheduler.json', p);
      const run = await this.collector.start({ ...p, requestId: randomUUID() });
      p.lastRunId = run.id;
      if (['BLOCKED_AUTH', 'BLOCKED_PERMISSION'].includes(run.status))
        p.blockedReason = run.status;
      if (run.status === 'RATE_LIMITED')
        p.nextCheckAt = Math.max(p.nextCheckAt, run.cooldownUntil);
      const qualified =
        (run.dataStates.QUALIFIED || 0) + (run.dataStates.QUEUED || 0);
      if (run.imported >= 5 && qualified === 0) {
        p.nextCheckAt = Math.max(p.nextCheckAt, this.now() + p.intervalMs * 2);
        p.blockedReason = 'LOW_QUALIFICATION_YIELD_REVIEW_REQUIRED';
      }
      await this.store.write('scheduler.json', p);
      await this.audit('CYCLE_FINISHED', run.status);
      return {
        decision: 'TRIGGERED',
        runId: run.id,
        status: run.status,
        nextCheckAt: p.nextCheckAt,
      };
    } catch (e) {
      await this.audit('CYCLE_FAILED', 'Safe stop; inspect collector status');
      throw e;
    } finally {
      this.pending = false;
    }
  }
  async acknowledgeBlock() {
    if (this.pending) throw Error('SCHEDULER_BUSY');
    const p = await this.status();
    p.blockedReason = null;
    await this.store.write('scheduler.json', p);
    await this.audit(
      'BLOCK_ACKNOWLEDGED',
      'Manual acknowledgement; token verification still required before search',
    );
    return p;
  }
}
