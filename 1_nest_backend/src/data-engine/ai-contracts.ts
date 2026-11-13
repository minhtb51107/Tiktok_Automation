import type { Coverage, ThreadCollection } from './conversation-contracts';

export const AI_CONTENT_VERSION = 'ai-content/1' as const;
export type AiStyle = 'SERIOUS' | 'FUNNY';
export type AiRunStatus =
  | 'QUEUED'
  | 'RUNNING'
  | 'WAITING_REVIEW'
  | 'SUCCEEDED'
  | 'FAILED'
  | 'CANCELLED'
  | 'BLOCKED_BILLING'
  | 'BLOCKED_AUTH'
  | 'RATE_LIMITED';
export interface AiUsage {
  inputTokens: number | null;
  outputTokens: number | null;
  totalTokens: number | null;
  estimatedCostUsd: number | null;
  costSource: 'PROVIDER_REPORTED' | 'CONFIGURED_RATES' | 'UNAVAILABLE';
}
export interface AiProviderConfig {
  model: string;
  provider: string;
  timeoutMs: number;
  maxTokens: number;
  requestBudget: number;
  tokenBudget: number;
  credential: 'present' | 'absent';
}
export interface AiCompletion {
  provider: 'HUGGING_FACE';
  model: string;
  providerRoute: string;
  content: string;
  usage: AiUsage;
  latencyMs: number;
  requestId: string | null;
  finishReason: string | null;
}
export interface AiCandidateAssessment {
  sourceId: string;
  disposition: 'SELECT' | 'REVIEW' | 'EXCLUDE';
  contentRole:
    | 'SUBSTANTIVE'
    | 'COUNTERPOINT'
    | 'EXPERIENCE'
    | 'HUMOR'
    | 'LOW_INFORMATION'
    | 'SPAM'
    | 'INDEPENDENT_OR_UNCLEAR';
  contextRelation:
    | 'SAME_CONTEXT'
    | 'LIKELY_RELATED'
    | 'INDEPENDENT'
    | 'UNCERTAIN';
  relevance: number;
  usefulness: number;
  reasons: string[];
  missingEvidence: string[];
}
export interface AiContentAssessment {
  schemaVersion: typeof AI_CONTENT_VERSION;
  id: string;
  collectionId: string;
  inputHash: string;
  revision: number;
  status: 'WAITING_REVIEW';
  style: AiStyle;
  topic: string;
  contentFocus: string;
  rootSourceId: string;
  candidates: AiCandidateAssessment[];
  selectedSourceIds: string[];
  excludedSourceIds: string[];
  missingInformation: string[];
  feasibility: {
    status:
      | 'READY_FOR_SCRIPT'
      | 'NEEDS_EDITORIAL_ENRICHMENT'
      | 'INSUFFICIENT_CONTENT'
      | 'UNKNOWN';
    estimatedSeconds: {
      minimum: number;
      maximum: number;
      source: 'AI_ESTIMATED_NOT_MEASURED';
    };
    reasons: string[];
  };
  editorialRecommendation: {
    hook: string;
    structure: string[];
    warnings: string[];
  };
  ruleSnapshot: {
    popularity: number | null;
    popularityCoverage: Coverage;
    conversation: number | null;
    videoSuitability: number | null;
  };
  provider: {
    name: 'HUGGING_FACE';
    model: string;
    route: string;
    latencyMs: number;
    usage: AiUsage;
  };
  createdAt: string;
  approval: 'PENDING';
}
export interface AiScriptSection {
  id: string;
  kind: 'QUOTE' | 'PARAPHRASE' | 'COMMENTARY';
  sourceIds: string[];
  text: string;
  purpose: string;
}
export interface AiScriptProposal {
  schemaVersion: 'ai-script-proposal/1';
  id: string;
  assessmentId: string;
  style: AiStyle;
  targetDurationSeconds: number;
  estimatedDuration: {
    minimum: number;
    maximum: number;
    source: 'AI_ESTIMATED_NOT_MEASURED';
  };
  hook: string;
  sections: AiScriptSection[];
  sourceIds: string[];
  warnings: string[];
  status: 'DRAFT_REQUIRES_HUMAN_REVIEW';
  provider: {
    name: 'HUGGING_FACE';
    model: string;
    route: string;
    latencyMs: number;
    usage: AiUsage;
  };
  createdAt: string;
}
export interface AiAgentToolCall {
  index: number;
  tool:
    | 'search_threads'
    | 'get_post_details'
    | 'get_conversation'
    | 'evaluate_candidates'
    | 'propose_script';
  input: Record<string, unknown>;
  status: 'SUCCEEDED' | 'BLOCKED' | 'FAILED';
  summary: string;
  startedAt: string;
  completedAt: string;
}
export interface AiAgentRun {
  schemaVersion: 'ai-research-agent/1';
  id: string;
  requestId: string;
  requestHash: string;
  status: AiRunStatus;
  mode: 'DETERMINISTIC_ORCHESTRATION_V1';
  instruction: string;
  style: AiStyle;
  targetDurationSeconds: number;
  collectionIds: string[];
  toolCalls: AiAgentToolCall[];
  assessmentIds: string[];
  proposal: AiScriptProposal | null;
  warnings: string[];
  error: string | null;
  startedAt: string;
  completedAt: string | null;
  elapsedMs: number;
  usage: AiUsage;
  approval: 'PENDING';
  productionApproved: false;
}
export interface AiCollectionInput {
  collectionId: string;
  collection: ThreadCollection;
  style: AiStyle;
  heuristic: unknown;
}
