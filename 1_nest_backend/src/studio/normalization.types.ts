export interface TextProposal {
  mode?: 'LIVE' | 'OFFLINE' | 'MOCK';
  executionStatus?:
    | 'SUCCESS'
    | 'BLOCKED_BILLING'
    | 'AUTH_ERROR'
    | 'RATE_LIMITED'
    | 'ERROR';
  diagnostic?: {
    httpStatus: number;
    endpoint: string;
    credential: 'present' | 'absent';
    redactedBody: string;
    billingInfo: string;
  };
  labels?: {
    term: string;
    replacement: string;
    category: 'EXPAND' | 'KEEP' | 'OMIT_SPOKEN' | 'REVIEW_AMBIGUOUS';
    reason: string;
  }[];
  explicitLockedTextApproval?: boolean;
  runId: string;
  itemId: string;
  baseRevision: number;
  inputText: string;
  originalText: string;
  proposedSpokenText: string | null;
  changes: { before: string; after: string; reason: string }[];
  ambiguousTerms: { term: string; reason: string }[];
  warnings: string[];
  error: string | null;
  approval: 'PENDING' | 'ACCEPTED' | 'REJECTED' | 'ERROR';
  decidedAt: string | null;
  provider: string;
  model: string;
  startedAt: string;
  completedAt: string;
  latencyMs: number;
  tokenUsage: {
    input: number | null;
    output: number | null;
    total: number | null;
  };
  estimatedCost: number | null;
}
