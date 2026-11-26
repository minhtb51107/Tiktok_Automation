import {
  BadRequestException, Body, ConflictException, Controller, ForbiddenException,
  Get, Injectable, NotFoundException, Param, Post, Query, StreamableFile,
} from '@nestjs/common';
import { createHash, timingSafeEqual } from 'crypto';
import { createReadStream, promises as fs } from 'fs';
import type { Request, Response, NextFunction } from 'express';
import { AiContentStudioService } from '../data-engine/ai.controller';
import { ContentQualityService } from '../data-engine/content-quality.controller';
import { ConversationStudioService } from '../data-engine/conversation.controller';
import { sourceQualityAdapter } from '../data-engine/conversation-extraction-v2';
import { canonicalPost } from '../data-engine/conversation-identity';
import { StudioService } from './studio.service';
import { avatarState, assertRenderable, currentNarration, PRODUCTION_CONTRACT, sourceBlockers } from './production-contract';
import { prepareTtsInput } from './speech-normalizer';
import { snapshotHash } from './render-policy';
import type { StudioJob } from './progress';
import type { StudioSession } from './studio.contracts';

const base = '/api/studio/operator';
const workerMedia = new Set<string>();
const adminVerbs = /^(GET|HEAD)$/;
const mediaPath = /^\/api\/studio\/(?:public-assets\/[\w.-]+|sessions\/[a-f0-9-]{36}\/(?:audio|source-images|media)\/[\w.-]+)$/;

export function operatorBoundary(req: Request, res: Response, next: NextFunction) {
  const enabled = process.env.STUDIO_OPERATOR_ONLY === '1';
  const route = req.path === base || req.path.startsWith(base + '/');
  if (!enabled) return route ? res.status(404).json({ code: 'OPERATOR_DISABLED' }) : next();
  if (adminVerbs.test(req.method) && workerMedia.has(req.path) && !req.url.includes('?')) return next();
  const token = process.env.STUDIO_OPERATOR_TOKEN || '';
  const supplied = req.get('authorization') || '';
  if (!route || token.length < 32 || !timingSafeEqual(
    createHash('sha256').update(supplied).digest(),
    createHash('sha256').update('Bearer ' + token).digest(),
  )) return res.status(403).json({ code: 'OPERATOR_FORBIDDEN' });
  return next();
}

const definitions = {
  search: { input: ['requestId','query'], output: 'ContentSearchRun', stage: 'DISCOVERING', budget: '120s browser budget' },
  collect: { input: ['requestId','searchId','url'], output: '{collectionId}', stage: 'COLLECTING', budget: '90s browser budget' },
  evaluate: { input: ['requestId','collectionId'], output: '{assessmentId,provider,model,usage}', stage: 'EVALUATING', budget: 'Existing inference ledger and provider timeout' },
  create_draft: { input: ['requestId','collectionId','replyIds'], output: '{sessionId,revision,selection}', stage: 'SOURCE_SELECTED', budget: 'Local store and existing avatar-cache limits' },
  normalize: { input: ['requestId','sessionId','revision'], output: 'ProjectSummary', stage: 'NORMALIZING', budget: 'Deterministic normalization' },
  pronunciation: { input: ['requestId','sessionId','revision','itemId','term','reading'], output: 'ProjectSummary', stage: 'NORMALIZING', budget: 'Local revision update' },
  audio: { input: ['requestId','sessionId','revision','itemId'], output: '{assetId,cacheHit,audioDurationMs,voiceJob,metrics}', stage: 'GENERATING_AUDIO', budget: 'Existing Kokoro deadline and resource guards' },
  prepare: { input: ['requestId','sessionId','revision'], output: 'ProjectSummary', stage: 'PREPARING_TIMELINE', budget: 'Existing timeline preparation' },
  visual_defaults: { input: ['requestId','sessionId','revision'], optional: ['gameplay: PRESET | OFF'], output: 'ProjectSummary', stage: 'CONFIGURING_EDITOR', budget: 'Existing local asset registry' },
  restore_cached_avatars: { input: ['requestId','sessionId','revision'], output: 'ProjectSummary', stage: 'RESTORING_CACHED_AVATARS', budget: 'Local hash-verified cache only' },
  render: { input: ['requestId','sessionId','revision'], output: 'MachineValidation', stage: 'RENDERING', budget: 'Existing 45 minute render watchdog, 720P, concurrency 1' },
} as const;
type Tool = keyof typeof definitions;
const uuid = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/;
const contentId = /^(?:[a-f0-9]{64}|[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12})$/;
const catalogScope = '00000000-0000-0000-0000-000000000000';
const enabled = (name: string) => process.env['STUDIO_OPERATOR_' + name] === '1';
const allowed = (name: string) => {
  if (!enabled(name)) throw new ForbiddenException('OPERATOR_AUTHORIZATION_REQUIRED:' + name);
};
const valid = (condition: unknown, code: string) => {
  if (!condition) throw new BadRequestException(code);
};

function projectSummary(s: StudioSession) {
  const order = s.items.filter(item => item.selected);
  return {
    sessionId: s.id, revision: s.revision, contract: PRODUCTION_CONTRACT,
    blockers: sourceBlockers(s),
    editor: s.editor ? {
      backgroundId: s.editor.backgroundId, backgroundMusic: s.editor.backgroundMusic,
      automaticGameplay: s.editor.automaticGameplay ?? 'PRESET',
      backgroundTracks: s.project.timeline ? s.project.backgroundTracks : s.editor.backgroundTracks,
      scenes: s.editor.scenes.map(scene => ({
        itemId: scene.itemId, enabled: scene.enabled, subtitlesEnabled: scene.visual?.subtitlesEnabled === true,
      })),
    } : null,
    items: order.map(item => ({
      id: item.id, sourceId: item.sourceId ?? item.sourceReference.entityId,
      url: item.sourceUrl, author: item.author.handle, avatar: avatarState(item),
      originalText: item.originalText, displayText: item.displayText,
      ttsInputText: prepareTtsInput(item.spokenText, item.pronunciationOverrides).spokenText,
      normalization: item.automaticNormalization || null,
      overrides: item.pronunciationOverrides || {},
      audioId: currentNarration(s, item)?.id ?? null,
    })),
    timeline: s.project.timeline ? {
      frames: s.project.timeline.totalFrames, fps: s.project.timeline.fps,
      scenes: s.project.timeline.scenes.map(row => ({
        id: row.scene.id, startFrame: row.startFrame, endFrame: row.endFrame,
      })),
    } : null,
  };
}

export function operatorFailure(error: string | null, stage: string, attempts: number) {
  if (!error) return null;
  // Public messages are fixed text. Runtime errors can include local paths,
  // provider bodies or credentials and are never echoed at this boundary.
  const rules = [
    [/GAMEPLAY_ASSET_UNAVAILABLE/i, 'GAMEPLAY_ASSET_UNAVAILABLE', 'No configured gameplay asset passed the local video probe.', 'Ask the operator host to configure a verified gameplay asset ID, or use visual_defaults with gameplay OFF when explicitly requested.', false],
    [/USER_CANCELLED/i, 'USER_CANCELLED', 'The operator cancelled this render.', 'Check the retained render checkpoint before starting a new attempt.', false],
    [/RENDER_STALLED/i, 'RENDER_STALLED', 'The worker produced no new frame for two minutes during frame rendering.', 'Check resource samples and the last worker checkpoint.', true],
    [/RENDER_TIMEOUT/i, 'RENDER_TIMEOUT', 'Rendering exceeded its execution budget.', 'Check measured frame throughput and resource samples before retrying.', true],
    [/RENDER_WORKER_CRASH/i, 'RENDER_WORKER_CRASH', 'The render worker exited without a completed artifact.', 'Check the last worker checkpoint and resource samples before retrying.', true],
    [/RENDER_FAILED/i, 'RENDER_FAILED', 'The render worker reported a render or output validation failure.', 'Inspect the render checkpoint before retrying.', false],
    [/backend restarted/i, 'INTERRUPTED', 'The backend restarted before this stage finished.', 'Reopen the project and inspect retained artifacts before a retry.', true],
    [/unknown Kokoro voice|voice.unavailable|locally available Kokoro voice/i, 'VOICE_UNAVAILABLE', 'The requested Kokoro voice is unavailable or was not declared by the runtime.', 'Ask the runtime administrator to verify the configured voicepack, then retry audio.', true],
    [/RESOURCE_GUARD_STOP|BLOCKED_RESOURCE|RESOURCE_BLOCKED|ALLOCATION_FAILURE|WINDOWS_OOM_EVIDENCE/i, 'RESOURCE_BLOCKED', 'A resource guard or allocator stopped execution.', 'Wait for safe headroom and other heavy workers to exit before retrying.', true],
    [/timeout|timed out|deadline exceeded/i, 'TIMEOUT', 'This stage exceeded its execution deadline.', 'Check the job checkpoint and worker state before retrying.', true],
    [/BLOCKED_RUNTIME|runtime unavailable|preflight unavailable/i, 'RUNTIME_UNAVAILABLE', 'A required local runtime dependency did not pass preflight.', 'Ask the runtime administrator to check Python, Kokoro assets, FFmpeg and FFprobe.', true],
    [/STALE_REVISION|session changed/i, 'STALE_REVISION', 'The project revision has changed.', 'Read GET /projects/:id and submit the stage with its current revision.', false],
    [/NORMALIZATION_REQUIRED/i, 'NORMALIZATION_REQUIRED', 'Current narration normalization is missing or stale.', 'Run normalize on the current project revision, then call audio.', false],
    [/CURRENT_(?:WAV_MISSING|MEASURED_AUDIO_REQUIRED)/i, 'CURRENT_AUDIO_REQUIRED', 'A current measured WAV is missing.', 'Inspect the project and call audio for the affected scene before prepare.', false],
    [/TTS_FAILED|inference|\bUNKNOWN\b/i, 'INFERENCE_FAILED', 'The inference stage did not produce a valid result.', 'Inspect the stage result and verify the local runtime or provider before retrying.', false],
    [/operation failed.*(?:required|invalid|mismatch|forbidden|eligible)|PREPARED_TIMELINE|SUBTITLES_FORBIDDEN/i, 'VALIDATION_ERROR', 'The input or project failed a stage precondition.', 'Read the project blockers or preflight and correct them before submitting again.', false],
  ] as const;
  const rule = rules.find(([pattern]) => pattern.test(error));
  return {
    errorCode: rule?.[1] ?? 'STAGE_FAILED',
    errorMessage: rule?.[2] ?? 'The stage failed without a recognized diagnostic.',
    failedStage: stage,
    retryable: rule?.[4] === true && attempts < 2,
    recommendedRecovery: rule?.[3] ?? 'Inspect the current project and checkpoint, then ask the runtime administrator for diagnosis.',
  };
}

function report(j: StudioJob) {
  const diff = (a: string | null, b: string | null) =>
    a && b ? Math.max(0, Date.parse(b) - Date.parse(a)) : null;
  const stage = definitions[j.operation.slice(9) as Tool].stage;
  const failure = operatorFailure(j.error, stage, j.attemptNumber || 1);
  return {
    contract: PRODUCTION_CONTRACT, jobId: j.jobId, attemptId: j.jobId,
    sessionId: j.sessionId === catalogScope ? null : j.sessionId,
    stage,
    status: j.suspectedInterruption && /^Backend restarted/.test(j.error || '') ? 'INTERRUPTED'
      : j.result && (j.result as any).validation === 'MACHINE_VALIDATED' && j.status === 'SUCCEEDED' ? 'DRAFT_READY'
      : j.status,
    queuedAt: j.queuedAt, startedAt: j.startedAt, finishedAt: j.completedAt,
    queueWaitMs: diff(j.queuedAt, j.startedAt), observedExecutionMs: j.startedAt ? j.elapsedMs : null,
    wallClockMs: diff(j.queuedAt, j.completedAt || new Date().toISOString()),
    revision: j.revision ?? j.inputRevision ?? null, checkpoint: j.currentStep, retryCount: (j.attemptNumber || 1) - 1,
    timeoutPolicy: definitions[j.operation.slice(9) as Tool].budget,
    errorCode: null, errorMessage: null, failedStage: null, retryable: false,
    recommendedRecovery: null, ...failure,
    heartbeatAt: j.heartbeatAt ?? null, maxHeartbeatGapMs: j.maxHeartbeatGapMs ?? null,
    suspectedInterruption: j.suspectedInterruption ?? false,
    events: j.events, result: j.result ?? null,
    renderProgress: j.renderProgress ?? null,
  };
}

@Injectable()
export class ProductionHarness {
  constructor(
    private studio: StudioService,
    private quality: ContentQualityService,
    private conversations: ConversationStudioService,
    private ai: AiContentStudioService,
  ) {}

  async job(id: string) {
    valid(uuid.test(id), 'INVALID_JOB_ID');
    const j = await this.studio.jobs.load(id).catch(() => null);
    if (!j?.operation.startsWith('operator:') ||
        !Object.prototype.hasOwnProperty.call(definitions, j.operation.slice(9)))
      throw new NotFoundException('OPERATOR_JOB_NOT_FOUND');
    return j;
  }

  async run(toolName: string, b: any) {
    if (!Object.prototype.hasOwnProperty.call(definitions, toolName))
      throw new ForbiddenException('OPERATOR_CAPABILITY_DENIED');
    const tool = toolName as Tool;
    const keys: readonly string[] = definitions[tool].input;
    valid(b && typeof b === 'object' && !Array.isArray(b) &&
      Object.keys(b).every(k => keys.includes(k) ||
        (tool === 'visual_defaults' && k === 'gameplay' && ['PRESET','OFF'].includes(b[k]))) &&
      keys.every(k => Object.prototype.hasOwnProperty.call(b,k)),
      'INVALID_TOOL_INPUT');
    valid(typeof b.requestId === 'string' && /^[\w-]{1,64}$/.test(b.requestId), 'INVALID_REQUEST_ID');
    if (keys.includes('sessionId'))
      valid(typeof b.sessionId === 'string' && uuid.test(b.sessionId) && Number.isSafeInteger(b.revision) && b.revision >= 0, 'INVALID_SESSION_REVISION');
    for (const key of ['collectionId','searchId'])
      if (keys.includes(key)) valid(typeof b[key] === 'string' && contentId.test(b[key]), 'INVALID_CONTENT_ID');
    if (keys.includes('itemId')) valid(typeof b.itemId === 'string' && uuid.test(b.itemId), 'INVALID_ITEM_ID');
    if (tool === 'search') valid(typeof b.query === 'string' && b.query.trim() && b.query.length <= 120, 'INVALID_QUERY');
    if (tool === 'collect') valid(typeof b.url === 'string' && b.url.length <= 512 && canonicalPost(b.url), 'INVALID_THREADS_URL');
    if (tool === 'create_draft') valid(Array.isArray(b.replyIds) && b.replyIds.length <= 12 &&
      new Set(b.replyIds).size === b.replyIds.length && b.replyIds.every(id => typeof id === 'string' && /^[\w-]{1,100}$/.test(id)), 'INVALID_REPLY_IDS');
    if (tool === 'pronunciation') valid(typeof b.term === 'string' && typeof b.reading === 'string' &&
      /^[\p{L}\p{N}.]{1,24}$/u.test(b.term) && /^[\p{L} -]{1,32}$/u.test(b.reading) &&
      b.reading.trim().split(/ +/).length <= 5, 'INVALID_PRONUNCIATION');
    if (['search','collect'].includes(tool)) allowed('COLLECTION');
    if (tool === 'evaluate') allowed('AI');
    if (tool === 'audio') allowed('TTS');
    if (tool === 'render') allowed('RENDER');

    const input = Object.fromEntries(keys.map(key => [key, b[key]]));
    if (tool === 'visual_defaults' && b.gameplay !== undefined) input.gameplay = b.gameplay;
    if (tool === 'search') input.query = b.query.trim();
    if (tool === 'collect') input.url = canonicalPost(b.url)!.url;
    const job = await this.studio.jobs.submit(b.sessionId || catalogScope, 'operator:' + tool, input, async (tick, id) => {
      await tick(definitions[tool].stage);
      if (tool === 'search') {
        const run = await this.quality.search({ query: input.query, requestId: id, limit: 10, maxRunMs: 120000, liveApproved: true });
        return { result: run, error: run.status === 'COMPLETED' ? undefined : 'DISCOVERY_FAILED' };
      }
      if (tool === 'collect') {
        const result = await this.quality.collect(b.searchId, { url: canonicalPost(b.url)!.url, requestId: id, liveApproved: true,
          collectionBudget: { maxActions: 4, maxCards: 40, maxDurationMs: 90000 } });
        return { result: { collectionId: result.collectionId, searchId: b.searchId } };
      }
      if (tool === 'evaluate') {
        const result = await this.ai.evaluate(b.collectionId, { style: 'SERIOUS', confirmLive: true });
        return { result: { collectionId: b.collectionId, assessmentId: result.id, provider: result.provider } };
      }
      if (tool === 'create_draft') {
        const { collection, evaluation } = await this.conversations.engine.collection(b.collectionId);
        valid(!collection.root.provenance.synthetic && canonicalPost(collection.root.url) &&
          collection.root.originalText.trim() && collection.root.author.handle, 'SAVED_ROOT_NOT_ELIGIBLE');
        const selection = this.selection(collection, evaluation);
        valid(b.replyIds.every(replyId => selection.some(row => row.id === replyId && row.eligible)), 'REPLY_NOT_QUALITY_ELIGIBLE');
        const review = await this.conversations.engine.review(b.collectionId);
        const s = await this.studio.createConversationDraft(collection, {
          ...review, decision: 'NEEDS_REVIEW', selectedReplyIds: b.replyIds, selectedObservedUrls: [],
        }, id, true);
        return { revision: s.revision, result: { sessionId: s.id, collectionId: b.collectionId, revision: s.revision, selection: [
          { id: collection.root.id, reason: 'Exact collection root' },
          ...selection.filter(row => b.replyIds.includes(row.id)),
        ] } };
      }
      const s = await this.studio.load(b.sessionId);
      if (s.revision !== b.revision) throw new ConflictException('STALE_REVISION');
      if (tool === 'restore_cached_avatars') {
        const next = await this.studio.restoreOperatorAvatars(s.id, s.revision);
        return {revision:next.revision, result:projectSummary(next)};
      }
      const blockers = sourceBlockers(s);
      valid(!blockers.length, blockers.join('; '));
      const item = s.items.find(i => i.selected && i.id === b.itemId);
      if (tool === 'normalize') {
        const next = await this.studio.normalizeAutomaticDraft(s.id, s.revision);
        return { revision: next.revision, result: projectSummary(next) };
      }
      if (tool === 'visual_defaults') {
        const next = await this.studio.applyAutomaticSeriousAssets(s.id, s.revision, b.gameplay);
        return { revision: next.revision, result: projectSummary(next) };
      }
      if (tool === 'pronunciation') {
        const tokens: string[] = item?.spokenText.toLowerCase().match(/[\p{L}\p{N}]+(?:\.[\p{L}\p{N}]+)*/gu) || [];
        valid(item && tokens.includes(b.term.toLowerCase()), 'PRONUNCIATION_TERM_NOT_PRESENT');
        const next = await this.studio.mutate(s.id, {
          revision: s.revision, title: s.title, items: [...s.items].sort((a,c) => a.order-c.order).map(i => ({
            id: i.id, selected: i.selected, displayText: i.displayText, spokenText: i.spokenText,
            ...(i.id === b.itemId ? { pronunciationOverrides: { ...i.pronunciationOverrides, [b.term]: b.reading } } : {}),
          })),
        });
        return { revision: next.revision, result: projectSummary(next) };
      }
      if (tool === 'audio') {
        valid(item && item.automaticNormalization?.ttsInputHash &&
          item.automaticNormalization.ttsInputHash === prepareTtsInput(item.spokenText, item.pronunciationOverrides).ttsInputHash, 'NORMALIZATION_REQUIRED');
        const cached = currentNarration(s, item!);
        if (cached && await this.measuredWav(s.id, cached.id).then(() => true, () => false))
          return { revision: s.revision, result: { assetId: cached.id, cacheHit: true, audioDurationMs: cached.durationMs } };
        const next = await this.studio.voiceAction(s.id, b.itemId, {
          revision: s.revision, action: 'GENERATE', draft: true,
          voice: item?.voiceSettings?.voice || 'my_yen', speed: item?.voiceSettings?.speed ?? 1.2,
        });
        const voiceJob = next.voiceJobs?.slice(-1)[0], asset = currentNarration(next, next.items.find(i => i.id === b.itemId)!);
        const failure = voiceJob?.failureCategory;
        const voiceError = failure && failure !== 'UNKNOWN' ? failure : voiceJob?.error || 'TTS_FAILED';
        return { revision: next.revision, error: asset ? undefined : voiceError,
          result: { assetId: asset?.id, audioDurationMs: asset?.durationMs, cacheHit: asset?.cacheHit ?? null,
            voiceJob: voiceJob ? { elapsedMs: voiceJob.elapsedMs, status: voiceJob.status } : null, metrics: asset?.synthesisMetrics ?? null } };
      }
      if (tool === 'prepare') {
        for (const i of s.items.filter(i => i.selected)) {
          const asset = currentNarration(s, i);
          valid(asset, 'CURRENT_MEASURED_AUDIO_REQUIRED:' + i.id);
          await this.measuredWav(s.id, asset!.id);
        }
        await this.studio.preparePreview(s.id, s.revision, true);
        const next = await this.studio.load(s.id);
        return { revision: next.revision, result: projectSummary(next) };
      }
      valid(s.project.timeline, 'PREPARED_TIMELINE_REQUIRED');
      try {
        const result = await this.studio.runOperatorDraft(s.id, s.revision, id, tick, id, async (current, props) => {
          assertRenderable(current, props);
          valid(snapshotHash(current.project.timeline) === snapshotHash(props.timeline), 'PREPARED_TIMELINE_STALE');
          for (const i of current.items.filter(i => i.selected))
            await this.measuredWav(current.id, currentNarration(current, i)!.id);
          const urls = [...props.audioAssets, ...props.mediaAssets].map(a => a.uri);
          for (const row of props.timeline.scenes)
            if (row.scene.threadsCard?.avatarUrl?.startsWith('/')) urls.push(row.scene.threadsCard.avatarUrl);
          valid(urls.every(uri => mediaPath.test(uri)), 'UNAPPROVED_RENDER_MEDIA');
          urls.forEach(uri => workerMedia.add(uri));
        });
        await tick('QUALITY_CHECK');
        return { ...result, result: await this.validateOutput(s.id, id) };
      } finally {
        workerMedia.clear();
      }
    });
    return report(await this.job(job.jobId));
  }

  private selection(collection: Parameters<typeof sourceQualityAdapter>[0],
    evaluation: Awaited<ReturnType<ConversationStudioService['engine']['collection']>>['evaluation']) {
    const normalized = sourceQualityAdapter(collection);
    return normalized.groups.PARENT_VERIFIED.map(row => {
      const reply = collection.replies.find(reply => reply.id === row.id);
      const label = evaluation.replyQuality.find(quality => quality.replyId === row.id)?.label;
      const rejectionReasons: string[] = [];
      if (!reply || reply.provenance.synthetic || collection.root.provenance.synthetic ||
          reply.rootId !== collection.root.id || reply.extractionStatus !== 'VERIFIED' ||
          canonicalPost(reply.evidence?.subjectUrl)?.id !== row.id || !reply.evidence?.documentHash ||
          row.membership === 'RECOMMENDED_POST')
        rejectionReasons.push('RELATIONSHIP_OR_PROVENANCE_INVALID');
      if (!row.displayText?.trim() || !reply?.author.handle) rejectionReasons.push('SOURCE_INCOMPLETE');
      if (label === 'SPAM' || label === 'DUPLICATE') rejectionReasons.push(label);
      const eligible = rejectionReasons.length === 0;
      const recommended = eligible && normalized.automation.selectedVerifiedReplyIds.includes(row.id);
      if (!recommended) rejectionReasons.push(...(row.quality?.reasons || ['NOT_RULE_RECOMMENDED']));
      return {id:row.id, eligible, recommended, rejectionReasons,
        reason: recommended ? 'Verified and rule-recommended' : rejectionReasons.join('; ')};
    });
  }

  async collection(id: string) {
    valid(contentId.test(id), 'INVALID_CONTENT_ID');
    const { collection, evaluation } = await this.conversations.engine.collection(id);
    const saved = (await this.ai.evaluator.list()).find(row => row.collectionId === id && row.style === 'SERIOUS');
    const selection = this.selection(collection, evaluation).map(row => ({...row,
      assessment: saved?.candidates.find(candidate => candidate.sourceId === row.id) ?? null}));
    return { root: collection.root, replies: collection.replies, evaluation, selection,
      eligible: selection.filter(row => row.eligible), assessmentId: saved?.id ?? null };
  }

  async collections() {
    const rows: Array<{ id: string; url: string; author: string; verifiedReplies: number }> = [];
    for await (const record of this.quality.data.engine.store.rows<Awaited<ReturnType<ConversationStudioService['engine']['collection']>>>('thread-collections')) {
      if (record.collection.root.provenance.synthetic) continue;
      rows.push({ id: record.id, url: record.collection.root.url, author: record.collection.root.author.handle,
        verifiedReplies: record.collection.replies.length });
      if (rows.length >= 50) break;
    }
    return rows;
  }

  async assessment(id: string) {
    valid(contentId.test(id), 'INVALID_CONTENT_ID');
    return this.ai.evaluator.get(id);
  }

  async project(id: string) {
    valid(uuid.test(id), 'INVALID_SESSION_ID');
    return projectSummary(await this.studio.load(id));
  }

  async projects() {
    return (await this.studio.list()).slice(0, 50);
  }

  async reports(sessionId?: string) {
    valid(sessionId === undefined || uuid.test(sessionId), 'INVALID_SESSION_ID');
    return (await this.studio.jobs.list(sessionId || catalogScope))
      .filter(job => Object.prototype.hasOwnProperty.call(definitions, job.operation.startsWith('operator:') && job.operation.slice(9)))
      .map(report);
  }

  async productionReport(id: string) {
    valid(uuid.test(id), 'INVALID_SESSION_ID');
    const session = await this.studio.load(id);
    const catalog = await this.reports();
    const resultRef = (result: unknown) => result as { id?: string; sessionId?: string; collectionId?: string; searchId?: string } | null;
    const draft = catalog.filter(job => resultRef(job.result)?.sessionId === id);
    const collectionId = session.draftProvenance?.collectionId || resultRef(draft[0]?.result)?.collectionId;
    const related = collectionId ? catalog.filter(job => resultRef(job.result)?.collectionId === collectionId) : [];
    const searchIds = new Set(related.map(job => resultRef(job.result)?.searchId).filter(Boolean));
    const jobs = [...new Map([...await this.reports(id), ...draft, ...related,
      ...catalog.filter(job => searchIds.has(resultRef(job.result)?.id))]
      .map(job => [job.jobId, job])).values()]
      .sort((a, b) => a.queuedAt.localeCompare(b.queuedAt));
    const renderStrategies = await Promise.all(jobs.filter(job => job.stage === 'RENDERING')
      .map(async job => {
        const manifest = await this.studio.renders.load(id, job.jobId).catch(() => null);
        return {
          jobId: job.jobId,
          strategy: manifest?.metrics.executionStrategy ?? null,
          reason: manifest?.metrics.executionStrategyReason ?? null,
        };
      }));
    const latest = jobs[jobs.length - 1];
    const recordedEnd = latest?.finishedAt || new Date().toISOString();
    return {
      sessionId: id, contract: PRODUCTION_CONTRACT, jobs, renderStrategies,
      projectWallClockMs: jobs.length ? Date.parse(recordedEnd) - Date.parse(jobs[0].queuedAt) : null,
      observedExecutionMs: jobs.reduce((sum, job) => sum + (job.observedExecutionMs ?? 0), 0),
      queueWaitMs: jobs.reduce((sum, job) => sum + (job.queueWaitMs ?? 0), 0),
      retryExecutionMs: jobs.filter(job => job.retryCount > 0)
        .reduce((sum, job) => sum + (job.observedExecutionMs ?? 0), 0),
      measurementScope: 'PROJECT_AND_LINKED_RECENT_CATALOG_CHECKPOINTS',
    };
  }

  async preflight(id: string) {
    valid(uuid.test(id), 'INVALID_SESSION_ID');
    const s = await this.studio.load(id);
    try {
      valid(s.project.timeline, 'PREPARED_TIMELINE_REQUIRED');
      const props = (await this.studio.preview(id)).request.inputProps;
      assertRenderable(s, props);
      valid(snapshotHash(s.project.timeline) === snapshotHash(props.timeline), 'PREPARED_TIMELINE_STALE');
      for (const item of s.items.filter(i => i.selected))
        await this.measuredWav(id, currentNarration(s, item)!.id);
      return { sessionId: id, revision: s.revision, contract: PRODUCTION_CONTRACT,
        ready: enabled('RENDER'), blockers: enabled('RENDER') ? [] : ['OPERATOR_AUTHORIZATION_REQUIRED:RENDER'] };
    } catch (error) {
      return { sessionId: id, revision: s.revision, contract: PRODUCTION_CONTRACT,
        ready: false, blockers: error instanceof BadRequestException ? error.message.split('; ') : ['PREVIEW_OR_MEDIA_UNAVAILABLE'] };
    }
  }

  async validateOutput(sessionId: string, jobId: string) {
    const m = await this.studio.renders.load(sessionId, jobId);
    const file = await this.studio.renders.output(sessionId, jobId);
    const probe = m.probe as { streams?: Array<{ codec_type: string; codec_name: string;
      width?: number; height?: number; avg_frame_rate?: string; nb_read_frames?: string }>;
      format?: { duration?: string } };
    const durationSeconds = Number(probe?.format?.duration);
    const video = probe?.streams?.find(s => s.codec_type === 'video');
    const [fpsNumerator, fpsDenominator] = (video?.avg_frame_rate || '').split('/').map(Number);
    valid(m.mode === 'DRAFT' && m.width === 720 && m.height === 1280 &&
      Number.isFinite(durationSeconds) && durationSeconds > 0 &&
      video?.codec_name === 'h264' && video.width === 720 && video.height === 1280 &&
      fpsNumerator / fpsDenominator === m.fps && Number(video.nb_read_frames) === m.totalFrames &&
      probe?.streams?.some(s => s.codec_type === 'audio' && s.codec_name === 'aac'), 'RENDER_PROBE_INVALID');
    const hash = createHash('sha256');
    for await (const chunk of createReadStream(file)) hash.update(chunk);
    return { validation: 'MACHINE_VALIDATED', humanAcceptance: 'PENDING', sha256: hash.digest('hex'),
      durationSeconds, fps: m.fps, frames: m.totalFrames, width: m.width, height: m.height,
      metrics: m.metrics, artifact: base + '/jobs/' + jobId + '/video' };
  }

  async video(id: string) {
    const j = await this.job(id);
    if (j.operation !== 'operator:render' || j.status !== 'SUCCEEDED' || !j.result)
      throw new NotFoundException('OPERATOR_VIDEO_NOT_READY');
    const current = await this.validateOutput(j.sessionId, id);
    if (current.sha256 !== (j.result as any).sha256) throw new ConflictException('ARTIFACT_HASH_CHANGED');
    return new StreamableFile(createReadStream(await this.studio.renders.output(j.sessionId,id)), {
      type: 'video/mp4', disposition: 'attachment; filename="draft.mp4"',
    });
  }

  async audio(id: string, assetId: string) {
    valid(uuid.test(id) && uuid.test(assetId), 'INVALID_AUDIO_ID');
    const s = await this.studio.load(id);
    valid(s.items.some(i => i.selected && currentNarration(s, i)?.id === assetId), 'CURRENT_MEASURED_AUDIO_REQUIRED');
    return new StreamableFile(createReadStream(await this.measuredWav(id,assetId)), { type:'audio/wav' });
  }

  private async measuredWav(sessionId: string, assetId: string) {
    const file = await this.studio.audioFile(sessionId, assetId);
    const stat = await fs.stat(file).catch(() => null);
    valid(stat?.isFile() && stat.size > 44, 'CURRENT_WAV_MISSING:' + assetId);
    return file;
  }

  async cancel(id: string) {
    await this.job(id);
    return report(await this.studio.jobs.cancel(id));
  }
}

@Controller(base.slice(1))
export class ProductionHarnessController {
  constructor(private harness: ProductionHarness) {}
  @Get('tools') tools() {
    return { role: 'OPERATOR', contract: PRODUCTION_CONTRACT, mutations: definitions,
      authorization: { collection: enabled('COLLECTION'), ai: enabled('AI'), tts: enabled('TTS'), render: enabled('RENDER') },
      reads: ['collections', 'collections/:id', 'assessments/:id', 'projects', 'projects/:id', 'projects/:id/preflight', 'projects/:id/report', 'projects/:id/audio/:asset', 'jobs?sessionId=', 'jobs/:id', 'jobs/:id/video'],
      retry: 'Read the checkpoint first. Same request returns the same job. At most one explicit retry for identical stage inputs.' };
  }
  @Post('call/:tool') call(@Param('tool') tool: string, @Body() body: unknown) { return this.harness.run(tool,body); }
  @Get('jobs') reports(@Query('sessionId') id?: string) { return this.harness.reports(id); }
  @Get('jobs/:id') async status(@Param('id') id: string) { return report(await this.harness.job(id)); }
  @Post('jobs/:id/cancel') cancel(@Param('id') id: string) { return this.harness.cancel(id); }
  @Get('jobs/:id/video') video(@Param('id') id: string) { return this.harness.video(id); }
  @Get('collections/:id') collection(@Param('id') id: string) { return this.harness.collection(id); }
  @Get('collections') collections() { return this.harness.collections(); }
  @Get('assessments/:id') assessment(@Param('id') id: string) { return this.harness.assessment(id); }
  @Get('projects') projects() { return this.harness.projects(); }
  @Get('projects/:id/preflight') preflight(@Param('id') id: string) { return this.harness.preflight(id); }
  @Get('projects/:id/report') productionReport(@Param('id') id: string) { return this.harness.productionReport(id); }
  @Get('projects/:id') project(@Param('id') id: string) { return this.harness.project(id); }
  @Get('projects/:id/audio/:asset') audio(@Param('id') id: string, @Param('asset') asset: string) { return this.harness.audio(id,asset); }
}
