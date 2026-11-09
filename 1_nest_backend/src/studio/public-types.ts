export interface PublicRecord {
  topic?:string|null;
  bodyText?:string;
  topicEvidence?:{href:string;label:string};
  shareCount?:number|null;
  fields?:Record<string,import('./metadata-fields').ObservedField>;
  text: string;
  author: string;
  handle: string | null;
  avatar: string | null;
  createdAt: string | null;
  type: 'POST' | 'COMMENT' | 'UNKNOWN';
  parentReference: string | null;
  media: { url: string; kind: 'IMAGE' | 'VIDEO' | 'GIF' }[];
  likeCount: number | null;
  replyCount: number | null;
  repostCount: number | null;
  provenance: Record<string, string>;
  [key: string]: unknown;
}
export interface SourceAttempt {
  scope?: 'TARGET_ONLY' | 'WITH_CONTEXT';
  matchedTargetId?: string | null;
  matchMethod?: 'DOM_PERMALINK' | 'PUBLIC_CANONICAL_METADATA' | 'UNVERIFIED';
  contextCandidates?: PublicRecord[];
  browserNavigations?: number;
  domCandidates?: number;
  originalUrl: string;
  resolvedUrl: string | null;
  canonicalUrl: string | null;
  status: 'SUCCESS' | 'PARTIAL' | 'ERROR';
  elapsedMs: number;
  diagnostics: { stage: string; code: string; message: string }[];
  redirects: { url: string; status: number; location: string | null }[];
  records: PublicRecord[];
  retrievedAt: string;
}
