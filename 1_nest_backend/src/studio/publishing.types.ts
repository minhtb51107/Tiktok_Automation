export type PostingMode = 'INBOX_UPLOAD' | 'DIRECT_POST';
export type ExecutionMode = 'LIVE' | 'MOCK';
export interface TikTokAccount {
  id: string;
  mode: ExecutionMode;
  subjectHash?: string;
  nickname: string;
  username: string | null;
  avatarUrl: string | null;
  scopes: string[];
  status: 'CONNECTED' | 'MOCK_CONNECTED' | 'DISCONNECTED' | 'BLOCKED_AUTH';
  expiresAt: number;
  updatedAt: string;
}
export interface CreatorInfo {
  source: ExecutionMode;
  checkedAt: string;
  creator_username: string;
  creator_nickname: string;
  creator_avatar_url: string | null;
  privacy_level_options: string[];
  comment_disabled: boolean;
  duet_disabled: boolean;
  stitch_disabled: boolean;
  max_video_post_duration_sec: number;
}
export interface PublishingDraft {
  revision: number;
  accountId: string;
  execution: ExecutionMode;
  mode: PostingMode;
  renderJobId: string;
  caption: string;
  hashtags: string[];
  mentions: string[];
  coverMs: number;
  privacy: string;
  allowComment: boolean;
  allowDuet: boolean;
  allowStitch: boolean;
  ownBrand: boolean;
  paidPartnership: boolean;
  aiDisclosure: 'UNSET' | 'YES' | 'NO';
  musicConsent: boolean;
  contentConsent: boolean;
}
export interface PublicationJob {
  id: string;
  sessionId: string;
  accountId: string;
  mode: PostingMode;
  execution: ExecutionMode;
  renderJobId: string;
  status: string;
  stage: string;
  createdAt: string;
  completedAt: string | null;
  errors: string[];
  warnings: string[];
  publishId: string | null;
  uploadedBytes: number | null;
  totalBytes: number | null;
  requestHash: string;
  draft: PublishingDraft;
}
