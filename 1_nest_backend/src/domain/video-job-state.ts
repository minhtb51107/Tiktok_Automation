export enum VideoJobStatus {
  PENDING = 'PENDING',
  SCRIPT_READY = 'SCRIPT_READY',
  AUDIO_READY = 'AUDIO_READY',
  RENDERED = 'RENDERED',
  FAILED = 'FAILED',
}

const ALLOWED_TRANSITIONS: Record<VideoJobStatus, readonly VideoJobStatus[]> = {
  [VideoJobStatus.PENDING]: [VideoJobStatus.SCRIPT_READY, VideoJobStatus.FAILED],
  [VideoJobStatus.SCRIPT_READY]: [VideoJobStatus.AUDIO_READY, VideoJobStatus.FAILED],
  [VideoJobStatus.AUDIO_READY]: [VideoJobStatus.RENDERED, VideoJobStatus.FAILED],
  [VideoJobStatus.RENDERED]: [],
  [VideoJobStatus.FAILED]: [VideoJobStatus.PENDING],
};

export const canTransitionVideoJob = (
  from: VideoJobStatus,
  to: VideoJobStatus,
): boolean => ALLOWED_TRANSITIONS[from].includes(to);

export const assertVideoJobTransition = (
  from: VideoJobStatus,
  to: VideoJobStatus,
): void => {
  if (!canTransitionVideoJob(from, to)) {
    throw new Error(`Invalid video job status transition: ${from} -> ${to}`);
  }
};
