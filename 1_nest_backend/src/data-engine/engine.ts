import { sourceProvenance } from "./studio-integration";
import {
  DATA_SCHEMA,
  type Bronze,
  type DataPost,
  type DataRun,
  type Evaluation,
  type SourceInput,
  type DataState,
  type Silver,
} from './contracts';
import { DATA_CONFIG, type DataConfig } from './config';
import { DataStore } from './store';
import {
  hash,
  validate,
  evaluate,
  similarity,
  validDate,
  precisionAt10,
} from './rules';
import type {
  ContentCandidate,
  ContentSource,
} from '../video-pipeline/contracts';
const key = (kind: string, id: string) => kind + '/' + id + '.json';
const transitions: Record<DataState, DataState[]> = {
  DISCOVERED: ['VALIDATED', 'QUARANTINED', 'FAILED'],
  VALIDATED: ['ELIGIBLE', 'SCORED', 'FAILED'],
  ELIGIBLE: ['SCORED', 'FAILED'],
  SCORED: ['QUALIFIED', 'REJECTED', 'FAILED'],
  QUALIFIED: ['QUEUED', 'FAILED'],
  QUEUED: [],
  REJECTED: [],
  QUARANTINED: [],
  FAILED: [],
};
export class DataEngine {
  private tail: Promise<unknown> = Promise.resolve();
  readonly configHash: string;
  constructor(
    readonly store = new DataStore(),
    readonly config: DataConfig = DATA_CONFIG,
    private clock = () => new Date().toISOString(),
  ) {
    if (
      Object.values(config.weights).reduce((n, v) => n + v, 0) !== 100 ||
      config.nearDuplicate.threshold <= 0 ||
      config.nearDuplicate.threshold > 1
    )
      throw Error('Invalid scoring/deduplication configuration');
    this.configHash = hash(config);
  }
  private serial<T>(fn: () => Promise<T>): Promise<T> {
    const next = this.tail.catch(() => {}).then(fn);
    this.tail = next;
    return next;
  }
  private async move(
    e: Evaluation,
    to: DataState,
    reason: string,
    error: string | null = null,
    recovery = false,
  ) {
    if (!recovery && !transitions[e.state].includes(to))
      throw Error('INVALID_TRANSITION: ' + e.state + ' -> ' + to);
    e.transitions.push({
      at: this.clock(),
      from: e.state,
      to,
      inputHash: e.inputHash,
      version: this.config.version,
      outcome: error ? 'ERROR' : 'OK',
      reason,
      error,
    });
    e.state = to;
    e.revision++;
    await this.store.write(key('evaluations', e.id), e);
  }
  private async ingest(
    input: SourceInput,
    runId: string,
  ): Promise<{ post: DataPost; bronze: Bronze; created: boolean }> {
    const clean = JSON.parse(JSON.stringify(input)) as SourceInput;
    clean.rawPayload ??= null;
    const inputHash = hash(clean),
      postId = hash(
        input.sourcePlatform === 'THREADS' && input.sourcePostId
          ? { platform: 'THREADS', id: input.sourcePostId }
          : { invalid: inputHash },
      ),
      bronzeId = hash({ postId, inputHash });
    let b = await this.store.read<Bronze>(key('bronze', bronzeId));
    if (!b) {
      b = {
        ...clean,
        schemaVersion: DATA_SCHEMA,
        id: bronzeId,
        postId,
        rawHash: hash(clean.rawPayload),
        inputHash,
        rightsStatus: 'UNKNOWN',
        ingestedAt: this.clock(),
      };
      await this.store.write(key('bronze', bronzeId), b, true);
    }
    let post = await this.store.read<DataPost>(key('posts', postId));
    if (!post) {
      let ordinal = 0;
      for await (const p of this.store.rows<DataPost>('posts'))
        ordinal = Math.max(ordinal, p.ordinal);
      post = {
        schemaVersion: DATA_SCHEMA,
        id: postId,
        ordinal: ordinal + 1,
        createdByRunId: runId,
        sourcePostId: input.sourcePostId,
        sourceUrl: input.sourceUrl,
        observations: [],
        evaluationIds: [],
        currentBronzeId: bronzeId,
        currentEvaluationId: null,
      };
    }
    if (!post.observations.includes(bronzeId)) post.observations.push(bronzeId);
    const current = await this.store.read<Bronze>(
      key('bronze', post.currentBronzeId),
    );
    // Out-of-order historical imports never replace a newer observation. Unknown dates
    // do not overwrite a valid dated observation; distinct observations remain retained.
    const time = (v: Bronze) =>
      validDate(v.fetchedAt) ? Date.parse(v.fetchedAt!) : -Infinity;
    if (
      !current ||
      time(b) > time(current) ||
      (time(b) === time(current) &&
        (b.ingestedAt > current.ingestedAt ||
          (b.ingestedAt === current.ingestedAt && b.id > current.id)))
    ) {
      post.currentBronzeId = bronzeId;
      post.sourceUrl = b.sourceUrl;
    }
    await this.store.write(key('posts', post.id), post);
    return { post, bronze: b, created: post.createdByRunId === runId };
  }
  private async findDuplicate(post: DataPost, s: Silver) {
    let near: Silver['duplicate'] = null;
    for await (const other of this.store.rows<DataPost>('posts')) {
      if (other.id===post.id || !other.currentEvaluationId) continue;
      const e = await this.store.read<Evaluation>(
        key('evaluations', other.currentEvaluationId),
      );
      if (!e?.silver || e.silver.status !== 'VALIDATED') continue;
      if(e.silver.duplicate?.postId===post.id)continue;
      const common = e.silver.duplicate?.kind==='EXACT'?{
        postId:e.silver.duplicate.postId,bronzeId:e.silver.duplicate.bronzeId,evaluationId:e.silver.duplicate.evaluationId
      }:{
        postId: other.id,
        bronzeId: e.bronzeId,
        evaluationId: e.id,
      };
      if (e.silver.deduplicationKey === s.deduplicationKey)
        return { ...common, kind: 'EXACT' as const, similarity: 1 };
      const score = similarity(
        e.silver.normalized.body,
        s.normalized.body,
        this.config,
      );
      if (
        score >= this.config.nearDuplicate.threshold &&
        (!near || score > near.similarity)
      )
        near = { ...common, kind: 'NEAR', similarity: score };
    }
    return near;
  }
  private async process(post: DataPost, b: Bronze, asOf: string) {
    const id = hash({ bronzeId: b.id, configHash: this.configHash }),
      old = await this.store.read<Evaluation>(key('evaluations', id));
    const e: Evaluation = old || {
      schemaVersion: DATA_SCHEMA,
      id,
      postId: post.id,
      bronzeId: b.id,
      inputHash: b.inputHash,
      configHash: this.configHash,
      asOf,
      revision: 0,
      state: 'DISCOVERED',
      silver: null,
      gold: null,
      transitions: [
        {
          at: this.clock(),
          from: null,
          to: 'DISCOVERED',
          inputHash: b.inputHash,
          version: this.config.version,
          outcome: 'OK',
          reason: 'Saved source observation; no network calls',
          error: null,
        },
      ],
      review: null,
      queue: null,
    };
    if (!old) await this.store.write(key('evaluations', id), e);
    if (!post.evaluationIds.includes(id)) post.evaluationIds.push(id);
    if (post.currentBronzeId === b.id) post.currentEvaluationId = id;
    await this.store.write(key('posts', post.id), post);
    const reused =
      !!old &&
      old.state !== 'FAILED' &&
      !['DISCOVERED', 'VALIDATED', 'ELIGIBLE'].includes(old.state);
    try {
      if (e.state === 'FAILED') {
        const resume = e.resumeFrom!;
        await this.move(
          e,
          resume,
          'Retry from last durable checkpoint',
          null,
          true,
        );
        delete e.resumeFrom;
      }
      if (e.state === 'DISCOVERED') {
        e.silver = validate(b, this.config);
        await this.move(
          e,
          e.silver.status === 'QUARANTINED' ? 'QUARANTINED' : 'VALIDATED',
          e.silver.quarantineReasons.join('; ') ||
            'Required source fields validated',
        );
      }
      if (e.state === 'VALIDATED') {
        e.silver!.duplicate = await this.findDuplicate(post, e.silver!);
        e.gold = evaluate(b, e.silver!, e.asOf, this.config);
        if (e.gold.eligibility === 'ELIGIBLE')
          await this.move(e, 'ELIGIBLE', 'Rule eligibility satisfied');
        await this.move(
          e,
          'SCORED',
          'Deterministic score and rule breakdown saved',
        );
      }
      if (e.state === 'ELIGIBLE') {
        e.gold ??= evaluate(b, e.silver!, e.asOf, this.config);
        await this.move(e, 'SCORED', 'Deterministic scoring checkpoint');
      }
      if (e.state === 'SCORED' && e.gold!.eligibility === 'REJECTED')
        await this.move(e, 'REJECTED', e.gold!.reasons.join('; '));
      if (
        e.state === 'SCORED' &&
        e.gold!.eligibility === 'ELIGIBLE' &&
        e.gold!.score >= this.config.qualifiedScore
      )
        await this.move(
          e,
          'QUALIFIED',
          'Configured score threshold met; not queued automatically',
        );
      return { evaluation: e, reused };
    } catch (error) {
      const saved = (await this.store.read<Evaluation>(
        key('evaluations', id),
      ))!;
      saved.resumeFrom = saved.state;
      await this.move(
        saved,
        'FAILED',
        'Processing failed; retry is explicit',
        (error as Error).message.slice(0, 300),
      );
      throw error;
    }
  }
  async import(inputs: SourceInput[], asOf = this.clock()) {
    return this.serial(async () => {
      if (
        !Array.isArray(inputs) ||
        !inputs.length ||
        inputs.length > this.config.maxBatch ||
        Buffer.byteLength(JSON.stringify(inputs)) > 2 * 1024 * 1024 ||
        !validDate(asOf)
      )
        throw Error(
          'Invalid batch: 1–100 JSON inputs, <=2 MiB and ISO asOf required',
        );
      const datasetHash = hash(inputs),
        id = hash({ datasetHash, configHash: this.configHash });
      const old = await this.store.read<DataRun>(key('runs', id));
      if (old) return { ...this.publicRun(old), reused: true };
      const run: DataRun = {
        schemaVersion: DATA_SCHEMA,
        id,
        datasetHash,
        version: this.config.version,
        configHash: this.configHash,
        status: 'RUNNING',
        inputs: JSON.parse(JSON.stringify(inputs)),
        cursor: 0,
        asOf,
        startedAt: this.clock(),
        completedAt: null,
        elapsedMs: 0,
        metrics:{activeElapsedMs:0,observedPeakProcessRssBytes:0,cpuUserMicros:0,cpuSystemMicros:0},
        error: null,
        results: [],
      };
      await this.store.write(key('runs', id), run);
      return this.execute(run);
    });
  }
  private publicRun({ inputs, ...run }: DataRun) {
    return { ...run, inputCount: inputs.length };
  }
  private async execute(run: DataRun) {
    const started=performance.now(),cpu=process.cpuUsage();
    const sample=()=>{run.metrics.observedPeakProcessRssBytes=Math.max(run.metrics.observedPeakProcessRssBytes,process.memoryUsage().rss);};
    sample();
    if (run.configHash !== this.configHash)
      throw Error(
        'CONFIG_VERSION_MISMATCH: resume with the recorded configuration',
      );
    run.status = 'RUNNING';
    run.error = null;
    run.completedAt = null;
    await this.store.write(key('runs', run.id), run);
    try {
      while (run.cursor < run.inputs.length) {
        const { post, bronze, created } = await this.ingest(run.inputs[run.cursor], run.id),
          { evaluation, reused } = await this.process(post, bronze, run.asOf);
        run.results[run.cursor] = {
          postId: post.id,
          bronzeId: bronze.id,
          state: evaluation.state,
          reused,
          newPost: created && !run.results.slice(0, run.cursor).some(r => r.postId === post.id),
        };
        run.cursor++;
        sample();
        run.elapsedMs = Math.max(
          0,
          Date.parse(this.clock()) - Date.parse(run.startedAt),
        );
        await this.store.write(key('runs', run.id), run);
      }
      run.status = 'COMPLETED';
      run.completedAt = this.clock();
    } catch (error) {
      run.status = 'FAILED';
      run.error = (error as Error).message.slice(0, 300);
    }
    run.elapsedMs = Math.max(
      0,
      Date.parse(this.clock()) - Date.parse(run.startedAt),
    );
    sample();const used=process.cpuUsage(cpu);run.metrics.activeElapsedMs+=performance.now()-started;run.metrics.cpuUserMicros+=used.user;run.metrics.cpuSystemMicros+=used.system;
    await this.store.write(key('runs', run.id), run);
    return this.publicRun(run);
  }
  async resume(id: string) {
    return this.serial(async () => {
      const run = await this.store.read<DataRun>(key('runs', id));
      if (!run) throw Error('Unknown run');
      return run.status === 'COMPLETED'
        ? { ...this.publicRun(run), reused: true }
        : this.execute(run);
    });
  }
  async detail(id: string) {
    const post = await this.store.read<DataPost>(key('posts', id));
    if (!post) throw Error('Unknown data post');
    return {
      post,
      bronze: await this.store.read<Bronze>(
        key('bronze', post.currentBronzeId),
      ),
      evaluation: post.currentEvaluationId
        ? await this.store.read<Evaluation>(
            key('evaluations', post.currentEvaluationId),
          )
        : null,
      observationCount: post.observations.length,
    };
  }
  async observation(postId: string, bronzeId: string) {
    const { post } = await this.detail(postId);
    if (!post.observations.includes(bronzeId))
      throw Error('Observation does not belong to post');
    return this.store.read<Bronze>(key('bronze', bronzeId));
  }
  async history(postId: string, evaluationId: string) {
    const { post } = await this.detail(postId);
    if (!post.evaluationIds.includes(evaluationId))
      throw Error('Evaluation does not belong to post');
    return this.store.read<Evaluation>(key('evaluations', evaluationId));
  }
  async catalog(state?: string, page = 0) {
    if (!Number.isInteger(page) || page < 0) throw Error('Invalid page');
    const counts: Record<string, number> = {},
      rows: any[] = [];
    let total = 0,
      matching = 0,
      observations = 0;
    const provenanceCounts={REAL:0,SYNTHETIC:0,UNKNOWN:0},reviewSummary={pending:0,accepted:0,rejected:0,quarantined:0};
    for await (const post of this.store.rows<DataPost>('posts')) {
      total++;
      observations += post.observations.length;
      const { bronze, evaluation: e } = await this.detail(post.id);
      const status = e?.state || 'DISCOVERED';
      counts[status] = (counts[status] || 0) + 1;
      const provenance=sourceProvenance(bronze);provenanceCounts[provenance]++;
      if(status==="QUARANTINED")reviewSummary.quarantined++;
      else if(e?.review?.decision==="ACCEPT")reviewSummary.accepted++;
      else if(e?.review?.decision==="REJECT")reviewSummary.rejected++;
      else if(!["REJECTED","QUEUED"].includes(status))reviewSummary.pending++;
      if (state && state !== status) continue;
      if (matching++ < page * 25 || rows.length >= 25) continue;
      rows.push({
        id: post.id,
        sourcePostId: post.sourcePostId,
        sourceUrl: post.sourceUrl,
        author: bronze?.author,
        bodyPreview:
          e?.silver?.normalized.body.slice(0, 240) ||
          bronze?.originalBody?.slice(0, 240),
        state: status,
        score: e?.gold?.score ?? null,
        labels: e?.gold?.labels || [],
        duplicate: e?.silver?.duplicate || null,
        quarantine: e?.silver?.quarantineReasons || [],
        observations: post.observations.length,
        revision: e?.revision ?? 0,
        synthetic: bronze?.provenance?.synthetic === true,
        provenance,
      });
    }
    const runs: any[] = [];
    for await (const r of this.store.rows<DataRun>('runs'))
      runs.push(this.publicRun(r));
    runs.sort((a, b) => b.startedAt.localeCompare(a.startedAt));
    return {
      schemaVersion: DATA_SCHEMA,
      workflow: 'THREADS_SERIOUS',
      total,
      observations,
      matching,
      page,
      pageSize: 25,
      counts,
      provenanceCounts,reviewSummary,
      qualifiedRatio: total
        ? ((counts.QUALIFIED || 0) + (counts.QUEUED || 0)) / total
        : null,
      ratioMeaning: 'Pipeline threshold coverage, NOT measured content quality',
      precisionAt10: precisionAt10([], {}),
      rows,
      runs: runs.slice(0, 20),
    };
  }
  async review(
    id: string,
    revision: number,
    decision: 'ACCEPT' | 'REJECT' | 'NEEDS_REVIEW',
    reason: string,
    confirmedType?: 'POST' | 'COMMENT',
  ) {
    return this.serial(async () => {
      const { evaluation: e, bronze: b } = await this.detail(id);
      if (!e || e.revision !== revision) throw Error('STALE_REVISION');
      if (
        !e.silver ||
        e.silver.status === 'QUARANTINED' ||
        e.state === 'FAILED'
      )
        throw Error(
          'Fix/reimport quarantined or failed source; review cannot bypass validation',
        );
      if (e.state === 'QUEUED')
        throw Error(
          'Queued snapshot is retained; review changes require a new observation/evaluation',
        );
      if(!e.gold||!['SCORED','QUALIFIED','REJECTED'].includes(e.state))throw Error('Finish/resume the pipeline before manual review');
      if (
        !['ACCEPT', 'REJECT', 'NEEDS_REVIEW'].includes(decision) ||
        typeof reason !== 'string' ||
        !reason.trim() ||
        reason.length > 1000
      )
        throw Error('Explicit review reason required');
      if (
        decision === 'ACCEPT' &&
        b!.itemType === 'UNKNOWN' &&
        !['POST', 'COMMENT'].includes(confirmedType || '')
      )
        throw Error(
          'Confirm target POST/COMMENT explicitly; raw UNKNOWN remains unchanged',
        );
      e.review = {
        decision,
        reason,
        at: this.clock(),
        confirmedType: confirmedType || null,
      };
      e.gold!.eligibility =
        decision === 'ACCEPT'
          ? 'ELIGIBLE'
          : decision === 'REJECT'
            ? 'REJECTED'
            : 'NEEDS_REVIEW';
      e.gold!.selectionReasons.push('LOCAL_USER_' + decision + ': ' + reason);
      await this.move(
        e,
        decision === 'ACCEPT'
          ? 'QUALIFIED'
          : decision === 'REJECT'
            ? 'REJECTED'
            : 'SCORED',
        'Explicit local user review; deterministic score remains unchanged',
        null,
        true,
      );
      return this.detail(id);
    });
  }
  async enqueue(id: string, revision: number) {
    return this.serial(async () => {
      const { evaluation: e, bronze: b } = await this.detail(id);
      if (!e || e.revision !== revision) throw Error('STALE_REVISION');
      if (e.state !== 'QUALIFIED' || e.gold?.eligibility !== 'ELIGIBLE')
        throw Error('Only qualified content can enter the production queue');
      if (e.review?.decision !== 'ACCEPT') throw Error('Explicit ACCEPT review required before enqueue');
      if (b!.itemType === 'UNKNOWN' && !e.review?.confirmedType)
        throw Error('Target entity type requires manual confirmation');
      e.queue = {
        id: hash({ evaluationId: e.id, revision: e.revision }),
        workflow: 'THREADS_SERIOUS',
        mode: 'DRAFT_ONLY',
        rightsStatus: 'UNKNOWN',
        at: this.clock(),
      };
      e.gold.queueState = 'WAITING_MANUAL_PRODUCTION';
      await this.move(
        e,
        'QUEUED',
        'Manual enqueue only; no video production or publishing started',
      );
      return this.productionInput(id);
    });
  }
  async productionInput(id: string) {
    const { evaluation: e, bronze: b } = await this.detail(id);
    if (!e?.queue || e.state !== 'QUEUED') throw Error('Not queued');
    const type =
      b!.itemType === 'UNKNOWN' ? e.review?.confirmedType : b!.itemType;
    if (!type) throw Error('Unresolved target type');
    const candidate: ContentCandidate = {
      id,
      style: 'SERIOUS',
      sourceReferences: [{ entityType: type, entityId: b!.sourcePostId! }],
      status: 'SELECTED',
      selectedBy: e.review ? 'USER' : 'RULE',
      selectionReason: e.gold!.selectionReasons.join('; '),
    };
    const source: ContentSource = {
      id: b!.id,
      platform: 'THREADS',
      canonicalUrl: b!.sourceUrl!,
      retrievedAt: b!.fetchedAt!,
      synthetic: b!.provenance.synthetic,
    };
    return {
      postId: e.postId,
      evaluationId: e.id,
      revision: e.revision,
      queue: e.queue,
      candidate,
      source,
      content:{originalText:b!.originalBody,displayText:e.silver!.normalized.bodySource==='VERIFIED_STUDIO_MAPPING'?b!.provenance.bodyMapping!.body:b!.originalBody,spokenText:null,topic:e.silver!.normalized.topic,author:b!.author},
      bronzeId: b!.id,
      silver: e.silver,
      rightsStatus: 'UNKNOWN',
      publishingAllowed: false,
    };
  }
  /** Hold the existing single-writer lock through snapshot validation/materialization. */
  async withQueuedProduction<T>(id:string,evaluationId:string,queueId:string,revision:number,action:(snapshot:{bronze:Bronze;evaluation:Evaluation;input:Awaited<ReturnType<DataEngine['productionInput']>>})=>Promise<T>):Promise<T>{
    return this.serial(async()=>{
      const {bronze:b,evaluation:e}=await this.detail(id);
      if(!b||!e||e.id!==evaluationId||e.revision!==revision)throw Error('STALE_REVISION');
      if(e.state!=='QUEUED'||e.queue?.id!==queueId||e.queue.workflow!=='THREADS_SERIOUS'||e.queue.mode!=='DRAFT_ONLY')throw Error('PRODUCTION_NOT_QUEUED');
      if(e.review?.decision!=='ACCEPT'||!e.review.reason?.trim()||!e.review.at)throw Error('PRODUCTION_REQUIRES_ACCEPT');
      if(e.silver?.status!=='VALIDATED'||e.gold?.eligibility!=='ELIGIBLE'||e.gold.queueState!=='WAITING_MANUAL_PRODUCTION')throw Error('PRODUCTION_NOT_ELIGIBLE');
      if(e.configHash!==this.configHash||e.inputHash!==b.inputHash||e.bronzeId!==b.id||e.silver.bronzeId!==b.id)throw Error('PRODUCTION_SNAPSHOT_MISMATCH');
      if(validate(b,this.config).status!=='VALIDATED')throw Error('PRODUCTION_INVALID_SOURCE');
      if(!['POST','COMMENT'].includes(b.itemType==='UNKNOWN'?e.review.confirmedType||'':b.itemType))throw Error('PRODUCTION_TARGET_UNCONFIRMED');
      if(b.itemType!=='UNKNOWN'&&e.review.confirmedType&&e.review.confirmedType!==b.itemType)throw Error('PRODUCTION_TARGET_CONFLICT');
      return action(JSON.parse(JSON.stringify({bronze:b,evaluation:e,input:await this.productionInput(id)})));
    });
  }
}
