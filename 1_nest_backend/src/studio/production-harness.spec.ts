import { describe, expect, it, jest } from '@jest/globals';
import { mkdtemp } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { createHash } from 'crypto';
import { StudioJobs } from './progress';
import { assertRenderable, avatarState, sourceBlockers } from './production-contract';
import { operatorBoundary, ProductionHarness } from './production-harness';
import { prepareTtsInput } from './speech-normalizer';

function rootSession(): any {
  const url = 'https://www.threads.com/@demo/post/DeI-TuzEc_9';
  const text = 'Mình học đại học và làm việc ở quê.';
  return {
    id: '10000000-0000-4000-8000-000000000000', revision: 1,
    project: { style: 'SERIOUS' },
    items: [{
      id: '20000000-0000-4000-8000-000000000000', selected: true,
      sourceReference: { entityType: 'POST', entityId: 'source' },
      sourceUrl: url, displayText: text, originalText: text, spokenText: text,
      author: { handle: 'demo' },
      rawExtraction: { url, text, handle: 'demo', provenance: { text: 'fixture' } },
    }],
  };
}

describe('Production Harness runtime', () => {
  it('accepts root-only content and distinguishes evidenced default from unavailable avatar', () => {
    const s = rootSession(), item = s.items[0];
    expect(sourceBlockers(s)).toEqual([]);
    expect(avatarState(item)).toBe('AVATAR_UNAVAILABLE');
    item.rawExtraction.avatar = 'https://static.cdninstagram.com/rsrc.php/default_profile.png';
    expect(avatarState(item)).toBe('DEFAULT_AVATAR');
    item.spokenText += ' Xin hãy theo dõi kênh.';
    expect(sourceBlockers(s).join()).toContain('EDITORIAL_SCENE_NOT_VERBATIM');
  });

  it('blocks commentary, external subtitles and missing measured voice at render time', () => {
    const s = rootSession(), i = s.items[0];
    i.editorial = { kind: 'COMMENTARY', stage: 'HOOK' };
    const props: any = { audioAssets: [], mediaAssets: [], timeline: {
      introDurationInFrames: 2, scenes: [{ subtitles: [{}], scene: {
        id: i.id, displayText: i.displayText, narrationText: i.spokenText,
        sourceReferences: [i.sourceReference], subtitles: [],
        styleProperties: { style: 'SERIOUS', cardMode: 'POST' },
      } }],
    } };
    expect(() => assertRenderable(s, props)).toThrow(/EDITORIAL_SCENE_NOT_VERBATIM.*INTRO_OUTRO_FORBIDDEN.*SUBTITLES_FORBIDDEN.*CURRENT_MEASURED_AUDIO_REQUIRED/);
  });

  it('permits a short root-only timeline with current measured narration', () => {
    const s = rootSession(), i = s.items[0], tts = prepareTtsInput(i.spokenText);
    i.automaticNormalization = { ttsInputHash: tts.ttsInputHash, ambiguousTerms: [] };
    i.voiceSettings = { voice: 'my_yen', speed: 1.2 };
    s.voiceAssets = [{ id: 'wav', itemId: i.id, ...i.voiceSettings, status: 'GENERATED',
      durationMs: 3000, durationEvidence: 'FFPROBE', ttsInputHash: tts.ttsInputHash,
      textHash: createHash('sha256').update(i.spokenText).digest('hex') }];
    expect(() => assertRenderable(s, { audioAssets: [], mediaAssets: [], timeline: {
      totalFrames: 90, scenes: [{ audioDurationMs: 3000, subtitles: [], scene: {
        id: i.id, displayText: i.displayText, narrationText: i.spokenText,
        sourceReferences: [i.sourceReference], subtitles: [], audioAssetId: 'wav',
        styleProperties: { style: 'SERIOUS', cardMode: 'POST' },
      } }],
    } } as any)).not.toThrow();
  });

  it('rejects legacy publishing routes even with the Operator credential', () => {
    const oldMode = process.env.STUDIO_OPERATOR_ONLY, oldToken = process.env.STUDIO_OPERATOR_TOKEN;
    process.env.STUDIO_OPERATOR_ONLY = '1';
    process.env.STUDIO_OPERATOR_TOKEN = 'synthetic-fixture-value-for-local-tests';
    try {
      const json = jest.fn(), next = jest.fn(), status = jest.fn((_code: number) => ({ json }));
      const req: any = { url: '/api/studio/tiktok/oauth/start', path: '/api/studio/tiktok/oauth/start',
        method: 'POST', get: () => 'Bearer ' + process.env.STUDIO_OPERATOR_TOKEN };
      operatorBoundary(req, { status } as any, next);
      expect(status).toHaveBeenCalledWith(403);
      expect(next).not.toHaveBeenCalled();
      req.path = req.url = '/api/studio/operator/tools';
      operatorBoundary(req, { status } as any, next);
      expect(next).toHaveBeenCalledTimes(1);
    } finally {
      if (oldMode === undefined) delete process.env.STUDIO_OPERATOR_ONLY;
      else process.env.STUDIO_OPERATOR_ONLY = oldMode;
      if (oldToken === undefined) delete process.env.STUDIO_OPERATOR_TOKEN;
      else process.env.STUDIO_OPERATOR_TOKEN = oldToken;
    }
  });

  it('uses StudioJobs for stage preconditions, telemetry, idempotency and recovery', async () => {
    const store = await mkdtemp(join(tmpdir(), 'operator-harness-test-'));
    const session = rootSession(), jobs = new StudioJobs(store);
    const mutate = jest.fn(async (_id: string, body: any) => {
      Object.assign(session.items[0], body.items[0]);
      return session;
    });
    const studio = { jobs, load: async () => session, mutate };
    const harness = new ProductionHarness(studio as any, null, null, null);
    const input = { requestId: 'prepare-1', sessionId: session.id, revision: 1 };
    await expect(harness.run('publish', input)).rejects.toThrow('OPERATOR_CAPABILITY_DENIED');
    const result = await harness.run('prepare', input);
    const wait = async (id: string) => {
      for (let i = 0; i < 100; i++) {
        const job = await harness.job(id);
        if (!['QUEUED','RUNNING'].includes(job.status)) return job;
        await new Promise(resolve => setTimeout(resolve, 10));
      }
      throw Error('Fixture job never finished');
    };
    const failed = await wait(result.jobId);
    expect(failed.status).toBe('FAILED');
    expect(failed.error).toContain('CURRENT_MEASURED_AUDIO_REQUIRED');
    expect(failed.elapsedMs).toBeGreaterThanOrEqual(0);
    expect(failed.heartbeatAt).toBeTruthy();
    expect((await harness.run('prepare', input)).jobId).toBe(result.jobId);
    const retry = await harness.run('prepare', { ...input, requestId: 'prepare-2' });
    expect((await wait(retry.jobId)).attemptNumber).toBe(2);
    await expect(harness.run('prepare', { ...input, requestId: 'prepare-3' }))
      .rejects.toThrow('OPERATOR_ATTEMPT_LIMIT');
    const reopened = new ProductionHarness({ ...studio, jobs: new StudioJobs(store) } as any, null, null, null);
    expect((await reopened.job(retry.jobId)).status).toBe('FAILED');
    const item = session.items[0];
    const pronunciation = await harness.run('pronunciation', {
      ...input, requestId: 'voice-1', itemId: item.id, term: 'đại', reading: 'đại',
    });
    expect((await wait(pronunciation.jobId)).status).toBe('SUCCEEDED');
    expect(item.originalText).toBe('Mình học đại học và làm việc ở quê.');
    expect(item.displayText).toBe(item.originalText);
    expect(item.pronunciationOverrides).toEqual({ đại: 'đại' });
  });
});
