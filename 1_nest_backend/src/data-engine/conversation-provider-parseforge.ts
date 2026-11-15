import type { PublicRecord } from '../studio/public-types';
import type {
  PublicPost,
  ThreadCollection,
} from './conversation-contracts';
import {
  canonicalPost,
  type RelationshipCandidate,
} from './conversation-evidence';
import { hash } from './rules';

export const PARSEFORGE_ACTOR =
  'parseforge/threads-replies-scraper' as const;

/** Documented output subset. Unknown fields remain preserved in raw evidence. */
export interface ParseforgeReplyRow {
  postUrl?: unknown;
  postCode?: unknown;
  text?: unknown;
  postedAt?: unknown;
  likeCount?: unknown;
  replyCount?: unknown;
  repostCount?: unknown;
  reshareCount?: unknown;
  depth?: unknown;
  parentPostUrl?: unknown;
  parentPostCode?: unknown;
  rootPostUrl?: unknown;
  rootPostCode?: unknown;
  username?: unknown;
  authorFullName?: unknown;
  profileUrl?: unknown;
  imageUrls?: unknown;
  videoUrls?: unknown;
  scrapedAt?: unknown;
  error?: unknown;
  [key: string]: unknown;
}

export interface ParseforgeProjection {
  cards: PublicRecord[];
  candidates: RelationshipCandidate[];
  externalEvidence: NonNullable<ThreadCollection['externalEvidence']>;
}

const string = (value: unknown) =>
  typeof value === 'string' && value.trim() ? value.trim() : null;
const count = (value: unknown) =>
  Number.isInteger(value) && Number(value) >= 0 ? Number(value) : null;
const iso = (value: unknown) => {
  const text = string(value);
  return text && Number.isFinite(Date.parse(text))
    ? new Date(text).toISOString()
    : null;
};
const urls = (value: unknown) =>
  Array.isArray(value)
    ? value.filter(
        (entry): entry is string =>
          typeof entry === 'string' && /^https:\/\//.test(entry),
      )
    : [];

/** Pure adapter only: no Actor invocation, credentials, network or billing. */
export function projectParseforgeRows(
  root: PublicPost,
  rows: ParseforgeReplyRow[],
  observedAt: string,
): ParseforgeProjection {
  const exactRoot = canonicalPost(root.url);
  if (
    !exactRoot ||
    exactRoot.id !== root.id ||
    exactRoot.handle !== root.author.handle ||
    !Number.isFinite(Date.parse(observedAt))
  )
    throw Error('PARSEFORGE_INVALID_ROOT');
  if (!Array.isArray(rows) || rows.length > 1000)
    throw Error('PARSEFORGE_INVALID_DATASET');

  const evidenceRows: ParseforgeProjection['externalEvidence']['rows'] = [],
    cards: PublicRecord[] = [],
    candidates: RelationshipCandidate[] = [],
    seen = new Map<string, string>(),
    conflictingSubjects = new Set<string>();

  rows.forEach((raw, index) => {
    const rowHash = hash(raw),
      rootIdentity = canonicalPost(string(raw.rootPostUrl)),
      subject = canonicalPost(string(raw.postUrl)),
      parent = canonicalPost(string(raw.parentPostUrl)),
      body = string(raw.text),
      username = string(raw.username)?.replace(/^@/, '') ?? null,
      depth = Number.isInteger(raw.depth) ? Number(raw.depth) : null,
      reasons: string[] = [];
    if (raw.error) reasons.push('PROVIDER_ERROR_ROW');
    if (rootIdentity?.url !== exactRoot.url)
      reasons.push('PROVIDER_ROOT_URL_MISMATCH');
    if (string(raw.rootPostCode) && string(raw.rootPostCode) !== exactRoot.id)
      reasons.push('PROVIDER_ROOT_CODE_MISMATCH');
    if (!subject) reasons.push('PROVIDER_SUBJECT_URL_INVALID');
    if (subject && string(raw.postCode) && string(raw.postCode) !== subject.id)
      reasons.push('PROVIDER_SUBJECT_CODE_MISMATCH');
    if (!parent) reasons.push('PROVIDER_PARENT_URL_MISSING');
    if (
      parent &&
      string(raw.parentPostCode) &&
      string(raw.parentPostCode) !== parent.id
    )
      reasons.push('PROVIDER_PARENT_CODE_MISMATCH');
    if (!body) reasons.push('PROVIDER_BODY_MISSING');
    if (!username || username !== subject?.handle)
      reasons.push('PROVIDER_AUTHOR_IDENTITY_MISMATCH');
    if (depth === null || depth < 1)
      reasons.push('PROVIDER_DEPTH_INVALID');
    if (subject?.url === exactRoot.url)
      reasons.push('PROVIDER_ROOT_IS_NOT_REPLY');
    if (subject) {
      const prior = seen.get(subject.url);
      if (prior && prior !== rowHash) {
        reasons.push('PROVIDER_DUPLICATE_CONFLICT');
        conflictingSubjects.add(subject.url);
      }
      else if (prior) reasons.push('PROVIDER_EXACT_DUPLICATE');
      else seen.set(subject.url, rowHash);
    }
    const acceptedForGraph = reasons.length === 0;
    evidenceRows.push({
      index,
      rowHash,
      rootUrl: rootIdentity?.url ?? null,
      subjectUrl: subject?.url ?? null,
      parentUrl: parent?.url ?? null,
      acceptedForGraph,
      reasons,
      raw,
    });
    if (!acceptedForGraph || !subject || !parent || !body || !username || depth === null)
      return;
    const capturedAt = iso(raw.scrapedAt) ?? observedAt,
      authorUrl = `https://www.threads.com/@${username}`;
    cards.push({
      url: subject.url,
      text: body,
      bodyText: body,
      author: username,
      handle: username,
      avatar: null,
      createdAt: iso(raw.postedAt),
      type: 'COMMENT',
      parentReference: parent.url,
      media: [
        ...urls(raw.imageUrls).map((url) => ({ url, kind: 'IMAGE' as const })),
        ...urls(raw.videoUrls).map((url) => ({ url, kind: 'VIDEO' as const })),
      ],
      likeCount: count(raw.likeCount),
      replyCount: count(raw.replyCount),
      repostCount: count(raw.repostCount),
      shareCount: count(raw.reshareCount),
      provenance: {
        text: 'optional external provider row; graph validation required',
        type: 'APIFY_PARSEFORGE',
        rawEvidence: JSON.stringify({ actorId: PARSEFORGE_ACTOR, rowHash, index }),
      },
    });
    candidates.push({
      kind: 'EXTERNAL_PROVIDER_PARENT',
      rootUrl: exactRoot.url,
      subjectUrl: subject.url,
      parentUrl: parent.url,
      documentUrl: `https://apify.com/${PARSEFORGE_ACTOR}`,
      authorUrl,
      bodyText: body,
      pointer: `/provider/${PARSEFORGE_ACTOR}/rows/${index}`,
      observedAt: capturedAt,
      label: 'provider parentPostUrl; independently graph-validated',
      subjectPermalink: subject.url,
      publishedAt: iso(raw.postedAt),
      provider: { actorId: PARSEFORGE_ACTOR, rowHash, depth },
    });
  });

  for (const subjectUrl of conflictingSubjects) {
    for (const row of evidenceRows)
      if (row.subjectUrl === subjectUrl) {
        row.acceptedForGraph = false;
        if (!row.reasons.includes('PROVIDER_DUPLICATE_CONFLICT'))
          row.reasons.push('PROVIDER_DUPLICATE_CONFLICT');
      }
    for (let index = cards.length - 1; index >= 0; index--)
      if (cards[index].url === subjectUrl) cards.splice(index, 1);
    for (let index = candidates.length - 1; index >= 0; index--)
      if (candidates[index].subjectUrl === subjectUrl)
        candidates.splice(index, 1);
  }

  return {
    cards,
    candidates,
    externalEvidence: {
      provider: 'APIFY_PARSEFORGE',
      actorId: PARSEFORGE_ACTOR,
      observedAt,
      rows: evidenceRows,
    },
  };
}
