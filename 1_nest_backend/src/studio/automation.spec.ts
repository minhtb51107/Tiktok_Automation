import { afterEach, beforeEach, expect, it, jest } from '@jest/globals';
import { promises as fs } from 'fs';
import * as path from 'path';
import { tmpdir } from 'os';
import { AutomationStore } from './automation.store';
import {
  AutomationService,
  productionUsage,
  productionWindow,
} from './automation.service';
import { AutomationReviewService } from './automation-review.service';
import {
  defaultAutomationPolicy,
  type ProductionDay,
  type ReviewRequest,
} from './automation.types';
import { ProductPipelineService } from './product-pipeline';

let root: string;
const keys = [
  'STUDIO_AUTOMATION_ENABLED',
  'STUDIO_AUTOMATION_TOKEN',
  'STUDIO_OPERATOR_ONLY',
  'STUDIO_PRODUCT_AUTOMATION_LIVE_ENABLED',
  'STUDIO_DATA_QUALITY_LIVE_ENABLED',
  'STUDIO_DATA04_LIVE_ENABLED',
];
let previous: Record<string, string | undefined>;
beforeEach(async () => {
  root = await fs.mkdtemp(path.join(tmpdir(), 'local-production-'));
  previous = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
  for (const key of keys) process.env[key] = '1';
  process.env.STUDIO_AUTOMATION_TOKEN = 'x'.repeat(32);
  process.env.STUDIO_OPERATOR_ONLY = '0';
});
afterEach(async () => {
  for (const [key, value] of Object.entries(previous))
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  await fs.rm(root, { recursive: true, force: true });
});

function store() {
  return Object.assign(new AutomationStore(), { root });
}

it('assigns pre- and post-midnight to the same Vietnam overnight window', () => {
  const s = defaultAutomationPolicy().schedule;
  expect(productionWindow(new Date('2026-11-26T16:10:00Z'), s)).toEqual({
    dayKey: '2026-11-26',
    open: true,
  });
  expect(productionWindow(new Date('2026-11-26T23:10:00Z'), s)).toEqual({
    dayKey: '2026-11-26',
    open: true,
  });
  expect(productionWindow(new Date('2026-11-27T00:00:00Z'), s)).toEqual({
    dayKey: '2026-11-27',
    open: false,
  });
});

it('blocks a second data-root owner and releases the OS lock', async () => {
  const first = store(),
    second = store();
  try {
    await first.claim();
    await expect(second.claim()).rejects.toThrow(
      'AUTOMATION_RUNTIME_ALREADY_OWNED',
    );
    await first.release();
    await second.claim();
  } finally {
    await first.release();
    await second.release();
  }
});

it('reserves before dispatch, reconciles a crash, and drains without new work', async () => {
  const db = store(),
    batches: any[] = [];
  let active = false,
    interrupted = true;
  const start = jest.fn(async (body: any) => {
    if (interrupted) {
      interrupted = false;
      throw Error('STAGED_CRASH');
    }
    const batch = {
      id: 'batch-a',
      dispatchRequestId: body.requestId,
      status: 'RUNNING',
      results: [],
      errors: [],
    };
    batches.push(batch);
    active = true;
    return batch;
  });
  const studio = { hasHeavyWorker: () => false };
  const execution = {
    listAuto: async () => batches,
    hasActiveAuto: () => active,
    productionLiveAuthorized: () => true,
    startAuto: start,
  };
  const fake = () => {
    const service = new AutomationService(
      db,
      new AutomationReviewService(db, studio as any),
      execution as any,
      studio as any,
    );
    Object.assign(service, { owned: true, runtimePreflight: async () => true });
    return service;
  };
  const before = fake(),
    date = new Date('2026-11-26T16:20:00Z');
  await before.tick(date);
  expect(start).not.toHaveBeenCalled();
  const p = await before.configure(
    { requestId: 'configure', revision: 0, policy: { topics: ['công việc'] } },
    'PATCH',
  );
  await before.configure(
    { requestId: 'enable', revision: p.revision },
    'START',
  );
  await expect(before.tick(date)).rejects.toThrow('STAGED_CRASH');
  const ledger = await db.day('2026-11-26', date.toISOString());
  expect(ledger.reservations[0].status).toBe('RESERVED');
  const restarted = fake();
  await restarted.tick(new Date('2026-11-26T23:00:00Z'));
  expect(start).toHaveBeenCalledTimes(2);
  expect(start.mock.calls.map((call) => call[0].requestId)).toEqual([
    ledger.reservations[0].requestId,
    ledger.reservations[0].requestId,
  ]);
  expect(
    (await restarted.configure({ requestId: 'off', revision: 2 }, 'STOP')).mode,
  ).toBe('DRAINING');
  await restarted.tick(date);
  expect((await restarted.policy()).mode).toBe('DRAINING');
  batches[0].status = 'FAILED';
  active = false;
  await restarted.tick(date);
  expect((await restarted.policy()).mode).toBe('DISABLED');
  expect(
    productionUsage(await db.day('2026-11-26', date.toISOString())).attempts,
  ).toBe(1);
  expect(start).toHaveBeenCalledTimes(2);
});

it('retains persisted limits and fails closed on corrupt policy', async () => {
  const db = store();
  await db.savePolicy({ ...defaultAutomationPolicy(), dailyVideoLimit: 1 });
  expect((await store().policy()).dailyVideoLimit).toBe(1);
  await fs.writeFile(path.join(root, 'policy.json'), '{ broken');
  await expect(store().policy()).rejects.toThrow('AUTOMATION_CORRUPT_STATE');
});

it('uses explicit request identity across days and prevents concurrent batch IDs', async () => {
  const pipeline = new ProductPipelineService(
    { hasHeavyWorker: () => false } as any,
    null,
    null,
    null,
    {} as any,
  );
  Object.assign(pipeline, {
    root,
    scheduleAuto: (id: string) => (pipeline as any).autoRunning.add(id),
  });
  const input = { topic: 'công việc', confirmLive: true, requestId: 'day-1' };
  const dispatch = {
    preset: '1080P60' as const,
    aiRequestLimit: 10,
    reviewBeforeRender: false,
    dayKey: '2026-11-26',
  };
  const a = await pipeline.startAuto(input, dispatch);
  expect((await pipeline.startAuto(input, dispatch)).id).toBe(a.id);
  await expect(
    pipeline.startAuto({ ...input, topic: 'concert' }, dispatch),
  ).rejects.toThrow('AUTOMATION_REQUEST_ID_CONFLICT');
  await expect(
    pipeline.startAuto({ ...input, requestId: 'day-2' }, dispatch),
  ).rejects.toThrow('RESOURCE_BLOCKED');
  (pipeline as any).autoRunning.clear();
  expect(
    (
      await pipeline.startAuto(
        { ...input, requestId: 'day-2' },
        { ...dispatch, dayKey: '2026-11-27' },
      )
    ).id,
  ).not.toBe(a.id);
});

it('rejects stale numbered responses before attempting a source mutation', async () => {
  const db = store(),
    studio = { load: async () => ({ revision: 9 }), mutate: jest.fn() };
  const service = new AutomationReviewService(db, studio as any);
  const review: ReviewRequest = {
    schemaVersion: 'automation-review/1',
    id: 'review',
    shortId: 'review',
    revision: 1,
    type: 'SELECT_REPLIES',
    batchId: 'batch',
    sessionId: 'session',
    sourceRevision: 8,
    options: [{ number: 1, preview: 'fixture', sourceId: 'old-reply' }],
    status: 'OPEN',
    createdAt: new Date().toISOString(),
    expiresAt: null,
  };
  await db.put('reviews', 'review', review);
  await expect(
    service.resolve('review', {
      requestId: 'discord-123',
      revision: 1,
      decision: 'SELECT',
      numbers: [1],
    }),
  ).rejects.toThrow('STALE_REVIEW');
  expect(studio.mutate).not.toHaveBeenCalled();
});
import {
  AutomationDiscordAdapter,
  authorizedAutomationMessage,
} from './automation-discord';

it('rejects unauthorized Discord authors and deduplicates accepted message IDs', async () => {
  const db = store(),
    configure = jest.fn(async () => ({ mode: 'ENABLED', dailyVideoLimit: 3 }));
  const api = { policy: async () => defaultAutomationPolicy(), configure };
  const adapter = new AutomationDiscordAdapter(api as any, db);
  const policy = { user: 'user', guild: 'guild', channel: 'channel' };
  Object.assign(adapter, { policy });
  const reply = jest.fn(async () => null),
    message = {
      id: 'command-1',
      content: '!auto on',
      author: { id: 'other' },
      guildId: 'guild',
      channelId: 'channel',
      reply,
    };
  expect(authorizedAutomationMessage(message, policy)).toBe(false);
  await adapter.message(message as any);
  expect(configure).not.toHaveBeenCalled();
  message.author.id = 'user';
  await Promise.all([
    adapter.message(message as any),
    adapter.message(message as any),
  ]);
  expect(configure).toHaveBeenCalledTimes(1);
  expect(reply).toHaveBeenCalledTimes(1);
});

it('reattaches to a submitted render without submitting another job', async () => {
  const render = { jobId: 'render-a' },
    submit = jest.fn();
  const jobs = { findRequest: async () => render, submit };
  const pipeline = new ProductPipelineService(
    { jobs } as any,
    null,
    null,
    null,
  );
  expect(
    await pipeline.renderPreparedDraft(
      { id: 'session' } as any,
      '1080P60',
      'same-request',
    ),
  ).toBe(render);
  expect(submit).not.toHaveBeenCalled();
});

it('enforces the independent daily rerender cap before editing any session', async () => {
  const db = store(),
    policy = {
      ...defaultAutomationPolicy(),
      mode: 'ENABLED' as const,
      schedule: { ...defaultAutomationPolicy().schedule, enabled: false },
      dailyRerenderLimit: 0,
    };
  await db.savePolicy(policy);
  const studio = { load: jest.fn() };
  const review = { video: async () => ({ id: 'v' }) };
  const pipeline = { productionLiveAuthorized: () => true };
  const service = new AutomationService(
    db,
    review as any,
    pipeline as any,
    studio as any,
  );
  Object.assign(service, { owned: true });
  await expect(
    service.revise('v', {
      requestId: 'rerender',
      sourceId: 'reply',
      version: 1,
    }),
  ).rejects.toThrow('DAILY_LIMIT_REACHED');
  expect(studio.load).not.toHaveBeenCalled();
});
import { createHash } from 'crypto';
import { prepareTtsInput } from './speech-normalizer';
import { currentNarration } from './production-contract';

it.each([true, false])(
  'keeps the old MP4 and WAVs through a revision with valid probe %s',
  async (validProbe) => {
    const db = store(),
      player = defaultAutomationPolicy();
    const policy = {
      ...player,
      mode: 'ENABLED' as const,
      schedule: { ...player.schedule, enabled: false },
    };
    await db.savePolicy(policy);
    const sessionId = '11111111-1111-4111-8111-111111111111',
      url = 'https://www.threads.com/@root/post/ROOT';
    const items = ['ROOT', 'KEEP', 'REMOVE'].map((id, order) => {
      const text = [
          'Câu chuyện từ tác giả',
          'Trải nghiệm làm nghề',
          'Góc nhìn thứ ba',
        ][order],
        sourceUrl = order ? 'https://www.threads.com/@reply/post/' + id : url;
      const ttsInputHash = prepareTtsInput(text).ttsInputHash;
      return {
        id,
        order,
        selected: true,
        displayText: text,
        originalText: text,
        spokenText: text,
        sourceId: id,
        sourceReference: {
          entityId: id,
          entityType: order ? 'COMMENT' : 'POST',
        },
        sourceUrl,
        rawExtraction: {
          url: sourceUrl,
          text,
          handle: order ? 'reply' : 'root',
        },
        author: { handle: order ? 'reply' : 'root' },
        automaticNormalization: { ttsInputHash, ambiguousTerms: [] },
        observationEvidence: { level: 'PARENT_VERIFIED', targetUrl: url },
        voiceSettings: { voice: 'my_yen', speed: 1.3 },
      };
    });
    const voiceAssets = items.map((x) => ({
      id: 'wav-' + x.id,
      itemId: x.id,
      durationMs: 30500,
      durationEvidence: 'FFPROBE',
      status: 'GENERATED',
      voice: 'my_yen',
      speed: 1.3,
      ttsInputHash: x.automaticNormalization.ttsInputHash,
      textHash: createHash('sha256').update(x.spokenText).digest('hex'),
    }));
    const session: any = {
      id: sessionId,
      revision: 1,
      title: 'fixture',
      items,
      voiceAssets,
      project: { style: 'SERIOUS' },
    };
    const oldFile = path.join(root, 'old.mp4'),
      newFile = path.join(root, 'new.mp4');
    await fs.writeFile(oldFile, 'old-artifact');
    await fs.writeFile(newFile, 'new-artifact');
    const rootSha = createHash('sha256').update('old-artifact').digest('hex');
    const manifest = (jobId: string) => ({
      sessionId,
      jobId,
      revision: jobId === 'old' ? 1 : 3,
      mode: 'DRAFT',
      preset: '1080P60',
      width: 1080,
      height: 1920,
      fps: 60,
      totalFrames: 3660,
      frameRange: [0, 3659],
      expectedDurationSeconds: 61,
      metrics: {},
      probe: {
        format: { duration: '61' },
        streams: [
          {
            codec_type: 'video',
            codec_name: 'h264',
            width: 1080,
            height: 1920,
            avg_frame_rate: jobId === 'old' || validProbe ? '60/1' : '30/1',
            nb_read_frames: '3660',
            duration: '61',
          },
          { codec_type: 'audio', codec_name: 'aac', duration: '61' },
        ],
      },
    });
    const prepare = jest.fn(async () => {
      session.revision++;
    });
    const studio = {
      load: async () => session,
      hasHeavyWorker: () => false,
      withProductionWorker: async (work) => work(),
      mutate: async (_id: string, body: any) => {
        for (const x of items)
          x.selected = body.items.find((y) => y.id === x.id).selected;
        session.revision++;
        return session;
      },
      preparePreview: prepare,
      preview: async () => ({
        request: {
          inputProps: {
            audioAssets: [],
            mediaAssets: [],
            timeline: {
              totalFrames: 1830,
              fps: 30,
              scenes: items
                .filter((i) => i.selected)
                .map((i) => ({
                  audioDurationMs: 30500,
                  subtitles: [],
                  scene: {
                    id: i.id,
                    displayText: i.displayText,
                    narrationText: i.spokenText,
                    sourceReferences: [i.sourceReference],
                    styleProperties: { style: 'SERIOUS' },
                    audioAssetId: 'wav-' + i.id,
                    subtitles: [],
                  },
                })),
            },
          },
        },
      }),
      renders: {
        load: async (_id, jobId) => manifest(jobId),
        output: async (_id, jobId) => (jobId === 'old' ? oldFile : newFile),
      },
      jobs: {
        findRequest: async () => null,
        load: async () => ({ jobId: 'new', status: 'SUCCEEDED' }),
      },
    };
    const pipeline = {
      productionLiveAuthorized: () => true,
      hasActiveAuto: () => false,
      listAuto: async () => [],
      renderPreparedDraft: async () => ({ jobId: 'new', inputRevision: 3 }),
      waitStudioJob: async () => ({ status: 'SUCCEEDED' }),
    };
    const review = new AutomationReviewService(db, studio as any),
      service = new AutomationService(
        db,
        review,
        pipeline as any,
        studio as any,
      );
    Object.assign(service, { owned: true });
    await db.put('videos', 'video', {
      schemaVersion: 'automation-video/1',
      id: 'video',
      shortId: 'video',
      rootSourceId: 'ROOT',
      sessionId,
      currentVersion: 1,
      reviewStatus: 'APPROVED',
      createdAt: new Date().toISOString(),
      versions: [
        {
          version: 1,
          renderJobId: 'old',
          sessionRevision: 1,
          selectedSourceIds: ['ROOT', 'KEEP', 'REMOVE'],
          durationMs: 61000,
          preset: '1080P60',
          sha256: rootSha,
        },
      ],
    });
    await service.revise('video', {
      requestId: 'drop-one',
      version: 1,
      sourceId: 'REMOVE',
    });
    await service.tick();
    await (service as any).revisionWorker;
    const result = await review.video('video');
    expect(result.currentVersion).toBe(validProbe ? 2 : 1);
    expect(result.reviewStatus).toBe(validProbe ? 'PENDING' : 'APPROVED');
    expect(prepare).toHaveBeenCalledTimes(1);
    expect(currentNarration(session, items[1] as any)?.id).toBe('wav-KEEP');
    expect(session.voiceAssets).toBe(voiceAssets);
    const old = await service.artifact('video', 1);
    for await (const chunk of old.getStream())
      expect(chunk.toString()).toBe('old-artifact');
    if (validProbe) {
      const pending = (await service.reviews()).find(
        (row) => row.videoId === 'video' && row.videoVersion === 2,
      );
      const input = {
        requestId: 'approve-version-two',
        revision: pending.revision,
        decision: 'APPROVE',
      };
      const resolved = await service.resolve(pending.id, input);
      expect(resolved.status).toBe('RESOLVED');
      expect(await service.resolve(pending.id, input)).toEqual(resolved);
      expect((await review.video('video')).reviewStatus).toBe('APPROVED');
    }
  },
);
