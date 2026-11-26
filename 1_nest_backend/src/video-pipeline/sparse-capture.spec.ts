import { expect, it } from '@jest/globals';
import type { TimelineScene, VideoPreviewProps } from './contracts';
import { defaultSceneVisual } from './scene-visual';
import { planSparseCapture } from './sparse-capture';
import { threadsCardState } from './threads-card-state';

function fixture() {
  const scene = {
    startFrame: 0, endFrame: 90, durationInFrames: 90,
    contentStartFrame: 5, contentEndFrame: 85, subtitles: [],
    scene: {
      threadsCard: { avatarUrl: null }, mediaAssetIds: [],
      displayText: 'Nội dung giữ nguyên theo nguồn.\n'.repeat(60),
      visual: defaultSceneVisual(),
    },
  } as unknown as TimelineScene;
  scene.scene.visual!.card = { ...scene.scene.visual!.card, startMs: 200, durationMs: 2300 };
  const props = {
    timeline: { style: 'SERIOUS', fps: 30, totalFrames: 90, scenes: [scene] },
    mediaAssets: [{ id: 'game', kind: 'VIDEO', availability: 'AVAILABLE' }],
    backgroundTracks: [{
      id: 'gameplay', assetId: 'game', enabled: true, startMs: 0,
      durationMs: 3000, sourceInMs: 1000, sourceOutMs: 2500, loop: true,
    }],
  } as unknown as VideoPreviewProps;
  return { props, scene };
}

it('captures each visible pagination interval and preserves exact frame boundaries', () => {
  const { props, scene } = fixture();
  const result = planSparseCapture(props, [0, 89]);
  if (result.supported === false) throw Error(result.reason);
  const card = threadsCardState(scene, [], 30);
  expect(result.states.length).toBeGreaterThan(1);
  expect(result.states[0].start).toBe(6);
  expect(result.states[result.states.length - 1]?.end).toBe(75);
  expect(result).toMatchObject({ span: 45, sourceIn: 30, loop: true });
  for (let frame = 0; frame < 90; frame++) {
    const state = result.states.find(s => frame >= s.start && frame < s.end);
    expect(Boolean(state)).toBe(card.at(frame).visible);
    if (state) expect(card.at(state.capture)).toEqual(card.at(frame));
  }
  const sub = planSparseCapture(props, [30, 40]);
  expect(sub.supported && sub.states[0].start).toBe(30);
  expect(sub.supported && sub.states[sub.states.length - 1]?.end).toBe(41);
});

it('keeps dynamic cards and incompatible gameplay on the standard renderer', () => {
  const { props, scene } = fixture();
  scene.scene.visual!.imageMode = 'PAN';
  expect(planSparseCapture(props, [0, 89])).toEqual({ supported: false, reason: 'DYNAMIC_OR_OVERRIDDEN_CARD' });
  scene.scene.visual!.imageMode = 'FULL';
  props.backgroundTracks![0].durationMs = 1500;
  expect(planSparseCapture(props, [0, 89])).toEqual({ supported: false, reason: 'GAMEPLAY_COVERAGE_OR_OFFSET' });
});
