import { BadRequestException, ConflictException, Injectable, Optional } from '@nestjs/common';
import { createHash, randomUUID } from 'crypto';
import { promises as fs } from 'fs';
import * as path from 'path';
import { replaceFile } from './atomic-file';
import { prepareTtsInput } from './speech-normalizer';
import type { StudioSession } from './studio.contracts';
import { isOperatorRenderPreset, type OperatorRenderPreset, type RenderManifest } from './render.types';
import { StudioService } from './studio.service';
import { ConversationStudioService } from '../data-engine/conversation.controller';
import { AiContentStudioService } from '../data-engine/ai.controller';
import { EditorialStudioService } from '../data-engine/editorial.controller';
import type { EditorialPlan, EditorialSection } from '../data-engine/editorial-contracts';
import { observedContextViews } from '../data-engine/conversation-context';
import { ContentQualityService } from '../data-engine/content-quality.controller';
import { selectConversation } from '../data-engine/content-selection';
import type { ThreadCollection, ConversationReview } from '../data-engine/conversation-contracts';
import { assertRenderable, currentNarration, sourceBlockers } from './production-contract';
import { validateDraftArtifact } from './production-artifact';
import { snapshotHash } from './render-policy';
import { canonicalPost } from '../data-engine/conversation-identity';
import { spokenAmbiguities } from './voice-settings';
import { DEEP_CONVERSATION_BUDGET } from '../data-engine/conversation-public';

export type ProductStage =
  | 'SOURCE'
  | 'AI_QUALITY'
  | 'HUMAN_REVIEW'
  | 'SCRIPT'
  | 'VOICE'
  | 'EDITOR'
  | 'MP4';

export type ProductStageStatus =
  | 'NOT_STARTED'
  | 'RUNNING'
  | 'WAITING_USER'
  | 'READY'
  | 'COMPLETED'
  | 'FAILED';

export interface ProductPipelineJob {
  schemaVersion: 'product-pipeline/1';
  id: string;
  requestKey: string;
  sourceUrl: string;
  sessionId: string;
  createdAt: string;
  updatedAt: string;
  sourceJobId: string | null;
  collectionId: string | null;
  assessmentId: string | null;
  appliedReviewRevision: number | null;
  editorialPlanId: string | null;
  scriptProposalId: string | null;
  scriptReviewRevision: number | null;
  stages: Record<
    ProductStage,
    { status: ProductStageStatus; reason: string; evidence: string[] }
  >;
  nextStage: ProductStage | null;
  latestRenderJobId: string | null;
  warnings: string[];
  /** Exact-source, verified-reply selection for a DRAFT; never user approval. */
  automaticDraftSelection?: boolean;
}

export type AutonomousProductStage =
  | 'DISCOVERING'
  | 'COLLECTING'
  | 'VALIDATING'
  | 'SCORING'
  | 'NORMALIZING'
  | 'CHECKING_DURATION'
  | 'GENERATING_VOICE'
  | 'PREPARING_TIMELINE'
  | 'RENDERING'
  | 'VERIFYING'
  | 'COMPLETED';

export interface AutonomousVideoResult {
  sourceUrl: string;
  collectionId: string | null;
  assessmentId: string | null;
  sessionId: string | null;
  renderJobId: string | null;
  status:
    | 'COMPLETED'
    | 'NOT_ENOUGH_CONTENT'
    | 'QUALITY_FAILED'
    | 'AI_FAILED'
    | 'TTS_FAILED'
    | 'RENDER_FAILED'
    | 'ACCESS_BLOCKED'
    | 'RESOURCE_STOPPED'
    | 'WAITING_HUMAN';
  checkpoint?: 'RESERVED' | 'COLLECTED' | 'ASSESSED' | 'DRAFT' | 'PREPARED' | 'RENDER_SUBMITTED';
  aiLedgerIds?: string[];
  reviewChoice?: {type:'SELECT_ROOT'|'SELECT_REPLIES';options:{sourceId:string;preview:string}[]};
  reviewedChoice?: {type:'SELECT_ROOT'|'SELECT_REPLIES';selectedSourceIds:string[]};
  artifact?: Awaited<ReturnType<typeof validateDraftArtifact>>;
  selectedSourceIds: string[];
  estimatedSeconds: { minimum: number; maximum: number } | null;
  measuredSeconds: number | null;
  timelineSeconds: number | null;
  warnings: string[];
}

export interface AutomaticDispatch {
  preset: OperatorRenderPreset;
  aiRequestLimit: number;
  reviewBeforeRender: boolean;
  reviewSlots?:number;
  dayKey: string;
}

export interface AutonomousProductBatch {
  schemaVersion: 'product-auto-batch/1';
  id: string;
  requestKey: string;
  request: {
    topic: string;
    style: 'SERIOUS';
    keywords: string[];
    keywordExpansion: 'OFF' | 'EXPLICIT';
    targetVideos: number;
    maxCandidates: number;
    maxEnrich: number;
    maxRunMs: number;
    voice: 'my_yen';
    speed: 1.3;
  };
  status: 'QUEUED' | 'RUNNING' | 'COMPLETED' | 'PARTIAL' | 'BLOCKED' | 'FAILED' | 'CANCELLED';
  stage: AutonomousProductStage;
  stageEvents?: Array<{at:string;stage:AutonomousProductStage;status:AutonomousProductBatch['status']}>;
  discoveryRunId: string | null;
  dispatchRequestId?: string;
  dispatch?: AutomaticDispatch;
  discoveryResumeAttempted?: boolean;
  restartAttempts?:number;
  resumeCandidateUrl?:string;
  results: AutonomousVideoResult[];
  /** Prior side-effect-free evaluations retained when an explicit resume re-runs policy code. */
  priorResults?: Array<{
    resumedAt: string;
    reason: 'POLICY_REEVALUATION_NO_SIDE_EFFECTS';
    results: AutonomousVideoResult[];
  }>;
  errors: string[];
  cancelRequested: boolean;
  startedAt: string | null;
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export const SERIOUS_DRAFT_DURATION_POLICY = {
  minimumSeconds: 60,
  preferredMinimumSeconds: 65,
  maximumSeconds: 90,
} as const;

export function seriousDraftDurationStatus(seconds: number) {
  if (!Number.isFinite(seconds) || seconds < SERIOUS_DRAFT_DURATION_POLICY.minimumSeconds)
    return 'TOO_SHORT' as const;
  if (seconds > SERIOUS_DRAFT_DURATION_POLICY.maximumSeconds)
    return 'TOO_LONG' as const;
  return seconds < SERIOUS_DRAFT_DURATION_POLICY.preferredMinimumSeconds
    ? ('PASS_BELOW_PREFERRED' as const)
    : ('PASS_PREFERRED' as const);
}

export function measuredMp4Duration(manifest: Pick<RenderManifest, 'probe'>) {
  const seconds = Number(
    (manifest.probe as { format?: { duration?: string | number } } | undefined)
      ?.format?.duration,
  );
  return Number.isFinite(seconds) && seconds > 0 ? seconds : null;
}

export const autonomousProductRequest = (body: any): AutonomousProductBatch['request'] => {
  const topic = typeof body?.topic === 'string' ? body.topic.trim() : '',
    style = body?.style ?? 'SERIOUS',
    targetVideos = body?.targetVideos ?? 1,
    maxCandidates = body?.maxCandidates ?? 30,
    maxEnrich = body?.maxEnrich ?? 10,
    maxRunMs = body?.maxRunMs ?? 3_600_000,
    keywordExpansion = body?.keywordExpansion === 'EXPLICIT' ? 'EXPLICIT' : 'OFF',
    explicit = Array.isArray(body?.keywords)
      ? body.keywords.map((x: unknown) => String(x).trim()).filter(Boolean)
      : [],
    keywords = [...new Set<string>([topic, ...(keywordExpansion === 'EXPLICIT' ? explicit : [])])];
  if (
    !topic || topic.length > 120 || style !== 'SERIOUS' ||
    !Number.isInteger(targetVideos) || targetVideos < 1 || targetVideos > 3 ||
    !Number.isInteger(maxCandidates) || maxCandidates < 1 || maxCandidates > 30 ||
    !Number.isInteger(maxEnrich) || maxEnrich < 1 || maxEnrich > 10 || maxEnrich > maxCandidates ||
    !Number.isInteger(maxRunMs) || maxRunMs < 60_000 || maxRunMs > 3_600_000 ||
    !keywords.length || keywords.length > 8 || keywords.some((x) => x.length > 120)
  ) throw new BadRequestException('Invalid autonomous DRAFT request');
  return { topic, style, keywords, keywordExpansion, targetVideos, maxCandidates, maxEnrich, maxRunMs, voice: 'my_yen', speed: 1.3 };
};

export const autonomousDiscoveryErrors = (run: {
  status: string;
  errors?: string[];
  diagnosis?: { stage?: string; outcome?: string };
  collections?: unknown[];
}) => [
  ...new Set([
    ...(run.errors || []),
    ...(!run.collections?.length && run.status !== 'COMPLETED'
      ? [
          `DISCOVERY_${run.diagnosis?.outcome || 'UNKNOWN'}_AT_${run.diagnosis?.stage || 'UNKNOWN'}`,
        ]
      : []),
  ]),
];

const stages: ProductStage[] = [
  'SOURCE',
  'AI_QUALITY',
  'HUMAN_REVIEW',
  'SCRIPT',
  'VOICE',
  'EDITOR',
  'MP4',
];

function threadsUrl(value: unknown) {
  if (typeof value !== 'string' || value.length > 500)
    throw new BadRequestException('Enter one public Threads permalink');
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    throw new BadRequestException('Enter one public Threads permalink');
  }
  if (
    !['threads.com', 'www.threads.com'].includes(url.hostname.toLowerCase()) ||
    !/^\/@[^/]+\/post\/[A-Za-z0-9_-]+\/?$/.test(url.pathname)
  )
    throw new BadRequestException(
      'Use a canonical https://www.threads.com/@handle/post/id permalink',
    );
  url.protocol = 'https:';
  url.hostname = 'www.threads.com';
  url.search = '';
  url.hash = '';
  url.pathname = url.pathname.replace(/\/$/, '');
  return url.toString();
}

const currentAudio = (session: StudioSession, itemId: string) => {
  const item = session.items.find((row) => row.id === itemId);
  const spokenHash = createHash('sha256')
    .update(item?.spokenText || '')
    .digest('hex');
  const ttsHash = item
    ? prepareTtsInput(item.spokenText, item.pronunciationOverrides).ttsInputHash
    : null;
  return session.voiceAssets?.some(
    (asset) =>
      asset.itemId === itemId &&
      asset.status !== 'STALE' &&
      asset.textHash === spokenHash &&
      (!asset.ttsInputHash || asset.ttsInputHash === ttsHash) &&
      asset.durationMs > 0,
  );
};

export const partitionAutomaticResumeResults = (
  rows: AutonomousVideoResult[],
) => {
  const retryable: AutonomousVideoResult[] = [],
    retained: AutonomousVideoResult[] = [];
  for (const row of rows) {
    const noSideEffects =
      !row.collectionId &&
      !row.assessmentId &&
      !row.sessionId &&
      !row.renderJobId;
    if (
      noSideEffects &&
      ['NOT_ENOUGH_CONTENT', 'QUALITY_FAILED'].includes(row.status)
    )
      retryable.push(row);
    else retained.push(row);
  }
  return { retryable, retained };
};

export const resumableAutomaticVoiceResult = (
  row: AutonomousVideoResult,
) =>
  ['TTS_FAILED', 'RESOURCE_STOPPED'].includes(row.status) &&
  !!row.sessionId &&
  !!row.assessmentId;

export function productStageSnapshot(
  session: StudioSession,
  sourceJobStatus: string | null,
  renders: RenderManifest[],
  state: { assessmentId?: string | null; reviewApplied?: boolean; scriptMaterialized?: boolean; sourceOnlyDraft?: boolean } = {},
): Pick<
  ProductPipelineJob,
  'stages' | 'nextStage' | 'latestRenderJobId' | 'warnings'
> {
  const selected = session.items
      .filter((item) => item.selected)
      .sort((a, b) => a.order - b.order),
    sourceReady = session.items.some((item) => item.inclusion === 'TARGET'),
    sourceFailed = sourceJobStatus === 'FAILED' || session.status === 'ERROR',
    voiceReady =
      selected.length > 0 && selected.every((item) => currentAudio(session, item.id)),
    scriptReady =
      (!!state.sourceOnlyDraft ||
        (!!state.scriptMaterialized && !!session.project.editorialPlan)) &&
      selected.length > 0 &&
      selected.every((item) => item.spokenText.trim()),
    timelineReady =
      !!session.project.timeline &&
      session.project.timeline.scenes.length === selected.length,
    completedRenders = renders
      .filter((render) => render.status === 'COMPLETED')
      .sort((a, b) => b.completedAt!.localeCompare(a.completedAt!)),
    result = {} as ProductPipelineJob['stages'];

  result.SOURCE = sourceFailed
    ? {
        status: 'FAILED',
        reason: 'Collection failed; preserved errors are available in Source.',
        evidence: session.errors,
      }
    : sourceReady
      ? {
          status: 'COMPLETED',
          reason: 'Canonical target was materialized in this project.',
          evidence: [
            `${session.items.length} source cards`,
            `${session.items.filter((item) => item.inclusion === 'EXPLICIT_CONTEXT').length} observed contexts`,
          ],
        }
      : sourceJobStatus && ['QUEUED', 'RUNNING'].includes(sourceJobStatus)
        ? {
            status: 'RUNNING',
            reason: 'The existing bounded Source collector is running.',
            evidence: sourceJobStatus ? [sourceJobStatus] : [],
          }
        : {
            status: 'NOT_STARTED',
            reason: 'Explicit collection has not completed.',
            evidence: [],
          };
  result.AI_QUALITY = state.assessmentId
    ? {
        status: 'COMPLETED',
        reason: 'A persisted AI assessment is linked to this exact collection.',
        evidence: [state.assessmentId],
      }
    : sourceReady
    ? {
        status: 'WAITING_USER',
        reason:
          'AI evaluation is explicit and budgeted. It is never started by opening or resuming this pipeline.',
        evidence: ['Rule-based Source Quality remains available without inference.'],
      }
    : {
        status: 'NOT_STARTED',
        reason: 'Source is required first.',
        evidence: [],
      };
  result.HUMAN_REVIEW = state.reviewApplied
    ? {
        status: 'COMPLETED',
        reason: 'An explicit ACCEPT review revision was applied to this DRAFT project.',
        evidence: [`${selected.length}/${session.items.length} selected`],
      }
    : state.sourceOnlyDraft
    ? {
        status: 'READY',
        reason:
          'Verified source-only material was selected automatically for this DRAFT. This is not USER_APPROVED or publishing approval.',
        evidence: [`${selected.length}/${session.items.length} selected`],
      }
    : sourceReady
    ? {
        status: 'WAITING_USER',
        reason:
          'Review root and observed/verified evidence, then select only material allowed in the DRAFT.',
        evidence: [
          `${selected.length}/${session.items.length} selected`,
          'Selection does not grant rights or publication approval.',
        ],
      }
    : {
        status: 'NOT_STARTED',
        reason: 'Source is required first.',
        evidence: [],
      };
  result.SCRIPT = scriptReady
    ? {
        status: 'READY',
        reason: 'The reviewed AI/editorial DRAFT is materialized as editable scenes in this project.',
        evidence: [`${selected.length} narration scenes`],
      }
    : {
        status: selected.length ? 'WAITING_USER' : 'NOT_STARTED',
        reason: selected.length
          ? 'Review and save narration for every selected scene.'
          : 'Select source material first.',
        evidence: [],
      };
  result.VOICE = voiceReady
    ? {
        status: 'COMPLETED',
        reason: 'Every selected scene has a current measured DRAFT audio asset.',
        evidence: selected.map((item) => item.id),
      }
    : {
        status: scriptReady ? 'WAITING_USER' : 'NOT_STARTED',
        reason: scriptReady
          ? 'Generate DRAFT audio explicitly in the existing Voice workspace.'
          : 'A saved Script is required first.',
        evidence: [],
      };
  result.EDITOR = timelineReady
    ? {
        status: 'COMPLETED',
        reason: 'The existing timeline engine has a saved scene for every selection.',
        evidence: [
          `${session.project.timeline!.totalFrames} frames`,
          `${session.project.timeline!.fps} FPS`,
        ],
      }
    : {
        status: voiceReady ? 'WAITING_USER' : 'NOT_STARTED',
        reason: voiceReady
          ? 'Prepare and review the existing Editor timeline.'
          : 'Current measured voice assets are required.',
        evidence: [],
      };
  result.MP4 = completedRenders.length
    ? {
        status: 'COMPLETED',
        reason: 'At least one real MP4 completed for this project.',
        evidence: completedRenders.map(
          (render) =>
            `${render.jobId}: ${render.expectedDurationSeconds.toFixed(3)}s ${render.width}x${render.height}`,
        ),
      }
    : {
        status: timelineReady ? 'WAITING_USER' : 'NOT_STARTED',
        reason: timelineReady
          ? 'Run an explicit DRAFT render in MP4 Output.'
          : 'A prepared timeline is required.',
        evidence: [],
      };
  const nextStage = stages.find((stage) =>
    ['NOT_STARTED', 'RUNNING', 'WAITING_USER', 'FAILED'].includes(result[stage].status),
  ) ?? null;
  return {
    stages: result,
    nextStage,
    latestRenderJobId: completedRenders[0]?.jobId ?? null,
    warnings: [
      'Observed context remains unverified unless parent evidence says otherwise.',
      'DRAFT audio and MP4 do not grant content rights or publishing approval.',
      ...(session.errors || []),
    ],
  };
}

@Injectable()
export class ProductPipelineService {
  private root = path.join(
    process.env.STUDIO_DATA_ROOT
      ? path.resolve(process.env.STUDIO_DATA_ROOT)
      : path.resolve(process.cwd(), '.studio-data'),
    'product-jobs',
  );
  private autoRunning = new Set<string>();
  private autoAdmission: Promise<unknown> = Promise.resolve();
  private autoWrites: Promise<unknown> = Promise.resolve();
  private serializeAuto<T>(work: () => Promise<T>) {
    const result = this.autoAdmission.then(work);
    this.autoAdmission = result.catch(() => undefined);
    return result;
  }
  hasActiveAuto() { return this.autoRunning.size !== 0; }
  productionLiveAuthorized() {
    return ['STUDIO_PRODUCT_AUTOMATION_LIVE_ENABLED','STUDIO_DATA_QUALITY_LIVE_ENABLED','STUDIO_DATA04_LIVE_ENABLED']
      .every(key => process.env[key] === '1');
  }

  constructor(
    readonly studio: StudioService,
    readonly conversations: ConversationStudioService,
    readonly ai: AiContentStudioService,
    readonly editorial: EditorialStudioService,
    @Optional() readonly quality?: ContentQualityService,
  ) {}
  private file(id: string) {
    if (!/^[a-f0-9-]{36}$/.test(id))
      throw new BadRequestException('Invalid product job ID');
    return path.join(this.root, id + '.json');
  }
  private async save(job: ProductPipelineJob) {
    await fs.mkdir(this.root, { recursive: true });
    const tmp = this.file(job.id) + '.tmp';
    await fs.writeFile(tmp, JSON.stringify(job, null, 2));
    await replaceFile(tmp, this.file(job.id));
    return job;
  }
  private autoRoot() {
    return path.join(this.root, 'autonomous');
  }
  private autoFile(id: string) {
    if (!/^[a-f0-9-]{36}$/.test(id))
      throw new BadRequestException('Invalid autonomous batch ID');
    return path.join(this.autoRoot(), id + '.json');
  }
  private async saveAuto(job: AutonomousProductBatch, clearCancellation = false) {
    const write = this.autoWrites.then(async () => {
      job.updatedAt = new Date().toISOString();
      await fs.mkdir(this.autoRoot(), { recursive: true });
      const file = this.autoFile(job.id), tmp = file + '.tmp';
      const previous = await fs.readFile(file, 'utf8').catch(error => {
        if (error.code === 'ENOENT') return null;
        throw error;
      });
      const old = previous ? JSON.parse(previous) as AutonomousProductBatch : null;
      if (old?.cancelRequested && !clearCancellation) job.cancelRequested = true;
      if(!old||old.stage!==job.stage||old.status!==job.status)
        job.stageEvents=[...(old?.stageEvents??[]),{at:job.updatedAt,stage:job.stage,status:job.status}];
      await fs.writeFile(tmp, JSON.stringify(job, null, 2));
      await replaceFile(tmp, file);
      return job;
    });
    this.autoWrites = write.catch(() => undefined);
    return write;
  }

  async getAuto(id: string) {
    const job = JSON.parse(
      await fs.readFile(this.autoFile(id), 'utf8').catch(() => {
        throw new BadRequestException('Unknown autonomous batch');
      }),
    ) as AutonomousProductBatch;
    // Historical batch files remain immutable evidence. Enrich only the API
    // view when an older executor stopped before copying discovery diagnostics.
    if (!job.errors.length && job.discoveryRunId && this.quality) {
      const run = await this.quality.engine.get(job.discoveryRunId).catch(() => null);
      if (run) job.errors = autonomousDiscoveryErrors(run);
    }
    return job;
  }
  async listAuto() {
    const rows: AutonomousProductBatch[] = [];
    for (const name of await fs.readdir(this.autoRoot()).catch(() => []))
      if (/^[a-f0-9-]{36}\.json$/.test(name))
        rows.push(await this.getAuto(name.slice(0, -5)));
    return rows.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }
  startAuto(body: any, dispatch?: AutomaticDispatch) {
    return this.serializeAuto(async () => {
      if (body?.confirmLive !== true || !this.productionLiveAuthorized())
        throw new BadRequestException('AUTONOMOUS_LIVE_APPROVAL_REQUIRED');
      if (process.env.STUDIO_AUTOMATION_ENABLED==='1'&&!dispatch)throw new ConflictException('USE_AUTOMATION_SCHEDULER');
      if (!this.quality) throw new BadRequestException('AUTONOMOUS_DISCOVERY_UNAVAILABLE');
      const request = autonomousProductRequest(body);
      const dispatchRequestId: string | undefined = body.requestId;
      if (dispatchRequestId !== undefined &&
          (typeof dispatchRequestId !== 'string' || !/^[\w-]{1,100}$/.test(dispatchRequestId)))
        throw new BadRequestException('INVALID_DISPATCH_REQUEST_ID');
      if (dispatch && (!dispatchRequestId || !isOperatorRenderPreset(dispatch.preset)))
        throw new BadRequestException('INVALID_AUTOMATION_DISPATCH');
      const requestKey = createHash('sha256').update(JSON.stringify(dispatchRequestId === undefined
        ? { version: 'product-auto-batch/1', request }
        : { version: 'product-auto-dispatch/1', request, dispatchRequestId, dispatch })).digest('hex');
      const old = (await this.listAuto()).find(row => dispatchRequestId === undefined
        ? row.requestKey === requestKey : row.dispatchRequestId === dispatchRequestId);
      if (old) {
        if (old.requestKey !== requestKey) throw new ConflictException('AUTOMATION_REQUEST_ID_CONFLICT');
        return old;
      }
      if (this.hasActiveAuto() || this.studio.hasHeavyWorker()) throw new ConflictException('RESOURCE_BLOCKED');
      const now = new Date().toISOString();
      const job: AutonomousProductBatch = {
        schemaVersion: 'product-auto-batch/1', id: randomUUID(), requestKey, request,
        dispatchRequestId, dispatch, status: 'QUEUED', stage: 'DISCOVERING',
        discoveryRunId: null, results: [], errors: [], cancelRequested: false,
        startedAt: null, completedAt: null, createdAt: now, updatedAt: now,
      };
      await this.saveAuto(job);
      this.scheduleAuto(job.id);
      return job;
    });
  }
  private scheduleAuto(id: string) {
    this.autoRunning.add(id);
    setImmediate(() => void this.executeAuto(id).catch(() => undefined));
  }
  cancelAuto(id: string) {
    return this.serializeAuto(async () => {
      const job = await this.getAuto(id);
      if(job.dispatch)throw new ConflictException('USE_AUTOMATION_SCHEDULER');
      if (['QUEUED', 'RUNNING'].includes(job.status)) {
        // Queue behind checkpoint writes and update only the cancellation bit.
        const write = this.autoWrites.then(async () => {
          const current = await this.getAuto(id);
          current.cancelRequested = true;
          const file = this.autoFile(id);
          await fs.writeFile(file + '.tmp', JSON.stringify(current, null, 2));
          await replaceFile(file + '.tmp', file);
          return current;
        });
        this.autoWrites = write.catch(() => undefined);
        return write;
      }
      return job;
    });
  }
  resumeAuto(id: string, scheduled=false) {
    return this.serializeAuto(async () => {
      const job = await this.getAuto(id);
      if (job.dispatch&&!scheduled)throw new ConflictException('USE_AUTOMATION_SCHEDULER');
      if (this.autoRunning.has(id) || job.status === 'COMPLETED') return job;
      if (scheduled&&(job.restartAttempts??0)>=1)throw new ConflictException('AUTOMATION_ATTEMPT_LIMIT');
      if (scheduled)job.restartAttempts=(job.restartAttempts??0)+1;
      if (!this.productionLiveAuthorized() || job.status === 'BLOCKED')
        throw new BadRequestException('A new LIVE authorization is required');
      if (this.hasActiveAuto() || this.studio.hasHeavyWorker()) throw new ConflictException('RESOURCE_BLOCKED');
      const partition = partitionAutomaticResumeResults(job.results);
      if (partition.retryable.length) {
        job.priorResults = [...(job.priorResults || []), {
          resumedAt: new Date().toISOString(), reason: 'POLICY_REEVALUATION_NO_SIDE_EFFECTS', results: partition.retryable,
        }];
        job.results = partition.retained;
      }
      job.cancelRequested = false;
      job.status = 'QUEUED';
      job.completedAt = null;
      await this.saveAuto(job, true);
      this.scheduleAuto(id);
      return job;
    });
  }
  finalizeInterruptedCancellation(id:string) {
    return this.serializeAuto(async()=>{
      const batch=await this.getAuto(id);
      if(!this.hasActiveAuto()&&batch.cancelRequested&&['QUEUED','RUNNING'].includes(batch.status)){
        batch.status='CANCELLED';batch.completedAt=new Date().toISOString();
        await this.saveAuto(batch);
      }
    });
  }
  resumeReviewed(id:string,sourceUrl:string,approved:boolean,choice?:AutonomousVideoResult['reviewedChoice']) {
    return this.serializeAuto(async()=>{
      if(!this.productionLiveAuthorized()||this.hasActiveAuto()||this.studio.hasHeavyWorker())
        throw new ConflictException('RESOURCE_BLOCKED');
      const batch=await this.getAuto(id);
      const row=batch.results.find(x=>x.sourceUrl===sourceUrl&&x.status==='WAITING_HUMAN');
      if(!row)return;
      if(approved&&row.warnings[0]!=='REVIEW_BEFORE_RENDER')throw new BadRequestException('REVIEW_CANNOT_BYPASS_BLOCKER');
      if(choice)row.reviewedChoice=choice;
      if(!approved&&row.sessionId)row.checkpoint='DRAFT';
      row.status='QUALITY_FAILED';
      batch.resumeCandidateUrl=sourceUrl;
      batch.status='QUEUED';batch.completedAt=null;
      await this.saveAuto(batch);
      this.scheduleAuto(id);
    });
  }
  private async checkAuto(batch: AutonomousProductBatch) {
    if ((await this.getAuto(batch.id)).cancelRequested) throw Error('AUTONOMOUS_CANCELLED');
  }
  async start(value: unknown) {
    const sourceUrl = threadsUrl(value),
      requestKey = createHash('sha256')
        .update('product-pipeline/1\n' + sourceUrl)
        .digest('hex');
    for (const name of await fs.readdir(this.root).catch(() => [])) {
      if (!/^[a-f0-9-]{36}\.json$/.test(name)) continue;
      const old: ProductPipelineJob = JSON.parse(
        await fs.readFile(path.join(this.root, name), 'utf8'),
      );
      if (old.requestKey === requestKey) return this.get(old.id);
    }
    const session = await this.studio.create(),
      now = new Date().toISOString(),
      base = productStageSnapshot(session, null, []),
      job: ProductPipelineJob = {
        schemaVersion: 'product-pipeline/1',
        id: randomUUID(),
        requestKey,
        sourceUrl,
        sessionId: session.id,
        createdAt: now,
        updatedAt: now,
        sourceJobId: null,
        collectionId: null,
        assessmentId: null,
        appliedReviewRevision: null,
        editorialPlanId: null,
        scriptProposalId: null,
        scriptReviewRevision: null,
        ...base,
      };
    await this.save(job);
    const sourceJob = await this.studio.startJob(session.id, {
      operation: 'fetch',
      input: {
        revision: session.revision,
        scope: 'WITH_CONTEXT',
        urls: [sourceUrl],
      },
    });
    job.sourceJobId = sourceJob.jobId;
    job.updatedAt = new Date().toISOString();
    return this.save(job);
  }
  async get(id: string) {
    const job: ProductPipelineJob = JSON.parse(
        await fs.readFile(this.file(id), 'utf8').catch(() => {
          throw new BadRequestException('Unknown product job');
        }),
      ),
      session = await this.studio.load(job.sessionId),
      sourceJob = job.sourceJobId
        ? await this.studio.jobs.load(job.sourceJobId)
        : null,
      sourceReady = session.items.some((item) => item.inclusion === 'TARGET');
    if (sourceReady && !job.collectionId) {
      const attempt = session.attempts?.find(
        (row) => row.matchedTargetId && row.records.length,
      );
      if (attempt) {
        const run = await this.conversations.engine.importObservedCapture(
          attempt,
          `product-${job.id}`,
        );
        job.collectionId = run.results[0]?.collectionId ?? null;
      }
    }
    if (job.collectionId) {
      const assessments = await this.ai.evaluator.list();
      const matching = assessments
        .filter((row: any) => row.collectionId === job.collectionId)
        .sort((a: any, b: any) => b.createdAt.localeCompare(a.createdAt));
      job.assessmentId = matching[0]?.id ?? null;
    }
    const snapshot = productStageSnapshot(
        session,
        sourceJob?.status ?? null,
        await this.studio.renders.list(session.id),
        {
          assessmentId: job.assessmentId,
          reviewApplied: job.appliedReviewRevision !== null,
          scriptMaterialized:
            !!job.editorialPlanId &&
            !!job.scriptProposalId &&
            job.scriptReviewRevision !== null,
          sourceOnlyDraft: job.automaticDraftSelection === true,
        },
      );
    Object.assign(job, snapshot, { updatedAt: new Date().toISOString() });
    return this.save(job);
  }
  async applyReview(id: string, revision: number) {
    const job: ProductPipelineJob = JSON.parse(
      await fs.readFile(this.file(id), 'utf8').catch(() => {
        throw new BadRequestException('Unknown product job');
      }),
    );
    if (!job.collectionId)
      throw new BadRequestException('Collect and sync Source before review');
    const review = await this.conversations.engine.review(job.collectionId);
    if (review.revision !== revision || review.decision !== 'ACCEPT')
      throw new BadRequestException('An exact ACCEPT review revision is required');
    const session = await this.studio.load(job.sessionId),
      selectedUrls = new Set(review.selectedObservedUrls || []),
      selectedIds = new Set(review.selectedReplyIds);
    const saved = await this.studio.mutate(job.sessionId, {
      revision: session.revision,
      title: session.title,
      items: session.items.map((item) => ({
        id: item.id,
        selected:
          item.inclusion === 'TARGET' ||
          selectedUrls.has(item.sourceUrl) ||
          selectedIds.has(item.sourceId || ''),
        displayText: item.displayText,
        spokenText: item.spokenText,
        metadata: item.metadata,
        pronunciationOverrides: item.pronunciationOverrides,
      })),
    });
    job.appliedReviewRevision = review.revision;
    job.updatedAt = new Date().toISOString();
    await this.save(job);
    return { job: await this.get(job.id), session: saved };
  }
  async materializeScript(
    id: string,
    body: { proposalId?: unknown; reviewRevision?: unknown; sessionRevision?: unknown },
  ) {
    const job: ProductPipelineJob = JSON.parse(
      await fs.readFile(this.file(id), 'utf8').catch(() => {
        throw new BadRequestException('Unknown product job');
      }),
    );
    if (!job.collectionId || job.appliedReviewRevision === null)
      throw new BadRequestException('Apply an accepted conversation review first');
    if (
      typeof body?.proposalId !== 'string' ||
      !/^[a-f0-9]{64}$/.test(body.proposalId) ||
      !Number.isInteger(body.reviewRevision) ||
      !Number.isInteger(body.sessionRevision)
    )
      throw new BadRequestException('Invalid Script DRAFT materialization request');
    const conversationReview = await this.conversations.engine.review(job.collectionId);
    if (
      conversationReview.decision !== 'ACCEPT' ||
      conversationReview.revision !== job.appliedReviewRevision
    )
      throw new BadRequestException('Conversation review changed; apply it again');
    const proposal = await this.ai.agent.proposal(body.proposalId);
    const scriptReview = await this.ai.agent.review(body.proposalId);
    if (!scriptReview || scriptReview.revision !== body.reviewRevision)
      throw new BadRequestException('Save and reopen the exact Script review revision');
    if (job.assessmentId && proposal.assessmentId !== job.assessmentId)
      throw new BadRequestException('Script proposal belongs to another assessment');
    if (
      job.scriptProposalId === proposal.id &&
      job.scriptReviewRevision === scriptReview.revision &&
      job.editorialPlanId
    )
      return {
        job: await this.get(job.id),
        plan: await this.editorial.engine.get(job.editorialPlanId),
        session: await this.studio.load(job.sessionId),
      };
    const record = await this.conversations.engine.collection(job.collectionId);
    const observed = observedContextViews(record.collection);
    const selectedSourceIds = new Set<string>([
      record.collection.root.id,
      ...conversationReview.selectedReplyIds,
      ...observed
        .filter((row) => (conversationReview.selectedObservedUrls || []).includes(row.url))
        .map((row) => row.id),
    ]);
    for (const section of scriptReview.sections)
      if (
        section.kind !== 'COMMENTARY' &&
        section.sourceIds.some((sourceId) => !selectedSourceIds.has(sourceId))
      )
        throw new BadRequestException(
          'AI Script cites source material outside the persisted editorial review',
        );
    let plan = (await this.editorial.engine.list()).find(
      (row) =>
        row.collectionId === job.collectionId &&
        row.selectionRevision === conversationReview.revision,
    );
    if (!plan)
      plan = await this.editorial.create({
        collectionId: job.collectionId,
        selectionRevision: conversationReview.revision,
        selectionConfirmed: true,
        requestId: `product-${job.id}-${conversationReview.revision}`,
        style: 'SERIOUS',
      });
    const sourceDrafts = new Map<string, typeof scriptReview.sections>();
    const commentary: typeof scriptReview.sections = [];
    for (const section of scriptReview.sections) {
      if (section.kind === 'COMMENTARY') commentary.push(section);
      else
        for (const sourceId of section.sourceIds)
          sourceDrafts.set(sourceId, [
            ...(sourceDrafts.get(sourceId) || []),
            section,
          ]);
    }
    const isConclusion = (section: (typeof scriptReview.sections)[number]) =>
      /(conclusion|resolution|kết luận|kết thúc)/iu.test(section.purpose);
    const conclusion = commentary.filter(isConclusion);
    const analysis = commentary.filter((row) => !isConclusion(row));
    const sections: EditorialSection[] = plan.sections.map((section) => {
      if (section.stage === 'HOOK')
        return {
          ...section,
          displayText: scriptReview!.hook,
          narrationText: scriptReview!.hook,
        };
      if (section.stage === 'COMMENTARY' || section.stage === 'RESOLUTION') {
        const rows = section.stage === 'RESOLUTION' ? conclusion : analysis;
        const text = rows.map((row) => row.text.trim()).filter(Boolean).join('\n\n');
        return { ...section, displayText: text, narrationText: text };
      }
      const rows = section.sourceId ? sourceDrafts.get(section.sourceId) || [] : [];
      if (!rows.length) return section;
      const text = rows.map((row) => row.text.trim()).filter(Boolean).join('\n\n');
      const exactQuote = rows.length === 1 && rows[0].kind === 'QUOTE' && text === section.originalText;
      return {
        ...section,
        kind: exactQuote ? ('QUOTE' as const) : ('PARAPHRASE' as const),
        displayText: text,
        narrationText: text,
      };
    });
    plan = await this.editorial.save(plan.id, {
      revision: plan.revision,
      sections,
    });
    const session = await this.studio.applyEditorialDraft(
      job.sessionId,
      body.sessionRevision as number,
      plan,
    );
    job.editorialPlanId = plan.id;
    job.scriptProposalId = proposal.id;
    job.scriptReviewRevision = scriptReview.revision;
    job.updatedAt = new Date().toISOString();
    await this.save(job);
    return { job: await this.get(job.id), plan, session };
  }
  private async registerAutomaticDraft(
    sourceUrl: string,
    session: StudioSession,
    collectionId: string,
    assessmentId: string,
  ) {
    const now = new Date().toISOString(),
      id = randomUUID(),
      snapshot = productStageSnapshot(session, null, [], {
        assessmentId,
        sourceOnlyDraft: true,
      }),
      job: ProductPipelineJob = {
        schemaVersion: 'product-pipeline/1',
        id,
        requestKey: createHash('sha256')
          .update(`product-auto-draft/1\n${collectionId}`)
          .digest('hex'),
        sourceUrl,
        sessionId: session.id,
        createdAt: now,
        updatedAt: now,
        sourceJobId: null,
        collectionId,
        assessmentId,
        appliedReviewRevision: null,
        editorialPlanId: null,
        scriptProposalId: null,
        scriptReviewRevision: null,
        automaticDraftSelection: true,
        ...snapshot,
      };
    return this.save(job);
  }
  async waitStudioJob(jobId: string, deadlineMs: number) {
    while (Date.now() < deadlineMs) {
      const job = await this.studio.jobs.load(jobId);
      if (!['QUEUED', 'RUNNING'].includes(job.status)) return job;
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
    throw Error('AUTONOMOUS_STAGE_TIMEOUT');
  }
  async renderPreparedDraft(session: StudioSession, preset: OperatorRenderPreset, requestId: string) {
    const prior = await this.studio.jobs.findRequest(session.id, 'operator:automation-render', requestId);
    if (prior) return prior;
    return this.studio.jobs.submit(session.id, 'operator:automation-render', {
      requestId, revision: session.revision, preset,
    }, (tick, jobId) => this.studio.runOperatorDraft(session.id, session.revision, requestId, tick, jobId, preset,
      async (current, props) => {
        assertRenderable(current, props);
        if (snapshotHash(current.project.timeline) !== snapshotHash(props.timeline)) throw Error('STALE_REVISION');
        await this.requireNarration(current);
      }, true));
  }

  private async requireNarration(session: StudioSession) {
    const assets = [];
    for (const item of session.items.filter(x => x.selected)) {
      const asset = currentNarration(session, item);
      if (!asset || (await fs.stat(await this.studio.audioFile(session.id, asset.id))).size <= 44)
        throw Error('CURRENT_MEASURED_AUDIO_REQUIRED:' + item.id);
      assets.push(asset);
    }
    return assets;
  }

  private async continueAutomaticDraft(batch: AutonomousProductBatch, result: AutonomousVideoResult) {
    if (!result.sessionId) throw Error('AUTONOMOUS_DRAFT_SESSION_MISSING');
    const id = result.sessionId, preset = batch.dispatch?.preset ?? '1080P60';
    const requestId = 'auto-render-' + batch.id + '-' + canonicalPost(result.sourceUrl)?.id;
    let current = await this.studio.load(id);
    const existing = result.renderJobId
      ? await this.studio.jobs.load(result.renderJobId)
      : await this.studio.jobs.findRequest(id, 'operator:automation-render', requestId);
    if (result.checkpoint !== 'PREPARED' && !existing) {
      await this.checkAuto(batch);
      const blockers = sourceBlockers(current);
      if (blockers.length) throw Error(blockers.join('; '));
      current = await this.studio.restoreOperatorAvatars(id, current.revision);
      current = await this.studio.applyAutomaticSeriousAssets(id, current.revision);
      current = await this.studio.normalizeAutomaticDraft(id, current.revision);
      const ambiguous = current.items.filter(item => item.selected).flatMap(item =>
        [...spokenAmbiguities(item.spokenText,item.pronunciationOverrides),
        ...(item.automaticNormalization?.ambiguousTerms ?? [])].filter(term =>
          !Object.keys(item.pronunciationOverrides ?? {}).some(key => key.toLowerCase() === term.toLowerCase())));
      if (ambiguous.length) {
        result.status = 'WAITING_HUMAN';
        result.warnings = ['PRONUNCIATION_REVIEW_REQUIRED', ...new Set(ambiguous)];
        return;
      }
      batch.stage = 'GENERATING_VOICE';
      await this.saveAuto(batch);
      for (const item of current.items.filter(row => row.selected).sort((a,b) => a.order-b.order)) {
        await this.checkAuto(batch);
        const cached = currentNarration(current, item);
        if (cached && (await fs.stat(await this.studio.audioFile(id,cached.id)).catch(() => null))?.size > 44) continue;
        current = await this.studio.voiceAction(id, item.id, {
          revision: current.revision, action:'GENERATE', voice:batch.request.voice, speed:batch.request.speed, draft:true,
        });
      }
      const assets = await this.requireNarration(current);
      result.measuredSeconds = assets.reduce((sum, asset) => sum + asset.durationMs / 1000, 0);
      batch.stage = 'PREPARING_TIMELINE';
      await this.saveAuto(batch);
      await this.studio.preparePreview(id, current.revision, true);
      current = await this.studio.load(id);
      const timeline = current.project.timeline;
      if (!timeline) throw Error('AUTONOMOUS_TIMELINE_MISSING');
      const props = (await this.studio.preview(id)).request.inputProps;
      assertRenderable(current, props);
      result.timelineSeconds = timeline.totalFrames / timeline.fps;
      if (['TOO_SHORT','TOO_LONG'].includes(seriousDraftDurationStatus(result.timelineSeconds))) {
        result.status = 'NOT_ENOUGH_CONTENT';
        result.warnings = ['MEASURED_DURATION_OUT_OF_RANGE'];
        return;
      }
      result.checkpoint = 'PREPARED';
      if (batch.dispatch?.reviewBeforeRender) {
        result.status = 'WAITING_HUMAN';
        result.warnings = ['REVIEW_BEFORE_RENDER'];
        return;
      }
      await this.saveAuto(batch);
    }
    await this.checkAuto(batch);
    batch.stage = 'RENDERING';
    await this.saveAuto(batch);
    const submitted = existing ?? await this.renderPreparedDraft(current, preset, requestId);
    result.renderJobId = submitted.jobId;
    result.checkpoint = 'RENDER_SUBMITTED';
    await this.saveAuto(batch);
    const completed = await this.waitStudioJob(submitted.jobId, Date.now() + batch.request.maxRunMs);
    const finishedManifest = await this.studio.renders.load(id, submitted.jobId).catch(()=>null);
    if (completed.status !== 'SUCCEEDED' && finishedManifest?.status!=='COMPLETED') {
      result.status = /RENDER_PRESET_UNSUPPORTED|RENDER_FPS_CONVERSION_UNSUPPORTED/.test(completed.error ?? '')
        ? 'WAITING_HUMAN' : 'RENDER_FAILED';
      result.warnings = [completed.error || completed.status];
      return;
    }
    batch.stage = 'VERIFYING';
    await this.saveAuto(batch);
    const artifact = await validateDraftArtifact(this.studio, id, submitted.jobId, preset, submitted.inputRevision);
    if (['TOO_SHORT','TOO_LONG'].includes(seriousDraftDurationStatus(artifact.durationSeconds)))
      throw Error('MP4_DURATION_OUT_OF_RANGE');
    result.artifact = artifact;
    result.timelineSeconds = artifact.durationSeconds;
    result.status = 'COMPLETED';
  }

  private async processAutomaticCollection(batch: AutonomousProductBatch, collection: ThreadCollection,
    result: AutonomousVideoResult, index: number) {
    const identity = canonicalPost(collection.root.url);
    if (!identity || collection.root.provenance.synthetic || !collection.root.originalText.trim())
      throw Error('INVALID_SOURCE_PROJECTION');
    if (result.sessionId) return this.continueAutomaticDraft(batch, result);
    const terms = [batch.request.topic, ...batch.request.keywords];
    const prior = selectConversation(collection,'SERIOUS',new Date().toISOString(),terms);
    const verified = new Set(collection.replies.filter(reply=>!reply.provenance.synthetic && canonicalPost(reply.url)).map(reply=>reply.id));
    const ruleIds = prior.comments.filter(row => verified.has(row.id)&&row.useful && row.relationship === 'PARENT_VERIFIED')
      .sort((a,b) => b.score-a.score || a.id.localeCompare(b.id)).slice(0,8).map(row => row.id);
    const estimate = (selectedIds: string[]) =>
      selectConversation(collection,'SERIOUS',new Date().toISOString(),terms,{ selectedIds }).estimate;
    const eligible = estimate(ruleIds);
    result.estimatedSeconds = {minimum:eligible.minimumSeconds,maximum:eligible.maximumSeconds};
    if (eligible.maximumSeconds < 60) { result.status = 'NOT_ENOUGH_CONTENT'; return; }
    await this.checkAuto(batch);
    const imported = await this.conversations.engine.importCollection(collection, 'auto-' + batch.id + '-' + index);
    const collectionId = imported.results[0]?.collectionId;
    if (!collectionId) throw Error('AUTONOMOUS_COLLECTION_IMPORT_FAILED');
    result.collectionId = collectionId;
    result.checkpoint = 'COLLECTED';
    batch.stage = 'SCORING';
    await this.saveAuto(batch);
    let assessment;
    try {
      assessment = result.assessmentId
        ? await this.ai.evaluator.get(result.assessmentId)
        : await this.ai.evaluator.evaluate({collectionId, collection, style:'SERIOUS', heuristic:imported.results[0]?.evaluation},
          undefined, async ledgerId => {
            await this.checkAuto(batch);
            const spent = batch.results.reduce((n,row) => n+(row.aiLedgerIds?.length ?? 0),0);
            if (spent >= (batch.dispatch?.aiRequestLimit ?? 30)) throw Error('DAILY_AI_LIMIT_REACHED');
            (result.aiLedgerIds ??= []).push(ledgerId);
            await this.saveAuto(batch);
          }, new Set(ruleIds));
    } catch (error) {
      if ((error as Error).message === 'AUTONOMOUS_CANCELLED') throw error;
      result.status = 'AI_FAILED';
      result.warnings = [(error as Error).message];
      return;
    }
    result.assessmentId = assessment.id;
    result.checkpoint = 'ASSESSED';
    await this.saveAuto(batch);
    const aiEligible = ruleIds.filter(id => assessment.selectedSourceIds.includes(id));
    let selectedIds = aiEligible;
    if (result.reviewedChoice?.type==='SELECT_REPLIES') {
      selectedIds=aiEligible.filter(id=>result.reviewedChoice.selectedSourceIds.includes(id));
      if(selectedIds.length!==result.reviewedChoice.selectedSourceIds.length)throw Error('REVIEW_CANNOT_BYPASS_BLOCKER');
    }
    const chosen = estimate(selectedIds);
    result.selectedSourceIds = [collection.root.id,...selectedIds];
    result.estimatedSeconds = {minimum:chosen.minimumSeconds,maximum:chosen.maximumSeconds};
    if (chosen.maximumSeconds < 60 || chosen.minimumSeconds > 90) {
      result.status = 'NOT_ENOUGH_CONTENT';
      return;
    }
    if(!result.reviewedChoice&&prior.topicRelevance.status==='UNCERTAIN') {
      result.reviewChoice={type:'SELECT_ROOT',options:[{sourceId:collection.root.id,preview:collection.root.originalText.slice(0,280)}]};
      result.status='WAITING_HUMAN';result.warnings=['ROOT_TOPIC_REVIEW_REQUIRED'];return;
    }
    if(result.reviewedChoice?.type!=='SELECT_REPLIES'&&assessment.candidates.some(c=>selectedIds.includes(c.sourceId)&&c.requiresHumanReview)){
      result.reviewChoice={type:'SELECT_REPLIES',options:collection.replies.filter(r=>aiEligible.includes(r.id))
        .map(r=>({sourceId:r.id,preview:r.originalText.slice(0,280)}))};
      result.status='WAITING_HUMAN';result.warnings=['REPLY_SELECTION_REVIEW_REQUIRED'];return;
    }
    result.reviewChoice=undefined;
    await this.checkAuto(batch);
    batch.stage = 'NORMALIZING';
    await this.saveAuto(batch);
    const review = await this.conversations.engine.review(collectionId);
    const draftReview: ConversationReview = {...review, selectedReplyIds:selectedIds, selectedObservedUrls:[],
      decision:'NEEDS_REVIEW', reason:'AUTOMATIC_VERIFIED_SOURCE_SELECTION_FOR_DRAFT'};
    const draft = await this.studio.createConversationDraft(collection,draftReview,'auto-'+batch.id+'-'+identity.id,true);
    result.sessionId = draft.id;
    result.checkpoint = 'DRAFT';
    await this.saveAuto(batch);
    await this.registerAutomaticDraft(collection.root.url,draft,collectionId,assessment.id);
    await this.continueAutomaticDraft(batch,result);
  }

  private async executeAuto(id: string) {
    let job: AutonomousProductBatch;
    try {
      job = await this.getAuto(id);
      await this.studio.withProductionWorker(async () => {
        await this.checkAuto(job);
        if (!this.quality) throw Error('AUTONOMOUS_DISCOVERY_UNAVAILABLE');
        job.status = 'RUNNING';
        job.startedAt ??= new Date().toISOString();
        await this.saveAuto(job);
        let run = job.discoveryRunId ? await this.quality.engine.get(job.discoveryRunId)
          : await this.quality.data.studio.withControlledCollection(() => this.quality.engine.start({
            requestId:'auto-'+id, style:'SERIOUS', topic:job.request.topic, keywords:job.request.keywords,
            maxPosts:job.request.maxCandidates, maxEnrich:job.request.maxEnrich, priority:'HOT',
            minInteractions:0, maxRunMs:job.request.maxRunMs, collectionBudget:DEEP_CONVERSATION_BUDGET,
          }));
        job.discoveryRunId = run.id;
        job.errors = [...new Set([...job.errors,...autonomousDiscoveryErrors(run)])];
        await this.saveAuto(job);
        if (run.status === 'BLOCKED') {job.status='BLOCKED';return;}
        if (run.status === 'RUNNING') {
          if(job.discoveryResumeAttempted)throw Error('DISCOVERY_INTERRUPTED');
          job.discoveryResumeAttempted=true;
          await this.saveAuto(job);
          run=await this.quality.data.studio.withControlledCollection(()=>this.quality.engine.resume(run.id));
        }
        const known = new Set((await this.listAuto()).filter(row => row.id !== id)
          .flatMap(row => row.results.map(result => canonicalPost(result.sourceUrl)?.id).filter(Boolean)));
        for (const [index,collection] of run.collections.entries()) {
          await this.checkAuto(job);
          if(job.resumeCandidateUrl&&job.resumeCandidateUrl!==collection.root.url)continue;
          if (!job.resumeCandidateUrl&&(job.results.filter(row=>row.status==='COMPLETED').length>=job.request.targetVideos ||
              job.results.filter(row=>row.status==='COMPLETED'||row.status==='WAITING_HUMAN').length>=(job.dispatch?.reviewSlots??10))) break;
          const key = canonicalPost(collection.root.url)?.id;
          if (!key || known.has(key)) continue;
          let result = job.results.find(row=>canonicalPost(row.sourceUrl)?.id===key);
          if (!result) {
            result = {sourceUrl:collection.root.url, collectionId:null,assessmentId:null,sessionId:null,
              renderJobId:null, status:'QUALITY_FAILED', checkpoint:'RESERVED', selectedSourceIds:[],
              estimatedSeconds:null,measuredSeconds:null,timelineSeconds:null,warnings:[]};
            job.results.push(result);
            await this.saveAuto(job);
          } else if (!result.checkpoint || result.status === 'COMPLETED' || result.status === 'WAITING_HUMAN' ||
            result.status === 'NOT_ENOUGH_CONTENT' || result.status === 'AI_FAILED') continue;
          try {
            await this.processAutomaticCollection(job,collection,result,index);
          } catch (error) {
            const message=(error as Error).message;
            if (message === 'AUTONOMOUS_CANCELLED') throw error;
            result.status=/RESOURCE/.test(message)?'RESOURCE_STOPPED':result.renderJobId?'RENDER_FAILED':result.sessionId?'TTS_FAILED':'QUALITY_FAILED';
            result.warnings=[message];
          }
          await this.saveAuto(job);
        }
        delete job.resumeCandidateUrl;
        const complete=job.results.filter(row=>row.status==='COMPLETED').length;
        job.status=complete>=job.request.targetVideos?'COMPLETED':complete||job.results.some(row=>row.status==='WAITING_HUMAN')?'PARTIAL':'FAILED';
        job.stage='COMPLETED';
      });
    } catch (error) {
      if (job) {
        const message=(error as Error).message;
        job.status=message==='AUTONOMOUS_CANCELLED'?'CANCELLED':/ACCESS|CAPTCHA|LOGIN/.test(message)?'BLOCKED':'FAILED';
        job.errors.push(message);
      }
    } finally {
      try {
        if (job) {job.completedAt=new Date().toISOString();await this.saveAuto(job);}
      } finally { this.autoRunning.delete(id); }
    }
  }
  async list() {
    const result: ProductPipelineJob[] = [];
    for (const name of await fs.readdir(this.root).catch(() => []))
      if (/^[a-f0-9-]{36}\.json$/.test(name))
        result.push(await this.get(name.slice(0, -5)));
    return result.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }
}
