import type { OperatorRenderPreset } from './render.types';

export type AutomationMode = 'DISABLED' | 'ENABLED' | 'DRAINING' | 'BLOCKED';
export type ApprovalPolicy = 'EXCEPTION_ONLY' | 'REVIEW_BEFORE_RENDER';
export interface AutomationPolicy {
  schemaVersion: 'automation-policy/1';
  revision: number;
  mode: AutomationMode;
  timezone: 'Asia/Ho_Chi_Minh';
  schedule: { enabled: boolean; start: string; end: string };
  topics: string[];
  dailyVideoLimit: number;
  dailyAttemptLimit: number;
  dailyRerenderLimit: number;
  dailyAiRequestLimit: number;
  maxPendingVideos: number;
  maxPendingReviews: number;
  renderPreset: OperatorRenderPreset;
  approvalPolicy: ApprovalPolicy;
  maxConcurrentHeavyWorkers: 1;
  autoPublish: false;
  requestId?: string;
  mutationKey?: string;
}
export const defaultAutomationPolicy = (): AutomationPolicy => ({
  schemaVersion: 'automation-policy/1',
  revision: 0,
  mode: 'DISABLED',
  timezone: 'Asia/Ho_Chi_Minh',
  schedule: { enabled: true, start: '23:00', end: '07:00' },
  topics: [],
  dailyVideoLimit: 3,
  dailyAttemptLimit: 15,
  dailyRerenderLimit: 3,
  dailyAiRequestLimit: 30,
  maxPendingVideos: 10,
  maxPendingReviews: 10,
  renderPreset: '1080P60',
  approvalPolicy: 'EXCEPTION_ONLY',
  maxConcurrentHeavyWorkers: 1,
  autoPublish: false,
});
export interface AutomationInfrastructureRecovery {
  schemaVersion: 'automation-infrastructure/1';
  id: 'browser';
  failureCode: string;
  consecutiveFailures: number;
  lastFailureAt: string;
  nextProbeAt: string | null;
  recoveryAttempts: number;
  diagnosticReference: string;
  batchId: string;
  status: 'COOLDOWN' | 'PROBING' | 'RETRY_ADMITTED' | 'BLOCKED' | 'CLEARED';
  probe?: import('../data-engine/browser-resource-policy').BrowserResourceReport;
}
export interface ProductionReservation {
  id: string;
  requestId: string;
  candidateKey: string | null;
  batchId: string | null;
  sessionId: string | null;
  renderJobId: string | null;
  kind: 'NEW_VIDEO' | 'RERENDER';
  status:
    | 'RESERVED'
    | 'RUNNING'
    | 'WAITING_HUMAN'
    | 'COMPLETED'
    | 'FAILED'
    | 'CANCELLED';
  createdAt: string;
  finishedAt: string | null;
  dispatch?: {
    topic: string;
    capacity: number;
    attempts: number;
    aiLimit: number;
    reviewSlots: number;
    preset: OperatorRenderPreset;
    reviewBeforeRender: boolean;
    policyRevision: number;
    recovery?: {
      batchId: string;
      collectionId: string;
      sourceUrl: string;
      cacheOnly?: boolean;
    };
  };
  aiLedgerIds?: string[];
  infrastructureFailure?: boolean;
  cachedRecovery?: boolean;
  edit?: {
    videoId: string;
    version: number;
    sourceId: string;
    sourceRevision: number;
    preset: OperatorRenderPreset;
    preparedRevision?: number;
  };
  error?: string;
}
export interface ProductionDay {
  schemaVersion: 'production-day/1';
  dayKey: string;
  reservations: ProductionReservation[];
  updatedAt: string;
}
export interface ReviewRequest {
  schemaVersion: 'automation-review/1';
  id: string;
  shortId: string;
  revision: number;
  type: 'SELECT_ROOT' | 'SELECT_REPLIES' | 'PRONUNCIATION' | 'VIDEO_REVIEW';
  batchId: string | null;
  sessionId: string | null;
  sourceRevision: number | null;
  options: Array<{ number: number; sourceId: string; preview: string }>;
  status: 'OPEN' | 'RESOLVED' | 'EXPIRED' | 'CANCELLED';
  createdAt: string;
  expiresAt: string | null;
  videoId?: string;
  videoVersion?: number;
  reason?: string;
  ambiguousTerms?: string[];
  candidateUrl?: string;
  evaluationVersion?: string;
  resolution?: {
    requestId: string;
    digest: string;
    decision: string;
    selectedSourceIds?: string[];
  };
}
export interface ProducedVideoVersion {
  evaluationVersion?: string;
  version: number;
  sessionRevision: number;
  renderJobId: string;
  selectedSourceIds: string[];
  preset: OperatorRenderPreset;
  durationMs: number;
  sha256: string;
  createdAt: string;
}
export interface ProducedVideo {
  schemaVersion: 'automation-video/1';
  id: string;
  shortId: string;
  rootSourceId: string;
  sessionId: string;
  currentVersion: number;
  versions: ProducedVideoVersion[];
  reviewStatus: 'PENDING' | 'APPROVED' | 'REJECTED';
  createdAt: string;
  decision?: {
    requestId: string;
    status: 'APPROVED' | 'REJECTED';
    version: number;
  };
}
export interface AutomationOutbox {
  schemaVersion: 'automation-outbox/1';
  id: string;
  text: string;
  attempts: number;
  nextAt: string;
  sentAt: string | null;
}

export interface EditorialFeedbackEvent {
  schemaVersion: 'editorial-feedback/1';
  eventId: string;
  timestamp: string;
  rootSourceId: string;
  sourceId: string | null;
  videoId: string | null;
  videoVersion: number | null;
  action:
    | 'SELECT_ROOT'
    | 'REJECT_ROOT'
    | 'SELECT_REPLY'
    | 'REMOVE_REPLY'
    | 'APPROVE_VIDEO'
    | 'REJECT_VIDEO';
  reasonCode: string | null;
  evaluationVersion: string;
  featureSnapshotRef: string | null;
}
