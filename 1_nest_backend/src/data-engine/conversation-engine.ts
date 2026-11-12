import { DATA_SCHEMA, type SourceInput, type DataPost } from './contracts';
import { DataEngine } from './engine';
import { hash } from './rules';
import { canonicalPost } from './conversation-evidence';
import { POPULARITY_CONFIG, rankCandidates } from './conversation-popularity';
import {
  evaluateConversation,
  CONVERSATION_CONFIG,
} from './conversation-quality';
import {
  CONVERSATION_VERSION,
  type ConversationRun,
  type ConversationReview,
  type ThreadCollection,
  type PopularityCandidate,
} from './conversation-contracts';
import { observedContextViews } from './conversation-context';
export interface ConversationProvider {
  execution: 'LIVE' | 'SYNTHETIC';
  discover(keyword: string): Promise<PopularityCandidate[]>;
  enrich(url: string): Promise<ThreadCollection>;
}
export interface CollectionRecord {
  schemaVersion: typeof DATA_SCHEMA;
  version: typeof CONVERSATION_VERSION;
  id: string;
  runId: string;
  collection: ThreadCollection;
  evaluation: ReturnType<typeof evaluateConversation>;
  sourceLink: {
    postId: string;
    bronzeId: string;
    evaluationId: string | null;
    evaluationRevision: number | null;
  } | null;
  rightsStatus: 'UNKNOWN';
  configHash: string;
}
const configHash = () =>
  hash({
    quality: CONVERSATION_CONFIG,
    popularity: POPULARITY_CONFIG,
    collector: 'explicit-public-relationships/1',
    limits: { candidates: 6, roots: 2, replies: 20 },
  });
const key = (kind: string, id: string) => {
  if (!/^[a-f0-9]{64}$/.test(id)) throw Error('CONVERSATION_INVALID_ID');
  return `${kind}/${id}.json`;
};
function request(body: any): ConversationRun['request'] {
  if (
    !body ||
    typeof body.requestId !== 'string' ||
    !/^[\w-]{1,100}$/.test(body.requestId) ||
    !Number.isInteger(body.limit ?? 1) ||
    (body.limit ?? 1) < 1 ||
    (body.limit ?? 1) > 3
  )
    throw Error('CONVERSATION_INVALID_REQUEST');
  const limit = body.limit ?? 1;
  const priority = body.priority === undefined ? 'HOT' : body.priority;
  const minInteractions =
    body.minInteractions === undefined ? 0 : body.minInteractions;
  if (
    !['HOT', 'RECENT'].includes(priority) ||
    !Number.isSafeInteger(minInteractions) ||
    minInteractions < 0 ||
    minInteractions > 1_000_000_000
  )
    throw Error('CONVERSATION_INVALID_RANKING');
  if (body.urls !== undefined) {
    if (
      !Array.isArray(body.urls) ||
      body.urls.length < 1 ||
      body.urls.length > 3
    )
      throw Error('CONVERSATION_INVALID_URLS');
    const urls = [
      ...new Set<string>(
        body.urls.map((x: any) => {
          const id = canonicalPost(x);
          if (!id) throw Error('CONVERSATION_INVALID_URL');
          return id.url;
        }),
      ),
    ];
    if (urls.length > limit) throw Error('CONVERSATION_LIMIT_MISMATCH');
    return {
      requestId: body.requestId,
      urls,
      limit,
      priority,
      minInteractions,
    };
  }
  if (
    typeof body.keyword !== 'string' ||
    !body.keyword.trim() ||
    body.keyword.length > 120
  )
    throw Error('CONVERSATION_INVALID_KEYWORD');
  return {
    requestId: body.requestId,
    keyword: body.keyword.trim(),
    limit,
    priority,
    minInteractions,
  };
}
/** Explicit bounded consumer. No timer, cron, auto resume or automatic production decisions. */
export class ConversationEngine {
  private busy = false;
  constructor(
    readonly data: DataEngine,
    readonly provider: ConversationProvider,
  ) {}
  private async exclusive<T>(fn: () => Promise<T>) {
    if (this.busy) throw Error('CONVERSATION_BUSY');
    this.busy = true;
    try {
      return await fn();
    } finally {
      this.busy = false;
    }
  }
  private async save(run: ConversationRun) {
    run.elapsedMs = Date.now() - Date.parse(run.startedAt);
    run.history.push({
      at: new Date().toISOString(),
      stage: run.stage,
      outcome: run.status,
    });
    await this.data.store.write(key('conversation-runs', run.id), run);
  }
  async get(id: string) {
    const r = await this.data.store.read<ConversationRun>(
      key('conversation-runs', id),
    );
    if (!r || r.version !== CONVERSATION_VERSION)
      throw Error('CONVERSATION_UNKNOWN_RUN');
    return r;
  }
  async list() {
    const list: ConversationRun[] = [];
    for await (const r of this.data.store.rows<ConversationRun>(
      'conversation-runs',
    ))
      list.push(r);
    return list.sort((a, b) => b.startedAt.localeCompare(a.startedAt));
  }
  async start(body: unknown) {
    return this.exclusive(async () => {
      const input = request(body),
        id = hash({
          version: CONVERSATION_VERSION,
          requestId: input.requestId,
        }),
        old = await this.data.store.read<ConversationRun>(
          key('conversation-runs', id),
        );
      if (old) {
        if (hash(old.request) !== hash(input))
          throw Error('CONVERSATION_REQUEST_CONFLICT');
        return old;
      }
      const run: ConversationRun = {
        schemaVersion: DATA_SCHEMA,
        version: CONVERSATION_VERSION,
        id,
        request: input,
        configHash: configHash(),
        execution: this.provider.execution,
        status: 'RUNNING',
        stage: 'DISCOVERY',
        startedAt: new Date().toISOString(),
        completedAt: null,
        elapsedMs: 0,
        candidates: null,
        ranking: null,
        captures: [],
        results: [],
        history: [],
        error: null,
      };
      await this.save(run);
      return this.process(run);
    });
  }
  async resume(id: string) {
    return this.exclusive(async () => {
      const run = await this.get(id);
      if (run.status === 'COMPLETED') return run;
      if (run.configHash !== configHash())
        throw Error('CONVERSATION_CONFIG_VERSION_MISMATCH');
      if (run.execution !== this.provider.execution)
        throw Error('CONVERSATION_EXECUTION_MISMATCH');
      return this.process(run);
    });
  }
  private async process(run: ConversationRun) {
    try {
      run.status = 'RUNNING';
      run.error = null;
      if (!run.candidates) {
        run.stage = 'DISCOVERY';
        await this.save(run);
        run.candidates = run.request.urls
          ? run.request.urls.map((url, observedOrder) => ({
              url,
              observedOrder,
              post: null,
            }))
          : await this.provider.discover(run.request.keyword!);
        if (run.candidates.length > 10)
          throw Error('CONVERSATION_CANDIDATE_BUDGET_EXCEEDED');
        const seen = new Set<string>();
        run.candidates = run.candidates.filter((c) => {
          const id = canonicalPost(c.url);
          if (!id) throw Error('CONVERSATION_INVALID_CANDIDATE');
          if (seen.has(id.id)) return false;
          seen.add(id.id);
          c.url = id.url;
          return true;
        });
        run.ranking = rankCandidates(
          run.candidates,
          run.request.limit,
          run.startedAt,
          {
            priority: run.request.priority,
            minInteractions: run.request.minInteractions,
          },
        );
        await this.save(run);
      }
      for (const url of run.ranking!.selected) {
        if (run.results.some((r) => r.url === url)) continue;
        let capture = run.captures.find((c) => c.url === url);
        if (!capture) {
          run.stage = 'COLLECTING_VERIFIED_REPLIES';
          await this.save(run);
          const collection = await this.provider.enrich(url);
          this.validateCollection(collection, url, run.execution);
          capture = { url, collection };
          run.captures.push(capture);
          await this.save(run);
        }
        this.validateCollection(capture.collection, url, run.execution);
        run.stage = 'PERSISTING_SHADOW';
        await this.save(run);
        const result = await this.persist(run, capture.collection);
        run.results.push({
          url,
          collectionId: result.id,
          evaluation: result.evaluation,
        });
        await this.save(run);
      }
      run.status = 'COMPLETED';
      run.stage = 'WAITING_HUMAN_REVIEW';
      run.completedAt = new Date().toISOString();
      await this.save(run);
      return run;
    } catch (e: any) {
      run.status = 'FAILED';
      run.error = /^CONVERSATION_[A-Z0-9_]+$/.test(e.message || '')
        ? e.message
        : 'CONVERSATION_OPERATION_FAILED';
      await this.save(run);
      return run;
    }
  }
  private validateCollection(
    c: ThreadCollection,
    url: string,
    execution: string,
  ) {
    if (
      c.version !== CONVERSATION_VERSION ||
      canonicalPost(c.root.url)?.url !== url ||
      c.root.id !== canonicalPost(url)?.id ||
      c.replies.length > 20 ||
      c.verifiedReplyCount !== c.replies.length ||
      c.status === 'COMPLETE' ||
      c.root.provenance.synthetic !== (execution === 'SYNTHETIC')
    )
      throw Error('CONVERSATION_INVALID_COLLECTION');
    const ids = new Set<string>(),
      pending = [...c.replies],
      verified = new Set([c.root.id]);
    while (pending.length) {
      let advanced = false;
      for (const r of [...pending]) {
        if (!verified.has(r.parentId)) continue;
        const identity = canonicalPost(r.url),
          parent = canonicalPost(r.evidence.parentUrl);
        if (
          r.id === c.root.id ||
          !identity ||
          identity.id !== r.id ||
          identity.handle !== r.author.handle ||
          ids.has(r.id) ||
          r.rootId !== c.root.id ||
          r.provenance.synthetic !== (execution === 'SYNTHETIC') ||
          parent?.id !== r.parentId ||
          parent.url !==
            (r.parentId === c.root.id
              ? c.root.url
              : c.replies.find((p) => p.id === r.parentId)?.url) ||
          canonicalPost(r.evidence.subjectUrl)?.url !== identity.url ||
          canonicalPost(r.evidence.documentUrl)?.url !== url ||
          !r.evidence.documentHash ||
          !r.originalText.trim()
        )
          throw Error('CONVERSATION_INVALID_REPLY');
        ids.add(r.id);
        verified.add(r.id);
        pending.splice(pending.indexOf(r), 1);
        advanced = true;
      }
      if (!advanced) throw Error('CONVERSATION_INVALID_PARENT_CHAIN');
    }
  }
  private async persist(run: ConversationRun, collection: ThreadCollection) {
    const id = hash({ runId: run.id, collection }),
      existing = await this.data.store.read<CollectionRecord>(
        key('thread-collections', id),
      );
    if (existing) return existing;
    let link: CollectionRecord['sourceLink'] = null;
    const capture = run.captures.find(
      (c) =>
        c.collection === collection || hash(c.collection) === hash(collection),
    )!;
    if (capture.importRunId) {
      const saved = await this.data.store.read<any>(
        key('runs', capture.importRunId),
      );
      if (saved && saved.status !== 'COMPLETED') {
        const resumed = await this.data.resume(capture.importRunId);
        if (resumed.status !== 'COMPLETED')
          throw Error('CONVERSATION_DATA_IMPORT_FAILED');
      }
    }
    for await (const post of this.data.store.rows<DataPost>('posts')) {
      if (
        post.sourcePostId === collection.root.id &&
        canonicalPost(post.sourceUrl)?.url === collection.root.url
      ) {
        link = {
          postId: post.id,
          bronzeId: post.currentBronzeId,
          evaluationId: post.currentEvaluationId,
          evaluationRevision:
            (await this.data.detail(post.id)).evaluation?.revision ?? null,
        };
        break;
      }
    }
    // Existing post/evaluation/approval are pinned, never replaced by enrichment snapshots.
    if (!link) {
      const root = collection.root;
      const input: SourceInput = {
        sourcePlatform: 'THREADS',
        sourcePostId: root.id,
        sourceUrl: root.url,
        author: { ...root.author, avatarUrl: null },
        originalBody: root.originalText,
        topic: root.topic ?? null,
        itemType: 'UNKNOWN',
        parentReference: null,
        publishedAt: root.publishedAt,
        fetchedAt: root.provenance.observedAt,
        engagement: root.engagement,
        fetch: {
          source: 'DATA04_PUBLIC_CONVERSATION',
          query: run.request.keyword || null,
        },
        rawPayload: root.rawPayload ?? root,
        provenance: {
          synthetic: root.provenance.synthetic,
          identityEvidence: 'DOM_PERMALINK',
          collectionRunId: run.id,
          discoveryReviewRequired: true,
        },
      };
      capture.importRunId = hash({
        datasetHash: hash([input]),
        configHash: this.data.configHash,
      });
      await this.save(run);
      let imported = await this.data.import([input], run.startedAt);
      if (imported.status !== 'COMPLETED')
        imported = await this.data.resume(capture.importRunId);
      if (imported.status !== 'COMPLETED')
        throw Error('CONVERSATION_DATA_IMPORT_FAILED');
      for await (const p of this.data.store.rows<DataPost>('posts'))
        if (
          p.sourcePostId === root.id &&
          canonicalPost(p.sourceUrl)?.url === root.url
        ) {
          link = {
            postId: p.id,
            bronzeId: p.currentBronzeId,
            evaluationId: p.currentEvaluationId,
            evaluationRevision:
              (await this.data.detail(p.id)).evaluation?.revision ?? null,
          };
          break;
        }
    }
    for (const reply of collection.replies) {
      const rid = hash({ identity: reply.url, observation: reply });
      await this.data.store.write(
        key('thread-replies', rid),
        {
          schemaVersion: DATA_SCHEMA,
          version: CONVERSATION_VERSION,
          id: rid,
          rightsStatus: 'UNKNOWN',
          reply,
        },
        true,
      );
    }
    const record: CollectionRecord = {
      schemaVersion: DATA_SCHEMA,
      version: CONVERSATION_VERSION,
      id,
      runId: run.id,
      collection,
      evaluation: evaluateConversation(collection, run.startedAt),
      sourceLink: link,
      rightsStatus: 'UNKNOWN',
      configHash: hash(CONVERSATION_CONFIG),
    };
    await this.data.store.write(key('thread-collections', id), record, true);
    return record;
  }
  async collection(id: string) {
    const r = await this.data.store.read<CollectionRecord>(
      key('thread-collections', id),
    );
    if (
      !r ||
      r.version !== CONVERSATION_VERSION ||
      hash({ runId: r.runId, collection: r.collection }) !== r.id
    )
      throw Error('CONVERSATION_COLLECTION_INTEGRITY');
    return r;
  }
  async review(id: string) {
    return (
      (await this.data.store.read<ConversationReview>(
        key('conversation-feedback', id),
      )) || {
        schemaVersion: DATA_SCHEMA,
        collectionId: id,
        revision: 0,
        selectedReplyIds: [],
        selectedObservedUrls: [],
        replyLabels: {},
        decision: 'NEEDS_REVIEW',
        reason: '',
        history: [],
      }
    );
  }
  async feedback(id: string, body: any) {
    return this.exclusive(async () => {
      const record = await this.collection(id),
        old = await this.review(id);
      if (
        !body ||
        typeof body.requestId !== 'string' ||
        !/^[\w-]{1,100}$/.test(body.requestId) ||
        !Number.isInteger(body.revision) ||
        !Array.isArray(body.selectedReplyIds) ||
        !['ACCEPT', 'REJECT', 'NEEDS_REVIEW'].includes(body.decision) ||
        typeof body.reason !== 'string' ||
        !body.reason.trim() ||
        body.reason.length > 1000
      )
        throw Error('CONVERSATION_INVALID_FEEDBACK');
      const selected = [...new Set<string>(body.selectedReplyIds)];
      const observed = observedContextViews(record.collection),
        selectedObserved = [
          ...new Set<string>(
            (body.selectedObservedUrls ?? [])
              .map((url: unknown) => canonicalPost(url)?.url)
              .filter((url: unknown): url is string => typeof url === 'string'),
          ),
        ];
      if (
        selected.some((x) => !record.collection.replies.some((r) => r.id === x))
      )
        throw Error('CONVERSATION_UNKNOWN_REPLY');
      if (selectedObserved.some((url) => !observed.some((x) => x.url === url)))
        throw Error('CONVERSATION_UNKNOWN_OBSERVED_CONTEXT');
      const replyLabels = body.replyLabels ?? {};
      if (
        !replyLabels ||
        typeof replyLabels !== 'object' ||
        Array.isArray(replyLabels) ||
        Object.entries(replyLabels).some(
          ([id, label]) =>
            !record.collection.replies.some((r) => r.id === id) ||
            ![
              'SUBSTANTIVE',
              'LOW_INFORMATION',
              'SPAM',
              'DUPLICATE',
              'UNCERTAIN',
            ].includes(String(label)),
        )
      )
        throw Error('CONVERSATION_INVALID_REPLY_LABEL');
      const inputHash = hash({
        revision: body.revision,
        selected,
        selectedObserved,
        replyLabels,
        decision: body.decision,
        reason: body.reason,
      });
      const prior = old.history.find((x) => x.requestId === body.requestId);
      if (prior) {
        if (prior.inputHash !== inputHash)
          throw Error('CONVERSATION_REQUEST_CONFLICT');
        return old;
      }
      if (old.revision !== body.revision)
        throw Error('CONVERSATION_STALE_REVISION');
      const revision = old.revision + 1,
        review: ConversationReview = {
          ...old,
          revision,
          selectedReplyIds: selected,
          selectedObservedUrls: selectedObserved,
          replyLabels,
          decision: body.decision,
          reason: body.reason,
          history: [
            ...old.history,
            {
              requestId: body.requestId,
              inputHash,
              at: new Date().toISOString(),
              revision,
              selectedReplyIds: selected,
              selectedObservedUrls: selectedObserved,
              replyLabels,
              decision: body.decision,
              reason: body.reason,
            },
          ],
        };
      await this.data.store.write(key('conversation-feedback', id), review);
      return review;
    });
  }
  async bundle(id: string) {
    const record = await this.collection(id),
      review = await this.review(id);
    return {
      version: 'conversation-source-bundle/1',
      collectionId: id,
      root: record.collection.root,
      sourceLink: record.sourceLink,
      replyReferences: record.collection.replies
        .filter((r) => review.selectedReplyIds.includes(r.id))
        .map((r) => ({
          id: r.id,
          url: r.url,
          parentId: r.parentId,
          originalText: r.originalText,
          evidence: r.evidence,
        })),
      observedReferences: observedContextViews(record.collection)
        .filter((x) => (review.selectedObservedUrls || []).includes(x.url))
        .map((x) => ({
          id: x.id,
          url: x.url,
          originalText: x.originalText,
          displayText: x.displayText,
          relationship: x.relationship,
          reasons: x.reasons,
          raw: x.raw,
        })),
      reviewRevision: review.revision,
      qualityDecision: review.decision,
      rightsStatus: 'UNKNOWN',
      productionApproved: false,
      handoffEnabled: false,
      reason:
        'Quality feedback/reply selection is not DATA-01 ACCEPT/queue or script/audio approval; DATA-03 multi-source adapter is not enabled',
    };
  }
}
