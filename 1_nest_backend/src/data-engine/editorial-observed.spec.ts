import { afterEach, beforeEach, describe, expect, test } from '@jest/globals';
import { mkdtemp, rm } from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { DataStore } from './store';
import { DataEngine } from './engine';
import { ConversationEngine } from './conversation-engine';
import { EditorialEngine } from './editorial-engine';
import { editorialFixture } from './editorial-test.fixture';
import { TEST_COMMENTARY } from './editorial-test.fixture';
import { ProductionConsumer } from './production-consumer';
import { StudioService } from '../studio/studio.service';
import { productionSession } from './production-adapter';

describe('DATA05 explicit exception-review context editorial bridge', () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(path.join(os.tmpdir(), 'editorial-observed-'));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  test('keeps same-page membership UNKNOWN while allowing an explicit DRAFT selection', async () => {
    const data = new DataEngine(new DataStore(path.join(dir, 'data')));
    const fixture = editorialFixture();
    const observedUrl = 'https://www.threads.com/@observer/post/OBSERVED';
    fixture.collection.unverified.push({
      url: observedUrl,
      reason: 'Relationship unavailable',
      observation: {
        level: 'OBSERVED_ON_TARGET_PAGE',
        targetUrl: fixture.collection.root.url,
        observedAt: fixture.collection.completedAt,
        author: { handle: 'observer', name: null },
        originalText:
          'Tôi quan sát được một góc nhìn khác trong cùng trang đích, nhưng quan hệ cha con chưa được chứng minh.',
      },
    });
    fixture.collection.unverifiedCandidateCount = 1;
    const conversations = new ConversationEngine(data, {
      execution: 'SYNTHETIC',
      discover: async () => [],
      enrich: async () => fixture.collection,
    });
    const run = await conversations.start({
      requestId: 'observed-fixture',
      urls: [fixture.collection.root.url],
    });
    const collectionId = run.results[0].collectionId;
    const review = await conversations.feedback(collectionId, {
      requestId: 'explicit-observed-selection',
      revision: 0,
      selectedReplyIds: [],
      selectedObservedUrls: [observedUrl],
      decision: 'NEEDS_REVIEW',
      reason: 'Synthetic editorial selection; relationship remains unverified',
    });
    const editorial = new EditorialEngine(conversations);
    const plan = await editorial.create({
      collectionId,
      selectionRevision: review.revision,
      selectionConfirmed: true,
      requestId: 'observed-plan',
      style: 'SERIOUS',
      mode: 'COMMENTARY_ENABLED',
    });
    expect(plan.selectedReplyIds).toEqual([]);
    expect(plan.selectedObservedUrls).toEqual([observedUrl]);
    const section = plan.sections.find((row) => row.id === 'observed-OBSERVED');
    expect(section).toMatchObject({
      sourceId: 'OBSERVED',
      parentId: null,
      permalink: observedUrl,
      sourceEvidence: 'UNKNOWN_CONVERSATION_MEMBERSHIP',
    });
    expect(plan.feasibility.missingEvidence).toContain(
      'UNKNOWN_CONVERSATION_MEMBERSHIP_REQUIRES_EXCEPTION_REVIEW',
    );
    expect(plan.bundle.collection.unverified[0].observation?.originalText).toBe(
      fixture.collection.unverified[0].observation?.originalText,
    );
    const edited = await editorial.save(plan.id, {
      revision: plan.revision,
      sections: plan.sections.map((row) =>
        row.kind !== 'COMMENTARY'
          ? row
          : {
              ...row,
              displayText:
                row.stage === 'HOOK'
                  ? 'Một góc nhìn xuất hiện trên trang đích có thực sự trả lời câu hỏi của bài viết hay chỉ là nội dung được đề xuất?'
                  : row.stage === 'RESOLUTION'
                    ? 'Người xem cần phân biệt giá trị nội dung với bằng chứng quan hệ nguồn trước khi kết luận.'
                    : TEST_COMMENTARY,
              narrationText:
                row.stage === 'HOOK'
                  ? 'Một góc nhìn xuất hiện trên trang đích có thực sự trả lời câu hỏi của bài viết hay chỉ là nội dung được đề xuất?'
                  : row.stage === 'RESOLUTION'
                    ? 'Người xem cần phân biệt giá trị nội dung với bằng chứng quan hệ nguồn trước khi kết luận.'
                    : TEST_COMMENTARY,
            },
      ),
    });
    expect(edited.feasibility.status).toBe('READY_FOR_SCRIPT');
    expect(edited.feasibility.missingEvidence).toContain(
      'UNKNOWN_CONVERSATION_MEMBERSHIP_REQUIRES_EXCEPTION_REVIEW',
    );
    const sourceLink = edited.bundle.sourceLink!;
    let detail = await data.detail(sourceLink.postId);
    detail = await data.review(
      sourceLink.postId,
      detail.evaluation!.revision,
      'ACCEPT',
      'Synthetic DATA-01 review; separate from relationship evidence',
      'POST',
    );
    await data.enqueue(sourceLink.postId, detail.evaluation!.revision);
    detail = await data.detail(sourceLink.postId);
    const studio = new StudioService({} as any);
    (studio as any).root = path.join(dir, 'sessions');
    const production = new ProductionConsumer(data, studio);
    const job = await editorial.handoff(
      edited.id,
      {
        planRevision: edited.revision,
        confirmDraftCreation: true,
        postId: sourceLink.postId,
        evaluationId: detail.evaluation!.id,
        queueId: detail.evaluation!.queue!.id,
        revision: detail.evaluation!.revision,
        requestId: 'observed-production',
      },
      (input, snapshot) => production.start(input, snapshot),
    );
    expect(job.snapshot.editorial?.plan.selectedReplyIds).toEqual([]);
    if (job.status !== 'SUCCEEDED') productionSession(job);
    expect(job).toMatchObject({ status: 'SUCCEEDED', error: null });
    const session = await studio.load(job.projectId!);
    expect(session.project.comments).toEqual([
      expect.objectContaining({
        sourceId: 'OBSERVED',
        relationshipStatus: 'OBSERVED_ON_TARGET_PAGE',
        observedTargetUrl: fixture.collection.root.url,
      }),
    ]);
    expect(
      session.items.find((item) => item.sourceId === 'OBSERVED')?.editorial
        ?.sourceEvidence,
    ).toBe('UNKNOWN_CONVERSATION_MEMBERSHIP');
    expect(
      session.productionOrigin?.conversation?.selectedObservedUrls,
    ).toEqual([observedUrl]);
    expect((await studio.load(session.id)).project.editorialPlan?.id).toBe(
      edited.id,
    );
    const idempotent = await studio.applyEditorialDraft(
      session.id,
      session.revision,
      edited,
    );
    expect(idempotent.revision).toBe(session.revision);
    const revised = structuredClone(edited);
    revised.revision++;
    revised.sections = revised.sections.map((row) =>
      row.id === 'commentary'
        ? {
            ...row,
            displayText: row.displayText + ' Bản sửa.',
            narrationText: row.narrationText + ' Bản sửa.',
          }
        : row,
    );
    const reapplied = await studio.applyEditorialDraft(
      session.id,
      session.revision,
      revised,
    );
    expect(reapplied.id).toBe(session.id);
    expect(reapplied.revision).toBe(session.revision + 1);
    expect(
      (await studio.load(session.id)).project.editorialPlan?.revision,
    ).toBe(revised.revision);
  });
});
