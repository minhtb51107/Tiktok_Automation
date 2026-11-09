import type { DATA_SCHEMA,SourceInput,Gold } from './contracts';
import type { SourceAttempt } from '../studio/public-types';
export type DiscoveryTopic='WORK'|'LIFE'|'FAMILY'|'ALL';
export type QualityBucket='GOLD_CANDIDATE'|'NEEDS_REVIEW'|'LOW_PRIORITY'|'REJECTED'|'QUARANTINED';
export interface CrawlerRequest {
  mode: 'SEARCH' | 'FEED' | 'URLS';
  keyword?: string;
  urls?: string[];
  requestId: string;
  limit?: number;
  topic?: DiscoveryTopic;
}
export interface CrawlerRun {
  execution: 'LIVE' | 'MOCK';
  schemaVersion: typeof DATA_SCHEMA;
  crawlerVersion: 'legacy-public-crawler/1';
  id: string;
  input: CrawlerRequest;
  status: 'RUNNING' | 'COMPLETED' | 'FAILED' | 'BLOCKED_ACCESS';
  stage: string;
  startedAt: string;
  completedAt: string | null;
  elapsedMs: number;
  urls: string[] | null;
  cursor: number;
  captures: {
    url: string;
    attempt: SourceAttempt;
    input: SourceInput | null;
    importRunId: string | null;
    done: boolean;
    captureHash: string;
    shadowIds?: string[];
  }[];
  error: string | null;
  warnings: string[];
  history: { at: string; stage: string; status: string }[];
}
export interface GoldShadow {schemaVersion:typeof DATA_SCHEMA;id:string;postId:string;bronzeId:string;evaluationId:string;evaluationRevision:number;createdAt:string;result:{version:string;configHash:string;topic:DiscoveryTopic;v1:{score:number;eligibility:Gold['eligibility'];evaluationVersion:string;labels:Gold['labels']}|null;v2:Gold|null;bucket:QualityBucket;voiceWarnings:string[];reasons:string[];tokenCount:number;proposedOnly:true;productionAllowed:false;}}
