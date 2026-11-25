export const RENDER_BUDGET_MS = 45 * 60_000;
export const RENDER_STALL_MS = 120_000;
export type RenderFailure = 'USER_CANCELLED' | 'RENDER_TIMEOUT' | 'RENDER_STALLED'
  | 'RESOURCE_BLOCKED' | 'RENDER_WORKER_CRASH' | 'RENDER_FAILED';

export class RenderProgress {
  private frames = 0;
  private frameStartedAt: number | null = null;
  private lastFrameAt: number | null = null;
  private workerAt: number | null = null;
  private samples: {at:number; frames:number}[] = [];
  private resource: Record<string, number> | null = null;
  constructor(private startedAt: number, private total: number) {}

  update(now: number, event: {step?: string; completed?: number; resource?: Record<string,number>}) {
    this.workerAt = now;
    if (event.resource) this.resource = event.resource;
    if (event.step === 'Rendering frames' && this.frameStartedAt === null) {
      this.frameStartedAt = now;
      this.samples = [{at: now, frames: 0}];
    }
    const completed = event.completed;
    if (this.frameStartedAt !== null && typeof completed === 'number' &&
        Number.isSafeInteger(completed) && completed > this.frames && completed <= this.total) {
      this.frames = completed;
      this.lastFrameAt = now;
      this.samples.push({at:now,frames:completed});
      while (this.samples.length > 2 && now - this.samples[1].at > 30_000) this.samples.shift();
    }
  }

  stalled(now: number) {
    return this.frameStartedAt !== null && this.frames < this.total &&
      now - (this.lastFrameAt ?? this.frameStartedAt) >= RENDER_STALL_MS;
  }

  view(now: number) {
    const first = this.samples[0], last = this.samples[this.samples.length - 1];
    const elapsed = this.frameStartedAt === null ? 0 : (this.lastFrameAt ?? now) - this.frameStartedAt;
    const avg = elapsed > 0 && this.frames ? this.frames * 1000 / elapsed : null;
    const rolling = last && first && last.at > first.at && now - last.at < 30_000
      ? (last.frames - first.frames) * 1000 / (last.at - first.at) : null;
    return {
      renderedFrames: this.frames, totalFrames: this.total,
      percent: this.total ? this.frames * 100 / this.total : 0,
      averageFps: avg, rollingFps: rolling,
      lastFrameAt: this.lastFrameAt === null ? null : new Date(this.lastFrameAt).toISOString(),
      lastWorkerAt: this.workerAt === null ? null : new Date(this.workerAt).toISOString(),
      estimatedRemainingMs: rolling ? Math.round((this.total - this.frames) * 1000 / rolling) : null,
      remainingBudgetMs: Math.max(0, this.startedAt + RENDER_BUDGET_MS - now),
      resource: this.resource,
    };
  }
}
