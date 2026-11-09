import {
  AudioAsset,
  ContentStyle,
  MediaAsset,
  StoryboardScene,
  TimelineScene,
  VideoTimeline,
  VIDEO_PIPELINE_CONTRACT_VERSION,
} from './contracts';

export interface TimelineBuildInput {
  projectId: string;
  style: ContentStyle;
  fps: number;
  width: number;
  height: number;
  introDurationMs: number;
  outroDurationMs: number;
  scenes: readonly StoryboardScene[];
  audioAssets: readonly AudioAsset[];
  mediaAssets: readonly MediaAsset[];
}

const requireNonNegative = (value: number, name: string): void => {
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`${name} must be a non-negative finite number.`);
  }
};

export const millisecondsToFrames = (milliseconds: number, fps: number): number => {
  requireNonNegative(milliseconds, 'milliseconds');
  if (!Number.isInteger(fps) || fps <= 0) {
    throw new Error('fps must be a positive integer.');
  }
  return Math.ceil((milliseconds * fps) / 1000);
};

export const framesToMilliseconds = (frames: number, fps: number): number => {
  requireNonNegative(frames, 'frames');
  if (!Number.isInteger(fps) || fps <= 0) {
    throw new Error('fps must be a positive integer.');
  }
  return Number(((frames * 1000) / fps).toFixed(3));
};

const validateOrdering = (scenes: readonly StoryboardScene[]): void => {
  const ids = new Set<string>();
  scenes.forEach((scene, index) => {
    if (scene.order !== index) {
      throw new Error(`Scene order is not contiguous at ${scene.id}.`);
    }
    if (ids.has(scene.id)) throw new Error(`Duplicate scene id: ${scene.id}`);
    ids.add(scene.id);
  });
};

export const buildVideoTimeline = (input: TimelineBuildInput): VideoTimeline => {
  if (!Number.isInteger(input.fps) || input.fps <= 0) {
    throw new Error('fps must be a positive integer.');
  }
  requireNonNegative(input.introDurationMs, 'introDurationMs');
  requireNonNegative(input.outroDurationMs, 'outroDurationMs');
  validateOrdering(input.scenes);

  const audioById = new Map(input.audioAssets.map((asset) => [asset.id, asset]));
  const mediaById = new Map(input.mediaAssets.map((asset) => [asset.id, asset]));
  const introFrames = millisecondsToFrames(input.introDurationMs, input.fps);
  const outroFrames = millisecondsToFrames(input.outroDurationMs, input.fps);
  let cursor = introFrames;

  const scenes: TimelineScene[] = input.scenes.map((scene) => {
    if (scene.styleProperties.style !== input.style) {
      throw new Error(`Scene ${scene.id} style does not match project style.`);
    }
    requireNonNegative(scene.timing.paddingBeforeMs, `${scene.id}.paddingBeforeMs`);
    requireNonNegative(scene.timing.paddingAfterMs, `${scene.id}.paddingAfterMs`);

    for (const mediaId of scene.mediaAssetIds) {
      const media = mediaById.get(mediaId);
      if (!media || media.availability !== 'AVAILABLE') {
        throw new Error(`Scene ${scene.id} requires missing media asset: ${mediaId}`);
      }
    }
    for (const sfxId of scene.sfxAssetIds) {
      const sfx = audioById.get(sfxId);
      if (!sfx || sfx.role !== 'SFX' || sfx.availability !== 'AVAILABLE') {
        throw new Error(`Scene ${scene.id} requires missing SFX asset: ${sfxId}`);
      }
    }

    const audio = scene.audioAssetId
      ? audioById.get(scene.audioAssetId)
      : undefined;
    if (scene.narrationText.trim() && !audio) {
      throw new Error(`Scene ${scene.id} has narration but no audio asset.`);
    }
    if (audio && (audio.role !== 'NARRATION' || audio.availability !== 'AVAILABLE')) {
      throw new Error(`Scene ${scene.id} narration audio is unavailable.`);
    }

    const manualDuration = scene.timing.manualSceneDurationMs;
    if (manualDuration !== undefined) {
      requireNonNegative(manualDuration, `${scene.id}.manualSceneDurationMs`);
    }
    const contentDurationMs = manualDuration ?? audio?.durationMs;
    if (contentDurationMs === undefined || contentDurationMs <= 0) {
      throw new Error(`Scene ${scene.id} needs measured audio or manual duration.`);
    }
    if (audio && contentDurationMs < audio.durationMs) {
      throw new Error(`Scene ${scene.id} manual duration would cut narration audio.`);
    }

    const paddingBeforeFrames = millisecondsToFrames(
      scene.timing.paddingBeforeMs,
      input.fps,
    );
    const contentFrames = millisecondsToFrames(contentDurationMs, input.fps);
    const paddingAfterFrames = millisecondsToFrames(
      scene.timing.paddingAfterMs,
      input.fps,
    );
    const startFrame = cursor;
    const contentStartFrame = startFrame + paddingBeforeFrames;
    const contentEndFrame = contentStartFrame + contentFrames;
    const endFrame = contentEndFrame + paddingAfterFrames;
    const audioFrames = audio
      ? millisecondsToFrames(audio.durationMs, input.fps)
      : undefined;

    const subtitles = scene.subtitles.map((cue) => {
      requireNonNegative(cue.startMs, `${scene.id}.${cue.id}.startMs`);
      requireNonNegative(cue.endMs, `${scene.id}.${cue.id}.endMs`);
      if (cue.endMs <= cue.startMs) {
        throw new Error(`Subtitle ${cue.id} has an invalid range.`);
      }
      if (!audio || cue.endMs > audio.durationMs) {
        throw new Error(`Subtitle ${cue.id} exceeds narration audio duration.`);
      }
      return {
        ...cue,
        startFrame:
          contentStartFrame + millisecondsToFrames(cue.startMs, input.fps),
        endFrame:
          contentStartFrame + millisecondsToFrames(cue.endMs, input.fps),
      };
    });

    cursor = endFrame;
    return {
      scene,
      startFrame,
      endFrame,
      durationInFrames: endFrame - startFrame,
      contentStartFrame,
      contentEndFrame,
      audioStartFrame: audio ? contentStartFrame : undefined,
      audioEndFrame:
        audio && audioFrames !== undefined
          ? contentStartFrame + audioFrames
          : undefined,
      audioDurationMs: audio?.durationMs,
      sceneDurationMs: framesToMilliseconds(endFrame - startFrame, input.fps),
      subtitles,
    };
  });

  const totalFrames = cursor + outroFrames;
  return {
    contractVersion: VIDEO_PIPELINE_CONTRACT_VERSION,
    projectId: input.projectId,
    style: input.style,
    fps: input.fps,
    width: input.width,
    height: input.height,
    introDurationInFrames: introFrames,
    outroDurationInFrames: outroFrames,
    scenes,
    totalFrames,
    totalDurationMs: framesToMilliseconds(totalFrames, input.fps),
  };
};
