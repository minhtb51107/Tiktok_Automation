import type {
  ContentStyle,
  VideoPreviewProps,
} from '../../../1_nest_backend/src/video-pipeline/contracts';

const createEmptyPreview = (style: ContentStyle): VideoPreviewProps => ({
  contractVersion: '1.0',
  previewMode: true,
  audioAssets: [],
  mediaAssets: [],
  timeline: {
    contractVersion: '1.0',
    projectId: `empty-${style.toLocaleLowerCase()}-preview`,
    style,
    fps: 60,
    width: 1080,
    height: 1920,
    introDurationInFrames: 0,
    outroDurationInFrames: 0,
    scenes: [],
    totalFrames: 1,
    totalDurationMs: 16.667,
  },
});

export const EMPTY_FUNNY_PREVIEW = createEmptyPreview('FUNNY');
export const EMPTY_SERIOUS_PREVIEW = createEmptyPreview('SERIOUS');
