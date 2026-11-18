import type { HTTPRequest, HTTPResponse } from 'puppeteer';
import type { PublicRecord } from '../studio/public-types';
import type {
  MembershipEvidence,
  StructuredAcquisitionDiagnosis,
  StructuredPayloadDiagnostic,
  StructuredPayloadSource,
  StructuredPostObservation,
  StructuredRequestDiagnostic,
  StructuredResponseDiagnostic,
  StructuredResponseType,
  StructuredSsrMilestone,
} from './conversation-contracts';
import type { PublicRequestDecision } from '../studio/public-request-telemetry';
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
  requests?: StructuredRequestDiagnostic[];
  responses?: StructuredResponseDiagnostic[];
  ssrMilestones?: StructuredSsrMilestone[];
  acquisitionDiagnosis?: StructuredAcquisitionDiagnosis;
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
const usefulDiagnosticField = (field: string) =>
  /^(?:id|pk|code|user|username|author|caption|text|body|articleBody|permalink|url|media|thread_items|direct_replies|reply_threads|containing_thread|pinned_replies|self_thread|reply_to_post_id|parent_post_id|parent_id|root_post_id|root_id|reply_to_post|parent_post|root_post|is_reply|reply_to_author|root_post_author|direct_reply_count|reply_count|like_count|repost_count|reshare_count|share_count|taken_at|created_at|published_at)$/u.test(
    field,
  );

const idVariants = (raw: string | null): string[] => {
  if (!raw) return [];
  const prefix = raw.match(/^(\d+)_\d+$/u)?.[1];
  return prefix ? [raw, prefix] : [raw];
};

function postFromObject(
  row: Record<string, unknown>,
  pointer: string,
  input: StructuredPayloadInput,
): (StructuredPostObservation & { altIds?: string[] }) | null {
  const code = scalar(row.code),
    pk = scalar(row.pk),
    rawId = scalar(row.id),
    id = pk ?? rawId,
    user = object(row.user) ?? object(row.author),
    authorHandle = scalar(user?.username) ?? scalar(user?.handle);
  if (!code || !id || !authorHandle || !/^[\w-]+$/u.test(code)) return null;
  const url = canonicalPost(
    `https://www.threads.com/@${authorHandle}/post/${code}`,
  );
  if (!url) return null;
  const caption = object(row.caption),
    appInfo = object(row.text_post_app_info),
    originalText =
      scalar(caption?.text) ??
      scalar(row.text) ??
      scalar(row.articleBody) ??
      scalar(row.body),
    parentPostId =
      nestedId(row.reply_to_post_id) ??
      nestedId(appInfo?.reply_to_post_id) ??
      nestedId(row.parent_post_id) ??
      nestedId(appInfo?.parent_post_id) ??
      nestedId(row.parent_id) ??
      nestedId(appInfo?.parent_id) ??
      nestedId(row.reply_to_post) ??
      nestedId(appInfo?.reply_to_post) ??
      nestedId(row.parent_post) ??
      nestedId(appInfo?.parent_post),
    rootPostId =
      nestedId(row.root_post_id) ??
      nestedId(appInfo?.root_post_id) ??
      nestedId(row.root_id) ??
      nestedId(appInfo?.root_id) ??
      nestedId(row.root_post) ??
      nestedId(appInfo?.root_post);
  const altIds = [...new Set([...idVariants(pk), ...idVariants(rawId)])];
  return {
    id,
    altIds,
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

/**
 * Evidence observed in the public target GraphQL/SSR response: each direct reply is
 * wrapped by (data.)media.text_post_app_info.direct_replies.edges[*].node.posts.
 * The edge index only identifies the wrapper; it never defines reply order or a
 * nested parent. The named direct_replies container is the root relationship.
 */
export function targetDirectReplyContainerEvidence(
  posts: StructuredPostObservation[],
  diagnostics: StructuredPayloadDiagnostic[],
  rootUrl: string,
) {
  const root = canonicalPost(rootUrl);
  if (!root) throw Error('CONVERSATION_INVALID_ROOT');
  const relationshipCandidates: RelationshipCandidate[] = [],
    membershipEvidence: MembershipEvidence[] = [];
  // Reject any payload that explicitly declares a different root media object.
  const wrongRootPayloads = new Set<string>();
  for (const post of posts) {
    if (
      /^\/(?:data\/)?media$/u.test(post.pointer) &&
      post.url !== root.url
    )
      wrongRootPayloads.add(post.payloadHash);
  }
  for (const post of posts) {
    if (wrongRootPayloads.has(post.payloadHash)) continue;
    const isTargetNetwork =
        post.source === 'NETWORK' && /^\/api\/graphql\/?$/u.test(post.endpointPath),
      isTargetSsr =
        post.source === 'SSR' &&
        post.responseType === 'SSR_RELAY' &&
        canonicalPost(`https://www.threads.com${post.endpointPath}`)?.url ===
          root.url;
    const branchMatch = post.pointer.match(
      /^\/(?:data\/)?media\/text_post_app_info\/direct_replies\/edges\/\d+\/node\/posts\/edges\/(\d+)\/node$/u,
    );
    if (
      (!isTargetNetwork && !isTargetSsr) ||
      post.collectionKind !== 'CONVERSATION' ||
      !branchMatch ||
      !/^\/(?:data\/)?media\/text_post_app_info\/direct_replies\/edges\/\d+\/node$/u.test(
        post.containerReference ?? '',
      )
    )
      continue;
    const observedAt =
        diagnostics.find((row) => row.payloadHash === post.payloadHash)
          ?.observedAt ?? new Date(0).toISOString(),
      direct = branchMatch[1] === '0',
      evidenceType = direct
        ? 'STRUCTURED_TARGET_DIRECT_REPLIES_CONTAINER'
        : 'STRUCTURED_TARGET_CONVERSATION_BRANCH';
    membershipEvidence.push({
      rootId: root.id,
      subjectId: post.code,
      status: 'THREAD_UI_CONFIRMED',
      evidenceType,
      sourceActionId: null,
      containerReference: post.containerReference,
      observedAt,
    });
    // The first post in an observed direct_replies branch is explicitly the
    // root's direct reply. Later posts are confirmed conversation members, but
    // without an explicit parent field their direct parent remains unknown.
    if (!direct || !post.originalText) continue;
    relationshipCandidates.push({
      kind: 'STRUCTURED_PUBLIC_PARENT',
      rootUrl: root.url,
      subjectUrl: post.url,
      parentUrl: root.url,
      documentUrl: root.url,
      authorUrl: `https://www.threads.com/@${post.authorHandle}`,
      bodyText: post.originalText,
      pointer: post.pointer,
      observedAt,
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
  return { relationshipCandidates, membershipEvidence };
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
    allPosts: Array<StructuredPostObservation & { altIds?: string[] }> = [],
    conflicts: string[] = [];
  const inputPriority = (row: StructuredPayloadInput) =>
    row.source === 'NETWORK' ? 0 : row.responseType === 'SSR_RELAY' ? 1 : 2;
  const prioritizedInputs = [...inputs]
    .sort((a, b) => inputPriority(a) - inputPriority(b))
    .slice(0, 80);
  for (const input of prioritizedInputs) {
    const posts: Array<StructuredPostObservation & { altIds?: string[] }> = [],
      fields = new Set<string>(),
      relationships = new Set<string>(),
      pagination: StructuredPayloadDiagnostic['pagination'] = [];
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
      const pageInfo = object(row.page_info) ?? object(row.pageInfo);
      if (pageInfo && pagination.length < 50) {
        const hasNext = pageInfo.has_next_page ?? pageInfo.hasNextPage,
          endCursor = pageInfo.end_cursor ?? pageInfo.endCursor;
        pagination.push({
          payloadHash: hash(input.payload),
          pointer,
          edgeCount: Array.isArray(row.edges) ? row.edges.length : null,
          hasNextPage: typeof hasNext === 'boolean' ? hasNext : null,
          endCursorPresent: typeof endCursor === 'string' && !!endCursor,
          observedAt: input.observedAt,
        });
      }
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
      observedFieldNames: [...fields]
        .filter(usefulDiagnosticField)
        .sort()
        .slice(0, 200),
      postNodes: posts.length,
      relationshipFields: [...relationships].sort(),
      pagination,
      observedAt: input.observedAt,
    });
    allPosts.push(...posts);
  }
  const exact = new Map<
    string,
    StructuredPostObservation & { altIds?: string[] }
  >();
  for (const post of allPosts) {
    const key = `${post.url}|${post.payloadHash}|${post.pointer}`;
    exact.set(key, post);
  }
  const rawPosts = [...exact.values()],
    idToUrls = new Map<string, Set<string>>();
  for (const post of rawPosts) {
    const keys = post.altIds?.length ? post.altIds : idVariants(post.id);
    for (const idKey of keys) {
      const values = idToUrls.get(idKey) ?? new Set<string>();
      values.add(post.url);
      idToUrls.set(idKey, values);
    }
  }
  for (const [id, urls] of idToUrls)
    if (urls.size > 1) conflicts.push(`CONFLICTING_STRUCTURED_ID:${id}`);
  const posts: StructuredPostObservation[] = rawPosts.map(
      ({ altIds: _alt, ...clean }) => clean,
    ),
    rootPosts = rawPosts.filter((post) => post.url === root.url),
    rootIdsByPayload = new Map<string, Set<string>>(),
    uniqueUrlForId = (id: string | null) => {
      if (!id) return null;
      for (const key of idVariants(id)) {
        const urls = idToUrls.get(key);
        if (urls?.size === 1) return [...urls][0];
      }
      return null;
    },
    containerCounts = new Map<string, number>();
  for (const post of rootPosts) {
    const ids = rootIdsByPayload.get(post.payloadHash) ?? new Set<string>();
    for (const idKey of post.altIds?.length ? post.altIds : idVariants(post.id))
      ids.add(idKey);
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
        idVariants(post.rootPostId).some((k) =>
          rootIdsByPayload.get(post.payloadHash)?.has(k),
        ),
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
  const directContainer = targetDirectReplyContainerEvidence(
    posts,
    diagnostics,
    root.url,
  );
  for (const candidate of directContainer.relationshipCandidates)
    if (
      !relationshipCandidates.some(
        (existing) => existing.subjectUrl === candidate.subjectUrl,
      )
    )
      relationshipCandidates.push(candidate);
  for (const evidence of directContainer.membershipEvidence) {
    const index = membershipEvidence.findIndex(
      (existing) => existing.subjectId === evidence.subjectId,
    );
    if (index >= 0) membershipEvidence[index] = evidence;
    else membershipEvidence.push(evidence);
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

/**
 * Browser-evaluated SSR observation. Scans all data-sjs script tags (up to 150) and
 * prioritizes scripts carrying Relay/conversation markers so late-streamed replies
 * are never dropped behind unrelated head config scripts. Strict byte cap retained.
 */
export function observeStructuredSsrScripts() {
  const markerRe =
    /"(?:RelayPrefetchedStreamCache|direct_replies|reply_threads|containing_thread|thread_items|reply_to_post_id|text_post_app_info|BarcelonaPostPage)"/u;
  const raw = [
    ...document.querySelectorAll('script[type="application/json"][data-sjs]'),
  ]
    .slice(0, 150)
    .map((script, index) => ({
      index,
      text: script.textContent || '',
      hasMarker: markerRe.test(script.textContent || ''),
    }))
    .filter((row) => !!row.text && row.text.length <= 2000000);
  raw.sort((a, b) => Number(b.hasMarker) - Number(a.hasMarker) || a.index - b.index);
  let total = 0;
  return raw
    .filter((row) => {
      if (total + row.text.length > 5000000) return false;
      total += row.text.length;
      return true;
    })
    .slice(0, 80)
    .map(({ index, text }) => ({ index, text }));
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
  private readonly requestByObject = new WeakMap<HTTPRequest, string>();
  private readonly requests: StructuredRequestDiagnostic[] = [];
  private readonly responses: StructuredResponseDiagnostic[] = [];
  private readonly ssrMilestones: StructuredSsrMilestone[] = [];

  recordRequest(request: HTTPRequest, decision: PublicRequestDecision) {
    if (this.requests.length >= 500) return;
    const id = `request-${this.requests.length + 1}`,
      endpointPath = this.endpointPath(request.url());
    this.requestByObject.set(request, id);
    this.requests.push({
      id,
      endpointPath,
      method: request.method(),
      resourceType: request.resourceType(),
      admitted: decision.admitted,
      admissionReason: decision.reason,
      completion: 'PENDING',
      failureCategory: null,
      observedAt: new Date().toISOString(),
    });
  }

  finishRequest(request: HTTPRequest) {
    const row = this.requestFor(request);
    if (row) row.completion = 'FINISHED';
  }

  failRequest(request: HTTPRequest) {
    const row = this.requestFor(request);
    if (!row) return;
    row.completion = 'FAILED';
    row.failureCategory = request.failure()?.errorText
      ? 'BROWSER_REQUEST_FAILED'
      : 'BROWSER_REQUEST_FAILURE_UNSPECIFIED';
  }

  observeSsr(
    milestone: string,
    scripts: Array<{ index: number; text: string }>,
    endpointPath: string,
  ) {
    const observedAt = new Date().toISOString(),
      parsed = parseSsrRelayScripts(scripts, endpointPath, observedAt),
      postNodes = extractStructuredEvidence(
        parsed,
        'https://www.threads.com/@diagnostic/post/DIAGNOSTIC',
      ).posts.length;
    this.ssrMilestones.push({
      milestone,
      scriptCount: scripts.length,
      totalBytes: scripts.reduce((sum, row) => sum + row.text.length, 0),
      postNodes,
      scriptHashes: scripts.map((row) => hash(row.text)),
      queryNames: [
        ...new Set(
          parsed
            .map((row) => row.queryName)
            .filter((name): name is string => !!name),
        ),
      ].sort(),
      observedAt,
    });
  }

  observe(response: HTTPResponse) {
    const task = this.capture(response).finally(() =>
      this.pending.delete(task),
    );
    this.pending.add(task);
  }
  private async capture(response: HTTPResponse) {
    const request = response.request(),
      requestRow = this.requestFor(request),
      endpointPath = this.endpointPath(response.url()),
      headers = response.headers(),
      contentType = headers['content-type'] ?? '',
      declaredValue = Number(headers['content-length'] ?? 0),
      declared =
        Number.isFinite(declaredValue) && declaredValue > 0
          ? declaredValue
          : null,
      diagnostic: StructuredResponseDiagnostic = {
        requestId: requestRow?.id ?? 'request-untracked',
        endpointPath,
        method: request.method(),
        status: response.status(),
        contentType: contentType.split(';')[0]?.trim().toLowerCase() ?? '',
        resourceType: request.resourceType(),
        contentLength: declared,
        admitted: requestRow?.admitted ?? true,
        admissionReason: requestRow?.admissionReason ?? 'UNTRACKED_RESPONSE',
        parserDecision: 'PENDING',
        bodyHash: null,
        conversationMarkers: [],
        observedAt: new Date().toISOString(),
      };
    if (this.responses.length < 200) this.responses.push(diagnostic);
    if (response.status() < 200 || response.status() >= 300) {
      diagnostic.parserDecision = 'SKIPPED_HTTP_STATUS';
      return;
    }
    let url: URL;
    try {
      url = new URL(response.url());
    } catch {
      diagnostic.parserDecision = 'SKIPPED_NON_PUBLIC_HOST';
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
    ) {
      diagnostic.parserDecision = 'SKIPPED_NON_PUBLIC_HOST';
      return;
    }
    const jsonContentType = /(?:application|text)\/(?:[^;]+\+)?json\b/iu.test(
        contentType,
      ),
      parseableJavascriptResponse =
        ['xhr', 'fetch'].includes(request.resourceType()) &&
        /^(?:application\/x-javascript|text\/javascript)(?:;|$)/iu.test(
          contentType,
        ),
      diagnosticTextType =
        ['xhr', 'fetch'].includes(request.resourceType()) &&
        /(?:json|javascript|graphql|text\/plain)/iu.test(contentType);
    if (!jsonContentType && !diagnosticTextType) {
      diagnostic.parserDecision = 'SKIPPED_CONTENT_TYPE';
      return;
    }
    if (declared !== null && declared > 3000000) {
      diagnostic.parserDecision = 'SKIPPED_DECLARED_TOO_LARGE';
      return;
    }
    let body: string;
    try {
      body = await response.text();
    } catch {
      diagnostic.parserDecision = 'SKIPPED_BODY_READ_FAILED';
      return;
    }
    if (!body) {
      diagnostic.parserDecision = 'SKIPPED_EMPTY_BODY';
      return;
    }
    if (body.length > 3000000) {
      diagnostic.parserDecision = 'SKIPPED_BODY_TOO_LARGE';
      return;
    }
    diagnostic.bodyHash = hash(body);
    diagnostic.conversationMarkers = [
      'containing_thread',
      'reply_threads',
      'thread_items',
      'direct_replies',
      'reply_to_post_id',
      'root_post_id',
    ].filter((marker) => body.includes(`"${marker}"`));
    const payloads: unknown[] = [];
    try {
      payloads.push(JSON.parse(body));
    } catch {
      const lines = body
        .split(/\r?\n/u)
        .map((line) => line.trim())
        .filter(Boolean);
      if (lines.length >= 2 && lines.length <= 20 && url.pathname.includes('graphql')) {
        try {
          for (const line of lines) payloads.push(JSON.parse(line));
        } catch {
          payloads.length = 0;
        }
      }
      if (!payloads.length) {
        diagnostic.parserDecision = 'SKIPPED_JSON_PARSE_FAILED';
        return;
      }
    }
    if (!jsonContentType && !parseableJavascriptResponse) {
      diagnostic.parserDecision = 'SKIPPED_CONTENT_TYPE_JSON_PARSEABLE';
      return;
    }
    let acceptedAny = false,
      hitLimit = false;
    for (const payload of payloads) {
      const payloadHash = hash(payload);
      if (this.seen.has(payloadHash)) continue;
      if (this.captured.length >= 30) {
        hitLimit = true;
        break;
      }
      this.seen.add(payloadHash);
      acceptedAny = true;
      this.captured.push({
        source: 'NETWORK',
        endpointPath: url.pathname,
        responseType: 'NETWORK_JSON',
        queryName: null,
        observedAt: new Date().toISOString(),
        payload,
      });
    }
    diagnostic.parserDecision = acceptedAny
      ? 'ACCEPTED_JSON'
      : hitLimit
        ? 'SKIPPED_CAPTURE_LIMIT'
        : 'SKIPPED_DUPLICATE_PAYLOAD';
  }
  async settle() {
    await Promise.allSettled([...this.pending]);
    return [...this.captured];
  }

  telemetry() {
    return {
      requests: this.requests.map((row) => ({ ...row })),
      responses: this.responses.map((row) => ({ ...row })),
      ssrMilestones: this.ssrMilestones.map((row) => ({ ...row })),
    };
  }

  private requestFor(request: HTTPRequest) {
    const id = this.requestByObject.get(request);
    return id ? this.requests.find((row) => row.id === id) : undefined;
  }

  private endpointPath(value: string) {
    try {
      const url = new URL(value);
      if (url.protocol === 'http:' || url.protocol === 'https:')
        return url.pathname;
      if (url.protocol === 'data:') return 'DATA_URL';
      if (url.protocol === 'blob:') return 'BLOB_URL';
      return `${url.protocol.replace(':', '').toUpperCase()}_URL`;
    } catch {
      return 'INVALID_URL';
    }
  }
}

export function diagnoseStructuredAcquisition(
  extraction: StructuredExtraction,
): StructuredAcquisitionDiagnosis {
  if (extraction.relationshipCandidates.length)
    return 'STRUCTURED_RELATIONSHIP_EVIDENCE_PRESENT';
  const responses = extraction.responses ?? [],
    milestones = extraction.ssrMilestones ?? [],
    firstQueries = new Set(milestones[0]?.queryNames ?? []),
    laterConversationQuery = milestones
      .slice(1)
      .some((row) =>
        row.queryNames.some(
          (name) =>
            /BarcelonaPostPage(?:Downward|Upward)Query/u.test(name) &&
            !firstQueries.has(name),
        ),
      );
  if (laterConversationQuery) return 'SSR_LATE_INSERTION';
  if (
    responses.some(
      (row) =>
        row.parserDecision === 'SKIPPED_CONTENT_TYPE_JSON_PARSEABLE' &&
        row.conversationMarkers.length > 0,
    )
  )
    return 'NETWORK_CONTENT_TYPE_MISSED';
  if (responses.some((row) => [401, 403, 429].includes(row.status)))
    return 'PUBLIC_ACCESS_LIMITED';
  const conversationQueries = milestones.some((row) =>
      row.queryNames.some((name) =>
        /BarcelonaPostPage(?:Downward|Upward)Query/u.test(name),
      ),
    ),
    conversationMarkers = responses.some(
      (row) =>
        row.parserDecision === 'ACCEPTED_JSON' &&
        row.conversationMarkers.length > 0,
    );
  if (conversationQueries || conversationMarkers)
    return 'STRUCTURED_SCHEMA_UNRECOGNIZED';
  const possiblyRelevantBlockedRequest = (extraction.requests ?? []).some(
    (row) =>
      !row.admitted &&
      (['BLOCKED_EVENT_BUDGET', 'BLOCKED_NAVIGATION_BUDGET'].includes(
        row.admissionReason,
      ) ||
        (row.admissionReason === 'BLOCKED_UNSUPPORTED_ORIGIN' &&
          ['xhr', 'fetch', 'document', 'script'].includes(row.resourceType))),
  );
  if (
    !milestones.length ||
    !responses.length ||
    possiblyRelevantBlockedRequest ||
    (extraction.requests ?? []).some(
      (row) => row.admitted && row.completion !== 'FINISHED',
    )
  )
    return 'INCONCLUSIVE';
  return 'NO_STRUCTURED_EVIDENCE';
}
