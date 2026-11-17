import { describe, expect, it } from '@jest/globals';
import { bgmVolumeAtFrame } from './bgm-volume';

const timeline = {
  fps: 30,
  scenes: [
    {
      startFrame: 0,
      endFrame: 90,
      audioStartFrame: 15,
      audioEndFrame: 75,
      scene: {
        visual: { voiceEnabled: true, voiceVolume: 1, bgmEnabled: true },
      },
    },
  ],
} as any;

describe('BGM narration ducking', () => {
  const bgm = {
    enabled: true,
    assetId: 'bgm',
    volume: 0.06,
    startMs: 0,
    ducking: true,
    duckVolume: 0.02,
  };

  it('ramps before and after voice instead of changing gain abruptly', () => {
    expect(bgmVolumeAtFrame(bgm, timeline, 9)).toBe(0.06);
    expect(bgmVolumeAtFrame(bgm, timeline, 12)).toBeGreaterThan(0.02);
    expect(bgmVolumeAtFrame(bgm, timeline, 12)).toBeLessThan(0.06);
    expect(bgmVolumeAtFrame(bgm, timeline, 15)).toBe(0.02);
    expect(bgmVolumeAtFrame(bgm, timeline, 74)).toBe(0.02);
    expect(bgmVolumeAtFrame(bgm, timeline, 75)).toBe(0.02);
    expect(bgmVolumeAtFrame(bgm, timeline, 78)).toBeGreaterThan(0.02);
    expect(bgmVolumeAtFrame(bgm, timeline, 80)).toBe(0.06);
  });

  it('respects disabled scene BGM and bypasses ducking when disabled globally', () => {
    const muted = structuredClone(timeline);
    muted.scenes[0].scene.visual.bgmEnabled = false;
    expect(bgmVolumeAtFrame(bgm, muted, 20)).toBe(0);
    expect(bgmVolumeAtFrame({ ...bgm, ducking: false }, timeline, 20)).toBe(
      0.06,
    );
  });
});
