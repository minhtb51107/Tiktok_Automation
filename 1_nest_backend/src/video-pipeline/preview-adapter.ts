import {
  RemotionPreviewRequest,
  VideoProject,
  VIDEO_PIPELINE_CONTRACT_VERSION,
} from './contracts';

export const createRemotionPreviewRequest = (
  project: VideoProject,
): RemotionPreviewRequest => {
  if (!project.timeline) {
    throw new Error(`VideoProject ${project.id} has no timeline.`);
  }
  if (
    project.timeline.projectId !== project.id ||
    project.timeline.style !== project.style
  ) {
    throw new Error('Timeline identity does not match the project.');
  }
  return {
    compositionId:
      project.style === 'FUNNY'
        ? 'FunnyTimelinePreview'
        : 'SeriousTimelinePreview',
    durationInFrames: project.timeline.totalFrames,
    fps: project.timeline.fps,
    inputProps: {
      contractVersion: VIDEO_PIPELINE_CONTRACT_VERSION,
      timeline: project.timeline,
      audioAssets: project.audioAssets,
      mediaAssets: project.mediaAssets,
      previewMode: true,
      backgroundMusic:project.backgroundMusic,
      backgroundTracks:project.backgroundTracks,
    },
  };
};
