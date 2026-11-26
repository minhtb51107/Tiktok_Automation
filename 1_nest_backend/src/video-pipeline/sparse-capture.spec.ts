import { expect, it } from '@jest/globals';
import type { TimelineScene, VideoPreviewProps } from './contracts';
import {
  defaultSceneVisual,
  desktopThreadsVisual,
  mobileThreadsVisual,
} from './scene-visual';
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

it('supports MOBILE_THREADS (default) and DESKTOP_THREADS layout presets with semantic pagination', () => {
  const longPost = [
    'IELTS Việt Nam là 1 thứ rất tào lao luôn, bắt nguồn từ việc thi đầu vào của mấy trường nước ngoài mà giờ nó biến chất thành thước đo "trí tuệ" của 1 con người.',
    '- Thật ra trường ĐH nước ngoài chú trọng nhất vẫn là năng lực và kiến thức còn điểm tiếng Anh IELTS chỉ cần đủ tối thiểu để pass',
    '- Tui 20 năm trước thi IELTS chỉ 6.5 nhưng qua Tây học tới Tiến Sĩ rồi giờ chả ai hỏi tui IELTS mấy chấm',
    '- Giáo sư nước ngoài nói tiếng Anh cũng tệ lắm, vì cái chính vẫn là kiến thức, tiếng nói chỉ là công cụ',
  ].join('\n');

  const mobileScene = {
    startFrame: 0,
    endFrame: 120,
    durationInFrames: 120,
    contentStartFrame: 0,
    contentEndFrame: 120,
    subtitles: [],
    scene: {
      threadsCard: { avatarUrl: null },
      mediaAssetIds: [],
      displayText: longPost,
      visual: mobileThreadsVisual(),
    },
  } as unknown as TimelineScene;

  const mobileState = threadsCardState(mobileScene, [], 30);
  expect(mobileState.layout.layoutPreset).toBe('MOBILE_THREADS');
  expect(mobileState.layout.appearance).toBe('LIGHT');
  expect(mobileState.layout.width).toBe(1040);
  expect(mobileState.layout.pages.length).toBe(2);
  expect(mobileState.layout.pages[0]).toContain('đủ tối thiểu để pass');
  expect(mobileState.layout.pages[1]).toContain('tiếng nói chỉ là công cụ');
  expect(mobileState.at(0).pageIndex).toBe(0);
  expect(mobileState.at(119).pageIndex).toBe(1);

  const desktopScene = {
    ...mobileScene,
    scene: {
      ...mobileScene.scene,
      visual: desktopThreadsVisual(),
    },
  } as unknown as TimelineScene;

  const desktopState = threadsCardState(desktopScene, [], 30);
  expect(desktopState.layout.layoutPreset).toBe('DESKTOP_THREADS');
  expect(desktopState.layout.appearance).toBe('DARK');
  expect(desktopState.layout.width).toBe(900);
});
