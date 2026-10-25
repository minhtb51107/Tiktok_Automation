export const VIDEO_PIPELINE_CONTRACT_VERSION = '1.0' as const;

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

export type VoiceProvider = 'EDGE' | 'GOOGLE' | 'OPENAI' | 'FIXTURE';

export interface VoiceSelection {
  provider: VoiceProvider;
  voiceId: string;
  language: string;
}

export type AssetAvailability = 'AVAILABLE' | 'MISSING';
export type DurationSource = 'MEASURED' | 'FIXTURE' | 'MANUAL';

export interface AudioAsset {
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
