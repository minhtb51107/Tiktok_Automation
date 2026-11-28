import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  OnModuleDestroy,
  OnModuleInit,
  StreamableFile,
} from '@nestjs/common';
import { createReadStream, promises as fs } from 'fs';
import { randomUUID } from 'crypto';
import { freemem } from 'os';
import { AutomationStore, automationKey } from './automation.store';
import {
  AutomationReviewService,
  automationRequestId,
  sourceId,
} from './automation-review.service';
import {
  defaultAutomationPolicy,
  type AutomationPolicy,
  type ProductionDay,
  type ProductionReservation,
  type ProducedVideo,
  type ReviewRequest,
} from './automation.types';
import {
  ProductPipelineService,
  activeTtsRecovery,
  autonomousProductRequest,
  seriousDraftDurationStatus,
  type AutonomousProductBatch,
  type AutonomousVideoResult,
} from './product-pipeline';
import { StudioService } from './studio.service';
import { canonicalPost } from '../data-engine/conversation-identity';
import { validateDraftArtifact } from './production-artifact';
import { isOperatorRenderPreset } from './render.types';
import { assertRenderable } from './production-contract';
import { probeNativeBrowserMonitor } from '../data-engine/browser-resource-guard';
import { isBrowserInfrastructureFailure } from '../data-engine/browser-resource-policy';
import type { AutomationInfrastructureRecovery } from './automation.types';

const localTime = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Ho_Chi_Minh',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});
const active = (r: ProductionReservation) =>
  r.status === 'RESERVED' || r.status === 'RUNNING';
const terminal = (b: AutonomousProductBatch) =>
  !['QUEUED', 'RUNNING'].includes(b.status);
const DISCOVERY_BATCH_LIMIT = 6;
const DISCOVERY_RECOVERY_DELAY_MS = 60000;
const freshDiscovery = (row: ProductionReservation) => row.dispatch && !row.dispatch.recovery;

function discoveryKeywords(topic: string) {
  const variants = [topic.replace(/^kinh nghiệm\s+/iu,''), 'chia sẻ '+topic, topic+' thực tế'];
  return [...new Set([topic,...variants.filter(query=>query.length<=120)])].slice(0,3);
}

function nextDiscovery(topics: string[], reservations: ProductionReservation[], now: Date) {
  const fresh = reservations.filter(freshDiscovery);
  if (fresh.length >= DISCOVERY_BATCH_LIMIT) return {blocker:'DISCOVERY_EXHAUSTED'} as const;
  let failed = false, coolingDown = false;
  for (let offset=0; offset<topics.length; offset++) {
    const topic=topics[(fresh.length+offset)%topics.length];
    const history=fresh.filter(row=>row.dispatch.topic===topic);
    const last=history[history.length-1];
    const keyword=last?.dispatch?.discoveryKeyword??topic;
    if(last?.infrastructureFailure) return {topic,keyword}; // The existing native probe owns this retry.
    if(last?.discoveryOutcome==='FAILED'){
      if(history[history.length-2]?.discoveryOutcome==='FAILED'){
        failed=true;
        continue;
      }
      if(Date.parse(last.finishedAt??'')+DISCOVERY_RECOVERY_DELAY_MS>now.getTime()){
        coolingDown=true;
        continue;
      }
      return {topic,keyword};
    }
    const empty=new Set(history.filter(row=>row.discoveryOutcome==='EMPTY').map(row=>row.dispatch.discoveryKeyword??topic));
    const next=last?.discoveryOutcome==='RESULTS'?keyword:discoveryKeywords(topic).find(query=>!empty.has(query));
    if(next) return {topic,keyword:next};
  }
  return {blocker:coolingDown?'DISCOVERY_RECOVERY_COOLDOWN':failed?'DISCOVERY_FAILED':'DISCOVERY_EXHAUSTED'} as const;
}

const clock = /^(?:[01]\d|2[0-3]):[0-5]\d$/;

export function productionWindow(
  now: Date,
  schedule: AutomationPolicy['schedule'],
) {
  const p = Object.fromEntries(
    localTime.formatToParts(now).map((part) => [part.type, part.value]),
  );
  const today = p.year + '-' + p.month + '-' + p.day,
    time = p.hour + ':' + p.minute;
  if (!schedule.enabled) return { dayKey: today, open: true };
  if (schedule.start === schedule.end)
    throw Error('INVALID_AUTOMATION_SCHEDULE');
  if (schedule.start < schedule.end)
    return {
      dayKey: today,
      open: time >= schedule.start && time < schedule.end,
    };
  return {
    dayKey:
      time < schedule.end
        ? new Date(Date.UTC(+p.year, +p.month - 1, +p.day - 1))
            .toISOString()
            .slice(0, 10)
        : today,
    open: time >= schedule.start || time < schedule.end,
  };
}

function batchPilotWindow(now: Date, schedule: AutomationPolicy['schedule']) {
  const window = productionWindow(now, schedule);
  const localClock = Object.fromEntries(localTime.formatToParts(now).map(part=>[part.type,part.value]));
  const nextDay = schedule.enabled && schedule.start<schedule.end && localClock.hour+':'+localClock.minute>=schedule.end;
  const dayKey = nextDay ? productionWindow(new Date(now.getTime()+86400000),schedule).dayKey : window.dayKey;
  const end = schedule.enabled ? schedule.end : '00:00';
  const overnight = !schedule.enabled || schedule.start>schedule.end;
  return {dayKey,endsAt:new Date(Date.parse(dayKey+'T'+end+':00+07:00')+(overnight?86400000:0)).toISOString()};
}

export function validateAutomationPolicy(value: AutomationPolicy) {
  const ranges: Record<string, number> = {
    dailyVideoLimit: 10,
    dailyAttemptLimit: 100,
    dailyRerenderLimit: 100,
    dailyAiRequestLimit: 1000,
    maxPendingVideos: 100,
    maxPendingReviews: 100,
  };
  if (
    value?.schemaVersion !== 'automation-policy/1' ||
    !Number.isSafeInteger(value.revision) ||
    value.revision < 0 ||
    !['DISABLED', 'ENABLED', 'DRAINING', 'BLOCKED'].includes(value.mode) ||
    value.timezone !== 'Asia/Ho_Chi_Minh' ||
    typeof value.schedule?.enabled !== 'boolean' ||
    !clock.test(value.schedule.start) ||
    !clock.test(value.schedule.end) ||
    value.schedule.start === value.schedule.end ||
    !Array.isArray(value.topics) ||
    value.topics.length > 30 ||
    value.topics.some(
      (t) => typeof t !== 'string' || !t.trim() || t.length > 120,
    ) ||
    new Set(value.topics).size !== value.topics.length ||
    Object.entries(ranges).some(
      ([k, max]) =>
        !Number.isSafeInteger(value[k]) ||
        value[k] < (k === 'dailyRerenderLimit' ? 0 : 1) ||
        value[k] > max,
    ) ||
    !isOperatorRenderPreset(value.renderPreset) ||
    !['EXCEPTION_ONLY', 'REVIEW_BEFORE_RENDER'].includes(
      value.approvalPolicy,
    ) ||
    value.maxConcurrentHeavyWorkers !== 1 ||
    value.autoPublish !== false ||
    (value.pilotWindow!==undefined && (!/^\d{4}-\d{2}-\d{2}$/.test(value.pilotWindow?.dayKey) ||
      !Number.isFinite(Date.parse(value.pilotWindow?.endsAt))))
  )
    throw new BadRequestException('INVALID_AUTOMATION_POLICY');
  return value;
}

export function productionUsage(day: ProductionDay) {
  const rows = day.reservations;
  const candidates = rows.filter((r) => !r.dispatch),
    batches = rows.filter((r) => r.dispatch);
  return {
    newVideos: candidates.filter(
      (r) => r.kind === 'NEW_VIDEO' && r.status === 'COMPLETED',
    ).length,
    waiting: candidates.filter(
      (r) => r.kind === 'NEW_VIDEO' && r.status === 'WAITING_HUMAN',
    ).length,
    attempts:
      candidates.filter((row) => !row.cachedRecovery).length +
      batches.reduce((n,r)=>{
        if(active(r)||r.dispatch?.recovery?.cacheOnly) return n;
        const evaluated=candidates.filter(c=>c.batchId===r.batchId&&c.kind==='NEW_VIDEO'&&!c.cachedRecovery).length;
        const acquisitions=r.acquisitionAttempts??0;
        // Old ledgers lack acquisition evidence and keep their original accounting.
        return n+Math.max(0,acquisitions-evaluated,(r.acquisitionAttempts===undefined&&!r.infrastructureFailure&&!evaluated)?1:0);
      },0),
    discoveryAttempts: batches.filter(freshDiscovery).length,
    rerenders: candidates.filter((r) => r.kind === 'RERENDER').length,
    aiRequests: candidates.reduce(
      (n, r) => n + (r.aiLedgerIds?.length ?? 0),
      0,
    ),
  };
}

@Injectable()
export class AutomationService implements OnModuleInit, OnModuleDestroy {
  private timeout: ReturnType<typeof setTimeout>;
  private owned = false;
  private stopped = false;
  private running: Promise<void>;
  private blocker: string | null = null;
  constructor(
    readonly store: AutomationStore,
    readonly review: AutomationReviewService,
    readonly pipeline: ProductPipelineService,
    readonly studio: StudioService,
  ) {}

  private configured() {
    return (
      process.env.STUDIO_AUTOMATION_ENABLED === '1' &&
      process.env.STUDIO_OPERATOR_ONLY !== '1' &&
      (process.env.STUDIO_AUTOMATION_TOKEN?.length ?? 0) >= 32
    );
  }
  async onModuleInit() {
    await this.store.claim();
    this.owned = true;
    if (this.configured()) this.schedule(0);
  }
  async onModuleDestroy() {
    this.stopped = true;
    clearTimeout(this.timeout);
    await this.running?.catch(() => undefined);
    await this.revisionWorker?.catch(() => undefined);
    await this.store.release();
  }
  private schedule(delay = 15000) {
    if (this.stopped || !this.owned) return;
    this.timeout = setTimeout(() => {
      this.running = this.tick()
        .catch((error) => {
          this.blocker = (error as Error).message.slice(0, 150);
        })
        .finally(() => {
          this.running = undefined;
          this.schedule();
        });
    }, delay);
    this.timeout.unref();
  }
  private requireOwner() {
    if (!this.owned || !this.configured())
      throw new ForbiddenException('AUTHORIZATION_REQUIRED');
  }
  async policy() {
    return validateAutomationPolicy(await this.store.policy());
  }

  configure(body: any, action: 'PATCH' | 'START' | 'STOP') {
    this.requireOwner();
    return this.store.serialize(async () => {
      const policy = await this.policy(),
        requestId = automationRequestId(body?.requestId);
      const timeout = action==='START'?body?.retryTtsTimeout:undefined;
      const continuation=action==='START'?body?.continueTtsAdmission:undefined;
      const savedOnly=process.env.STUDIO_AUTOMATION_SAVED_BATCH_ID;
      const recovery=continuation??timeout;
      if((timeout!==undefined||continuation!==undefined)&&(!recovery||typeof recovery!=='object'||body.retryTtsAdmission===true||
         (timeout!==undefined&&continuation!==undefined)||Object.keys(recovery).length!==4||
         !['batchId','sessionId','itemId'].every(key=>typeof recovery[key]==='string'&&/^[a-f0-9-]{36}$/.test(recovery[key]))||
         typeof recovery.failedAt!=='string'||!Number.isFinite(Date.parse(recovery.failedAt))))
        throw new BadRequestException(continuation!==undefined?'INVALID_TTS_ADMISSION_CONTINUATION':'INVALID_TTS_TIMEOUT_RECOVERY');
      const patch = action === 'PATCH' ? body?.policy : undefined,
        digest = recovery ? automationKey(action,body.revision,continuation?'continueTtsAdmission':'retryTtsTimeout',recovery) : body?.retryTtsAdmission===true&&action==='START'
          ? automationKey(action,body?.revision,patch,'retryTtsAdmission')
          : automationKey(action, body?.revision, patch);
      if (policy.requestId === requestId) {
        if (policy.mutationKey !== digest)
          throw new ConflictException('AUTOMATION_REQUEST_ID_CONFLICT');
        return policy;
      }
      if (body?.revision !== policy.revision)
        throw new ConflictException('STALE_REVISION');
      const mutable = new Set([
        'schedule',
        'topics',
        'dailyVideoLimit',
        'dailyAttemptLimit',
        'dailyRerenderLimit',
        'dailyAiRequestLimit',
        'maxPendingVideos',
        'maxPendingReviews',
        'renderPreset',
        'approvalPolicy',
      ]);
      if (
        action === 'PATCH' &&
        (!patch ||
          typeof patch !== 'object' ||
          Array.isArray(patch) ||
          Object.keys(patch).some((k) => !mutable.has(k)))
      )
        throw new BadRequestException('INVALID_AUTOMATION_POLICY');
      if (patch?.schedule && policy.mode !== 'DISABLED')
        throw new ConflictException('AUTOMATION_MUST_BE_DISABLED');
      if (
        action === 'START' &&
        (savedOnly ? continuation?.batchId!==savedOnly : !!continuation||!this.pipeline.productionLiveAuthorized() || !policy.topics.length)
      )
        throw new ForbiddenException('AUTHORIZATION_REQUIRED');
      if (action === 'START' && policy.mode === 'DRAINING')
        throw new ConflictException('AUTOMATION_DRAINING');
      const mode =
        action === 'START'
          ? 'ENABLED'
          : action === 'STOP'
            ? this.pipeline.hasActiveAuto() || this.studio.hasHeavyWorker()
              ? 'DRAINING'
              : 'DISABLED'
            : policy.mode;
      const next = validateAutomationPolicy({
        ...policy,
        ...patch,
        mode,
        revision: policy.revision + 1,
        requestId,
        mutationKey: digest,
        ...(action==='START' ? {pilotWindow:process.env.STUDIO_AUTOMATION_BATCH_PILOT==='1'
          ? batchPilotWindow(new Date(),policy.schedule) : undefined} : {}),
      });
      if(recovery){
        if(!['DISABLED','BLOCKED'].includes(policy.mode))throw new ConflictException('TTS_RECOVERY_REQUIRES_IDLE_POLICY');
        const dayReservations=(await this.store.list<ProductionDay>('days')).flatMap(day=>day.reservations);
        if(!dayReservations.some(row=>row.batchId===recovery.batchId&&row.dispatch?.recovery?.cacheOnly))
          throw new ConflictException('TTS_RECOVERY_RESERVATION_UNVERIFIED');
        if(continuation)await this.pipeline.authorizeTtsAdmissionContinuation(continuation,requestId);
        else await this.pipeline.authorizeTtsTimeoutRecovery(timeout,requestId);
      }
      if(action==='START' && body.retryTtsAdmission===true){
        const batches=await this.pipeline.listAuto();
        for(const batch of batches.filter(batch=>batch.ttsWait?.blockReason==='ADMISSION_DENIED'))
          await this.pipeline.rearmTtsAdmission(batch.id);
      }
      await this.store.savePolicy(next);
      return next;
    });
  }
  async status() {
    const policy = await this.policy(),
      window = productionWindow(new Date(), policy.schedule);
    const day = await this.store.day(policy.pilotWindow?.dayKey??window.dayKey, new Date().toISOString());
    const { newVideos, waiting, attempts, discoveryAttempts, rerenders, aiRequests } =
      productionUsage(day);
    return {
      policy,
      window,
      owned: this.owned,
      infrastructure: await this.store.get<AutomationInfrastructureRecovery>(
        'infrastructure',
        'browser',
      ),
      active: this.pipeline.hasActiveAuto(),
      blocker: this.blocker,
      usage: { newVideos, waiting, attempts, discoveryAttempts, discoveryLimit:DISCOVERY_BATCH_LIMIT, rerenders, aiRequests },
      discoveryPlan: policy.topics.map(topic=>({topic,keywords:autonomousProductRequest({topic},topic).keywords})),
    };
  }
  async report() {
    const days = await this.store.list<ProductionDay>('days');
    const batchIds = new Set(
      days.flatMap((day) =>
        day.reservations
          .filter((row) => row.dispatch && row.batchId)
          .map((row) => row.batchId),
      ),
    );
    const batches = (await this.pipeline.listAuto()).filter((batch) =>
      batchIds.has(batch.id),
    );
    const status=await this.status();
    const pilotDay=status.policy.pilotWindow?.dayKey;
    const usageBatches=pilotDay?batches.filter(batch=>batch.dispatch?.dayKey===pilotDay):batches;
    return {
      ...status,
      days,
      batches,
      inference: this.pipeline.ai?.evaluator?.requestSummary?.(usageBatches.flatMap(batch=>batch.results.flatMap(row=>row.aiLedgerIds??[])))??null,
      editorialFeedback: await this.store.list('feedback'),
      editorialTelemetry: batches
        .filter((batch) => batch.collected)
        .map((batch) => {
          const routes = batch.results.flatMap(
            (row) => row.editorial?.routes ?? [],
          );
          const completedVideos = batch.results.filter(
            (row) => row.status === 'COMPLETED' && row.artifact,
          ).length;
          const cost = batch.inference?.estimatedCostUsd;
          return {
            batchId: batch.id,
            ...batch.collected,
            hardRejections: routes.filter(
              (row) => row.evidence.hardBlockers.length,
            ).length,
            heuristicDecisions: routes.filter((row) =>
              row.reasons.includes('EXACT_TOPIC_AND_CORROBORATING_CONTEXT'),
            ).length,
            llmEscalations: routes.filter(
              (row) =>
                row.providerRequired || row.reasons.includes('LLM_FALLBACK'),
            ).length,
            cacheHits: routes.filter((row) =>
              row.reasons.includes('EXACT_VALIDATED_CACHE'),
            ).length,
            inference: batch.inference ?? null,
            evaluationLatencyMs: batch.results.reduce(
              (n, row) => n + (row.editorial?.latencyMs ?? 0),
              0,
            ),
            humanReviewRequests: batch.results.filter(
              (row) => row.status === 'WAITING_HUMAN',
            ).length,
            completedVideos,
            ...(completedVideos && cost != null
              ? { estimatedCostPerCompletedVideo: cost / completedVideos }
              : {}),
          };
        }),
    };
  }
  async videos() {
    return this.store.list<ProducedVideo>('videos');
  }
  async reviews() {
    return this.store.list<ReviewRequest>('reviews');
  }

  private async saveDay(day: ProductionDay, now: Date) {
    day.updatedAt = now.toISOString();
    await this.store.put('days', day.dayKey, day);
  }
  private async saveVideo(
    batch: AutonomousProductBatch,
    row: AutonomousVideoResult,
  ) {
    const root = canonicalPost(row.sourceUrl),
      artifact = row.artifact;
    if (!root || !artifact || !row.sessionId || !row.renderJobId)
      throw Error('AUTOMATION_INVALID_ARTIFACT');
    const id = automationKey('video', root.id);
    const old = await this.store.get<ProducedVideo>('videos', id);
    if (old) {
      if (!old.versions.some((v) => v.renderJobId === row.renderJobId))
        throw Error('AUTOMATION_DUPLICATE_VIDEO');
      return old;
    }
    const manifest = await this.studio.renders.load(
      row.sessionId,
      row.renderJobId,
    );
    const checked = await validateDraftArtifact(
      this.studio,
      row.sessionId,
      row.renderJobId,
      artifact.preset,
      manifest.revision,
    );
    if (artifact.sha256 !== checked.sha256)
      throw Error('ARTIFACT_HASH_CHANGED');
    const video: ProducedVideo = {
      schemaVersion: 'automation-video/1',
      id,
      shortId: id.slice(0, 12),
      rootSourceId: row.selectedSourceIds[0],
      sessionId: row.sessionId,
      currentVersion: 1,
      reviewStatus: 'PENDING',
      createdAt: batch.completedAt ?? new Date().toISOString(),
      versions: [
        {
          version: 1,
          sessionRevision: manifest.revision,
          evaluationVersion: row.editorial?.version,
          renderJobId: row.renderJobId,
          selectedSourceIds: row.selectedSourceIds,
          preset: checked.preset,
          durationMs: Math.round(checked.durationSeconds * 1000),
          sha256: checked.sha256,
          createdAt: manifest.completedAt,
        },
      ],
    };
    await this.store.put('videos', id, video);
    return video;
  }

  private async reconcile(
    day: ProductionDay,
    batches: AutonomousProductBatch[],
    now: Date,
    canRun: boolean,
  ) {
    if (!Array.isArray(day.reservations))
      throw Error('AUTOMATION_CORRUPT_STATE');
    const notices: { id: string; text: string }[] = [];
    const policy = await this.policy();
    let dirty = false;
    for (const slot of day.reservations.filter((row) => row.dispatch)) {
      const batch = batches.find(
        (b) => b.id === slot.batchId || b.dispatchRequestId === slot.requestId,
      );
      if (!batch) {
        if (slot.batchId) throw Error('AUTOMATION_BATCH_MISSING');
        if (
          slot.status === 'RESERVED' &&
          canRun &&
          !this.pipeline.hasActiveAuto() &&
          !this.studio.hasHeavyWorker()
        ) {
          const started = await this.dispatch(day, slot);
          slot.batchId = started.id;
          slot.status = 'RUNNING';
          dirty = true;
        }
        continue;
      }
      if (!terminal(batch)) {
        if (slot.batchId !== batch.id || slot.status !== 'RUNNING') {
          slot.batchId = batch.id;
          slot.status = 'RUNNING';
          slot.finishedAt = null;
          dirty = true;
        }
        if (
          !this.pipeline.hasActiveAuto() &&
          canRun &&
          !this.studio.hasHeavyWorker()
        ) {
          if (batch.cancelRequested) {
            await this.pipeline.finalizeInterruptedCancellation(batch.id);
          } else if ((batch.restartAttempts ?? 0) < 1)
            await this.pipeline.resumeAuto(batch.id, true);
          else {
            this.blocker = 'AUTOMATION_ATTEMPT_LIMIT';
          }
        }
        continue;
      }
      if (slot.status === 'RUNNING' || slot.status === 'RESERVED' ||
          (activeTtsRecovery(batch)?.status === 'RESOLVED' && slot.finishedAt !== batch.completedAt)) {
        slot.batchId = batch.id;
        slot.status =
          batch.status === 'BLOCKED' || batch.status === 'FAILED'
            ? 'FAILED'
            : batch.status === 'CANCELLED'
              ? 'CANCELLED'
              : 'COMPLETED';
        slot.finishedAt = batch.completedAt;
        if (batch.browserInfrastructure) slot.infrastructureFailure = true;
        if(batch.collected?.attemptedRootIds || slot.dispatch.discoveryKeyword)
          slot.acquisitionAttempts=batch.collected?.attemptedRootIds?.length??0;
        if(freshDiscovery(slot)){
          slot.discoveryErrors=batch.errors;
          slot.discoveryOutcome=batch.collected?.attemptedRootIds?.length?'RESULTS':
            (batch.errors.length===0&&batch.collected || batch.errors.includes('DISCOVERY_NO_RESULTS_AT_DISCOVERY'))?'EMPTY':'FAILED';
        }
        slot.error = [
          ...batch.errors,
          ...batch.results.flatMap((r) => r.warnings),
        ].find((e) => /ACCESS|LOGIN|CAPTCHA|429|AI_.*BUDGET|RESOURCE/.test(e));
        dirty = true;
      }
      if (slot.batchId !== batch.id) throw Error('AUTOMATION_BATCH_MISMATCH');
      for (const row of batch.results) {
        const candidate = canonicalPost(row.sourceUrl)?.id;
        if (!candidate) continue;
        const id = automationKey('candidate', slot.id, candidate);
        const old = day.reservations.find((x) => x.id === id);
        const status =
          row.status === 'COMPLETED'
            ? 'COMPLETED'
            : row.status === 'WAITING_HUMAN'
              ? 'WAITING_HUMAN'
              : 'FAILED';
        let review: ReviewRequest;
        if (status === 'COMPLETED') {
          const video = await this.saveVideo(batch, row);
          review = await this.review.park(batch, row, video);
        } else if (status === 'WAITING_HUMAN') {
          review = await this.review.park(batch, row);
          if (
            review.status === 'RESOLVED' &&
            review.resolution?.decision !== 'REJECT' &&
            canRun &&
            productionUsage(day).newVideos < policy.dailyVideoLimit &&
            !this.pipeline.hasActiveAuto() &&
            !this.studio.hasHeavyWorker()
          ) {
            const approved = review.resolution?.decision === 'APPROVE';
            if (
              !approved ||
              (await this.studio.load(row.sessionId)).revision ===
                review.sourceRevision
            )
              await this.pipeline.resumeReviewed(
                batch.id,
                row.sourceUrl,
                approved,
                review.resolution?.decision === 'SELECT' &&
                  (review.type === 'SELECT_ROOT' ||
                    review.type === 'SELECT_REPLIES')
                  ? {
                      type: review.type,
                      selectedSourceIds: review.resolution.selectedSourceIds,
                    }
                  : undefined,
              );
          }
        }
        if (review?.status === 'OPEN')
          notices.push({
            id: review.id,
            text: 'Review ' + review.shortId + ' · ' + review.type,
          });
        const next: ProductionReservation = {
          id,
          requestId: slot.requestId,
          candidateKey: candidate,
          batchId: batch.id,
          sessionId: row.sessionId,
          renderJobId: row.renderJobId,
          kind: 'NEW_VIDEO',
          status:
            review?.resolution?.decision === 'REJECT' &&
            status === 'WAITING_HUMAN'
              ? 'CANCELLED'
              : status,
          createdAt: old?.createdAt ?? slot.createdAt,
          finishedAt: batch.completedAt,
          aiLedgerIds: row.aiLedgerIds,
          ...(slot.dispatch?.recovery?.cacheOnly
            ? { cachedRecovery: true }
            : {}),
        };
        if (JSON.stringify(old) !== JSON.stringify(next)) {
          if (old) day.reservations[day.reservations.indexOf(old)] = next;
          else day.reservations.push(next);
          dirty = true;
        }
      }
      notices.push({
        id: batch.id,
        text: 'Production batch ' + batch.id.slice(0, 8) + ' · ' + batch.status,
      });
    }
    if (dirty) await this.saveDay(day, now);
    for (const notice of notices)
      await this.review.notify(notice.id, notice.text);
  }

  private dispatch(day: ProductionDay, slot: ProductionReservation) {
    const d = slot.dispatch;
    return this.pipeline.startAuto(
      {
        confirmLive: true,
        requestId: slot.requestId,
        topic: d.topic,
        targetVideos: d.capacity,
        maxCandidates: 30,
        maxEnrich: d.attempts,
      },
      {
        preset: d.preset,
        dayKey: day.dayKey,
        aiRequestLimit: d.aiLimit,
        reviewBeforeRender: d.reviewBeforeRender,
        reviewSlots: d.reviewSlots,
        ...(d.discoveryKeyword ? { discoveryKeyword: d.discoveryKeyword } : {}),
        ...(d.recovery ? { recovery: d.recovery } : {}),
      },
    );
  }

  private browserHealthProbe() {
    return probeNativeBrowserMonitor();
  }

  private async monitorRecovery(
    days: ProductionDay[],
    batches: AutonomousProductBatch[],
    now: Date,
    canProbe: boolean,
  ) {
    let state = await this.store.get<AutomationInfrastructureRecovery>(
      'infrastructure',
      'browser',
    );
    const admitted = new Set(
      days.flatMap((day) =>
        day.reservations
          .filter((slot) => slot.dispatch)
          .map((slot) => slot.requestId),
      ),
    );
    const latest = batches
      .filter(
        (batch) =>
          admitted.has(batch.dispatchRequestId) &&
          terminal(batch) &&
          (batch.browserInfrastructure || batch.discoveryRunId) &&
          !batch.dispatch?.recovery,
      )
      .sort((a, b) => Date.parse(b.completedAt) - Date.parse(a.completedAt))[0];
    const fault = latest?.browserInfrastructure;
    const save = () => this.store.put('infrastructure', 'browser', state);
    if (
      fault &&
      latest.id !== state?.batchId &&
      (!state ||
        Date.parse(latest.completedAt) >= Date.parse(state.lastFailureAt))
    ) {
      const previous = state?.status === 'CLEARED' ? null : state;
      const blocked =
        !fault.cleanupVerified || Boolean(previous?.recoveryAttempts);
      state = {
        schemaVersion: 'automation-infrastructure/1',
        id: 'browser',
        failureCode: fault.failureCode,
        consecutiveFailures: (previous?.consecutiveFailures ?? 0) + 1,
        lastFailureAt: latest.completedAt,
        nextProbeAt: blocked
          ? null
          : new Date(
              Math.max(Date.parse(latest.completedAt) + 60000, now.getTime()),
            ).toISOString(),
        recoveryAttempts: previous?.recoveryAttempts ?? 0,
        diagnosticReference: fault.diagnosticReference,
        batchId: latest.id,
        status: blocked ? 'BLOCKED' : 'COOLDOWN',
      };
      await save();
    } else if (
      latest &&
      !fault &&
      state?.status === 'RETRY_ADMITTED' &&
      Date.parse(latest.completedAt) > Date.parse(state.lastFailureAt)
    ) {
      state.status = 'CLEARED';
      await save();
    }
    if (!state || ['CLEARED', 'RETRY_ADMITTED'].includes(state.status))
      return state;
    if (state.status === 'PROBING') {
      state.status = 'BLOCKED';
      state.nextProbeAt = null;
      await save();
    }
    if (
      state.status === 'COOLDOWN' &&
      canProbe &&
      Date.parse(state.nextProbeAt) <= now.getTime() &&
      !this.pipeline.hasActiveAuto() &&
      !this.studio.hasHeavyWorker()
    ) {
      state.status = 'PROBING';
      state.recoveryAttempts++;
      state.nextProbeAt = null;
      await save(); // A crash during a probe cannot grant a second attempt.
      const probe = await this.studio.withProductionWorker(() =>
        this.browserHealthProbe(),
      );
      state.probe = probe.report;
      state.status = probe.healthy ? 'RETRY_ADMITTED' : 'BLOCKED';
      await save();
    }
    if (state.status === 'BLOCKED') {
      this.blocker = state.failureCode;
      const policy = await this.policy();
      if (policy.mode === 'ENABLED')
        await this.store.savePolicy({
          ...policy,
          mode: 'BLOCKED',
          revision: policy.revision + 1,
        });
      await this.review.notify(
        automationKey('browser-infrastructure', state.diagnosticReference),
        'Browser infrastructure blocked · ' +
          state.failureCode +
          ' · ' +
          state.diagnosticReference,
      );
    } else if (state.status === 'COOLDOWN') this.blocker = state.failureCode;
    return state;
  }

  private async nextSavedAssessment(
    day: ProductionDay,
    batches: AutonomousProductBatch[],
    now: Date,
    providerAvailable: boolean,
  ) {
    const considered = new Set<string>();
    for (const batch of batches
      .slice()
      .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))) {
      if (!terminal(batch)) continue;
      for (const row of batch.results) {
        const key = canonicalPost(row.sourceUrl)?.id;
        if (!key || considered.has(key)) continue;
        considered.add(key);
        if (
          !row.collectionId ||
          day.reservations.some(
            (slot) =>
              slot.dispatch?.recovery?.collectionId === row.collectionId,
          )
        )
          continue;
        const recovery = await this.pipeline.savedAssessmentCandidate(
          batch,
          row,
          now.getTime(),
        );
        if (recovery && (providerAvailable || recovery.cacheOnly))
          return { recovery, topic: batch.request.topic };
      }
    }
    return null;
  }

  async tick(now = new Date()) {
    this.requireOwner();
    return this.store.serialize(async () => {
      let policy = await this.policy();
      const window = productionWindow(now, policy.schedule);
      const days = await this.store.list<ProductionDay>('days');
      const batches = await this.pipeline.listAuto();
      const savedOnly=process.env.STUDIO_AUTOMATION_SAVED_BATCH_ID;
      const savedBatch=savedOnly?batches.find(batch=>batch.id===savedOnly):undefined;
      const continuation=savedBatch?.ttsAdmissionContinuation;
      const pilotEnded=!!policy.pilotWindow && now.getTime()>=Date.parse(policy.pilotWindow.endsAt);
      const pilotCanDispatch=!policy.pilotWindow||(!pilotEnded&&policy.pilotWindow.dayKey===window.dayKey);
      const canRecover = policy.mode==='ENABLED' && (savedOnly ?
        !!continuation && continuation.requestId===policy.requestId :
        this.pipeline.productionLiveAuthorized() && window.open && pilotCanDispatch);
      const infrastructure = savedOnly?null:await this.monitorRecovery(
        days,
        batches,
        now,
        canRecover,
      );
      const infrastructureReady =
        !infrastructure ||
        ['CLEARED', 'RETRY_ADMITTED'].includes(infrastructure.status);
      const ttsRecoveries=batches.filter(batch=>(!savedOnly||batch.id===savedOnly&&!!continuation)&&days.some(day=>day.reservations.some(slot=>slot.batchId===batch.id&&slot.dispatch)));
      let ttsWait=ttsRecoveries.find(batch=>{const wait=activeTtsRecovery(batch);return wait&&wait.status!=='RESOLVED';});
      if(!savedOnly&&!ttsWait&&canRecover&&infrastructureReady&&!this.pipeline.hasActiveAuto()&&!this.studio.hasHeavyWorker()){
        for(const batch of ttsRecoveries){
          if(!batch.dispatch?.recovery?.cacheOnly||batch.status!=='FAILED'||batch.ttsWait)continue;
          const adopted=await this.pipeline.adoptTtsResourceWait(batch.id);
          if(adopted){batch.ttsWait=adopted;ttsWait=batch;break;}
        }
      }
      if(ttsWait&&canRecover&&infrastructureReady){
        const wait=await this.pipeline.probeTtsResourceWait(ttsWait.id,now.getTime());
        this.blocker=wait?.status==='BLOCKED'?'TTS_RESOURCE_BLOCKED':'TTS_RESOURCE_WAIT';
        if(wait?.status==='BLOCKED'){
          await this.store.savePolicy({...policy,mode:'BLOCKED',revision:policy.revision+1});
          await this.review.notify(automationKey('tts-resource',ttsWait.id),'TTS resource blocked · '+ttsWait.id);
        }
      }
      for (const day of days)
        await this.reconcile(
          day,
          batches,
          now,
          !savedOnly && canRecover && infrastructureReady && !ttsWait && day.dayKey === window.dayKey,
        );
      if (
        policy.mode === 'DRAINING' &&
        !this.pipeline.hasActiveAuto() &&
        !this.studio.hasHeavyWorker()
      ) {
        await this.store.savePolicy({
          ...policy,
          mode: 'DISABLED',
          revision: policy.revision + 1,
        });
        return;
      }
      if(pilotEnded&&policy.mode==='ENABLED'){
        this.blocker='PILOT_WINDOW_ENDED';
        await this.store.savePolicy({...policy,mode:this.pipeline.hasActiveAuto()||this.studio.hasHeavyWorker()?'DRAINING':'DISABLED',
          revision:policy.revision+1});
        return;
      }
      if(savedOnly){
        if(policy.mode==='ENABLED'&&!ttsWait&&!this.pipeline.hasActiveAuto()&&!this.studio.hasHeavyWorker())
          await this.store.savePolicy({...policy,mode:'DISABLED',revision:policy.revision+1});
        return;
      }
      if (
        !canRecover ||
        !infrastructureReady ||
        !!ttsWait ||
        this.pipeline.hasActiveAuto() ||
        this.studio.hasHeavyWorker()
      )
        return;
      const day =
        days.find((x) => x.dayKey === window.dayKey) ??
        (await this.store.day(window.dayKey, now.toISOString()));
      const usage = productionUsage(day);
      const pendingEdit = day.reservations.find(
        (x) => x.kind === 'RERENDER' && active(x),
      );
      if (pendingEdit) {
        await this.launchRevision(day.dayKey, pendingEdit.id);
        return;
      }
      if (day.reservations.some((x) => x.dispatch && active(x))) return;
      const failures = day.reservations
        .filter(
          (r) => r.dispatch && !isBrowserInfrastructureFailure(r.error ?? ''),
        )
        .slice(-3);
      if (
        failures.some((row) => /ACCESS|LOGIN|CAPTCHA/.test(row.error ?? '')) ||
        (failures.length === 3 &&
          failures.every((row) => row.status === 'FAILED' && row.error))
      ) {
        this.blocker = 'ACCESS_OR_REPEATED_SYSTEM_FAILURE';
        await this.store.savePolicy({
          ...policy,
          mode: 'BLOCKED',
          revision: policy.revision + 1,
        });
        return;
      }
      if (
        failures.some(
          (r) =>
            /429/.test(r.error ?? '') &&
            Date.parse(r.finishedAt ?? '') + 60 * 60_000 > now.getTime(),
        )
      ) {
        this.blocker = 'SOURCE_COOLDOWN';
        return;
      }
      const videos = (await this.videos()).filter(
        (v) => v.reviewStatus !== 'REJECTED',
      );
      const reviews = (await this.reviews()).filter((r) => r.status === 'OPEN');
      const capacity = Math.min(
        3,
        policy.dailyVideoLimit - usage.newVideos,
        policy.maxPendingVideos - videos.length,
        policy.maxPendingReviews - reviews.length,
      );
      const attempts = Math.min(10, policy.dailyAttemptLimit - usage.attempts);
      const aiLimit = policy.dailyAiRequestLimit - usage.aiRequests;
      if (usage.newVideos >= policy.dailyVideoLimit) {
        this.blocker = 'VIDEO_TARGET_REACHED';
        return;
      }
      if (capacity <= 0) {
        this.blocker = 'INVENTORY_FULL';
        return;
      }
      const saved = await this.nextSavedAssessment(
        day,
        batches,
        now,
        aiLimit > 0 && attempts > 0,
      );
      if ((aiLimit <= 0 || attempts <= 0) && !saved) {
        this.blocker = attempts <= 0 ? 'CANDIDATE_BUDGET_EXHAUSTED' : 'AI_BUDGET_EXHAUSTED';
        return;
      }
      const discovery=saved?null:nextDiscovery(policy.topics,day.reservations,now);
      if(discovery?.blocker){
        this.blocker=discovery.blocker;
        return;
      }
      if (!policy.topics.length || !(await this.runtimePreflight())) {
        this.blocker = 'RESOURCE_BLOCKED';
        return;
      }
      const topic = saved?.topic ?? discovery.topic;
      const id = randomUUID(),
        slot: ProductionReservation = {
          id,
          requestId: 'auto-' + window.dayKey + '-' + id,
          kind: 'NEW_VIDEO',
          status: 'RESERVED',
          createdAt: now.toISOString(),
          finishedAt: null,
          candidateKey: null,
          batchId: null,
          sessionId: null,
          renderJobId: null,
          dispatch: {
            topic,
            capacity: saved ? 1 : capacity,
            attempts: saved ? 1 : attempts,
            ...(saved ? { recovery: saved.recovery } : { discoveryKeyword: discovery.keyword }),
            aiLimit: saved?.recovery.cacheOnly ? 0 : aiLimit,
            reviewSlots: policy.maxPendingReviews - reviews.length,
            preset: policy.renderPreset,
            reviewBeforeRender:
              policy.approvalPolicy === 'REVIEW_BEFORE_RENDER',
            policyRevision: policy.revision,
          },
        };
      day.reservations.push(slot);
      await this.saveDay(day, now);
      const batch = await this.dispatch(day, slot);
      slot.batchId = batch.id;
      slot.status = 'RUNNING';
      await this.saveDay(day, now);
      this.blocker = null;
    });
  }

  private async runtimePreflight() {
    if (freemem() < 256 * 1024 ** 2) return false;
    const disk = await fs.statfs(this.store.root);
    return (
      disk.bavail * disk.bsize >= 3 * 1024 ** 3 &&
      (await this.studio.withProductionWorker(() =>
        this.studio.productionRuntimeReady(),
      ))
    );
  }

  decide(video: string, body: any, status: 'APPROVED' | 'REJECTED') {
    this.requireOwner();
    return this.store.serialize(() => this.review.decide(video, body, status));
  }
  resolve(id: string, body: any) {
    this.requireOwner();
    return this.store.serialize(() => this.review.resolve(id, body));
  }

  revise(key: string, body: any) {
    this.requireOwner();
    return this.store.serialize(async () => {
      const requestId = automationRequestId(body?.requestId),
        video = await this.review.video(key),
        policy = await this.policy();
      const now = new Date(),
        window = productionWindow(now, policy.schedule);
      const existing = (await this.store.list<ProductionDay>('days'))
        .flatMap((d) => d.reservations)
        .find((r) => r.kind === 'RERENDER' && r.requestId === requestId);
      if (existing) {
        if (
          existing.edit?.videoId !== video.id ||
          existing.edit.sourceId !== body.sourceId ||
          existing.edit.version !== body.version
        )
          throw new ConflictException('AUTOMATION_REQUEST_ID_CONFLICT');
        return existing;
      }
      if (
        policy.mode !== 'ENABLED' ||
        !this.pipeline.productionLiveAuthorized()
      )
        throw new ForbiddenException('AUTOMATION_DISABLED');
      const day = await this.store.day(window.dayKey, now.toISOString()),
        usage = productionUsage(day);
      if (
        usage.rerenders >= policy.dailyRerenderLimit ||
        usage.attempts >= policy.dailyAttemptLimit
      )
        throw new ConflictException('DAILY_LIMIT_REACHED');
      if (
        this.studio.hasHeavyWorker() ||
        this.pipeline.hasActiveAuto() ||
        day.reservations.some(active)
      )
        throw new ConflictException('RESOURCE_BLOCKED');
      const session = await this.studio.load(video.sessionId),
        version = video.versions.find(
          (v) => v.version === video.currentVersion,
        );
      if (
        !version ||
        video.currentVersion !== body.version ||
        version.sessionRevision !== session.revision
      )
        throw new ConflictException('STALE_REVISION');
      if (
        !session.items.some(
          (i) =>
            i.selected &&
            i.sourceReference.entityType === 'COMMENT' &&
            sourceId(i) === body.sourceId,
        )
      )
        throw new BadRequestException('SELECTED_REPLY_REQUIRED');
      const row: ProductionReservation = {
        id: randomUUID(),
        requestId,
        kind: 'RERENDER',
        status: 'RESERVED',
        candidateKey: video.rootSourceId,
        batchId: null,
        sessionId: session.id,
        renderJobId: null,
        createdAt: now.toISOString(),
        finishedAt: null,
        edit: {
          videoId: video.id,
          version: video.currentVersion,
          sourceId: body.sourceId,
          sourceRevision: session.revision,
          preset: version.preset,
        },
      };
      await this.review.recordFeedback(requestId, {
        action: 'REMOVE_REPLY',
        rootSourceId: video.rootSourceId,
        sourceId: body.sourceId,
        videoId: video.id,
        videoVersion: version.version,
        reasonCode: null,
        evaluationVersion: version.evaluationVersion ?? 'legacy',
        featureSnapshotRef: video.id + ':' + version.version,
      });
      day.reservations.push(row);
      await this.saveDay(day, now);
      return row;
    });
  }

  private revisionWorker?: Promise<void>;
  private async launchRevision(dayKey: string, id: string) {
    if (this.revisionWorker) return;
    this.revisionWorker = this.studio
      .withProductionWorker(async () => {
        const day = await this.store.day(dayKey, new Date().toISOString()),
          row = day.reservations.find((r) => r.id === id);
        if (!row?.edit || !active(row)) return;
        const save = () =>
          this.store.serialize(async () => {
            const fresh = await this.store.day(
              dayKey,
              new Date().toISOString(),
            );
            fresh.reservations[
              fresh.reservations.findIndex((r) => r.id === id)
            ] = row;
            await this.saveDay(fresh, new Date());
          });
        try {
          const e = row.edit,
            video = await this.review.video(e.videoId);
          const previous = video.versions.find((v) => v.version === e.version);
          if (!previous) throw Error('STALE_REVISION');
          const recorded = video.versions.find(
            (v) => v.renderJobId === row.renderJobId,
          );
          if (recorded) {
            row.status = 'COMPLETED';
            return;
          }
          if (video.currentVersion !== e.version) throw Error('STALE_REVISION');
          row.status = 'RUNNING';
          await save();
          let session = await this.studio.load(video.sessionId);
          const selected = previous.selectedSourceIds.filter(
            (x) => x !== e.sourceId,
          );
          const expected = [...selected].sort();
          const current = () =>
            session.items
              .filter((i) => i.selected)
              .map((i) => sourceId(i))
              .sort();
          if (session.revision === e.sourceRevision) {
            session = await this.studio.mutate(session.id, {
              revision: session.revision,
              title: session.title,
              items: session.items.map((i) => ({
                id: i.id,
                selected: i.selected && sourceId(i) !== e.sourceId,
                displayText: i.displayText,
                spokenText: i.spokenText,
              })),
            });
          }
          if (JSON.stringify(current()) !== JSON.stringify(expected))
            throw Error('STALE_REVISION');
          const requestId = 'auto-revise-' + row.id;
          const existing = row.renderJobId
            ? await this.studio.jobs.load(row.renderJobId)
            : await this.studio.jobs.findRequest(
                session.id,
                'operator:automation-render',
                requestId,
              );
          if (!existing && !e.preparedRevision) {
            if (
              ![e.sourceRevision + 1, e.sourceRevision + 2].includes(
                session.revision,
              )
            )
              throw Error('STALE_REVISION');
            if (session.revision === e.sourceRevision + 1)
              await this.studio.preparePreview(
                session.id,
                session.revision,
                true,
              );
            session = await this.studio.load(session.id);
            e.preparedRevision = session.revision;
            await save();
          }
          if (!existing && session.revision !== e.preparedRevision)
            throw Error('STALE_REVISION');
          const props = (await this.studio.preview(session.id)).request
            .inputProps;
          assertRenderable(session, props);
          const seconds = props.timeline.totalFrames / props.timeline.fps;
          if (
            ['TOO_SHORT', 'TOO_LONG'].includes(
              seriousDraftDurationStatus(seconds),
            )
          )
            throw Error('DURATION_REVIEW_REQUIRED:' + seconds);
          const submitted =
            existing ??
            (await this.pipeline.renderPreparedDraft(
              session,
              e.preset,
              requestId,
            ));
          row.renderJobId = submitted.jobId;
          await save();
          const done = await this.pipeline.waitStudioJob(
            submitted.jobId,
            Date.now() + 45 * 60_000,
          );
          if (done.status !== 'SUCCEEDED')
            throw Error(done.error || done.status);
          const artifact = await validateDraftArtifact(
            this.studio,
            session.id,
            submitted.jobId,
            e.preset,
            submitted.inputRevision,
          );
          if (
            ['TOO_SHORT', 'TOO_LONG'].includes(
              seriousDraftDurationStatus(artifact.durationSeconds),
            )
          )
            throw Error('DURATION_REVIEW_REQUIRED:' + artifact.durationSeconds);
          await this.store.serialize(async () => {
            const latest = await this.review.video(video.id);
            if (latest.currentVersion !== e.version)
              throw Error('STALE_REVISION');
            latest.currentVersion++;
            latest.reviewStatus = 'PENDING';
            delete latest.decision;
            latest.versions.push({
              version: latest.currentVersion,
              evaluationVersion: previous.evaluationVersion,
              sessionRevision: session.revision,
              renderJobId: submitted.jobId,
              selectedSourceIds: selected,
              preset: e.preset,
              durationMs: Math.round(artifact.durationSeconds * 1000),
              sha256: artifact.sha256,
              createdAt: new Date().toISOString(),
            });
            await this.store.put('videos', latest.id, latest);
            await this.review.parkVersion(latest);
            await this.review.notify(
              row.id,
              'New video version ' +
                latest.shortId +
                ' v' +
                latest.currentVersion,
            );
          });
          row.status = 'COMPLETED';
        } catch (error) {
          row.status = 'FAILED';
          row.error = (error as Error).message.slice(0, 160);
        } finally {
          row.finishedAt = new Date().toISOString();
          await save();
        }
      })
      .catch((error) => {
        this.blocker = (error as Error).message.slice(0, 150);
      })
      .finally(() => {
        this.revisionWorker = undefined;
      });
  }

  async artifact(id: string, version: number) {
    const row = await this.review.video(id),
      entry = row.versions.find((v) => v.version === version);
    if (!entry) throw new BadRequestException('STALE_REVISION');
    const check = await validateDraftArtifact(
      this.studio,
      row.sessionId,
      entry.renderJobId,
      entry.preset,
      entry.sessionRevision,
    );
    if (check.sha256 !== entry.sha256)
      throw new ConflictException('ARTIFACT_HASH_CHANGED');
    return new StreamableFile(
      createReadStream(
        await this.studio.renders.output(row.sessionId, entry.renderJobId),
      ),
      { type: 'video/mp4', disposition: 'attachment; filename="draft.mp4"' },
    );
  }
}
