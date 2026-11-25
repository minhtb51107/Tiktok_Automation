import { describe, expect, it, jest } from '@jest/globals';
import { mkdir, mkdtemp, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { createHash } from 'crypto';
import { StudioJobs } from './progress';
import { assertRenderable, avatarState, sourceBlockers } from './production-contract';
import { operatorBoundary, operatorFailure, ProductionHarness } from './production-harness';
import { prepareTtsInput } from './speech-normalizer';
import { StudioService } from './studio.service';
import { editorialFixture } from '../data-engine/editorial-test.fixture';

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
  it('classifies historical and runtime failures without echoing the underlying message', () => {
    const stage = 'GENERATING_AUDIO';
    for (const [raw, code] of [
      ['Unknown Kokoro voice', 'VOICE_UNAVAILABLE'],
      ['BLOCKED_RUNTIME: unavailable', 'RUNTIME_UNAVAILABLE'],
      ['RESOURCE_GUARD_STOP', 'RESOURCE_BLOCKED'],
      ['TIMEOUT', 'TIMEOUT'],
      ['Kokoro inference failed', 'INFERENCE_FAILED'],
      ['Operation failed: invalid request', 'VALIDATION_ERROR'],
    ]) {
      const out = operatorFailure(raw + ' bearer=private-fixture', stage, 2);
      expect(out).toMatchObject({errorCode:code, failedStage:stage, retryable:false});
      expect(JSON.stringify(out)).not.toContain('private-fixture');
    }
  });

  it('runs create, normalize, pronunciation, new DRAFT audio and cache through real Studio services with a mocked Kokoro worker', async () => {
    const root = await mkdtemp(join(tmpdir(), 'operator-voice-integration-'));
    const studio = new StudioService(null);
    const jobs = new StudioJobs(join(root,'jobs'));
    const runtime = {status:'READY', blockers:[], declaredVoices:[{id:'my_yen'}],
      model:'fixture', modelVersion:'fixture', packageVersion:'fixture'};
    const preflight = jest.fn(async () => runtime as any);
    const generate = jest.fn(async (id: string) => {
      const rel = `audio/${id}/assets/fixture.wav`;
      await mkdir(join(root, 'audio',id,'assets'), {recursive:true});
      await writeFile(join(root,rel), Buffer.alloc(128));
      return {filePath:rel, durationMs:200, durationEvidence:'FFPROBE', cacheKey:'fixture', cacheHit:false};
    });
    Object.assign(studio, {root, jobs, voice:{preflight, generate}});
    const f = editorialFixture('Mình học đại học và làm việc ở quê.', 'Mình từng học cùng các bạn và có thêm nhiều cơ hội học tiếp.');
    f.collection.root.provenance.synthetic = false;
    f.collection.replies[0].provenance.synthetic = false;
    const collectionId = 'a'.repeat(64);
    const review = {schemaVersion:'threads-data/1',collectionId,revision:1,selectedReplyIds:[],replyLabels:{},decision:'NEEDS_REVIEW',reason:'fixture',history:[]};
    Object.assign(f.quality.replyQuality[0], {label:'LOW_INFORMATION'});
    const conversations = {engine:{collection:async()=>({collection:f.collection,evaluation:f.quality}),review:async()=>review}};
    const harness = new ProductionHarness(studio, null, conversations as any, {evaluator:{list:async()=>[]}} as any);
    const old = process.env.STUDIO_OPERATOR_TTS;
    process.env.STUDIO_OPERATOR_TTS='1';
    const finish = async (tool: string, input: any) => {
      const initial = await harness.run(tool,input);
      for (let i=0; i<100; i++) {
        const j=await harness.job(initial.jobId);
        if (!['QUEUED','RUNNING'].includes(j.status)) return j;
        await new Promise(resolve=>setTimeout(resolve,10));
      }
      throw Error('fixture job did not complete');
    };
    try {
      const created = await finish('create_draft', {requestId:'create-a', collectionId, replyIds:['REPLY']});
      expect(created.status).toBe('SUCCEEDED');
      const s = await studio.load((created.result as any).sessionId);
      expect(s.voiceRuntime).toBeUndefined();
      const item = s.items.find(row => row.selected)!;
      const bytes = Buffer.from('test cached source image');
      const hash = createHash('sha256').update(bytes).digest('hex');
      const avatar = 'https://example.cdninstagram.com/avatar.jpg';
      item.author.avatarUrl = avatar;
      s.sourceImages = {[item.id]: { itemId:item.id, sourceUrl:avatar, provenance:'PUBLIC_CDN',
        uri:'/fixture', status:'READY', sha256:hash,fileName:hash+'.jpg', checkedAt:'fixture', error:null }};
      await mkdir(join(root,'source-images',s.id), {recursive:true});
      await writeFile(join(root,'source-images',s.id,hash+'.jpg'),bytes);
      await writeFile(join(root,s.id+'.json'),JSON.stringify(s));
      const other = await finish('create_draft', {requestId:'create-root', collectionId, replyIds:[]});
      const draft = await studio.load((other.result as any).sessionId);
      const target = draft.items.find(row => row.selected)!;
      expect(draft.sourceImages?.[target.id]?.sha256).toBe(hash);
      expect(target.id).not.toBe(item.id);
      const fields = {sessionId:draft.id, revision:draft.revision};
      const normalized = await finish('normalize', {...fields,requestId:'norm'});
      const pronunciation = await finish('pronunciation',{...fields,revision:normalized.revision,
        requestId:'pron',itemId:target.id,term:'quê',reading:'quê'});
      expect(pronunciation.status).toBe('SUCCEEDED');
      const renorm = await finish('normalize',{...fields,revision:pronunciation.revision,requestId:'norm2'});
      const input = {...fields,revision:renorm.revision,requestId:'audio1',itemId:target.id};
      const audio = await finish('audio',input);
      expect(audio.status).toBe('SUCCEEDED');
      expect(generate).toHaveBeenCalledTimes(1);
      const persisted = await studio.load(draft.id);
      expect(persisted.voiceAssets?.[0]).toMatchObject({purpose:'DRAFT', status:'GENERATED', durationEvidence:'FFPROBE'});
      expect(persisted.items.find(row=>row.id===target.id)?.spokenApproval?.valid).not.toBe(true);
      const cache = await finish('audio',{...input,revision:audio.revision,requestId:'audio-cache'});
      expect(cache.result).toMatchObject({cacheHit:true,assetId:(audio.result as any).assetId});
      expect(generate).toHaveBeenCalledTimes(1);
      await expect(studio.voiceAction(s.id,item.id,{revision:s.revision,action:'GENERATE',voice:'bad',speed:1.2,draft:true}))
        .rejects.toThrow('Unknown Kokoro voice');
      preflight.mockResolvedValueOnce({...runtime,status:'BLOCKED_RUNTIME',declaredVoices:[],blockers:['Python unavailable']});
      const unavailable = await studio.voiceAction(s.id,item.id,{revision:s.revision,action:'GENERATE',voice:'my_yen',speed:1.2,draft:true});
      expect(unavailable.voiceJobs?.slice(-1)[0]?.error).toContain('BLOCKED_RUNTIME');
      expect(generate).toHaveBeenCalledTimes(1);
    } finally {
      if (old === undefined) delete process.env.STUDIO_OPERATOR_TTS;
      else process.env.STUDIO_OPERATOR_TTS=old;
    }
  });
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
