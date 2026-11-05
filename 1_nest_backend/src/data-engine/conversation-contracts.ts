/** Browser-safe DATA-04 contracts. Observations, heuristics and human labels stay separate. */
export const CONVERSATION_VERSION = 'threads-conversation/1' as const;
export type Coverage = 'SUFFICIENT' | 'PARTIAL' | 'UNKNOWN';
export interface MetricScore {
  version: string; configHash: string; score: number | null; coverage: Coverage;
  breakdown: Record<string, {value: number | null; weight: number; reason: string}>;
  missing: string[]; reasons: string[];
}
export interface PublicPost {
  id: string; url: string; author: {handle: string; name: string | null};
  originalText: string; publishedAt: string | null; topic?: string | null; rawPayload?: unknown;
  engagement: {likes: number | null; replies: number | null; reposts: number | null; shares: number | null};
  provenance: {documentUrl: string; observedAt: string; method: string; synthetic: boolean};
}
export interface RelationshipEvidence {
  kind: 'JSON_LD_PARENT_ITEM' | 'JSON_LD_COMMENT';
  documentUrl: string; documentHash: string; pointer: string;
  subjectUrl: string; parentUrl: string;
}
export interface VerifiedReply extends PublicPost {
  parentId: string; rootId: string; evidence: RelationshipEvidence;
  extractionStatus: 'VERIFIED';
}
export interface UnverifiedCandidate {url: string | null; reason: string}
export interface ThreadCollection {
  version: typeof CONVERSATION_VERSION; root: PublicPost;
  replies: VerifiedReply[]; unverified: UnverifiedCandidate[];
  reportedReplyCount: number | null; observedReplyCount: number; verifiedReplyCount: number;
  unverifiedCandidateCount: number; startedAt: string; completedAt: string;
  status: 'COMPLETE' | 'PARTIAL' | 'UNKNOWN'; warnings: string[];
}
export type ReplyLabel = 'SUBSTANTIVE' | 'LOW_INFORMATION' | 'SPAM' | 'DUPLICATE' | 'UNCERTAIN';
export interface ReplyQuality {replyId: string; label: ReplyLabel; metric: MetricScore; duplicateOf: string | null}
export interface ConversationEvaluation {
  version: string; configHash: string; asOf: string;
  popularity: MetricScore; replyQuality: ReplyQuality[];
  conversation: MetricScore; videoSuitability: MetricScore;
  sample: {verified: number; substantive: number; lowInformation: number; spamDuplicate: number;
    substantiveRatio: number | null; lowInformationRatio: number | null; spamDuplicateRatio: number | null;
    denominator: 'VERIFIED_OBSERVED_SAMPLE'; collectionStatus: ThreadCollection['status']};
  precisionAt10: {status: 'NOT_MEASURED'; reason: string};
}
export interface PopularityCandidate {url: string; observedOrder: number; post: PublicPost | null}
export interface ConversationRun {
  schemaVersion: 'threads-data/1'; version: typeof CONVERSATION_VERSION; id: string;
  request: {requestId: string; urls?: string[]; keyword?: string; limit: number};
  configHash:string; execution: 'LIVE' | 'SYNTHETIC'; status: 'RUNNING' | 'COMPLETED' | 'FAILED';
  stage: string; startedAt: string; completedAt: string | null; elapsedMs: number;
  candidates: PopularityCandidate[] | null; ranking: {status: Coverage; reasons: string[]; selected: string[]} | null;
  captures: Array<{url: string; collection: ThreadCollection}>;
  results: Array<{url: string; collectionId: string; evaluation: ConversationEvaluation}>;
  history: Array<{at: string; stage: string; outcome: string}>; error: string | null;
}
export interface ConversationReview {
  schemaVersion: 'threads-data/1'; collectionId: string; revision: number;
  selectedReplyIds: string[]; replyLabels: Record<string,ReplyLabel>; decision: 'ACCEPT' | 'REJECT' | 'NEEDS_REVIEW'; reason: string;
  history: Array<{requestId: string; inputHash: string; at: string; revision: number; selectedReplyIds: string[]; replyLabels:Record<string,ReplyLabel>; decision: string; reason: string}>;
}
