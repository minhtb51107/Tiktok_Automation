import type { SourceAttempt } from '../studio/public-threads';
import type { SourceInput } from './contracts';
import { permalink } from './rules';
export function crawlerInput(
  a: SourceAttempt,
  runId: string,
  synthetic = false,
): SourceInput | null {
  const r = a.records[0],
    link = permalink(a.canonicalUrl);
  if (
    !r ||
    !link ||
    a.matchedTargetId !== link.id ||
    !['DOM_PERMALINK', 'PUBLIC_CANONICAL_METADATA'].includes(
      a.matchMethod || '',
    )
  )
    return null;
  return {
    sourcePlatform: 'THREADS',
    sourcePostId: link.id,
    sourceUrl: link.url,
    author: {
      name: r.author || null,
      handle: r.handle || null,
      avatarUrl: r.avatar || null,
    },
    originalBody: r.bodyText ?? r.text,
    topic: typeof r.topic === 'string' ? r.topic : null,
    itemType: r.type,
    parentReference: r.parentReference,
    publishedAt: r.createdAt,
    fetchedAt: a.retrievedAt,
    engagement: {
      likes: r.likeCount,
      replies: r.replyCount,
      reposts: r.repostCount,
      shares: r.shareCount ?? null,
    },
    fetch: { source: 'CONTROLLED_LEGACY_PUBLIC_CRAWLER', query: a.originalUrl },
    rawPayload: r,
    provenance: {
      synthetic,
      identityEvidence: a.matchMethod,
      collectionRunId: runId,
      discoveryReviewRequired: true,
      ...(typeof r.bodyText === 'string' && r.topicEvidence
        ? {
            bodyMapping: {
              body: r.bodyText,
              topic: typeof r.topic === 'string' ? r.topic : null,
              evidence: 'DOM: ' + r.topicEvidence.href,
              sourceUrl: link.url,
            },
          }
        : {}),
    },
  };
}
