import type {
  VideoProject,
  SourceReference,
  ContentAuthor,
} from '../video-pipeline/contracts';
export interface StudioItem {
  inclusion?: 'TARGET' | 'EXPLICIT_CONTEXT' | 'MANUAL';
  sourceId?: string;
  rawExtraction?: import('./public-types').PublicRecord;
  metadata?: import('./public-types').PublicRecord;
  id: string;
  sourceReference: SourceReference;
  sourceUrl: string;
  author: ContentAuthor;
  originalText: string;
  spokenText: string;
  displayText: string;
  mediaReferences: string[];
  selected: boolean;
  order: number;
  revision: number;
  manualLocks: string[];
}
export interface StudioSession {
  scope?: 'TARGET_ONLY' | 'WITH_CONTEXT';
  derivedFrom?: string;
  archivedItems?: StudioItem[];
  sourceRun?: {
    runId: string;
    startedAt: string;
    completedAt: string;
    elapsedMs: number;
  };
  reports?: import('./stage-report').StageReport[];
  attempts?: import('./public-types').SourceAttempt[];
  id: string;
  title: string;
  revision: number;
  updatedAt: string;
  status: 'IDLE' | 'READY' | 'PARTIAL' | 'ERROR';
  errors: string[];
  elapsedMs?: number;
  project: VideoProject;
  items: StudioItem[];
}
