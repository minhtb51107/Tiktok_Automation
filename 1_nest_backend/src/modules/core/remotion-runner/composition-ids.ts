export const REMOTION_COMPOSITION_IDS = {
  TIKTOK_MUSIC: 'TiktokMusic',
  THREADS_TOPIC: 'ThreadsTopicVideo',
  SERIOUS_ADVICE: 'SeriousAdviceVideo',
  VISUAL_STORY: 'VisualStoryNewsReel',
} as const;

export type RemotionCompositionId =
  (typeof REMOTION_COMPOSITION_IDS)[keyof typeof REMOTION_COMPOSITION_IDS];
