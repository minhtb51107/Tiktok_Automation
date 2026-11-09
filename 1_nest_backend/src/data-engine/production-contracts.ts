import type { Bronze, Evaluation, DATA_SCHEMA } from './contracts';
import type { DataEngine } from './engine';
export type ProductionSnapshot = {
  editorial?: import('./editorial-contracts').EditorialSnapshot;
  bronze: Bronze;
  evaluation: Evaluation;
  input: Awaited<ReturnType<DataEngine['productionInput']>>;
};
export interface ProductionRequest {
  postId: string;
  evaluationId: string;
  queueId: string;
  revision: number;
  requestId: string;
}
export interface ProductionJob {
  schemaVersion: typeof DATA_SCHEMA;
  jobVersion: 'production-consumer/1';
  id: string;
  projectId: string;
  request: ProductionRequest;
  requestIds: string[];
  snapshot: ProductionSnapshot;
  snapshotHash: string;
  status: 'QUEUED' | 'RUNNING' | 'SUCCEEDED' | 'FAILED';
  stage: string;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
  attempts: number;
  error: string | null;
  history: {
    at: string;
    status: ProductionJob['status'];
    stage: string;
    reason: string;
  }[];
  studioUrl: string;
  mode: 'DRAFT_ONLY';
  publishingAllowed: false;
}
