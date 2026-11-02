import type { SourceInput } from '../data-engine/contracts';
import { permalink } from '../data-engine/rules';
/** API ID is not the permalink shortcode. Keep both; canonical identity joins DATA-01. */
export function apiInput(
  r: any,
  query: string,
  fetchedAt: string,
  runId: string,
  synthetic = false,
): SourceInput {
  const link = permalink(r?.permalink),
    count = (v: unknown) => (typeof v === 'number' ? v : null);
  return {
    sourcePlatform: 'THREADS',
    sourcePostId: link?.id || null,
    nativeSourceId: typeof r?.id === 'string' ? r.id : null,
    sourceUrl: link?.url || null,
    author: {
      name: null,
      handle: typeof r?.username === 'string' ? r.username : null,
      avatarUrl: null,
    },
    originalBody: typeof r?.text === 'string' ? r.text : null,
    topic: typeof r?.topic_tag === 'string' ? r.topic_tag : null,
    itemType:
      r?.is_reply === true
        ? 'COMMENT'
        : r?.is_reply === false
          ? 'POST'
          : 'UNKNOWN',
    parentReference:
      typeof r?.replied_to?.id === 'string' ? r.replied_to.id : null,
    publishedAt: typeof r?.timestamp === 'string' ? r.timestamp : null,
    fetchedAt,
    engagement: {
      likes: count(r?.like_count),
      replies: count(r?.reply_count),
      reposts: count(r?.repost_count),
      shares: count(r?.share_count),
    },
    fetch: { source: 'OFFICIAL_THREADS_KEYWORD_SEARCH', query },
    rawPayload: r,
    provenance: {
      identityEvidence: 'OFFICIAL_THREADS_API',
      synthetic,
      collectionRunId: runId,
      discoveryReviewRequired: true,
    },
  };
}
export function safePage(page: any, secrets: string[]) {
  if (!page || !Array.isArray(page.data))
    throw Error('INVALID_RESPONSE: expected data array');
  for (const r of page.data)
    if (secrets.filter(Boolean).some((s) => JSON.stringify(r)?.includes(s)))
      throw Error(
        'INVALID_RESPONSE: credential-bearing content rejected, not rewritten',
      );
  const redact = (v: any): any => {
    if (Array.isArray(v)) return v.map(redact);
    if (v && typeof v === 'object')
      return Object.fromEntries(
        Object.entries(v).map(([k, value]) => [
          k,
          /^(access_token|client_secret|input_token|authorization|cookie|refresh_token)$/i.test(
            k,
          )
            ? '[REDACTED]'
            : redact(value),
        ]),
      );
    if (typeof v === 'string') {
      let s = v;
      for (const key of secrets.filter(Boolean))
        s = s.split(key).join('[REDACTED]');
      return s.replace(
        /([?&](?:access_token|input_token|client_secret)=)[^&#]*/gi,
        '$1[REDACTED]',
      );
    }
    return v;
  };
  return redact(page);
}
export function pageCursor(page: any) {
  let cursor = page.paging?.cursors?.after;
  if (!cursor && page.paging?.next) {
    const u = new URL(page.paging.next);
    if (
      u.protocol !== 'https:' ||
      u.username ||
      u.password ||
      u.port ||
      !['graph.threads.com', 'graph.threads.net'].includes(u.hostname) ||
      !/^\/v1\.0\/keyword_search$/.test(u.pathname)
    )
      throw Error('INVALID_RESPONSE: unsafe paging URL');
    cursor = u.searchParams.get('after');
  }
  if (
    cursor !== undefined &&
    cursor !== null &&
    (typeof cursor !== 'string' ||
      cursor.length > 2048 ||
      cursor.includes('[REDACTED]'))
  )
    throw Error('INVALID_RESPONSE: invalid cursor');
  return cursor || null;
}
