export const REMOTION_COMPOSITION_IDS = {
  TIKTOK_MUSIC: 'TiktokMusic',
  THREADS_TOPIC: 'ThreadsTopicVideo',
  SERIOUS_ADVICE: 'SeriousAdviceVideo',
  VISUAL_STORY: 'VisualStoryNewsReel',
  FUNNY_TIMELINE_PREVIEW: 'FunnyTimelinePreview',
  SERIOUS_TIMELINE_PREVIEW: 'SeriousTimelinePreview',
} as const;

export type RemotionCompositionId =
  (typeof REMOTION_COMPOSITION_IDS)[keyof typeof REMOTION_COMPOSITION_IDS];
