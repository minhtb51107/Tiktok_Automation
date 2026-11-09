export const VIDEO_PIPELINE_CONTRACT_VERSION = '1.0' as const;
export interface ProductionOrigin {
  conversation?:{collectionId:string;planId:string;planRevision:number;bundleHash:string;selectionRevision:number;selectedReplyIds:string[];sourceProvenance?:'REAL'|'SYNTHETIC'|'UNKNOWN'};
  jobId:string;postId:string;bronzeId:string;silverId:string;evaluationId:string;
  evaluationRevision:number;queueId:string;snapshotHash:string;mode:'DRAFT_ONLY';
}

export type ContentStyle = 'FUNNY' | 'SERIOUS';
export type ContentEntityType = 'POST' | 'COMMENT';

export interface SourceReference {
  entityType: ContentEntityType;
  entityId: string;
}

export interface ContentAuthor {
  id?: string;
  displayName: string;
  handle?: string;
  avatarUrl?: string;
}

export interface ContentSource {
  id: string;
  platform: 'THREADS';
  canonicalUrl: string;
  retrievedAt: string;
  synthetic: boolean;
}

export interface ThreadPost {
  id: string;
  sourceId: string;
  externalId?: string;
  author: ContentAuthor;
  text: string;
  mediaAssetIds: string[];
  commentIds: string[];
}

export interface ThreadComment {
  relationshipStatus?: 'PARENT_VERIFIED' | 'OBSERVED_ON_TARGET_PAGE' | 'UNKNOWN';
  observedTargetUrl?: string;
  id: string;
  sourceId: string;
  postId: string;
  parentCommentId?: string;
  author: ContentAuthor;
  text: string;
  mediaAssetIds: string[];
}

export interface ContentCandidate {
  id: string;
  style: ContentStyle;
  sourceReferences: SourceReference[];
  status: 'PENDING' | 'SELECTED' | 'REJECTED';
  selectionReason?: string;
  selectedBy?: 'USER' | 'RULE' | 'AI_FIXTURE';
}

export type VoiceProvider = 'EDGE' | 'GOOGLE' | 'OPENAI' | 'FIXTURE' | 'KOKORO';

export interface VoiceSelection {
  provider: VoiceProvider;
  voiceId: string;
  language: string;
}

export type AssetAvailability = 'AVAILABLE' | 'MISSING';
export type DurationSource = 'MEASURED' | 'FIXTURE' | 'MANUAL';

export interface AudioAsset {
  approvalStatus?: 'PENDING' | 'APPROVED';
  id: string;
  role: 'NARRATION' | 'SFX' | 'BGM';
  uri: string;
  durationMs: number;
  durationSource: DurationSource;
  availability: AssetAvailability;
  voice?: VoiceSelection;
}

export interface MediaAsset {
  id: string;
  kind: 'IMAGE' | 'GIF' | 'VIDEO' | 'MEME' | 'BACKGROUND';
  uri: string;
  availability: AssetAvailability;
  durationMs?: number;
  width?: number;
  height?: number;
  sourceReference?: SourceReference;
}

export interface SubtitleCue {
  id: string;
  text: string;
  startMs: number;
  endMs: number;
}

export interface FunnySceneProperties {
  style: 'FUNNY';
  template: 'THREADS_CARD';
  emphasis: 'POST' | 'COMMENT' | 'MEME';
}

export interface SeriousSceneProperties {
  style: 'SERIOUS';
  template: 'STORY_CARD';
  cardMode: 'POST' | 'COMMENT' | 'NARRATION';
  tone: 'REFLECTIVE' | 'ANALYTICAL' | 'EMOTIONAL';
}

export type StyleSpecificSceneProperties =
  | FunnySceneProperties
  | SeriousSceneProperties;

export type SceneLockedField =
  | 'SOURCE_REFERENCES'
  | 'DISPLAY_TEXT'
  | 'NARRATION_TEXT'
  | 'VOICE'
  | 'MEDIA'
  | 'SFX'
  | 'TIMING'
  | 'SUBTITLES'
  | 'STYLE_PROPERTIES';

export interface ManualOverrideState {
  lockedFields: SceneLockedField[];
  revision: number;
  lastEditedBy?: string;
}

export interface SceneTimingRequest {
  paddingBeforeMs: number;
  paddingAfterMs: number;
  manualSceneDurationMs?: number;
}

export interface StoryboardScene {
  imageNarration?:Array<{imageHash:string;sourceUrl:string;mode:'READ_FULL'|'SUMMARIZE';reviewer:'USER'|'AGENT_VISUAL'|null;ocrRevision:number;text:string}>;
  editorial?:{kind:import('../data-engine/editorial-contracts').EditorialKind;stage:string};
  visual?:import('./scene-visual').SceneVisual;
  sfxLayer?:{assetId:string;startMs:number;volume:number;durationMs?:number;sourceInMs?:number};
  threadsCard?: {
    topic?:string|null;
    countLabels?:Record<string,string|null>;
    author: string; handle: string | null; avatarUrl: string | null;
    createdAt: string | null; dateLabel: string | null; sourceUrl: string;
    counts: {likes:number|null;replies:number|null;reposts:number|null;shares:number|null};
    fieldStates: Record<string,string>;
  };
  id: string;
  order: number;
  sourceReferences: SourceReference[];
  displayText: string;
  narrationText: string;
  voice: VoiceSelection;
  audioAssetId?: string;
  mediaAssetIds: string[];
  sfxAssetIds: string[];
  subtitles: SubtitleCue[];
  timing: SceneTimingRequest;
  styleProperties: StyleSpecificSceneProperties;
  manualOverride: ManualOverrideState;
}

export interface TimelineSubtitleCue extends SubtitleCue {
  startFrame: number;
  endFrame: number;
}

export interface TimelineScene {
  scene: StoryboardScene;
  startFrame: number;
  endFrame: number;
  durationInFrames: number;
  contentStartFrame: number;
  contentEndFrame: number;
  audioStartFrame?: number;
  audioEndFrame?: number;
  audioDurationMs?: number;
  sceneDurationMs: number;
  subtitles: TimelineSubtitleCue[];
}

export interface VideoTimeline {
  contractVersion: typeof VIDEO_PIPELINE_CONTRACT_VERSION;
  projectId: string;
  style: ContentStyle;
  fps: number;
  width: number;
  height: number;
  introDurationInFrames: number;
  outroDurationInFrames: number;
  scenes: TimelineScene[];
  totalFrames: number;
  totalDurationMs: number;
}

export interface PublishingMetadata {
  title: string;
  caption: string;
  hashtags: string[];
  language: string;
  manualApprovalRequired: true;
}

export interface VideoProject {
  editorialApproval?:{status:'APPROVED'|'STALE';scriptHash:string;reason:string;approvedAt:string;sessionRevision:number};
  editorialApprovalHistory?:Array<{scriptHash:string;reason:string;approvedAt:string;sessionRevision:number}>;
  editorialPlan?:import('../data-engine/editorial-contracts').EditorialPlan;
  productionOrigin?: ProductionOrigin;
  backgroundTracks?:import('./editing').BackgroundClip[];
  editorSettings?:unknown;
  backgroundMusic?:import('./scene-visual').BackgroundMusic;
  contractVersion: typeof VIDEO_PIPELINE_CONTRACT_VERSION;
  id: string;
  style: ContentStyle;
  title: string;
  sources: ContentSource[];
  posts: ThreadPost[];
  comments: ThreadComment[];
  candidates: ContentCandidate[];
  storyboard: StoryboardScene[];
  audioAssets: AudioAsset[];
  mediaAssets: MediaAsset[];
  timeline?: VideoTimeline;
  publishing: PublishingMetadata;
}

export interface VideoPreviewProps extends Record<string, unknown> {
  backgroundTracks?:import('./editing').BackgroundClip[];
  backgroundMusic?:import('./scene-visual').BackgroundMusic;
  contractVersion: typeof VIDEO_PIPELINE_CONTRACT_VERSION;
  timeline: VideoTimeline;
  audioAssets: AudioAsset[];
  mediaAssets: MediaAsset[];
  previewMode: true;
}

export interface RemotionPreviewRequest {
  compositionId: 'FunnyTimelinePreview' | 'SeriousTimelinePreview';
  durationInFrames: number;
  fps: number;
  inputProps: VideoPreviewProps;
}
