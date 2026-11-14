import { BadRequestException, Injectable } from '@nestjs/common';
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
}

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

export function productStageSnapshot(
  session: StudioSession,
  sourceJobStatus: string | null,
  renders: RenderManifest[],
  state: { assessmentId?: string | null; reviewApplied?: boolean; scriptMaterialized?: boolean } = {},
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
      !!state.scriptMaterialized &&
      !!session.project.editorialPlan &&
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
  const nextStage = stages.find((stage) => result[stage].status !== 'COMPLETED') ?? null;
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
  constructor(
    readonly studio: StudioService,
    readonly conversations: ConversationStudioService,
    readonly ai: AiContentStudioService,
    readonly editorial: EditorialStudioService,
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
  async list() {
    const result: ProductPipelineJob[] = [];
    for (const name of await fs.readdir(this.root).catch(() => []))
      if (/^[a-f0-9-]{36}\.json$/.test(name))
        result.push(await this.get(name.slice(0, -5)));
    return result.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }
}
