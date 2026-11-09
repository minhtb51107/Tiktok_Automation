import type {
  MediaAsset,
  RemotionPreviewRequest,
} from '../video-pipeline/contracts';
export interface EditorSceneSettings {
  visual?: import('../video-pipeline/scene-visual').SceneVisual;
  itemId: string;
  enabled: boolean;
  paddingBeforeMs: number;
  paddingAfterMs: number;
  // Explicit visual-only duration when narration is unavailable; never an audio estimate.
  silentDurationMs: number;
  mediaAssetIds: string[];
}
export interface EditorSettings {
  backgroundTracks?: import('../video-pipeline/editing').BackgroundClip[];
  backgroundId?: string | null;
  backgroundMusic?: import('../video-pipeline/scene-visual').BackgroundMusic;
  scenes: EditorSceneSettings[];
}
export interface StudioMediaAsset extends Omit<MediaAsset, 'kind'> {
  kind: MediaAsset['kind'] | 'AUDIO';
  category?: import('./uploaded-media').MediaCategory;
  mime?: string;
  fileName: string;
  bytes: number;
  sha256: string;
  originalName: string;
}
export interface EditorPreview {
  revision: number;
  request: RemotionPreviewRequest;
  warnings: string[];
  missingAudioItemIds: string[];
}
