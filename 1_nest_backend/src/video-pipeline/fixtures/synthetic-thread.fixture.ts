/**
 * Synthetic test data only. No record in this file was scraped from Threads or
 * produced by a live AI provider.
 */
import {
  AudioAsset,
  ContentStyle,
  MediaAsset,
  VideoProject,
  VIDEO_PIPELINE_CONTRACT_VERSION,
} from '../contracts';
import { acceptAiStoryboard } from '../ai-storyboard';
import { normalizeThreadContent, RawThreadPost } from '../normalization';

export const SYNTHETIC_RAW_THREAD: RawThreadPost = {
  id: 'synthetic-post-001',
  url: 'https://example.invalid/threads/synthetic-post-001',
  retrievedAt: '2026-10-25T00:00:00.000Z',
  synthetic: true,
  author: { displayName: 'Synthetic Author', handle: '@fixture_author' },
  text: '  Một bài Threads hoàn toàn giả lập   để kiểm thử pipeline.  ',
  comments: [
    {
      id: 'synthetic-comment-001',
      author: { displayName: 'Fixture One' },
      text: ' Bình luận đầu tiên có punchline. ',
    },
    {
      id: 'synthetic-comment-empty',
      author: { displayName: 'Fixture Empty' },
      text: '   ',
    },
    {
      id: 'synthetic-comment-duplicate',
      author: { displayName: 'Fixture Duplicate' },
      text: 'bình luận đầu tiên có PUNCHLINE.',
    },
    {
      id: 'synthetic-comment-002',
      author: { displayName: 'Fixture Two' },
      text: 'Một góc nhìn thứ hai để đổi nhịp.',
    },
    {
      id: 'synthetic-comment-003',
      author: { displayName: 'Fixture Three' },
      text: 'Kết luận ngắn cho dữ liệu thử nghiệm.',
    },
  ],
};

export const SYNTHETIC_AUDIO_ASSETS: AudioAsset[] = [
  {
    id: 'audio-funny-post',
    role: 'NARRATION',
    uri: 'fixtures/video-pipeline/audio/funny-post.wav',
    durationMs: 2200,
    durationSource: 'FIXTURE',
    availability: 'AVAILABLE',
    voice: { provider: 'FIXTURE', voiceId: 'funny-voice', language: 'vi-VN' },
  },
  {
    id: 'audio-funny-comment-1',
    role: 'NARRATION',
    uri: 'fixtures/video-pipeline/audio/funny-comment-1.wav',
    durationMs: 1800,
    durationSource: 'FIXTURE',
    availability: 'AVAILABLE',
    voice: { provider: 'FIXTURE', voiceId: 'funny-voice', language: 'vi-VN' },
  },
  {
    id: 'audio-funny-comment-2',
    role: 'NARRATION',
    uri: 'fixtures/video-pipeline/audio/funny-comment-2.wav',
    durationMs: 2500,
    durationSource: 'FIXTURE',
    availability: 'AVAILABLE',
    voice: { provider: 'FIXTURE', voiceId: 'funny-voice', language: 'vi-VN' },
  },
  {
    id: 'audio-funny-comment-3',
    role: 'NARRATION',
    uri: 'fixtures/video-pipeline/audio/funny-comment-3.wav',
    durationMs: 1600,
    durationSource: 'FIXTURE',
    availability: 'AVAILABLE',
    voice: { provider: 'FIXTURE', voiceId: 'funny-voice', language: 'vi-VN' },
  },
  {
    id: 'audio-serious-post',
    role: 'NARRATION',
    uri: 'fixtures/video-pipeline/audio/serious-post.wav',
    durationMs: 4200,
    durationSource: 'FIXTURE',
    availability: 'AVAILABLE',
    voice: { provider: 'FIXTURE', voiceId: 'serious-voice', language: 'vi-VN' },
  },
  {
    id: 'audio-serious-comment',
    role: 'NARRATION',
    uri: 'fixtures/video-pipeline/audio/serious-comment.wav',
    durationMs: 3600,
    durationSource: 'FIXTURE',
    availability: 'AVAILABLE',
    voice: { provider: 'FIXTURE', voiceId: 'serious-voice', language: 'vi-VN' },
  },
  {
    id: 'sfx-pop',
    role: 'SFX',
    uri: 'fixtures/video-pipeline/audio/pop.wav',
    durationMs: 250,
    durationSource: 'FIXTURE',
    availability: 'AVAILABLE',
  },
];

export const SYNTHETIC_MEDIA_ASSETS: MediaAsset[] = [
  {
    id: 'meme-reaction',
    kind: 'MEME',
    uri: 'fixtures/video-pipeline/meme-reaction.svg',
    availability: 'AVAILABLE',
    width: 640,
    height: 640,
  },
  {
    id: 'funny-background',
    kind: 'BACKGROUND',
    uri: 'fixtures/video-pipeline/funny-background.svg',
    availability: 'AVAILABLE',
    width: 1080,
    height: 1920,
  },
  {
    id: 'serious-background',
    kind: 'BACKGROUND',
    uri: 'fixtures/video-pipeline/serious-background.svg',
    availability: 'AVAILABLE',
    width: 1080,
    height: 1920,
  },
];

export const SYNTHETIC_FUNNY_AI_OUTPUT: unknown = [
  {
    id: 'funny-scene-post',
    order: 0,
    sourceReferences: [{ entityType: 'POST', entityId: 'synthetic-post-001' }],
    displayText: 'Một bài đăng mở đầu cho tình huống giả lập',
    narrationText: 'Đây là phần mở đầu hoàn toàn tổng hợp.',
    voice: { provider: 'FIXTURE', voiceId: 'funny-voice', language: 'vi-VN' },
    audioAssetId: 'audio-funny-post',
    mediaAssetIds: ['meme-reaction'],
    sfxAssetIds: ['sfx-pop'],
    subtitles: [
      { id: 'sub-funny-post-1', text: 'Đây là phần mở đầu', startMs: 0, endMs: 900 },
      { id: 'sub-funny-post-2', text: 'hoàn toàn tổng hợp', startMs: 900, endMs: 2100 },
    ],
    timing: { paddingBeforeMs: 200, paddingAfterMs: 300 },
    styleProperties: {
      style: 'FUNNY',
      template: 'THREADS_CARD',
      emphasis: 'POST',
    },
  },
  {
    id: 'funny-scene-comment-1',
    order: 1,
    sourceReferences: [
      { entityType: 'COMMENT', entityId: 'synthetic-comment-001' },
    ],
    displayText: 'Bình luận đầu tiên có punchline.',
    narrationText: 'Bình luận đầu tiên tạo nhịp hài.',
    voice: { provider: 'FIXTURE', voiceId: 'funny-voice', language: 'vi-VN' },
    audioAssetId: 'audio-funny-comment-1',
    mediaAssetIds: [],
    sfxAssetIds: [],
    subtitles: [
      { id: 'sub-funny-comment-1', text: 'Bình luận đầu tiên', startMs: 0, endMs: 1700 },
    ],
    timing: { paddingBeforeMs: 100, paddingAfterMs: 250 },
    styleProperties: {
      style: 'FUNNY',
      template: 'THREADS_CARD',
      emphasis: 'COMMENT',
    },
  },
  {
    id: 'funny-scene-comment-2',
    order: 2,
    sourceReferences: [
      { entityType: 'COMMENT', entityId: 'synthetic-comment-002' },
    ],
    displayText: 'Một góc nhìn thứ hai để đổi nhịp.',
    narrationText: 'Góc nhìn thứ hai giúp câu chuyện đổi nhịp.',
    voice: { provider: 'FIXTURE', voiceId: 'funny-voice', language: 'vi-VN' },
    audioAssetId: 'audio-funny-comment-2',
    mediaAssetIds: [],
    sfxAssetIds: [],
    subtitles: [
      { id: 'sub-funny-comment-2', text: 'Góc nhìn thứ hai', startMs: 100, endMs: 2200 },
    ],
    timing: { paddingBeforeMs: 150, paddingAfterMs: 150 },
    styleProperties: {
      style: 'FUNNY',
      template: 'THREADS_CARD',
      emphasis: 'COMMENT',
    },
  },
  {
    id: 'funny-scene-comment-3',
    order: 3,
    sourceReferences: [
      { entityType: 'COMMENT', entityId: 'synthetic-comment-003' },
    ],
    displayText: 'Kết luận ngắn cho dữ liệu thử nghiệm.',
    narrationText: 'Đây là cảnh có thể xóa trong bài kiểm thử.',
    voice: { provider: 'FIXTURE', voiceId: 'funny-voice', language: 'vi-VN' },
    audioAssetId: 'audio-funny-comment-3',
    mediaAssetIds: [],
    sfxAssetIds: [],
    subtitles: [],
    timing: { paddingBeforeMs: 100, paddingAfterMs: 100 },
    styleProperties: {
      style: 'FUNNY',
      template: 'THREADS_CARD',
      emphasis: 'COMMENT',
    },
  },
];

export const SYNTHETIC_SERIOUS_AI_OUTPUT: unknown = [
  {
    id: 'serious-scene-post',
    order: 0,
    sourceReferences: [{ entityType: 'POST', entityId: 'synthetic-post-001' }],
    displayText: 'Bối cảnh của câu chuyện tổng hợp',
    narrationText: 'Ta bắt đầu bằng việc nhìn lại bối cảnh một cách chậm rãi.',
    voice: { provider: 'FIXTURE', voiceId: 'serious-voice', language: 'vi-VN' },
    audioAssetId: 'audio-serious-post',
    mediaAssetIds: ['serious-background'],
    sfxAssetIds: [],
    subtitles: [
      { id: 'sub-serious-post', text: 'Nhìn lại bối cảnh', startMs: 400, endMs: 3000 },
    ],
    timing: { paddingBeforeMs: 300, paddingAfterMs: 500 },
    styleProperties: {
      style: 'SERIOUS',
      template: 'STORY_CARD',
      cardMode: 'POST',
      tone: 'REFLECTIVE',
    },
  },
  {
    id: 'serious-scene-comment',
    order: 1,
    sourceReferences: [
      { entityType: 'COMMENT', entityId: 'synthetic-comment-002' },
    ],
    displayText: 'Phân tích góc nhìn thứ hai',
    narrationText: 'Góc nhìn thứ hai bổ sung một lớp phân tích cho câu chuyện.',
    voice: { provider: 'FIXTURE', voiceId: 'serious-voice', language: 'vi-VN' },
    audioAssetId: 'audio-serious-comment',
    mediaAssetIds: ['serious-background'],
    sfxAssetIds: [],
    subtitles: [
      { id: 'sub-serious-comment', text: 'Một lớp phân tích', startMs: 300, endMs: 2800 },
    ],
    timing: { paddingBeforeMs: 200, paddingAfterMs: 600 },
    styleProperties: {
      style: 'SERIOUS',
      template: 'STORY_CARD',
      cardMode: 'COMMENT',
      tone: 'ANALYTICAL',
    },
  },
];

export const createSyntheticVideoProject = (style: ContentStyle): VideoProject => {
  const normalized = normalizeThreadContent(SYNTHETIC_RAW_THREAD);
  const storyboard = acceptAiStoryboard(
    style === 'FUNNY' ? SYNTHETIC_FUNNY_AI_OUTPUT : SYNTHETIC_SERIOUS_AI_OUTPUT,
    style,
  );
  return {
    contractVersion: VIDEO_PIPELINE_CONTRACT_VERSION,
    id: `synthetic-project-${style.toLocaleLowerCase()}`,
    style,
    title: `Synthetic ${style} project`,
    sources: [normalized.source],
    posts: [normalized.post],
    comments: normalized.comments,
    candidates: [
      {
        id: `candidate-${style.toLocaleLowerCase()}`,
        style,
        sourceReferences: [
          { entityType: 'POST', entityId: normalized.post.id },
          ...normalized.comments.map((comment) => ({
            entityType: 'COMMENT' as const,
            entityId: comment.id,
          })),
        ],
        status: 'SELECTED',
        selectionReason: 'Synthetic deterministic fixture',
        selectedBy: 'AI_FIXTURE',
      },
    ],
    storyboard,
    audioAssets: SYNTHETIC_AUDIO_ASSETS,
    mediaAssets: SYNTHETIC_MEDIA_ASSETS,
    publishing: {
      title: `Synthetic ${style} preview`,
      caption: 'Synthetic fixture — not for publishing',
      hashtags: ['synthetic', 'offline-test'],
      language: 'vi-VN',
      manualApprovalRequired: true,
    },
  };
};
