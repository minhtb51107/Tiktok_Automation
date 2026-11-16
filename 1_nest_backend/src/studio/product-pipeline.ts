import { BadRequestException, Injectable, Optional } from '@nestjs/common';
import { createHash, randomUUID } from 'crypto';
import { promises as fs } from 'fs';
import * as path from 'path';
import { replaceFile } from './atomic-file';
import type { StudioSession } from './studio.contracts';
import type { RenderManifest } from './render.types';
import { StudioService } from './studio.service';
import { ConversationStudioService } from '../data-engine/conversation.controller';
import { AiContentStudioService } from '../data-engine/ai.controller';
import { EditorialStudioService } from '../data-engine/editorial.controller';
import type { EditorialPlan, EditorialSection } from '../data-engine/editorial-contracts';
import { observedContextViews } from '../data-engine/conversation-context';
import { ContentQualityService } from '../data-engine/content-quality.controller';
import { selectConversation } from '../data-engine/content-selection';
import type { ThreadCollection, ConversationReview } from '../data-engine/conversation-contracts';

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
    | 'RESOURCE_STOPPED';
  selectedSourceIds: string[];
  estimatedSeconds: { minimum: number; maximum: number } | null;
  measuredSeconds: number | null;
  timelineSeconds: number | null;
  warnings: string[];
}

export interface AutonomousProductBatch {
  schemaVersion: 'product-auto-batch/1';
  id: string;
  requestKey: string;
  request: {
    topic: string;
    style: 'SERIOUS';
    keywords: string[];
    targetVideos: number;
    maxCandidates: number;
    maxEnrich: number;
    maxRunMs: number;
    voice: 'my_yen';
    speed: 1.3;
  };
  status: 'QUEUED' | 'RUNNING' | 'COMPLETED' | 'PARTIAL' | 'BLOCKED' | 'FAILED' | 'CANCELLED';
  stage: AutonomousProductStage;
  discoveryRunId: string | null;
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

export const autonomousProductRequest = (body: any): AutonomousProductBatch['request'] => {
  const topic = typeof body?.topic === 'string' ? body.topic.trim() : '',
    style = body?.style ?? 'SERIOUS',
    targetVideos = body?.targetVideos ?? 1,
    maxCandidates = body?.maxCandidates ?? 30,
    maxEnrich = body?.maxEnrich ?? 10,
    maxRunMs = body?.maxRunMs ?? 3_600_000,
    keywords = Array.isArray(body?.keywords)
      ? [...new Set<string>(body.keywords.map((x: unknown) => String(x).trim()).filter(Boolean))]
      : [topic, 'đi làm', 'công sở', 'nghề nghiệp'].filter(Boolean);
  if (
    !topic || topic.length > 120 || style !== 'SERIOUS' ||
    !Number.isInteger(targetVideos) || targetVideos < 1 || targetVideos > 3 ||
    !Number.isInteger(maxCandidates) || maxCandidates < 1 || maxCandidates > 30 ||
    !Number.isInteger(maxEnrich) || maxEnrich < 1 || maxEnrich > 10 || maxEnrich > maxCandidates ||
    !Number.isInteger(maxRunMs) || maxRunMs < 60_000 || maxRunMs > 3_600_000 ||
    !keywords.length || keywords.length > 8 || keywords.some((x) => x.length > 120)
  ) throw new BadRequestException('Invalid autonomous DRAFT request');
  return { topic, style, keywords, targetVideos, maxCandidates, maxEnrich, maxRunMs, voice: 'my_yen', speed: 1.3 };
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
  return session.voiceAssets?.some(
    (asset) =>
      asset.itemId === itemId &&
      asset.status !== 'STALE' &&
      asset.textHash ===
        createHash('sha256').update(item?.spokenText || '').digest('hex') &&
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
  private async saveAuto(job: AutonomousProductBatch) {
    job.updatedAt = new Date().toISOString();
    await fs.mkdir(this.autoRoot(), { recursive: true });
    const tmp = this.autoFile(job.id) + '.tmp';
    await fs.writeFile(tmp, JSON.stringify(job, null, 2));
    await replaceFile(tmp, this.autoFile(job.id));
    return job;
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
  async startAuto(body: any) {
    if (
      body?.confirmLive !== true ||
      process.env.STUDIO_PRODUCT_AUTOMATION_LIVE_ENABLED !== '1' ||
      process.env.STUDIO_DATA_QUALITY_LIVE_ENABLED !== '1' ||
      process.env.STUDIO_DATA04_LIVE_ENABLED !== '1'
    ) throw new BadRequestException('AUTONOMOUS_LIVE_APPROVAL_REQUIRED');
    if (!this.quality)
      throw new BadRequestException('AUTONOMOUS_DISCOVERY_UNAVAILABLE');
    const request = autonomousProductRequest(body),
      requestKey = createHash('sha256')
        .update(JSON.stringify({ version: 'product-auto-batch/1', request }))
        .digest('hex');
    for (const old of await this.listAuto())
      if (old.requestKey === requestKey) return old;
    const now = new Date().toISOString(),
      job: AutonomousProductBatch = {
        schemaVersion: 'product-auto-batch/1',
        id: randomUUID(),
        requestKey,
        request,
        status: 'QUEUED',
        stage: 'DISCOVERING',
        discoveryRunId: null,
        results: [],
        errors: [],
        cancelRequested: false,
        startedAt: null,
        completedAt: null,
        createdAt: now,
        updatedAt: now,
      };
    await this.saveAuto(job);
    setImmediate(() => void this.executeAuto(job.id));
    return job;
  }
  async cancelAuto(id: string) {
    const job = await this.getAuto(id);
    if (['QUEUED', 'RUNNING'].includes(job.status)) {
      job.cancelRequested = true;
      await this.saveAuto(job);
    }
    return job;
  }
  async resumeAuto(id: string) {
    const job = await this.getAuto(id);
    if (this.autoRunning.has(id)) return job;
    if (job.status === 'COMPLETED') return job;
    if (job.status === 'BLOCKED')
      throw new BadRequestException('A new LIVE authorization is required');
    const partition = partitionAutomaticResumeResults(job.results);
    if (partition.retryable.length) {
      job.priorResults = [
        ...(job.priorResults || []),
        {
          resumedAt: new Date().toISOString(),
          reason: 'POLICY_REEVALUATION_NO_SIDE_EFFECTS',
          results: partition.retryable,
        },
      ];
      job.results = partition.retained;
    }
    job.cancelRequested = false;
    job.status = 'QUEUED';
    job.completedAt = null;
    await this.saveAuto(job);
    setImmediate(() => void this.executeAuto(id));
    return job;
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
  private async waitStudioJob(jobId: string, deadlineMs: number) {
    while (Date.now() < deadlineMs) {
      const job = await this.studio.jobs.load(jobId);
      if (!['QUEUED', 'RUNNING'].includes(job.status)) return job;
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
    throw Error('AUTONOMOUS_STAGE_TIMEOUT');
  }
  private async continueAutomaticDraft(
    batch: AutonomousProductBatch,
    result: AutonomousVideoResult,
    index: number,
  ): Promise<AutonomousVideoResult> {
    if (!result.sessionId) throw Error('AUTONOMOUS_DRAFT_SESSION_MISSING');
    batch.stage = 'GENERATING_VOICE';
    await this.saveAuto(batch);
    await this.studio.runtime(result.sessionId);
    let current = await this.studio.load(result.sessionId);
    for (const item of current.items
      .filter((row) => row.selected)
      .sort((a, b) => a.order - b.order)) {
      if (currentAudio(current, item.id)) continue;
      current = await this.studio.voiceAction(result.sessionId, item.id, {
        revision: current.revision,
        action: 'GENERATE',
        voice: batch.request.voice,
        speed: batch.request.speed,
        draft: true,
      });
      const latest = current.voiceJobs?.slice(-1)[0];
      if (latest?.status === 'ERROR') {
        result.status = 'TTS_FAILED';
        result.warnings = [latest.error || 'Kokoro generation failed'];
        return result;
      }
    }
    current = await this.studio.load(result.sessionId);
    const selectedItemIds = new Set(
        current.items.filter((row) => row.selected).map((row) => row.id),
      ),
      currentAssets = new Map<
        string,
        NonNullable<StudioSession['voiceAssets']>[number]
      >();
    for (const asset of current.voiceAssets || [])
      if (selectedItemIds.has(asset.itemId) && asset.status !== 'STALE')
        currentAssets.set(asset.itemId, asset);
    if (currentAssets.size !== selectedItemIds.size) {
      result.status = 'TTS_FAILED';
      result.warnings = ['One or more selected scenes have no current audio'];
      return result;
    }
    const measured = [...currentAssets.values()].reduce(
      (sum, asset) => sum + asset.durationMs / 1000,
      0,
    );
    result.measuredSeconds = Number(measured.toFixed(3));
    if (measured < 60) {
      result.status = 'NOT_ENOUGH_CONTENT';
      result.warnings = [
        `Measured source narration is ${result.measuredSeconds}s; no padding or invented text was added`,
      ];
      return result;
    }
    batch.stage = 'PREPARING_TIMELINE';
    await this.saveAuto(batch);
    await this.studio.preparePreview(result.sessionId, current.revision);
    current = await this.studio.load(result.sessionId);
    const timeline = current.project.timeline;
    if (!timeline) throw Error('AUTONOMOUS_TIMELINE_MISSING');
    if (timeline.scenes.some((scene) => scene.subtitles.length))
      throw Error('AUTONOMOUS_SUBTITLES_NOT_OFF');
    const timelineSeconds = timeline.totalFrames / timeline.fps;
    result.timelineSeconds = Number(timelineSeconds.toFixed(3));
    if (timelineSeconds < 65 || timelineSeconds > 90) {
      result.status = 'NOT_ENOUGH_CONTENT';
      result.warnings = [
        `Measured timeline ${result.timelineSeconds}s is outside the 65-90s product target`,
      ];
      return result;
    }
    batch.stage = 'RENDERING';
    await this.saveAuto(batch);
    const renderJob = await this.studio.startJob(result.sessionId, {
      operation: 'render',
      input: {
        revision: current.revision,
        mode: 'DRAFT',
        preset: '720P',
        requestId: `auto-${batch.id}-${index}`,
        backgroundMode: 'SAVED',
      },
    });
    result.renderJobId = renderJob.jobId;
    const completed = await this.waitStudioJob(
      renderJob.jobId,
      Date.now() + Math.min(batch.request.maxRunMs, 30 * 60_000),
    );
    if (completed.status !== 'SUCCEEDED') {
      result.status = 'RENDER_FAILED';
      result.warnings = [completed.error || completed.status];
      return result;
    }
    batch.stage = 'VERIFYING';
    await this.saveAuto(batch);
    const manifest = await this.studio.renders.load(
      result.sessionId,
      renderJob.jobId,
    );
    if (
      manifest.status !== 'COMPLETED' ||
      !manifest.probe ||
      manifest.expectedDurationSeconds < 65 ||
      manifest.expectedDurationSeconds > 90 ||
      manifest.sceneCount !== selectedItemIds.size
    ) {
      result.status = 'RENDER_FAILED';
      result.warnings = ['MP4 manifest/probe failed product acceptance'];
      return result;
    }
    result.status = 'COMPLETED';
    result.timelineSeconds = Number(
      manifest.expectedDurationSeconds.toFixed(3),
    );
    result.warnings = [...manifest.warnings];
    return result;
  }
  private async processAutomaticCollection(
    batch: AutonomousProductBatch,
    collection: ThreadCollection,
    index: number,
  ): Promise<AutonomousVideoResult> {
    const result: AutonomousVideoResult = {
      sourceUrl: collection.root.url,
      collectionId: null,
      assessmentId: null,
      sessionId: null,
      renderJobId: null,
      status: 'QUALITY_FAILED',
      selectedSourceIds: [],
      estimatedSeconds: null,
      measuredSeconds: null,
      timelineSeconds: null,
      warnings: [],
    };
    const terms = [batch.request.topic, ...batch.request.keywords],
      initial = selectConversation(
        collection,
        'SERIOUS',
        new Date().toISOString(),
        terms,
      ),
      ruleIds = initial.comments
        .filter(
          (row) =>
            row.useful && row.relationship === 'PARENT_VERIFIED',
        )
        .map((row) => row.id),
      eligible = ruleIds.length
        ? selectConversation(
            collection,
            'SERIOUS',
            new Date().toISOString(),
            terms,
            { selectedIds: ruleIds },
          )
        : initial;
    result.estimatedSeconds = {
      minimum: eligible.estimate.minimumSeconds,
      maximum: eligible.estimate.maximumSeconds,
    };
    if (!ruleIds.length || eligible.estimate.maximumSeconds < 60) {
      result.status = 'NOT_ENOUGH_CONTENT';
      result.warnings.push(...eligible.reasons);
      return result;
    }
    batch.stage = 'VALIDATING';
    await this.saveAuto(batch);
    const imported = await this.conversations.engine.importCollection(
        collection,
        `auto-${batch.id.slice(0, 8)}-${index}`,
      ),
      collectionId = imported.results[0]?.collectionId;
    if (!collectionId) throw Error('AUTONOMOUS_COLLECTION_IMPORT_FAILED');
    result.collectionId = collectionId;
    batch.stage = 'SCORING';
    await this.saveAuto(batch);
    let assessment: any;
    try {
      assessment = await this.ai.evaluator.evaluate({
        collectionId,
        collection,
        style: 'SERIOUS',
        heuristic: imported.results[0]?.evaluation,
      });
    } catch (error) {
      result.status = 'AI_FAILED';
      result.warnings.push(
        error instanceof Error ? error.message : 'AI evaluation failed',
      );
      return result;
    }
    result.assessmentId = assessment.id;
    const aiSelected = new Set<string>(assessment.selectedSourceIds || []),
      selectedIds = ruleIds.filter((id) => aiSelected.has(id));
    if (!selectedIds.length) {
      result.status = 'QUALITY_FAILED';
      result.warnings.push('AI selected no rule-eligible verified replies');
      return result;
    }
    const selected = selectConversation(
      collection,
      'SERIOUS',
      new Date().toISOString(),
      terms,
      { selectedIds },
    );
    result.selectedSourceIds = [collection.root.id, ...selectedIds];
    result.estimatedSeconds = {
      minimum: selected.estimate.minimumSeconds,
      maximum: selected.estimate.maximumSeconds,
    };
    if (
      selected.estimate.maximumSeconds < 65 ||
      selected.estimate.minimumSeconds > 90
    ) {
      result.status = 'NOT_ENOUGH_CONTENT';
      result.warnings.push(
        `Exact selected source estimate is ${selected.estimate.minimumSeconds}-${selected.estimate.maximumSeconds}s`,
      );
      return result;
    }
    batch.stage = 'NORMALIZING';
    await this.saveAuto(batch);
    const persistedReview = await this.conversations.engine.review(collectionId),
      draftReview: ConversationReview = {
        ...persistedReview,
        selectedReplyIds: selectedIds,
        selectedObservedUrls: [],
        decision: 'NEEDS_REVIEW',
        reason:
          'AUTOMATIC_VERIFIED_SOURCE_SELECTION_FOR_DRAFT_NOT_USER_APPROVAL',
      },
      draft = await this.studio.createConversationDraft(collection, draftReview);
    result.sessionId = draft.id;
    await this.registerAutomaticDraft(
      collection.root.url,
      draft,
      collectionId,
      assessment.id,
    );
    return this.continueAutomaticDraft(batch, result, index);
  }
  private async executeAuto(id: string) {
    if (this.autoRunning.has(id)) return;
    this.autoRunning.add(id);
    let job: AutonomousProductBatch | null = null;
    try {
      job = await this.getAuto(id);
      if (!this.quality) throw Error('AUTONOMOUS_DISCOVERY_UNAVAILABLE');
      job.status = 'RUNNING';
      job.startedAt ??= new Date().toISOString();
      job.stage = 'DISCOVERING';
      await this.saveAuto(job);
      const run = job.discoveryRunId
        ? await this.quality.engine.get(job.discoveryRunId)
        : await this.quality.data.studio.withControlledCollection(() =>
            this.quality!.engine.start({
              requestId: `auto-${job!.id}`,
              style: 'SERIOUS',
              topic: job!.request.topic,
              keywords: job!.request.keywords,
              maxPosts: job!.request.maxCandidates,
              maxEnrich: job!.request.maxEnrich,
              priority: 'HOT',
              minInteractions: 0,
              maxRunMs: job!.request.maxRunMs,
            }),
          );
      job.discoveryRunId = run.id;
      job.stage = 'COLLECTING';
      job.errors.push(
        ...autonomousDiscoveryErrors(run).filter(
          (error) => !job!.errors.includes(error),
        ),
      );
      await this.saveAuto(job);
      if (run.status === 'BLOCKED') {
        job.status = 'BLOCKED';
        job.errors.push(...run.errors);
        return;
      }
      for (let index = 0; index < run.collections.length; index++) {
        if (job.cancelRequested) {
          job.status = 'CANCELLED';
          return;
        }
        const collection = run.collections[index];
        const existingIndex = job.results.findIndex(
          (row) => row.sourceUrl === collection.root.url,
        );
        if (existingIndex >= 0) {
          const existing = job.results[existingIndex];
          if (
            existing.status === 'TTS_FAILED' &&
            existing.sessionId &&
            existing.assessmentId
          ) {
            try {
              job.results[existingIndex] = await this.continueAutomaticDraft(
                job,
                existing,
                index,
              );
            } catch (error) {
              existing.status = /RESOURCE/u.test(
                error instanceof Error ? error.message : '',
              )
                ? 'RESOURCE_STOPPED'
                : 'TTS_FAILED';
              existing.warnings = [
                error instanceof Error ? error.message : 'UNKNOWN',
              ];
            }
            await this.saveAuto(job);
          }
          continue;
        }
        let result: AutonomousVideoResult;
        try {
          result = await this.processAutomaticCollection(job, collection, index);
        } catch (error) {
          const message = error instanceof Error ? error.message : 'UNKNOWN';
          result = {
            sourceUrl: collection.root.url,
            collectionId: null,
            assessmentId: null,
            sessionId: null,
            renderJobId: null,
            status: /RESOURCE/.test(message)
              ? 'RESOURCE_STOPPED'
              : /ACCESS|CAPTCHA|LOGIN/.test(message)
                ? 'ACCESS_BLOCKED'
                : 'QUALITY_FAILED',
            selectedSourceIds: [],
            estimatedSeconds: null,
            measuredSeconds: null,
            timelineSeconds: null,
            warnings: [message],
          };
        }
        job.results.push(result);
        await this.saveAuto(job);
        if (
          job.results.filter((row) => row.status === 'COMPLETED').length >=
          job.request.targetVideos
        ) break;
      }
      const complete = job.results.filter((row) => row.status === 'COMPLETED').length;
      job.status =
        complete >= job.request.targetVideos
          ? 'COMPLETED'
          : complete
            ? 'PARTIAL'
            : 'FAILED';
      job.stage = 'COMPLETED';
    } catch (error) {
      if (job) {
        job.status = /ACCESS|CAPTCHA|LOGIN/.test(
          error instanceof Error ? error.message : '',
        )
          ? 'BLOCKED'
          : 'FAILED';
        job.errors.push(error instanceof Error ? error.message : 'UNKNOWN');
      }
    } finally {
      if (job) {
        job.completedAt = new Date().toISOString();
        await this.saveAuto(job);
      }
      this.autoRunning.delete(id);
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
