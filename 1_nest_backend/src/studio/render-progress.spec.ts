import { describe, expect, it } from '@jest/globals';
import { operatorFailure } from './production-harness';
import { RenderProgress, RENDER_BUDGET_MS, RENDER_STALL_MS } from './render-progress';

describe('Render telemetry', () => {
  it('tracks frame throughput separately from worker samples and refuses to treat heartbeats as frame progress', () => {
    const p = new RenderProgress(0, 150);
    expect(p.stalled(RENDER_STALL_MS * 2)).toBe(false);
    p.update(1000, {step:'Rendering frames',completed:0});
    p.update(2000, {step:'Rendering frames',completed:4});
    p.update(3000, {step:'Rendering frames',completed:8});
    p.update(4000, {completed:7,resource:{freeRamKiB:500000}});
    expect(p.view(4000)).toMatchObject({renderedFrames:8,totalFrames:150,
      averageFps:4,rollingFps:4,estimatedRemainingMs:35500,
      lastFrameAt:new Date(3000).toISOString(),lastWorkerAt:new Date(4000).toISOString(),
      resource:{freeRamKiB:500000},remainingBudgetMs:RENDER_BUDGET_MS-4000});
    const late=3000+RENDER_STALL_MS;
    p.update(late,{completed:8,resource:{freeRamKiB:450000}});
    expect(p.stalled(late)).toBe(true);
    expect(p.view(late).estimatedRemainingMs).toBeNull();
    p.update(late+1,{completed:150});
    expect(p.stalled(late+RENDER_STALL_MS)).toBe(false);
    expect(p.view(late+1).percent).toBe(100);
  });

  it.each(['USER_CANCELLED','RENDER_TIMEOUT','RENDER_STALLED','RESOURCE_BLOCKED','RENDER_WORKER_CRASH','RENDER_FAILED'])(
    'preserves the explicit render decision %s in the Operator report', code => {
      expect(operatorFailure(code,'RENDERING',1)).toMatchObject({errorCode:code,failedStage:'RENDERING'});
    },
  );
});
