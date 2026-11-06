export const DATA_SCHEMA = 'threads-data/1' as const;
export type DataState =
  | 'DISCOVERED'
  | 'VALIDATED'
  | 'ELIGIBLE'
  | 'SCORED'
  | 'QUALIFIED'
  | 'QUEUED'
  | 'REJECTED'
  | 'QUARANTINED'
  | 'FAILED';
export type Label =
  | 'ELIGIBLE'
  | 'DUPLICATE'
  | 'ADVERTISEMENT'
  | 'SPAM'
  | 'OFF_TOPIC'
  | 'LOW_CONTEXT'
  | 'UNSUPPORTED_LANGUAGE'
  | 'POLICY_RISK'
  | 'NEEDS_REVIEW';
export interface SourceInput {
  nativeSourceId?: string | null;
  sourcePlatform: string;
  sourcePostId: string | null;
  sourceUrl: string | null;
  author: {
    name: string | null;
    handle: string | null;
    avatarUrl: string | null;
  };
  originalBody: string | null;
  topic: string | null;
  itemType: 'POST' | 'COMMENT' | 'UNKNOWN';
  parentReference: string | null;
  publishedAt: string | null;
  fetchedAt: string | null;
  engagement: {
    likes: number | null;
    replies: number | null;
    reposts: number | null;
    shares: number | null;
  };
  fetch: { source: string; query: string | null };
  rawPayload: unknown;
  provenance: {
    sessionId?: string;
    itemId?: string;
    sessionRevision?: number;
    identityEvidence?: string;
    synthetic: boolean;
    collectionRunId?: string;
    discoveryReviewRequired?: boolean;
    bodyMapping?: {
      body: string;
      topic: string | null;
      evidence: string;
      sourceUrl: string;
    };
  };
}
export interface Bronze extends SourceInput {
  schemaVersion: typeof DATA_SCHEMA;
  id: string;
  postId: string;
  rawHash: string;
  inputHash: string;
  ingestedAt: string;
  rightsStatus: 'UNKNOWN';
}
export interface DuplicateReference {
  postId: string;
  bronzeId: string;
  evaluationId: string;
  kind: 'EXACT' | 'NEAR';
  similarity: number;
}
export interface Silver {
  schemaVersion: typeof DATA_SCHEMA;
  id: string;
  bronzeId: string;
  processingVersion: string;
  status: 'VALIDATED' | 'QUARANTINED';
  normalized: {
    body: string;
    topic: string | null;
    bodySource: 'RAW_BODY' | 'VERIFIED_STUDIO_MAPPING';
    sourceUrl: string | null;
    itemType: SourceInput['itemType'];
  };
  language: {
    code: 'vi' | 'other' | 'unknown';
    method: 'heuristic-v1';
    evidence: string[];
  };
  deduplicationKey: string;
  duplicate: DuplicateReference | null;
  flags: string[];
  quarantineReasons: string[];
}
export interface Gold {
  schemaVersion: typeof DATA_SCHEMA;
  silverId: string;
  evaluationVersion: string;
  asOf: string;
  eligibility: 'ELIGIBLE' | 'NEEDS_REVIEW' | 'REJECTED';
  labels: Label[];
  reasons: string[];
  score: number;
  breakdown: Record<
    string,
    { value: number; weight: number; contribution: number; reason: string }
  >;
  selectionReasons: string[];
  queueState: 'NOT_QUEUED' | 'WAITING_MANUAL_PRODUCTION';
}
export interface Transition {
  at: string;
  from: DataState | null;
  to: DataState;
  inputHash: string;
  version: string;
  outcome: 'OK' | 'ERROR';
  reason: string;
  error: string | null;
}
export interface Evaluation {
  reviewHistory?: Array<{revision:number;decision:'ACCEPT'|'REJECT'|'NEEDS_REVIEW';reason:string;at:string;confirmedType:'POST'|'COMMENT'|null}>;
  schemaVersion: typeof DATA_SCHEMA;
  id: string;
  postId: string;
  bronzeId: string;
  inputHash: string;
  configHash: string;
  asOf: string;
  revision: number;
  state: DataState;
  resumeFrom?: DataState;
  silver: Silver | null;
  gold: Gold | null;
  transitions: Transition[];
  review: {
    decision: 'ACCEPT' | 'REJECT' | 'NEEDS_REVIEW';
    reason: string;
    at: string;
    confirmedType: 'POST' | 'COMMENT' | null;
  } | null;
  queue: {
    id: string;
    workflow: 'THREADS_SERIOUS';
    mode: 'DRAFT_ONLY';
    rightsStatus: 'UNKNOWN';
    at: string;
  } | null;
}
export interface DataPost {
  createdByRunId?: string;
  schemaVersion: typeof DATA_SCHEMA;
  id: string;
  ordinal: number;
  sourcePostId: string | null;
  sourceUrl: string | null;
  observations: string[];
  evaluationIds: string[];
  currentBronzeId: string;
  currentEvaluationId: string | null;
}
export interface DataRun {
  schemaVersion: typeof DATA_SCHEMA;
  id: string;
  datasetHash: string;
  version: string;
  configHash: string;
  status: 'RUNNING' | 'COMPLETED' | 'FAILED';
  inputs: SourceInput[];
  cursor: number;
  asOf: string;
  startedAt: string;
  completedAt: string | null;
  elapsedMs: number;
  metrics:{activeElapsedMs:number;observedPeakProcessRssBytes:number;cpuUserMicros:number;cpuSystemMicros:number};
  error: string | null;
  results: {
    postId: string;
    bronzeId: string;
    state: DataState;
    reused: boolean;
    newPost?: boolean;
  }[];
}
