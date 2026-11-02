import { promises as fs } from 'fs';
import * as path from 'path';
import { createHash, randomUUID } from 'crypto';
import { BadRequestException } from '@nestjs/common';
import { replaceFile } from './atomic-file';
export type ProgressStatus =
  | 'QUEUED'
  | 'RUNNING'
  | 'WAITING_REVIEW'
  | 'SUCCEEDED'
  | 'FAILED'
  | 'CANCELLED';
export interface StudioJob {
  jobId: string;
  sessionId: string;
  operation: string;
  requestKey: string;
  status: ProgressStatus;
  currentStage: string;
  currentStep: string;
  completed: number | null;
  total: number | null;
  queuedAt: string;
  startedAt: string | null;
  completedAt: string | null;
  elapsedMs: number;
  etaMs: null;
  error: string | null;
  warnings: string[];
  cancelRequested: boolean;
  revision: number | null;
  events: {
    at: string;
    step: string;
    completed: number | null;
    total: number | null;
  }[];
}
export type ProgressSink = (
  step: string,
  completed?: number,
  total?: number,
) => Promise<void>;
const active = (j: StudioJob) => ['QUEUED', 'RUNNING'].includes(j.status);
export class JobCancelled extends Error {}
export class StudioJobs {
  private queue: Promise<unknown> = Promise.resolve();
  private writing: Promise<unknown> = Promise.resolve();
  private live = new Map<string, StudioJob>();
  constructor(private root = path.resolve('.studio-data/jobs')) {}
  private file(id: string) {
    if (!/^[a-f0-9-]{36}$/.test(id))
      throw new BadRequestException('Invalid job ID');
    return path.join(this.root, id + '.json');
  }
  private save(j: StudioJob) {
    const snapshot = JSON.stringify(j, null, 2);
    const write = this.writing
      .catch(() => {})
      .then(async () => {
        await fs.mkdir(this.root, { recursive: true });
        await fs.writeFile(this.file(j.jobId) + '.tmp', snapshot);
        await replaceFile(this.file(j.jobId) + '.tmp', this.file(j.jobId));
      });
    this.writing = write;
    return write;
  }
  async load(id: string) {
    if (this.live.has(id)) return this.live.get(id)!;
    const j: StudioJob = JSON.parse(await fs.readFile(this.file(id), 'utf8'));
    if (active(j)) {
      j.status = 'FAILED';
      j.error =
        'Backend restarted before completion. Not automatically retried.';
      j.completedAt = new Date().toISOString();
      await this.save(j);
    }
    return j;
  }
  async list(sessionId: string) {
    if (!/^[a-f0-9-]{36}$/.test(sessionId))
      throw new BadRequestException('Invalid session ID');
    const rows: StudioJob[] = [];
    for (const f of await fs.readdir(this.root).catch(() => []))
      if (/^[a-f0-9-]{36}\.json$/.test(f)) {
        const j = await this.load(f.slice(0, -5));
        if (j.sessionId === sessionId) rows.push(j);
      }
    return rows
      .sort((a, b) => b.queuedAt.localeCompare(a.queuedAt))
      .slice(0, 50);
  }
  async submit(
    sessionId: string,
    operation: string,
    input: unknown,
    run: (tick: ProgressSink) => Promise<{
      revision?: number;
      review?: boolean;
      error?: string;
      warnings?: string[];
    }>,
  ) {
    // Serialize admission too: double-clicks must not race the on-disk check.
    let release!: () => void;
    const before = this.writing;
    this.writing = new Promise<void>((r) => (release = r));
    let j: StudioJob;
    try {
      await before.catch(() => {});
      const requestKey = createHash('sha256')
        .update(JSON.stringify({ sessionId, operation, input }))
        .digest('hex');
      for (const f of await fs.readdir(this.root).catch(() => []))
        if (/^[a-f0-9-]{36}\.json$/.test(f)) {
          const old: StudioJob =
            this.live.get(f.slice(0, -5)) ||
            JSON.parse(await fs.readFile(path.join(this.root, f), 'utf8'));
          if (old.requestKey === requestKey) {
            release();
            return old;
          }
        }
      j = {
        jobId: randomUUID(),
        sessionId,
        operation,
        requestKey,
        status: 'QUEUED',
        currentStage:
          operation === 'fetch'
            ? 'SOURCE'
            : operation.startsWith('voice')
              ? 'VOICE'
              : operation.split('/')[0].toUpperCase(),
        currentStep: 'Queued',
        completed: null,
        total: null,
        queuedAt: new Date().toISOString(),
        startedAt: null,
        completedAt: null,
        elapsedMs: 0,
        etaMs: null,
        error: null,
        warnings: [],
        cancelRequested: false,
        revision: null,
        events: [],
      };
      await fs.mkdir(this.root, { recursive: true });
      await fs.writeFile(this.file(j.jobId), JSON.stringify(j, null, 2));
      this.live.set(j.jobId, j);
    } finally {
      release();
    }
    const execute = async () => {
      const started = Date.now();
      const tick: ProgressSink = async (step, completed, total) => {
        j.currentStep = step;
        j.elapsedMs = Date.now() - started;
        j.completed = completed ?? j.completed;
        j.total = total ?? j.total;
        j.events.push({
          at: new Date().toISOString(),
          step,
          completed: j.completed,
          total: j.total,
        });
        await this.save(j);
      };
      try {
        if (j.cancelRequested) throw new JobCancelled('Cancelled before start');
        j.status = 'RUNNING';
        j.startedAt = new Date().toISOString();
        await tick('Preparing');
        const out = await run(tick);
        j.revision = out.revision ?? null;
        j.warnings = out.warnings || [];
        if (j.cancelRequested)
          throw new JobCancelled(
            'Cancelled after the current atomic operation; saved artifacts retained',
          );
        j.error = out.error || null;
        j.status = out.error
          ? 'FAILED'
          : out.review
            ? 'WAITING_REVIEW'
            : 'SUCCEEDED';
        j.currentStep = out.error ? 'Failed' : 'Completed';
        if (!out.error) j.completed = j.total;
      } catch (e) {
        j.status = e instanceof JobCancelled ? 'CANCELLED' : 'FAILED';
        j.error =
          e instanceof JobCancelled
            ? null
            : 'Operation failed; review the persisted stage result. ' +
              (e instanceof Error
                ? e.message
                    .replace(/[A-Z]:[\\/][^\s]+/gi, '[local path]')
                    .slice(0, 300)
                : 'Unknown error');
        j.currentStep = j.status === 'CANCELLED' ? 'Cancelled' : 'Failed';
      } finally {
        j.completedAt = new Date().toISOString();
        j.elapsedMs = Date.now() - started;
        await this.save(j);
        this.live.delete(j.jobId);
      }
    };
    this.queue = this.queue.catch(() => {}).then(execute);
    return j;
  }
  async cancel(id: string) {
    const j = await this.load(id);
    if (active(j)) {
      j.cancelRequested = true;
      j.warnings.push(
        'Queued jobs stop before starting. A running operation/batch finishes safely, retaining artifacts, then becomes CANCELLED; no rollback or forced worker kill.',
      );
      await this.save(j);
    }
    return j;
  }
}
