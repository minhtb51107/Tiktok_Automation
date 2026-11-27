import { canonicalPost } from '../data-engine/conversation-identity';
import type { EditorialFeedbackEvent } from './automation.types';
import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type {
  AutomationOutbox,
  ProducedVideo,
  ReviewRequest,
} from './automation.types';
import { AutomationStore, automationKey } from './automation.store';
import type {
  AutonomousProductBatch,
  AutonomousVideoResult,
} from './product-pipeline';
import { StudioService } from './studio.service';
import { spokenAmbiguities } from './voice-settings';

export function automationRequestId(value: unknown): string {
  if (typeof value !== 'string' || !/^[\w-]{1,100}$/.test(value))
    throw new BadRequestException('INVALID_REQUEST_ID');
  return value;
}
export function sourceId(item: {
  sourceReference: { entityId: string };
  sourceId?: string;
}) {
  return item.sourceId ?? item.sourceReference.entityId;
}

@Injectable()
export class AutomationReviewService {
  constructor(
    readonly store: AutomationStore,
    readonly studio: StudioService,
  ) {}

  async video(key: string) {
    const row = (await this.store.list<ProducedVideo>('videos')).find(
      (x) => x.id === key || x.shortId === key,
    );
    if (!row) throw new NotFoundException('AUTOMATION_VIDEO_NOT_FOUND');
    return row;
  }
  async review(key: string) {
    const row = (await this.store.list<ReviewRequest>('reviews')).find(
      (x) => x.id === key || x.shortId === key,
    );
    if (!row) throw new NotFoundException('AUTOMATION_REVIEW_NOT_FOUND');
    return row;
  }
  async recordFeedback(
    identity: string,
    event: Omit<
      EditorialFeedbackEvent,
      'schemaVersion' | 'eventId' | 'timestamp'
    >,
  ) {
    const eventId = automationKey(
      'editorial-feedback',
      identity,
      event.action,
      event.rootSourceId,
      event.sourceId,
      event.videoId,
      event.videoVersion,
    );
    if (await this.store.get<EditorialFeedbackEvent>('feedback', eventId))
      return;
    await this.store.put('feedback', eventId, {
      schemaVersion: 'editorial-feedback/1',
      eventId,
      timestamp: new Date().toISOString(),
      ...event,
    });
  }
  async notify(key: string, text: string) {
    const id = automationKey('outbox', key);
    if (await this.store.get<AutomationOutbox>('outbox', id)) return;
    await this.store.put('outbox', id, {
      schemaVersion: 'automation-outbox/1',
      id,
      text: text.slice(0, 1800),
      attempts: 0,
      nextAt: new Date().toISOString(),
      sentAt: null,
    });
  }
  async park(
    batch: AutonomousProductBatch,
    result: AutonomousVideoResult,
    video?: ProducedVideo,
  ) {
    if (video) return this.parkVersion(video, batch.id);
    const session = result.sessionId
      ? await this.studio.load(result.sessionId)
      : null;
    const key = automationKey(
      'review',
      batch.id,
      result.sourceUrl,
      result.warnings[0],
      session?.revision,
    );
    const previous = (await this.store.list<ReviewRequest>('reviews')).find(
      (r) =>
        r.batchId === batch.id &&
        r.sessionId === result.sessionId &&
        !r.videoId &&
        r.candidateUrl === result.sourceUrl &&
        r.reason === result.warnings[0]?.split(':')[0].slice(0, 90) &&
        (r.status === 'OPEN' ||
          (r.resolution?.decision === 'PRONUNCIATION' &&
            r.sourceRevision === session?.revision - 1) ||
          r.resolution?.decision === 'REJECT' ||
          r.resolution?.decision === 'APPROVE'),
    );
    const old =
      previous ?? (await this.store.get<ReviewRequest>('reviews', key));
    if (old) return old;
    const type =
      result.reviewChoice?.type ??
      (result.warnings.includes('PRONUNCIATION_REVIEW_REQUIRED')
        ? 'PRONUNCIATION'
        : 'VIDEO_REVIEW');
    const selected =
      session?.items.filter(
        (item) =>
          item.selected && item.sourceReference.entityType === 'COMMENT',
      ) ?? [];
    const review: ReviewRequest = {
      schemaVersion: 'automation-review/1',
      id: key,
      shortId: key.slice(0, 12),
      revision: 1,
      type,
      batchId: batch.id,
      sessionId: result.sessionId,
      sourceRevision: session?.revision ?? null,
      candidateUrl: result.sourceUrl,
      evaluationVersion: result.editorial?.version,
      options: (
        result.reviewChoice?.options ??
        selected.map((item) => ({
          sourceId: sourceId(item),
          preview: item.displayText.slice(0, 280),
        }))
      ).map((option, i) => ({ ...option, number: i + 1 })),
      status: 'OPEN',
      createdAt: new Date().toISOString(),
      expiresAt: null,
      reason: result.warnings[0]?.split(':')[0].slice(0, 90),
      ...(type === 'PRONUNCIATION'
        ? { ambiguousTerms: result.warnings.slice(1) }
        : {}),
    };
    await this.store.put('reviews', key, review);
    return review;
  }
  async parkVersion(video: ProducedVideo, batchId: string | null = null) {
    const key = automationKey('video-review', video.id, video.currentVersion);
    for (const previous of await this.store.list<ReviewRequest>('reviews')) {
      if (
        previous.videoId !== video.id ||
        previous.videoVersion === video.currentVersion ||
        previous.status !== 'OPEN'
      )
        continue;
      await this.store.put('reviews', previous.id, {
        ...previous,
        status: 'CANCELLED',
        revision: previous.revision + 1,
      });
    }
    const old = await this.store.get<ReviewRequest>('reviews', key);
    if (old) return old;
    const version = video.versions.find(
      (v) => v.version === video.currentVersion,
    );
    const session = await this.studio.load(video.sessionId);
    const options = version.selectedSourceIds
      .filter((id) => id !== video.rootSourceId)
      .map((id, i) => ({
        number: i + 1,
        sourceId: id,
        preview:
          session.items
            .find((item) => sourceId(item) === id)
            ?.displayText.slice(0, 280) ?? '',
      }));
    const review: ReviewRequest = {
      schemaVersion: 'automation-review/1',
      id: key,
      shortId: key.slice(0, 12),
      revision: 1,
      type: 'VIDEO_REVIEW',
      batchId,
      sessionId: video.sessionId,
      sourceRevision: version.sessionRevision,
      options,
      status: 'OPEN',
      createdAt: new Date().toISOString(),
      expiresAt: null,
      videoId: video.id,
      videoVersion: version.version,
    };
    await this.store.put('reviews', key, review);
    return review;
  }
  async resolve(key: string, body: any) {
    const requestId = automationRequestId(body?.requestId);
    const row = await this.review(key);
    const digest =
      row.videoId && ['APPROVE', 'REJECT'].includes(body.decision)
        ? automationKey(
            body.decision === 'APPROVE' ? 'APPROVED' : 'REJECTED',
            row.videoVersion,
          )
        : automationKey(
            body.revision,
            body.decision,
            body.numbers,
            body.readings,
          );
    if (row.resolution?.requestId === requestId) {
      if (row.resolution.digest !== digest)
        throw new ConflictException('AUTOMATION_REQUEST_ID_CONFLICT');
      return row;
    }
    if (
      row.status !== 'OPEN' ||
      row.revision !== body.revision ||
      (row.expiresAt && Date.parse(row.expiresAt) <= Date.now())
    )
      throw new ConflictException('STALE_REVIEW');
    const session = row.sessionId
      ? await this.studio.load(row.sessionId)
      : null;
    if (session && session.revision !== row.sourceRevision)
      throw new ConflictException('STALE_REVIEW');
    const decision = body.decision;
    if (!['APPROVE', 'REJECT', 'SELECT', 'PRONUNCIATION'].includes(decision))
      throw new BadRequestException('INVALID_REVIEW_DECISION');
    if (row.videoId) {
      if (!['APPROVE', 'REJECT'].includes(decision))
        throw new BadRequestException('INVALID_REVIEW_DECISION');
      await this.decide(
        row.videoId,
        { requestId, version: row.videoVersion },
        decision === 'APPROVE' ? 'APPROVED' : 'REJECTED',
      );
      // decide() resolves the linked immutable version snapshot.
      return this.review(key);
    }
    let selectedSourceIds: string[] | undefined;
    if (decision === 'SELECT') {
      if (
        !['SELECT_ROOT', 'SELECT_REPLIES'].includes(row.type) ||
        !Array.isArray(body.numbers) ||
        new Set(body.numbers).size !== body.numbers.length ||
        !body.numbers.length ||
        (row.type === 'SELECT_ROOT' && body.numbers.length !== 1) ||
        !body.numbers.every(
          (n) => Number.isInteger(n) && row.options.some((x) => x.number === n),
        )
      )
        throw new BadRequestException('INVALID_REVIEW_OPTIONS');
      selectedSourceIds = row.options
        .filter((o) => body.numbers.includes(o.number))
        .map((o) => o.sourceId);
    }
    if (decision === 'PRONUNCIATION') {
      const hasTerm = (
        item: NonNullable<typeof session>['items'][number],
        term: string,
      ) =>
        item.selected &&
        [
          ...(item.automaticNormalization?.ambiguousTerms ?? []),
          ...spokenAmbiguities(item.spokenText, item.pronunciationOverrides),
        ].some((t) => t.toLowerCase() === term.toLowerCase());
      if (
        !session ||
        row.type !== 'PRONUNCIATION' ||
        !Array.isArray(body.readings) ||
        !body.readings.length ||
        body.readings.length > 30 ||
        !body.readings.every(
          (r) =>
            r &&
            typeof r.term === 'string' &&
            /^[\p{L}\p{N}.]{1,24}$/u.test(r.term) &&
            typeof r.reading === 'string' &&
            /^[\p{L} -]{1,32}$/u.test(r.reading) &&
            (!row.ambiguousTerms ||
              row.ambiguousTerms.some(
                (t) => t.toLowerCase() === r.term.toLowerCase(),
              )) &&
            session.items.some((i) => hasTerm(i, r.term)),
        )
      )
        throw new BadRequestException('INVALID_PRONUNCIATION');
      await this.studio.mutate(session.id, {
        revision: session.revision,
        title: session.title,
        items: session.items.map((i) => ({
          id: i.id,
          selected: i.selected,
          displayText: i.displayText,
          spokenText: i.spokenText,
          pronunciationOverrides: {
            ...i.pronunciationOverrides,
            ...Object.fromEntries(
              body.readings
                .filter((r) => hasTerm(i, r.term))
                .map((r) => [r.term, r.reading]),
            ),
          },
        })),
      });
    }
    if (decision === 'APPROVE' && row.reason !== 'REVIEW_BEFORE_RENDER')
      throw new BadRequestException('REVIEW_CANNOT_BYPASS_BLOCKER');
    const rootSourceId = canonicalPost(row.candidateUrl)?.id;
    const action =
      row.type === 'SELECT_ROOT'
        ? decision === 'SELECT'
          ? 'SELECT_ROOT'
          : decision === 'REJECT'
            ? 'REJECT_ROOT'
            : null
        : row.type === 'SELECT_REPLIES' && decision === 'SELECT'
          ? 'SELECT_REPLY'
          : null;
    if (action && rootSourceId) {
      for (const sourceId of selectedSourceIds ?? [rootSourceId])
        await this.recordFeedback(row.id + ':' + requestId, {
          action,
          rootSourceId,
          sourceId,
          videoId: null,
          videoVersion: null,
          reasonCode: row.reason ?? null,
          evaluationVersion: row.evaluationVersion ?? 'legacy',
          featureSnapshotRef: row.id,
        });
    }
    row.status = 'RESOLVED';
    row.revision++;
    row.resolution = { requestId, digest, decision, selectedSourceIds };
    await this.store.put('reviews', row.id, row);
    return row;
  }

  async decide(key: string, body: any, status: 'APPROVED' | 'REJECTED') {
    const requestId = automationRequestId(body?.requestId);
    const row = await this.video(key);
    if (
      row.decision?.requestId === requestId &&
      (row.decision.status !== status || row.decision.version !== body?.version)
    )
      throw new ConflictException('AUTOMATION_REQUEST_ID_CONFLICT');
    if (row.currentVersion !== body?.version)
      throw new ConflictException('STALE_REVISION');
    await this.recordFeedback(requestId, {
      action: status === 'APPROVED' ? 'APPROVE_VIDEO' : 'REJECT_VIDEO',
      rootSourceId: row.rootSourceId,
      sourceId: null,
      videoId: row.id,
      videoVersion: row.currentVersion,
      reasonCode: null,
      evaluationVersion:
        row.versions.find((version) => version.version === row.currentVersion)
          ?.evaluationVersion ?? 'legacy',
      featureSnapshotRef: row.id + ':' + row.currentVersion,
    });
    if (row.decision?.requestId !== requestId) {
      row.reviewStatus = status;
      row.decision = { status, requestId, version: body.version };
      await this.store.put('videos', row.id, row);
    }
    for (const review of await this.store.list<ReviewRequest>('reviews')) {
      if (
        review.videoId !== row.id ||
        review.videoVersion !== row.currentVersion ||
        review.status !== 'OPEN'
      )
        continue;
      review.status = 'RESOLVED';
      review.revision++;
      review.resolution = {
        requestId,
        digest: automationKey(status, body.version),
        decision: status,
      };
      await this.store.put('reviews', review.id, review);
    }
    return row;
  }
}
