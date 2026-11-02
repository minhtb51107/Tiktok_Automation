export interface VoiceSettings {
  voice: string | null;
  /** VOICE_SPEED contract: 0.5–3.0 inclusive, step 0.05; new SERIOUS default 1.2. */
  speed: number;
}
export interface SpokenApproval {
  textHash: string;
  approvedAt: string;
  revision: number;
  valid: boolean;
}
export interface VoiceAsset {
  purpose?: 'DRAFT' | 'APPROVED_TEXT';
  id: string;
  itemId: string;
  itemRevision: number;
  textHash: string;
  spokenText: string;
  voice: string;
  speed: number;
  model: string;
  modelVersion: string;
  cacheKey: string;
  durationMs: number;
  filePath: string;
  uri: string;
  createdAt: string;
  approvedAt: string | null;
  status: 'GENERATED' | 'APPROVED' | 'STALE';
  cacheHit: boolean;
  synthesisPerformed?: boolean;
  baseCacheHit?: boolean;
}
export interface VoiceJob {
  itemId: string;
  status: 'ERROR' | 'GENERATED' | 'APPROVED' | 'STALE';
  startedAt: string;
  completedAt: string;
  elapsedMs: number;
  error: string | null;
  assetId?: string;
  reused?: boolean;
}
export interface VoiceBatchResult {
  itemId: string;
  outcome:
    | 'GENERATED'
    | 'REUSED'
    | 'SKIPPED'
    | 'ERROR'
    | 'APPROVED'
    | 'UPDATED';
  reason: string | null;
}
export interface VoiceBatch {
  action: string;
  at: string;
  results: VoiceBatchResult[];
}
export interface VoiceRuntime {
  status: 'READY' | 'BLOCKED_RUNTIME';
  python: string;
  packageVersion: string | null;
  imports: Record<string, boolean>;
  voices: { id: string; label: string }[];
  declaredVoices: { id: string; label: string }[];
  model: string | null;
  modelVersion: string;
  device: string;
  gpuAvailable: boolean | null;
  ffmpeg: boolean;
  ffprobe: boolean;
  blockers: string[];
  checkedAt: string;
}
