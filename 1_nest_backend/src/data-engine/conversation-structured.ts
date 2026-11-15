import type { HTTPResponse } from 'puppeteer';
import type { PublicRecord } from '../studio/public-types';
import type {
  MembershipEvidence,
  StructuredPayloadDiagnostic,
  StructuredPayloadSource,
  StructuredPostObservation,
  StructuredResponseType,
} from './conversation-contracts';
import {
  canonicalPost,
  type RelationshipCandidate,
} from './conversation-evidence';
import { hash } from './rules';

export interface StructuredPayloadInput {
  source: StructuredPayloadSource;
  endpointPath: string;
  responseType: StructuredResponseType;
  queryName: string | null;
  observedAt: string;
  payload: unknown;
}
export interface StructuredExtraction {
  version: 'conversation-structured-observation/1';
  diagnostics: StructuredPayloadDiagnostic[];
  posts: StructuredPostObservation[];
  relationshipCandidates: RelationshipCandidate[];
  membershipEvidence: MembershipEvidence[];
  structuredVisibleUrls: string[];
  cards: PublicRecord[];
  domMatches: number;
  conflicts: string[];
}

const scalar = (value: unknown): string | null => {
  if (typeof value === 'string' && value.trim()) return value.trim();
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return null;
};
const object = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
const nestedId = (value: unknown): string | null => {
  const row = object(value);
  return scalar(row?.pk) ?? scalar(row?.id) ?? scalar(value);
};
const epoch = (value: unknown): string | null => {
  const raw = Number(value);
  if (!Number.isFinite(raw) || raw <= 0) return null;
  const millis = raw < 100000000000 ? raw * 1000 : raw;
  return Number.isFinite(new Date(millis).getTime())
    ? new Date(millis).toISOString()
    : null;
};
const collectionKind = (pointer: string) =>
  /(?:related|recommended|suggested|owner_threads|ownerthreads)/iu.test(pointer)
    ? ('RELATED' as const)
    : /(?:direct_replies|reply_threads|replies|containing_thread|pinned_replies|self_thread)/iu.test(
          pointer,
        )
      ? ('CONVERSATION' as const)
      : ('UNKNOWN' as const);
const containerReference = (pointer: string) => {
  const match = pointer.match(
    /^(.*?\/(?:direct_replies|reply_threads|containing_thread|pinned_replies|self_thread)(?:\/edges\/\d+\/node)?)/iu,
  );
  return match?.[1] ?? null;
};
const relationKeys = new Set([
  'reply_to_post_id',
  'parent_post_id',
  'parent_id',
  'root_post_id',
  'root_id',
  'reply_to_post',
  'parent_post',
  'root_post',
]);

function postFromObject(
  row: Record<string, unknown>,
  pointer: string,
  input: StructuredPayloadInput,
): StructuredPostObservation | null {
  const code = scalar(row.code),
    id = scalar(row.pk) ?? scalar(row.id),
    user = object(row.user) ?? object(row.author),
    authorHandle = scalar(user?.username) ?? scalar(user?.handle);
  if (!code || !id || !authorHandle || !/^[\w-]+$/u.test(code)) return null;
  const url = canonicalPost(
    `https://www.threads.com/@${authorHandle}/post/${code}`,
  );
  if (!url) return null;
  const caption = object(row.caption),
    originalText =
      scalar(caption?.text) ??
      scalar(row.text) ??
      scalar(row.articleBody) ??
      scalar(row.body),
    parentPostId =
      nestedId(row.reply_to_post_id) ??
      nestedId(row.parent_post_id) ??
      nestedId(row.parent_id) ??
      nestedId(row.reply_to_post) ??
      nestedId(row.parent_post),
    rootPostId =
      nestedId(row.root_post_id) ??
      nestedId(row.root_id) ??
      nestedId(row.root_post);
  return {
    id,
    code,
    url: url.url,
    authorHandle: url.handle,
    originalText,
    publishedAt:
      epoch(row.taken_at) ?? epoch(row.published_at) ?? epoch(row.created_at),
    parentPostId,
    rootPostId,
    collectionKind: collectionKind(pointer),
    containerReference: containerReference(pointer),
    source: input.source,
    endpointPath: input.endpointPath,
    responseType: input.responseType,
    queryName: input.queryName,
    payloadHash: hash(input.payload),
    pointer,
    fieldNames: Object.keys(row).sort().slice(0, 100),
  };
}

/** Generic bounded traversal. Field names are observed, never assumed to exist. */
export function extractStructuredEvidence(
  inputs: StructuredPayloadInput[],
  rootUrl: string,
  domSubjectUrls: string[] = [],
): StructuredExtraction {
  const root = canonicalPost(rootUrl);
  if (!root) throw Error('CONVERSATION_INVALID_ROOT');
  const diagnostics: StructuredPayloadDiagnostic[] = [],
    allPosts: StructuredPostObservation[] = [],
    conflicts: string[] = [];
  for (const input of inputs.slice(0, 40)) {
    const posts: StructuredPostObservation[] = [],
      fields = new Set<string>(),
      relationships = new Set<string>();
    let visited = 0;
    const walk = (value: unknown, pointer: string, depth: number) => {
      if (visited++ > 50000 || depth > 40) return;
      if (Array.isArray(value)) {
        value
          .slice(0, 500)
          .forEach((item, index) =>
            walk(item, `${pointer}/${index}`, depth + 1),
          );
        return;
      }
      const row = object(value);
      if (!row) return;
      for (const key of Object.keys(row)) {
        fields.add(key);
        if (relationKeys.has(key)) relationships.add(key);
      }
      const post = postFromObject(row, pointer, input);
      if (post) posts.push(post);
      for (const [key, child] of Object.entries(row))
        walk(child, `${pointer}/${key}`, depth + 1);
    };
    walk(input.payload, '', 0);
    diagnostics.push({
      source: input.source,
      endpointPath: input.endpointPath,
      responseType: input.responseType,
      queryName: input.queryName,
      payloadHash: hash(input.payload),
      topLevelFields: Object.keys(object(input.payload) ?? {})
        .sort()
        .slice(0, 100),
      observedFieldNames: [...fields].sort().slice(0, 200),
      postNodes: posts.length,
      relationshipFields: [...relationships].sort(),
      observedAt: input.observedAt,
    });
    allPosts.push(...posts);
  }
  const exact = new Map<string, StructuredPostObservation>();
  for (const post of allPosts) {
    const key = `${post.url}|${post.payloadHash}|${post.pointer}`;
    exact.set(key, post);
  }
  const posts = [...exact.values()],
    idToUrls = new Map<string, Set<string>>();
  for (const post of posts) {
    const values = idToUrls.get(post.id) ?? new Set<string>();
    values.add(post.url);
    idToUrls.set(post.id, values);
  }
  for (const [id, urls] of idToUrls)
    if (urls.size > 1) conflicts.push(`CONFLICTING_STRUCTURED_ID:${id}`);
  const rootPosts = posts.filter((post) => post.url === root.url),
    rootIdsByPayload = new Map<string, Set<string>>(),
    uniqueUrlForId = (id: string | null) => {
      if (!id) return null;
      const urls = idToUrls.get(id);
      return urls?.size === 1 ? [...urls][0] : null;
    },
    containerCounts = new Map<string, number>();
  for (const post of rootPosts) {
    const ids = rootIdsByPayload.get(post.payloadHash) ?? new Set<string>();
    ids.add(post.id);
    rootIdsByPayload.set(post.payloadHash, ids);
  }
  for (const post of posts)
    if (post.containerReference)
      containerCounts.set(
        `${post.payloadHash}|${post.containerReference}`,
        (containerCounts.get(
          `${post.payloadHash}|${post.containerReference}`,
        ) ?? 0) + 1,
      );
  const relationshipCandidates: RelationshipCandidate[] = [],
    membershipEvidence: MembershipEvidence[] = [];
  for (const post of posts) {
    if (post.url === root.url) continue;
    const explicitParent = uniqueUrlForId(post.parentPostId),
      explicitRootMatches =
        !!post.rootPostId &&
        !!rootIdsByPayload.get(post.payloadHash)?.has(post.rootPostId),
      singletonDirect =
        post.collectionKind === 'CONVERSATION' &&
        /direct_replies|reply_threads/iu.test(post.containerReference ?? '') &&
        rootIdsByPayload.has(post.payloadHash) &&
        !!post.containerReference &&
        containerCounts.get(
          `${post.payloadHash}|${post.containerReference}`,
        ) === 1,
      parentUrl = explicitParent ?? (singletonDirect ? root.url : null),
      evidenceType = explicitParent
        ? 'STRUCTURED_EXPLICIT_PARENT_FIELD'
        : singletonDirect
          ? 'STRUCTURED_SINGLETON_DIRECT_REPLY_CONTAINER'
          : explicitRootMatches
            ? 'STRUCTURED_EXPLICIT_ROOT_FIELD'
            : post.collectionKind === 'RELATED'
              ? 'STRUCTURED_RELATED_COLLECTION'
              : 'STRUCTURED_RELATIONSHIP_UNAVAILABLE';
    membershipEvidence.push({
      rootId: root.id,
      subjectId: post.code,
      status:
        post.collectionKind === 'RELATED'
          ? 'RECOMMENDED_POST'
          : explicitRootMatches || parentUrl
            ? 'THREAD_UI_CONFIRMED'
            : 'UNKNOWN',
      evidenceType,
      sourceActionId: null,
      containerReference: post.containerReference,
      observedAt:
        diagnostics.find((row) => row.payloadHash === post.payloadHash)
          ?.observedAt ?? new Date(0).toISOString(),
    });
    if (!parentUrl || post.collectionKind === 'RELATED' || !post.originalText)
      continue;
    relationshipCandidates.push({
      kind: 'STRUCTURED_PUBLIC_PARENT',
      rootUrl: root.url,
      subjectUrl: post.url,
      parentUrl,
      documentUrl: root.url,
      authorUrl: `https://www.threads.com/@${post.authorHandle}`,
      bodyText: post.originalText,
      pointer: post.pointer,
      observedAt:
        diagnostics.find((row) => row.payloadHash === post.payloadHash)
          ?.observedAt ?? new Date(0).toISOString(),
      label: evidenceType,
      subjectPermalink: post.url,
      publishedAt: post.publishedAt,
      structured: {
        source: post.source,
        payloadHash: post.payloadHash,
        responseType: post.responseType,
        queryName: post.queryName,
      },
    });
  }
  const best = new Map<string, StructuredPostObservation>();
  for (const post of posts) {
    const prior = best.get(post.url),
      score = (value: StructuredPostObservation) =>
        (value.originalText?.length ?? 0) +
        (value.parentPostId ? 10000 : 0) +
        (value.rootPostId ? 5000 : 0);
    if (!prior || score(post) > score(prior)) best.set(post.url, post);
  }
  const cards: PublicRecord[] = [...best.values()]
    .filter((post) => post.url !== root.url && !!post.originalText)
    .map((post) => ({
      url: post.url,
      text: post.originalText!,
      bodyText: post.originalText!,
      author: post.authorHandle,
      handle: post.authorHandle,
      avatar: null,
      createdAt: post.publishedAt,
      type: 'UNKNOWN',
      parentReference: null,
      media: [],
      likeCount: null,
      replyCount: null,
      repostCount: null,
      shareCount: null,
      provenance: {
        text: 'passive public structured response projection',
        type: post.collectionKind,
        rawEvidence: JSON.stringify({
          payloadHash: post.payloadHash,
          pointer: post.pointer,
          source: post.source,
          endpointPath: post.endpointPath,
          responseType: post.responseType,
          queryName: post.queryName,
          fieldNames: post.fieldNames,
        }),
      },
    }));
  const dom = new Set(
    domSubjectUrls.map((url) => canonicalPost(url)?.url).filter(Boolean),
  );
  return {
    version: 'conversation-structured-observation/1',
    diagnostics,
    posts,
    relationshipCandidates,
    membershipEvidence,
    structuredVisibleUrls: [...best.keys()],
    cards,
    domMatches: [...best.keys()].filter((url) => dom.has(url)).length,
    conflicts,
  };
}

/** Browser-evaluated SSR observation. It returns bounded script text only. */
export function observeStructuredSsrScripts() {
  let total = 0;
  return [
    ...document.querySelectorAll('script[type="application/json"][data-sjs]'),
  ]
    .slice(0, 30)
    .map((script, index) => ({ index, text: script.textContent || '' }))
    .filter((row) => {
      if (
        !row.text ||
        row.text.length > 2000000 ||
        total + row.text.length > 5000000
      )
        return false;
      total += row.text.length;
      return true;
    });
}

export function parseSsrRelayScripts(
  scripts: Array<{ index: number; text: string }>,
  endpointPath: string,
  observedAt: string,
): StructuredPayloadInput[] {
  const inputs: StructuredPayloadInput[] = [];
  for (const script of scripts) {
    let value: unknown;
    try {
      value = JSON.parse(script.text);
    } catch {
      continue;
    }
    const relays: Array<{ name: string; payload: unknown }> = [];
    let visited = 0;
    const walk = (node: unknown) => {
      if (visited++ > 50000) return;
      if (Array.isArray(node)) {
        if (
          node.length >= 4 &&
          node[0] === 'RelayPrefetchedStreamCache' &&
          Array.isArray(node[3]) &&
          typeof node[3][0] === 'string'
        ) {
          const payload = object(node[3][1]),
            result = object(object(payload?.__bbox)?.result),
            data = result?.data,
            name = String(node[3][0])
              .replace(/^adp_/u, '')
              .split('RelayPreloader')[0];
          if (data !== undefined) relays.push({ name, payload: data });
        }
        node.forEach(walk);
        return;
      }
      const row = object(node);
      if (row) Object.values(row).forEach(walk);
    };
    walk(value);
    if (relays.length)
      for (const relay of relays)
        inputs.push({
          source: 'SSR',
          endpointPath,
          responseType: 'SSR_RELAY',
          queryName: relay.name,
          observedAt,
          payload: relay.payload,
        });
    else
      inputs.push({
        source: 'SSR',
        endpointPath,
        responseType: 'SSR_JSON',
        queryName: null,
        observedAt,
        payload: value,
      });
  }
  return inputs;
}

/** Passive only: observes public JSON responses already admitted by the browser. */
export class PassiveStructuredResponseObserver {
  private readonly pending = new Set<Promise<void>>();
  private readonly captured: StructuredPayloadInput[] = [];
  private readonly seen = new Set<string>();
  observe(response: HTTPResponse) {
    const task = this.capture(response).finally(() =>
      this.pending.delete(task),
    );
    this.pending.add(task);
  }
  private async capture(response: HTTPResponse) {
    if (response.status() < 200 || response.status() >= 300) return;
    let url: URL;
    try {
      url = new URL(response.url());
    } catch {
      return;
    }
    if (
      url.protocol !== 'https:' ||
      ![
        'threads.com',
        'www.threads.com',
        'threads.net',
        'www.threads.net',
      ].includes(url.hostname)
    )
      return;
    const contentType = response.headers()['content-type'] ?? '';
    if (!/(?:application|text)\/(?:[^;]+\+)?json\b/iu.test(contentType)) return;
    const declared = Number(response.headers()['content-length'] ?? 0);
    if (declared > 3000000) return;
    let body: string;
    try {
      body = await response.text();
    } catch {
      return;
    }
    if (!body || body.length > 3000000) return;
    let payload: unknown;
    try {
      payload = JSON.parse(body);
    } catch {
      return;
    }
    const payloadHash = hash(payload);
    if (this.seen.has(payloadHash) || this.captured.length >= 30) return;
    this.seen.add(payloadHash);
    this.captured.push({
      source: 'NETWORK',
      endpointPath: url.pathname,
      responseType: 'NETWORK_JSON',
      queryName: null,
      observedAt: new Date().toISOString(),
      payload,
    });
  }
  async settle() {
    await Promise.allSettled([...this.pending]);
    return [...this.captured];
  }
}
