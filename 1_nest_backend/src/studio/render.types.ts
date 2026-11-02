import type { VideoPreviewProps } from '../video-pipeline/contracts';
export type RenderMode = 'DRAFT' | 'FINAL';
export interface RenderRequest {
  revision: number;
  mode: RenderMode;
  preset: '1080P' | '720P';
  backgroundMode?:'SAVED'|'FIT'|'LOOP';
  /** Inclusive frame range into the unchanged saved timeline; null means full. */
  frameRange?: [number, number];
  requestId: string;
}
export interface RenderManifest {
  schemaVersion: 1;
  backgroundMode?:'SAVED'|'FIT'|'LOOP';
  jobId: string;
  sessionId: string;
  projectId: string;
  revision: number;
  timelineHash: string;
  mode: RenderMode;
  publishable: boolean;
  status: 'QUEUED' | 'RUNNING' | 'COMPLETED' | 'FAILED' | 'CANCELLED';
  width: number;
  height: number;
  fps: number;
  totalFrames: number;
  frameRange: [number, number];
  expectedDurationSeconds: number;
  sceneCount: number;
  codec: 'h264';
  audioCodec: 'aac';
  pixelFormat: 'yuv420p';
  concurrency: 1;
  startedAt: string;
  completedAt: string | null;
  bytes: number | null;
  warnings: string[];
  error: string | null;
  metrics: Record<string, unknown>;
  probe?: unknown;
  downloadUrl?: string;
  previewHash: string;
}
export interface RenderSnapshot {
  props: VideoPreviewProps;
  manifest: RenderManifest;
  browserExecutable: string;
  appOrigin: string;
}
