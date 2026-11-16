/** Browser-safe DATA-04 contracts. Observations, heuristics and human labels stay separate. */
export const CONVERSATION_VERSION = 'threads-conversation/1' as const;
export type Coverage = 'SUFFICIENT' | 'PARTIAL' | 'UNKNOWN';
export interface MetricScore {
  version: string;
  configHash: string;
  score: number | null;
  coverage: Coverage;
  breakdown: Record<
    string,
    { value: number | null; weight: number; reason: string }
  >;
  missing: string[];
  reasons: string[];
}
export interface PublicPost {
  /** Existing reviewed Studio image transcription, never an implicit user approval. */
  imageNarration?: import('../video-pipeline/contracts').StoryboardScene['imageNarration'];
  id: string;
  url: string;
  author: { handle: string; name: string | null };
  originalText: string;
  publishedAt: string | null;
  topic?: string | null;
  itemType?: 'POST' | 'COMMENT' | 'UNKNOWN';
  attachments?: Array<{
    id: string;
    kind: 'IMAGE';
    sourceUrl: string;
    relationEvidence: 'EXACT_ROOT_DOM_MEDIA';
    status: 'DOWNLOADED' | 'URL_ONLY' | 'UNAVAILABLE';
    mimeType: string | null;
    width: number | null;
    height: number | null;
    bytes: number | null;
    sha256: string | null;
    localUri: string | null;
    error: string | null;
    observedAt: string;
    ocrStatus: 'NOT_RUN';
    rightsStatus: 'UNKNOWN';
  }>;
  rawPayload?: unknown;
  engagement: {
    likes: number | null;
    replies: number | null;
    reposts: number | null;
    shares: number | null;
  };
  engagementFields?: Record<
    'likeCount' | 'replyCount' | 'repostCount' | 'shareCount',
    import('../studio/metadata-fields').ObservedField
  >;
  provenance: {
    documentUrl: string;
    observedAt: string;
    method: string;
    synthetic: boolean;
  };
}
export interface RelationshipEvidence {
  kind:
    | 'JSON_LD_PARENT_ITEM'
    | 'JSON_LD_COMMENT'
    | 'DOM_EXPLICIT_REPLY_TARGET'
    | 'PERMALINK_DETAIL_PARENT'
    | 'STRUCTURED_PUBLIC_PARENT'
    | 'EXTERNAL_PROVIDER_PARENT';
  documentUrl: string;
  documentHash: string;
  pointer: string;
  subjectUrl: string;
  parentUrl: string;
  provider?: {
    actorId: string;
    rowHash: string;
    depth: number | null;
  };
  structured?: {
    source: 'SSR' | 'NETWORK';
    payloadHash: string;
    responseType: 'SSR_RELAY' | 'SSR_JSON' | 'NETWORK_JSON';
    queryName: string | null;
  };
}
export type RelationshipEvidenceSource =
  | 'EXPLICIT_PUBLIC_REPLY'
  | 'PERMALINK_DETAIL'
  | 'STRUCTURED_PUBLIC_RESPONSE'
  | 'EXTERNAL_PROVIDER';
export interface RelationshipObservation {
  source: RelationshipEvidenceSource;
  subjectUrl: string;
  parentUrl: string | null;
  rootUrl: string;
  documentUrl: string;
  pointer: string;
  observedAt: string;
  status: 'VERIFIED' | 'REJECTED' | 'UNRESOLVED';
  reasons: string[];
  rawEvidenceHash: string;
  provider?: RelationshipEvidence['provider'];
  structured?: RelationshipEvidence['structured'];
}
export interface VerifiedReply extends PublicPost {
  parentId: string;
  rootId: string;
  evidence: RelationshipEvidence;
  extractionStatus: 'VERIFIED';
}
export interface UnverifiedCandidate {
  url: string | null;
  reason: string;
  observation?: {
    level: 'OBSERVED_ON_TARGET_PAGE';
    targetUrl: string;
    observedAt: string;
    author: { handle: string; name: string | null };
    originalText: string;
    contextEvidence?: import('../studio/context-classification').ContextRegionEvidence[];
  };
}
export interface ConversationObservationSummary {
  /** Exact post permalinks observed as a card subject, not every link inside a card. */
  subjectPermalinks: number;
  /** Cards for which author and non-empty original body were captured. */
  materializedCards: number;
  /** Subject permalinks retained without enough body/author data. */
  missingBody: number;
  parentVerified: number;
}
export type ConversationMembership =
  | 'THREAD_UI_CONFIRMED'
  | 'RECOMMENDED_POST'
  | 'UNKNOWN';
export interface MembershipEvidence {
  rootId: string;
  subjectId: string;
  status: ConversationMembership;
  evidenceType: string;
  sourceActionId: string | null;
  containerReference: string | null;
  observedAt: string;
}
export type ConversationAcquisitionState =
  | 'OPEN_TARGET'
  | 'ROOT_RESOLVED'
  | 'CONVERSATION_VISIBLE'
  | 'COLLECTING'
  | 'LOADING_MORE'
  | 'EXPANDING_NESTED'
  | 'RESOLVING_RELATIONSHIPS'
  | 'COMPLETE'
  | 'PARTIAL'
  | 'BLOCKED'
  | 'FAILED';
export interface ConversationAcquisitionTrace {
  version: 'conversation-browser-acquisition/1';
  transitions: Array<{
    state: ConversationAcquisitionState;
    at: string;
    reason: string;
    actionId: string | null;
    subjectCards: number;
    fullBodyCards: number;
  }>;
  actions: Array<{
    id: string;
    kind: 'SCROLL' | 'LOAD_MORE' | 'EXPAND_NESTED';
    label: string | null;
    containerIdentity: string | null;
    containerSubjectUrl: string | null;
    beforeSubjects: number;
    afterSubjects: number;
    changed: boolean;
    at: string;
  }>;
  snapshots: Array<{
    actionId: string;
    at: string;
    subjectCards: number;
    fullBodyCards: number;
    explicitReplies: number;
    discussionCards: number;
    recommendedCards: number;
  }>;
  stopReason: string;
}
export type StructuredPayloadSource = 'SSR' | 'NETWORK';
export type StructuredResponseType = 'SSR_RELAY' | 'SSR_JSON' | 'NETWORK_JSON';
export interface StructuredPayloadDiagnostic {
  source: StructuredPayloadSource;
  endpointPath: string;
  responseType: StructuredResponseType;
  queryName: string | null;
  payloadHash: string;
  topLevelFields: string[];
  observedFieldNames: string[];
  postNodes: number;
  relationshipFields: string[];
  observedAt: string;
}
export interface StructuredPostObservation {
  id: string;
  code: string;
  url: string;
  authorHandle: string;
  originalText: string | null;
  publishedAt: string | null;
  parentPostId: string | null;
  rootPostId: string | null;
  collectionKind: 'CONVERSATION' | 'RELATED' | 'UNKNOWN';
  containerReference: string | null;
  source: StructuredPayloadSource;
  endpointPath: string;
  responseType: StructuredResponseType;
  queryName: string | null;
  payloadHash: string;
  pointer: string;
  fieldNames: string[];
}
export type StructuredResponseParserDecision =
  | 'PENDING'
  | 'ACCEPTED_JSON'
  | 'SKIPPED_HTTP_STATUS'
  | 'SKIPPED_NON_PUBLIC_HOST'
  | 'SKIPPED_CONTENT_TYPE'
  | 'SKIPPED_CONTENT_TYPE_JSON_PARSEABLE'
  | 'SKIPPED_DECLARED_TOO_LARGE'
  | 'SKIPPED_BODY_READ_FAILED'
  | 'SKIPPED_EMPTY_BODY'
  | 'SKIPPED_BODY_TOO_LARGE'
  | 'SKIPPED_JSON_PARSE_FAILED'
  | 'SKIPPED_DUPLICATE_PAYLOAD'
  | 'SKIPPED_CAPTURE_LIMIT';
export interface StructuredRequestDiagnostic {
  id: string;
  endpointPath: string;
  method: string;
  resourceType: string;
  admitted: boolean;
  admissionReason: string;
  completion: 'PENDING' | 'FINISHED' | 'FAILED';
  failureCategory: string | null;
  observedAt: string;
}
export interface StructuredResponseDiagnostic {
  requestId: string;
  endpointPath: string;
  method: string;
  status: number;
  contentType: string;
  resourceType: string;
  contentLength: number | null;
  admitted: boolean;
  admissionReason: string;
  parserDecision: StructuredResponseParserDecision;
  bodyHash: string | null;
  conversationMarkers: string[];
  observedAt: string;
}
export interface StructuredSsrMilestone {
  milestone: string;
  scriptCount: number;
  totalBytes: number;
  postNodes: number;
  scriptHashes: string[];
  queryNames: string[];
  observedAt: string;
}
export type StructuredAcquisitionDiagnosis =
  | 'STRUCTURED_RELATIONSHIP_EVIDENCE_PRESENT'
  | 'SSR_LATE_INSERTION'
  | 'NETWORK_CONTENT_TYPE_MISSED'
  | 'STRUCTURED_SCHEMA_UNRECOGNIZED'
  | 'PUBLIC_ACCESS_LIMITED'
  | 'NO_STRUCTURED_EVIDENCE'
  | 'INCONCLUSIVE';
export interface ThreadCollection {
  /** Immutable exact-target capture, including separately labelled observed context. */
  sourceCapture?: import('../studio/public-types').SourceAttempt;
  /** V2 card observations from the bounded conversation page visit. Raw source capture remains immutable. */
  observedCards?: import('../studio/public-types').PublicRecord[];
  observationSummary?: ConversationObservationSummary;
  acquisition?: ConversationAcquisitionTrace;
  /** Conversation membership is independent from the direct parent graph. */
  membershipEvidence?: MembershipEvidence[];
  /** Sanitized passive SSR/network observations; no headers, cookies, query strings, or raw payloads. */
  structuredEvidence?: {
    version: 'conversation-structured-observation/1';
    diagnostics: StructuredPayloadDiagnostic[];
    posts: StructuredPostObservation[];
    domMatches: number;
    conflicts: string[];
    requests?: StructuredRequestDiagnostic[];
    responses?: StructuredResponseDiagnostic[];
    ssrMilestones?: StructuredSsrMilestone[];
    acquisitionDiagnosis?: StructuredAcquisitionDiagnosis;
  };
  /** Auditable relationship candidates; graph verdict remains collectEvidence(). */
  relationshipObservations?: RelationshipObservation[];
  relationshipDiagnostics?: Array<{
    source: 'PERMALINK_DETAIL';
    url: string;
    status: string;
    observedAt: string;
  }>;
  /** Optional paid-provider rows are preserved separately and never trusted implicitly. */
  externalEvidence?: {
    provider: 'APIFY_PARSEFORGE';
    actorId: 'parseforge/threads-replies-scraper';
    runId?: string;
    datasetId?: string;
    approvalId?: string;
    observedAt: string;
    rows: Array<{
      index: number;
      rowHash: string;
      rootUrl: string | null;
      subjectUrl: string | null;
      parentUrl: string | null;
      acceptedForGraph: boolean;
      reasons: string[];
      raw: unknown;
    }>;
  };
  version: typeof CONVERSATION_VERSION;
  root: PublicPost;
  replies: VerifiedReply[];
  unverified: UnverifiedCandidate[];
  reportedReplyCount: number | null;
  observedReplyCount: number;
  verifiedReplyCount: number;
  unverifiedCandidateCount: number;
  startedAt: string;
  completedAt: string;
  status: 'COMPLETE' | 'PARTIAL' | 'UNKNOWN';
  warnings: string[];
}
export type ReplyLabel =
  | 'SUBSTANTIVE'
  | 'LOW_INFORMATION'
  | 'SPAM'
  | 'DUPLICATE'
  | 'UNCERTAIN';
export interface ReplyQuality {
  replyId: string;
  label: ReplyLabel;
  metric: MetricScore;
  duplicateOf: string | null;
}
export interface ConversationEvaluation {
  version: string;
  configHash: string;
  asOf: string;
  popularity: MetricScore;
  replyQuality: ReplyQuality[];
  conversation: MetricScore;
  videoSuitability: MetricScore;
  sample: {
    verified: number;
    substantive: number;
    lowInformation: number;
    spamDuplicate: number;
    substantiveRatio: number | null;
    lowInformationRatio: number | null;
    spamDuplicateRatio: number | null;
    denominator: 'VERIFIED_OBSERVED_SAMPLE';
    collectionStatus: ThreadCollection['status'];
  };
  precisionAt10: { status: 'NOT_MEASURED'; reason: string };
}
export interface PopularityCandidate {
  url: string;
  observedOrder: number;
  post: PublicPost | null;
}
export interface ConversationRun {
  schemaVersion: 'threads-data/1';
  version: typeof CONVERSATION_VERSION;
  id: string;
  request: {
    requestId: string;
    urls?: string[];
    keyword?: string;
    limit: number;
    priority?: 'HOT' | 'RECENT';
    minInteractions?: number;
  };
  configHash: string;
  execution: 'LIVE' | 'SYNTHETIC';
  status: 'RUNNING' | 'COMPLETED' | 'FAILED';
  stage: string;
  startedAt: string;
  completedAt: string | null;
  elapsedMs: number;
  candidates: PopularityCandidate[] | null;
  ranking: {
    status: Coverage;
    reasons: string[];
    selected: string[];
    priority?: string;
    minInteractions?: number;
    ranked?: Array<{
      url: string;
      score: number | null;
      coverage: Coverage;
      interactionTotal: number | null;
      thresholdStatus: string;
    }>;
  } | null;
  captures: Array<{
    url: string;
    collection: ThreadCollection;
    importRunId?: string;
  }>;
  results: Array<{
    url: string;
    collectionId: string;
    evaluation: ConversationEvaluation;
  }>;
  history: Array<{ at: string; stage: string; outcome: string }>;
  error: string | null;
}
export interface ConversationReview {
  schemaVersion: 'threads-data/1';
  collectionId: string;
  revision: number;
  selectedReplyIds: string[];
  selectedObservedUrls?: string[];
  replyLabels: Record<string, ReplyLabel>;
  decision: 'ACCEPT' | 'REJECT' | 'NEEDS_REVIEW';
  reason: string;
  history: Array<{
    requestId: string;
    inputHash: string;
    at: string;
    revision: number;
    selectedReplyIds: string[];
    selectedObservedUrls?: string[];
    replyLabels: Record<string, ReplyLabel>;
    decision: string;
    reason: string;
  }>;
}
