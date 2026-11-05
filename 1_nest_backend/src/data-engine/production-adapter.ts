import type { ProductionJob } from './production-contracts';
import type { StudioSession } from '../studio/studio.contracts';
import type { PublicRecord } from '../studio/public-types';
import { editorSettings } from '../video-pipeline/editor-state';
import { VOICE_SPEED } from '../studio/voice-settings';
import {editorialSession} from './editorial-adapter';
/** Pure saved-data projection. No network, AI, inference, render or approval. */
export function productionSession(job: ProductionJob): StudioSession {
  const { bronze: b, evaluation: e, input } = job.snapshot;
  const type = input.candidate.sourceReferences[0].entityType;
  const body = input.content.displayText!;
  const author = {
    displayName: b.author.name || b.author.handle || '',
    ...(b.author.handle ? { handle: b.author.handle } : {}),
    ...(b.author.avatarUrl ? { avatarUrl: b.author.avatarUrl } : {}),
  };
  const origin = {
    jobId: job.id,
    postId: b.postId,
    bronzeId: b.id,
    silverId: e.silver!.id,
    evaluationId: e.id,
    evaluationRevision: e.revision,
    queueId: e.queue!.id,
    snapshotHash: job.snapshotHash,
    mode: 'DRAFT_ONLY' as const,
  };
  const raw = b.rawPayload as any;
  const media: PublicRecord['media'] = Array.isArray(raw?.media)
    ? raw.media.filter(
        (x: any) =>
          x &&
          typeof x.url === 'string' &&
          ['IMAGE', 'GIF', 'VIDEO'].includes(x.kind),
      )
    : [];
  if (
    !media.length &&
    typeof raw?.media_url === 'string' &&
    ['IMAGE', 'VIDEO'].includes(raw.media_type)
  )
    media.push({ url: raw.media_url, kind: raw.media_type });
  const record: PublicRecord = {
    text: b.originalBody!,
    bodyText: body,
    topic: e.silver!.normalized.topic,
    author: author.displayName,
    handle: b.author.handle,
    avatar: b.author.avatarUrl,
    createdAt: b.publishedAt,
    type,
    parentReference: b.parentReference,
    media,
    likeCount: b.engagement.likes,
    replyCount: b.engagement.replies,
    repostCount: b.engagement.reposts,
    shareCount: b.engagement.shares,
    provenance: {
      text: 'DATA01 Bronze ' + b.id,
      type: 'DATA01 confirmed target; review ' + e.id,
    },
  };
  record.fields = Object.fromEntries(
    Object.entries({
      author: record.author,
      handle: record.handle,
      avatar: record.avatar,
      createdAt: record.createdAt,
      topic: record.topic,
      likeCount: record.likeCount,
      replyCount: record.replyCount,
      repostCount: record.repostCount,
      shareCount: record.shareCount,
    }).map(([name, value]) => [
      name,
      {
        value: value ?? null,
        raw: null,
        status:
          value === null || value === undefined || value === ''
            ? 'UNAVAILABLE'
            : 'AVAILABLE',
        source: 'DATA01 Bronze ' + b.id,
      },
    ]),
  );
  const itemId = b.sourcePostId!;
  const title =
    (b.provenance.synthetic ? '[SYNTHETIC TEST DATA] ' : '') +
    'Threads SERIOUS — ' +
    author.displayName;
  const s: StudioSession = {
    id: job.projectId,
    title,
    revision: 0,
    updatedAt: '',
    status: 'READY',
    scope: 'TARGET_ONLY',
    errors: [],
    productionOrigin: origin,
    items: [
      {
        id: itemId,
        sourceId: b.id,
        sourceReference: { entityType: type, entityId: itemId },
        sourceUrl: b.sourceUrl!,
        author,
        originalText: b.originalBody!,
        displayText: body,
        spokenText: body,
        rawExtraction: {
          ...JSON.parse(JSON.stringify(record)),
          type: b.itemType,
          topic: b.topic,
          bodyText: b.originalBody!,
          provenance: {
            text: 'DATA01 Bronze projection ' + b.id,
            type: 'DATA01 Bronze original; review confirmation is separate',
          },
        },
        metadata: record,
        selected: true,
        inclusion: 'TARGET',
        order: 0,
        revision: 0,
        manualLocks: [],
        mediaReferences: media.map((x) => x.url),
        voiceSettings: { voice: 'my_yen', speed: VOICE_SPEED.default },
        ...(b.provenance.bodyMapping
          ? {
              contentMapping: {
                topic: b.provenance.bodyMapping.topic,
                bodyText: body,
                status: 'VERIFIED' as const,
                evidence: {
                  type: b.provenance.bodyMapping.evidence.startsWith('DOM')
                    ? ('DOM' as const)
                    : ('USER_CONFIRMED' as const),
                  detail: b.provenance.bodyMapping.evidence,
                  sourceUrl: b.sourceUrl!,
                },
                includeTopicInTts: false,
              },
            }
          : {}),
      },
    ],
    project: {
      contractVersion: '1.0',
      id: job.projectId,
      title,
      style: 'SERIOUS',
      productionOrigin: origin,
      sources: [input.source],
      posts: [],
      comments: [],
      candidates: [input.candidate],
      storyboard: [
        {
          id: itemId,
          order: 0,
          sourceReferences: input.candidate.sourceReferences,
          displayText: body,
          narrationText: body,
          voice: { provider: 'KOKORO', voiceId: 'my_yen', language: 'vi' },
          mediaAssetIds: [],
          sfxAssetIds: [],
          subtitles: [],
          timing: { paddingBeforeMs: 200, paddingAfterMs: 300 },
          styleProperties: {
            style: 'SERIOUS',
            template: 'STORY_CARD',
            cardMode: type,
            tone: 'REFLECTIVE',
          },
          manualOverride: { lockedFields: [], revision: 0 },
        },
      ],
      audioAssets: [],
      mediaAssets: [],
      publishing: {
        title,
        caption: '',
        hashtags: [],
        language: 'vi',
        manualApprovalRequired: true,
      },
    },
  };
  if (type === 'POST')
    s.project.posts.push({
      id: itemId,
      externalId: b.nativeSourceId || b.sourcePostId!,
      sourceId: b.id,
      author,
      text: b.originalBody!,
      mediaAssetIds: [],
      commentIds: [],
    });
  else
    s.project.comments.push({
      id: itemId,
      sourceId: b.id,
      postId: b.parentReference || '',
      author,
      text: b.originalBody!,
      mediaAssetIds: [],
    });
  s.editor = editorSettings(s);
  return job.snapshot.editorial?editorialSession(s,job.snapshot.editorial.plan):s;
}
