import type { VideoPreviewProps } from '../video-pipeline/contracts';
import type { RenderFailure } from './render-progress';
export type RenderMode = 'DRAFT' | 'FINAL';
export const OPERATOR_RENDER_PRESETS = {
  '720P': { width: 720, height: 1280, fps: 30 },
  '1080P30': { width: 1080, height: 1920, fps: 30 },
  '1080P60': { width: 1080, height: 1920, fps: 60 },
} as const;
export type OperatorRenderPreset = keyof typeof OPERATOR_RENDER_PRESETS;
export type RenderPreset = '1080P' | OperatorRenderPreset;
export function isOperatorRenderPreset(value: unknown): value is OperatorRenderPreset {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(OPERATOR_RENDER_PRESETS, value);
}
export interface RenderRequest {
  revision: number;
  mode: RenderMode;
  preset: RenderPreset;
  fps?: 30 | 60;
  requireSparse?: boolean;
  backgroundMode?:'SAVED'|'FIT'|'LOOP';
  /** Inclusive frame range into the unchanged saved timeline; null means full. */
  frameRange?: [number, number];
  requestId: string;
}
export interface RenderManifest {
  schemaVersion: 1;
  preset?: RenderPreset;
  requireSparse?: boolean;
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
  failureCode?: RenderFailure;
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
