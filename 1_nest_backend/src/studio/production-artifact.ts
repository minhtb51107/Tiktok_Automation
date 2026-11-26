import { BadRequestException } from '@nestjs/common';
import { createHash } from 'crypto';
import { createReadStream } from 'fs';
import {
  OPERATOR_RENDER_PRESETS,
  type OperatorRenderPreset,
} from './render.types';
import type { StudioService } from './studio.service';

function valid(value: unknown, code: string) {
  if (!value) throw new BadRequestException(code);
}

export async function validateDraftArtifact(
  studio: StudioService,
  sessionId: string,
  jobId: string,
  preset: OperatorRenderPreset,
  revision?: number,
) {
  const m = await studio.renders.load(sessionId, jobId);
  const file = await studio.renders.output(sessionId, jobId);
  const target = OPERATOR_RENDER_PRESETS[preset];
  const probe = m.probe as {
    streams?: Array<{
      codec_type: string;
      codec_name: string;
      width?: number;
      height?: number;
      avg_frame_rate?: string;
      nb_read_frames?: string;
      duration?: string;
    }>;
    format?: { duration?: string };
  };
  const durationSeconds = Number(probe?.format?.duration);
  const video = probe?.streams?.find((s) => s.codec_type === 'video');
  const audio = probe?.streams?.find((s) => s.codec_type === 'audio');
  const [fpsNumerator, fpsDenominator] = (video?.avg_frame_rate || '')
    .split('/')
    .map(Number);
  const expectedSeconds = m.totalFrames / target.fps;
  const durationMatches = (seconds: number) =>
    Number.isFinite(seconds) &&
    seconds > 0 &&
    Math.abs(seconds - expectedSeconds) <= 1 / target.fps + 0.001;
  valid(
    m.sessionId === sessionId &&
      m.jobId === jobId &&
      (revision === undefined || m.revision === revision) &&
      m.mode === 'DRAFT' &&
      (m.preset ?? '720P') === preset &&
      m.width === target.width &&
      m.height === target.height &&
      m.fps === target.fps &&
      Number.isSafeInteger(m.totalFrames) &&
      m.totalFrames > 0 &&
      m.frameRange?.[0] === 0 &&
      m.frameRange?.[1] === m.totalFrames - 1 &&
      Math.abs(m.expectedDurationSeconds - expectedSeconds) <= 0.001 &&
      durationMatches(durationSeconds) &&
      durationMatches(Number(video?.duration)) &&
      video?.codec_name === 'h264' &&
      video.width === target.width &&
      video.height === target.height &&
      fpsNumerator / fpsDenominator === target.fps &&
      Number(video.nb_read_frames) === m.totalFrames &&
      audio?.codec_name === 'aac' &&
      durationMatches(Number(audio.duration)),
    'RENDER_PROBE_INVALID',
  );
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return {
    validation: 'MACHINE_VALIDATED',
    humanAcceptance: 'PENDING',
    sha256: hash.digest('hex'),
    preset,
    durationSeconds,
    fps: m.fps,
    frames: m.totalFrames,
    width: m.width,
    height: m.height,
    metrics: m.metrics,
  };
}
