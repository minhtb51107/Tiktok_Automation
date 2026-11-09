import type { StudioSession } from '../studio/studio.contracts';
import type { PublicRecord } from '../studio/public-types';
import type { SourceInput } from './contracts';
import { permalink, hash } from './rules';
/** Read-only projection. No displayText/spokenText, credentials or media bytes. */
export function savedSessionInputs(s: StudioSession): SourceInput[] {
  if (s.project.style !== 'SERIOUS')
    throw Error(
      'DATA-01 accepts THREADS SERIOUS only; other workflows remain legacy',
    );
  const inputs: SourceInput[] = [];
  for (const i of s.items.filter(
    (i) => i.selected && i.inclusion !== 'EXPLICIT_CONTEXT',
  )) {
    const attempt = s.attempts?.find((a) => a.canonicalUrl === i.sourceUrl),
      link = permalink(i.sourceUrl);
    const raw =
      i.rawExtraction ||
      ({
        text: i.originalText,
        author: i.author.displayName,
        handle: i.author.handle || null,
        avatar: i.author.avatarUrl || null,
        type: 'UNKNOWN',
        parentReference: null,
        createdAt: null,
        media: [],
        likeCount: null,
        replyCount: null,
        repostCount: null,
        shareCount: null,
        provenance: {
          text: 'Studio immutable original; extractor payload unavailable',
        },
      } as PublicRecord);
    const observations: {
      record: PublicRecord;
      at: string | null;
      source: string;
    }[] = [
      {
        record: raw,
        at: attempt?.retrievedAt || s.sourceRun?.completedAt || null,
        source: 'STUDIO_RAW_EXTRACTION',
      },
    ];
    for (const o of i.metadataObservations || [])
      observations.push({
        record: o.record,
        at: o.observedAt,
        source: 'STUDIO_METADATA_OBSERVATION',
      });
    if (
      i.metadata &&
      hash(i.metadata) !== hash(observations[observations.length - 1].record)
    )
      observations.push({
        record: i.metadata,
        at: null,
        source: 'STUDIO_LATEST_METADATA_UNDATED',
      });
    for (const o of observations) {
      const r = o.record,
        m = i.contentMapping;
      inputs.push({
        sourcePlatform: 'THREADS',
        sourcePostId: attempt?.matchedTargetId || link?.id || null,
        sourceUrl: link?.url || i.sourceUrl || null,
        author: {
          name: r.author ?? null,
          handle: r.handle ?? null,
          avatarUrl: r.avatar ?? null,
        },
        originalBody: r.bodyText ?? r.text ?? null,
        topic: r.topic ?? null,
        itemType: r.type,
        parentReference: r.parentReference ?? null,
        publishedAt: r.createdAt ?? null,
        fetchedAt: o.at,
        engagement: {
          likes: r.likeCount ?? null,
          replies: r.replyCount ?? null,
          reposts: r.repostCount ?? null,
          shares: r.shareCount ?? null,
        },
        fetch: {
          source: o.source,
          query: attempt?.originalUrl || i.sourceUrl || null,
        },
        rawPayload: r,
        provenance: {
          sessionId: s.id,
          itemId: i.id,
          sessionRevision: s.revision,
          identityEvidence: attempt?.matchMethod || 'UNVERIFIED',
          synthetic: false,
          ...(m?.status === 'VERIFIED' && m.evidence.sourceUrl === i.sourceUrl
            ? {
                bodyMapping: {
                  body: m.bodyText,
                  topic: m.topic,
                  evidence: m.evidence.type + ': ' + m.evidence.detail,
                  sourceUrl: link?.url || i.sourceUrl,
                },
              }
            : {}),
        },
      });
    }
  }
  return inputs;
}
