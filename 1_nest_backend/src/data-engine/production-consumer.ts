import { sessionReadiness } from "../studio/session-readiness";
import { DataEngine } from './engine';
import { DATA_SCHEMA } from './contracts';
import { hash } from './rules';
import type { StudioService } from '../studio/studio.service';
import type {
  ProductionJob,
  ProductionRequest,
  ProductionSnapshot,
} from './production-contracts';
import { productionSession } from './production-adapter';
import {selectedReplies} from './editorial-feasibility';
import type {EditorialSnapshot,EditorialPlan} from './editorial-contracts';
import type {ConversationReview} from './conversation-contracts';

const key = (id: string) => 'production-jobs/' + id + '.json';
function projectId(id: string) {
  return `${id.slice(0, 8)}-${id.slice(8, 12)}-5${id.slice(13, 16)}-8${id.slice(17, 20)}-${id.slice(20, 32)}`;
}
function request(body: any): ProductionRequest {
  if (
    !body ||
    !['postId', 'evaluationId', 'queueId'].every(
      (k) => typeof body[k] === 'string' && /^[a-f0-9]{64}$/.test(body[k]),
    ) ||
    !Number.isSafeInteger(body.revision) ||
    body.revision < 0 ||
    typeof body.requestId !== 'string' ||
    !/^[A-Za-z0-9-]{1,100}$/.test(body.requestId)
  )
    throw Error('INVALID_PRODUCTION_REQUEST');
  return {
    postId: body.postId,
    evaluationId: body.evaluationId,
    queueId: body.queueId,
    revision: body.revision,
    requestId: body.requestId,
  };
}
/** Explicit single-writer consumer; no startup timer or automatic generation. */
export class ProductionConsumer {
  private tail: Promise<unknown> = Promise.resolve();
  constructor(
    readonly data: DataEngine,
    readonly studio: Pick<StudioService, 'ensureProductionSession' | 'load'>,
    private clock = () => new Date().toISOString(),
  ) {}
  private serial<T>(fn: () => Promise<T>) {
    const next = this.tail.catch(() => {}).then(fn);
    this.tail = next;
    return next;
  }
  async list() {
    const rows: ProductionJob[] = [];
    for await (const j of this.data.store.rows<ProductionJob>(
      'production-jobs',
    ))
      rows.push(j);
    return rows.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }
  async get(id: string) {
    if (!/^[a-f0-9]{64}$/.test(id)) throw Error('INVALID_PRODUCTION_JOB_ID');
    const j = await this.data.store.read<ProductionJob>(key(id));
    if (!j || j.jobVersion !== 'production-consumer/1')
      throw Error('UNKNOWN_PRODUCTION_JOB');
    return j;
  }
  private async move(
    j: ProductionJob,
    status: ProductionJob['status'],
    stage: string,
    reason: string,
  ) {
    j.status = status;
    j.stage = stage;
    j.updatedAt = this.clock();
    j.history.push({ at: j.updatedAt, status, stage, reason });
    await this.data.store.write(key(j.id), j);
  }
  async ready(page = 0) {
    if (!Number.isSafeInteger(page) || page < 0) throw Error('Invalid page');
    const rows: any[] = [];
    const jobs=await this.list();
    let total = 0;
    for await (const p of this.data.store.rows<any>('posts')) {
      const { evaluation: e } = await this.data.detail(p.id);
      if (e?.state !== 'QUEUED' || !e.queue) continue;
      let summary: {
        sourceUrl: string | null;
        sourcePostId: string | null;
        author: ProductionSnapshot['bronze']['author'];
        bodyPreview: string;
        score: number;
      };
      try {
        summary = await this.data.withQueuedProduction(
          p.id,
          e.id,
          e.queue.id,
          e.revision,
          async (s) => ({
            sourceUrl: s.bronze.sourceUrl,
            sourcePostId: s.bronze.sourcePostId,
            author: s.bronze.author,
            bodyPreview: s.input.content.displayText?.slice(0, 240) || '',
            score: s.evaluation.gold!.score,
          }),
        );
      } catch {
        continue;
      }
      const id = hash({
        postId: p.id,
        evaluationId: e.id,
        queueId: e.queue.id,
      });
      const prior = jobs.find(j=>j.request.postId===p.id&&j.request.queueId===e.queue!.id&&j.status==='SUCCEEDED') || jobs.find(j=>j.request.postId===p.id&&j.request.queueId===e.queue!.id) || await this.data.store.read<ProductionJob>(key(id));
      if (prior?.status === 'SUCCEEDED') continue;
      if (total++ < page * 25 || rows.length >= 25) continue;
      rows.push({
        ...summary,
        postId: p.id,
        evaluationId: e.id,
        queueId: e.queue.id,
        revision: e.revision,
        jobId: prior?.id || null,
        jobStatus: prior?.status || null,
        studioUrl: prior?.studioUrl || null,
        canCreateProject: !prior,
        canResume: !!prior,
        mode: 'DRAFT_ONLY',
      });
    }
    return { page, pageSize: 25, total, rows };
  }
  async start(body: any, editorial?:EditorialSnapshot) {
    return this.serial(async () => {
      const input = request(body),
        id = hash({
          postId: input.postId,
          evaluationId: input.evaluationId,
          queueId: input.queueId,
          ...(editorial?{editorialHash:hash(editorial)}:{}),
        });
      for await (const existing of this.data.store.rows<ProductionJob>(
        'production-jobs',
      )) {
        if(existing.request.postId===input.postId&&existing.request.queueId===input.queueId&&existing.id!==id)throw Error('PRODUCTION_EXISTING_PROJECT');
        if (
          existing.requestIds.includes(input.requestId) &&
          (existing.id !== id || existing.request.revision !== input.revision)
        )
          throw Error('IDEMPOTENCY_CONFLICT');
      }
      const existing = await this.data.store.read<ProductionJob>(key(id));
      if (existing) {
        if (existing.request.revision !== input.revision)
          throw Error('STALE_REVISION');
        if (!existing.requestIds.includes(input.requestId)) {
          existing.requestIds.push(input.requestId);
          await this.data.store.write(key(id), existing);
        }
        // Retry does not silently execute a previously failed job. Explicit resume is required.
        return existing;
      }
      const j = await this.data.withQueuedProduction(
        input.postId,
        input.evaluationId,
        input.queueId,
        input.revision,
        async (snapshot) => {
          if(editorial){if(snapshot.input.candidate.sourceReferences[0].entityType!=='POST'||snapshot.bronze.originalBody!==editorial.plan.bundle.collection.root.originalText)throw Error('PRODUCTION_EDITORIAL_ROOT_MISMATCH');await this.validateEditorial(editorial,snapshot.bronze.id);snapshot={...snapshot,editorial} as ProductionSnapshot;}
          const at = this.clock(),
            project = projectId(id);
          const job: ProductionJob = {
            schemaVersion: DATA_SCHEMA,
            jobVersion: 'production-consumer/1',
            id,
            projectId: project,
            request: input,
            requestIds: [input.requestId],
            snapshot,
            snapshotHash: hash(snapshot),
            status: 'QUEUED',
            stage: 'SNAPSHOT_SAVED',
            createdAt: at,
            updatedAt: at,
            completedAt: null,
            attempts: 0,
            error: null,
            history: [
              {
                at,
                status: 'QUEUED',
                stage: 'SNAPSHOT_SAVED',
                reason:
                  'Explicit creation from ACCEPT review and queued snapshot',
              },
            ],
            studioUrl: '/studio?session=' + project+(editorial?'&area=Discovery&step=Script':''),
            mode: 'DRAFT_ONLY',
            publishingAllowed: false,
          };
          await this.data.store.write(key(id), job);
          return job;
        },
      );
      return this.execute(j);
    });
  }
  async resume(id: string) {
    return this.serial(async () => {
      const j = await this.get(id);
      if (j.status === 'SUCCEEDED') return j;
      return this.execute(j);
    });
  }
  private async execute(j: ProductionJob) {
    j.attempts++;
    j.error = null;
    j.completedAt = null;
    try {
      if (j.snapshotHash !== hash(j.snapshot))
        throw Error('PRODUCTION_CHECKPOINT_INTEGRITY');
      await this.move(
        j,
        'RUNNING',
        'VALIDATING_SNAPSHOT',
        'Recheck current source/review/revision before materializing',
      );
      await this.data.withQueuedProduction(
        j.request.postId,
        j.request.evaluationId,
        j.request.queueId,
        j.request.revision,
        async (snapshot) => {
          if(j.snapshot.editorial)await this.validateEditorial(j.snapshot.editorial,snapshot.bronze.id);
          if (hash({...snapshot,...(j.snapshot.editorial?{editorial:j.snapshot.editorial}:{})}) !== j.snapshotHash)
            throw Error('PRODUCTION_SNAPSHOT_MISMATCH');
          await this.move(
            j,
            'RUNNING',
            'CREATING_PROJECT',
            'No script approval, audio or rendering implied',
          );
          await this.studio.ensureProductionSession(productionSession(j));
        },
      );
      j.completedAt = this.clock();
      await this.move(
        j,
        'SUCCEEDED',
        'WAITING_SCRIPT_REVIEW',
        'Project ready to edit; script DRAFT, voice absent, publishing blocked',
      );
    } catch (e: any) {
      j.error = /^(STALE_REVISION|PRODUCTION_[A-Z_]+)$/.test(e.message || '')
        ? e.message
        : 'PRODUCTION_MATERIALIZATION_FAILED';
      await this.move(j, 'FAILED', 'STOPPED', j.error);
    }
    return j;
  }
  async readiness(id: string) {
    const j = await this.get(id);
    if (j.status !== 'SUCCEEDED')
      return {
        jobId: j.id,
        projectId: j.projectId,
        status: j.status,
        ready: false,
      };
    const s = await this.studio.load(j.projectId);
    if (s.productionOrigin?.jobId !== j.id)
      throw Error('PRODUCTION_SESSION_COLLISION');
    return {
      jobId: j.id,
      projectId: s.id,
      sessionRevision: s.revision,
      studioUrl: j.studioUrl,
      scope: 'PROJECT_PREPARATION_ONLY',
      ...(await sessionReadiness(s)),
      renderMode: 'DRAFT_ONLY',
      qualityValidation: 'NOT_PERFORMED_BY_CONSUMER',
      publishingAllowed: false,
    };
  }
  private async validateEditorial(snapshot:EditorialSnapshot,bronzeId:string){
    const p=snapshot.plan;
    if(hash(p)!==snapshot.planHash||hash(p.bundle)!==p.bundleHash||p.bundle.sourceLink?.bronzeId!==bronzeId||p.scriptStatus!=='DRAFT'||p.editorialSelectionConfirmed!==true)throw Error('PRODUCTION_EDITORIAL_INTEGRITY');
    selectedReplies(p.bundle.collection,p.selectedReplyIds);
    const current=await this.data.store.read<EditorialPlan>('editorial-plans/'+p.id+'.json');
    const review=await this.data.store.read<ConversationReview>('conversation-feedback/'+p.collectionId+'.json');
    if(!current||hash(current)!==snapshot.planHash||review?.revision!==p.selectionRevision||hash(review.selectedReplyIds)!==hash(p.selectedReplyIds))throw Error('PRODUCTION_EDITORIAL_STALE');
  }
}
