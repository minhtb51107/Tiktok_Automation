import type {
  ThreadCollection,
  ConversationEvaluation,
} from './conversation-contracts';
export const EDITORIAL_VERSION = 'conversation-editorial/1' as const;
export type EditorialKind = 'QUOTE' | 'PARAPHRASE' | 'COMMENTARY';
export interface EditorialSection {
  id: string;
  stage: 'HOOK' | 'CONTEXT' | 'DISCUSSION' | 'COMMENTARY' | 'RESOLUTION';
  kind: EditorialKind;
  sourceId: string | null;
  parentId: string | null;
  permalink: string | null;
  originalText: string;
  displayText: string;
  narrationText: string;
  locked: boolean;
}
export interface Feasibility {
  version: string;
  configHash: string;
  status:
    | 'READY_FOR_SCRIPT'
    | 'NEEDS_EDITORIAL_ENRICHMENT'
    | 'INSUFFICIENT_CONTENT'
    | 'UNKNOWN';
  reasons: string[];
  missingEvidence: string[];
  breakdown: Record<string, { value: number; reason: string }>;
  estimate: {
    source: 'ESTIMATED';
    minimumSeconds: number;
    maximumSeconds: number;
    tokens: number;
    targetSeconds: [70, 100];
    authoritative: false;
  };
}
export interface EditorialPlan {
  schemaVersion: 'threads-data/1';
  version: typeof EDITORIAL_VERSION;
  id: string;
  requestId: string;
  revision: number;
  collectionId: string;
  selectionRevision: number;
  selectedReplyIds: string[];
  bundle: {
    collection: ThreadCollection;
    quality: ConversationEvaluation;
    humanReplyLabels?: Record<
      string,
      import('./conversation-contracts').ReplyLabel
    >;
    sourceLink: {
      postId: string;
      bronzeId: string;
      evaluationId: string | null;
    } | null;
  };
  bundleHash: string;
  sections: EditorialSection[];
  feasibility: Feasibility;
  style: 'SERIOUS' | 'FUNNY';
  scriptStatus: 'DRAFT';
  editorialSelectionConfirmed: true;
  rightsStatus: 'UNKNOWN';
  updatedAt: string;
  history: Array<{
    at: string;
    revision: number;
    action: string;
    reason: string;
  }>;
}
export interface EditorialSnapshot {
  plan: EditorialPlan;
  planHash: string;
}
export interface DurationAssessment {
  source: 'ESTIMATED' | 'MEASURED' | 'FIXTURE';
  status:
    | 'NOT_MEASURED'
    | 'DURATION_TOO_SHORT'
    | 'INVALID_NARRATION_COVERAGE'
    | 'TIMELINE_MISMATCH'
    | 'MEASURED_DURATION_PASS'
    | 'FIXTURE_CONTRACT_PASS';
  timelineSeconds: number | null;
  narrationSeconds: number | null;
  releaseReady: false;
  durationGatePassed: boolean;
  warnings: string[];
}
