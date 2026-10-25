import { describe, expect, it } from '@jest/globals';
import { createSyntheticVideoProject } from './fixtures/synthetic-thread.fixture';
import {
  buildVideoTimeline,
  framesToMilliseconds,
  millisecondsToFrames,
} from './timeline-engine';

const timelineFor = (style: 'FUNNY' | 'SERIOUS' = 'FUNNY') => {
  const project = createSyntheticVideoProject(style);
  return {
    project,
    timeline: buildVideoTimeline({
      projectId: project.id,
      style,
      fps: 60,
      width: 1080,
      height: 1920,
      introDurationMs: 1000,
      outroDurationMs: 500,
      scenes: project.storyboard,
      audioAssets: project.audioAssets,
      mediaAssets: project.mediaAssets,
    }),
  };
};

describe('deterministic timeline engine', () => {
  it('uses a documented ceil conversion for milliseconds and frames', () => {
    expect(millisecondsToFrames(1000, 60)).toBe(60);
    expect(millisecondsToFrames(1001, 60)).toBe(61);
    expect(framesToMilliseconds(61, 60)).toBe(1016.667);
  });

  it('is the sole owner of intro, padding, ordering, subtitles, and total frames', () => {
    const { timeline } = timelineFor();

    expect(timeline.introDurationInFrames).toBe(60);
    expect(timeline.outroDurationInFrames).toBe(30);
    expect(timeline.scenes.map((scene) => [
      scene.scene.id,
      scene.startFrame,
      scene.endFrame,
      scene.durationInFrames,
    ])).toEqual([
      ['funny-scene-post', 60, 222, 162],
      ['funny-scene-comment-1', 222, 351, 129],
      ['funny-scene-comment-2', 351, 519, 168],
      ['funny-scene-comment-3', 519, 627, 108],
    ]);
    expect(timeline.totalFrames).toBe(657);
    expect(timeline.totalDurationMs).toBe(10950);
    expect(timeline.scenes[0].audioDurationMs).toBe(2200);
    expect(timeline.scenes[0].subtitles.map((cue) => [cue.startFrame, cue.endFrame])).toEqual([
      [72, 126],
      [126, 198],
    ]);
  });

  it('honors a locked manual duration without truncating measured audio', () => {
    const project = createSyntheticVideoProject('FUNNY');
    project.storyboard[0] = {
      ...project.storyboard[0],
      timing: {
        ...project.storyboard[0].timing,
        manualSceneDurationMs: 2600,
      },
      manualOverride: {
        lockedFields: ['TIMING'],
        revision: 1,
        lastEditedBy: 'offline-test-user',
      },
    };
    const timeline = buildVideoTimeline({
      projectId: project.id,
      style: project.style,
      fps: 60,
      width: 1080,
      height: 1920,
      introDurationMs: 0,
      outroDurationMs: 0,
      scenes: project.storyboard,
      audioAssets: project.audioAssets,
      mediaAssets: project.mediaAssets,
    });

    expect(timeline.scenes[0].durationInFrames).toBe(186);
    expect(timeline.scenes[0].audioEndFrame).toBe(144);
    expect(timeline.scenes[0].contentEndFrame).toBe(168);
  });

  it('fails closed for missing audio, assets, and subtitle overflow', () => {
    const project = createSyntheticVideoProject('FUNNY');
    expect(() =>
      buildVideoTimeline({
        projectId: project.id,
        style: project.style,
        fps: 60,
        width: 1080,
        height: 1920,
        introDurationMs: 0,
        outroDurationMs: 0,
        scenes: project.storyboard,
        audioAssets: project.audioAssets.filter(
          (asset) => asset.id !== 'audio-funny-post',
        ),
        mediaAssets: project.mediaAssets,
      }),
    ).toThrow('has narration but no audio asset');

    expect(() =>
      buildVideoTimeline({
        projectId: project.id,
        style: project.style,
        fps: 60,
        width: 1080,
        height: 1920,
        introDurationMs: 0,
        outroDurationMs: 0,
        scenes: project.storyboard,
        audioAssets: project.audioAssets,
        mediaAssets: [],
      }),
    ).toThrow('requires missing media asset');

    project.storyboard[0].subtitles[0].endMs = 9999;
    expect(() =>
      buildVideoTimeline({
        projectId: project.id,
        style: project.style,
        fps: 60,
        width: 1080,
        height: 1920,
        introDurationMs: 0,
        outroDurationMs: 0,
        scenes: project.storyboard,
        audioAssets: project.audioAssets,
        mediaAssets: project.mediaAssets,
      }),
    ).toThrow('exceeds narration audio duration');
  });

  it('supports the SERIOUS style through the same timeline engine', () => {
    const { timeline } = timelineFor('SERIOUS');
    expect(timeline.style).toBe('SERIOUS');
    expect(timeline.scenes).toHaveLength(2);
    expect(timeline.scenes.every((scene) => scene.scene.styleProperties.style === 'SERIOUS')).toBe(true);
  });
});
