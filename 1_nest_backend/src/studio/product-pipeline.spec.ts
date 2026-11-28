import { prepareTtsInput } from './speech-normalizer';
import { autonomousDiscoveryErrors, autonomousProductRequest, measuredMp4Duration, partitionAutomaticResumeResults, ProductPipelineService, productStageSnapshot, resumableAutomaticVoiceResult, seriousDraftDurationStatus } from './product-pipeline';
import { describe, expect, it, jest } from '@jest/globals';
import { mkdtemp, writeFile, rm } from 'fs/promises';
import * as os from 'os';
import * as path from 'path';

const session = (overrides: any = {}) => ({
  id: '00000000-0000-4000-8000-000000000001',
  title: 'Product flow',
  revision: 1,
  updatedAt: '2026-11-14T00:00:00.000Z',
  status: 'READY',
  errors: [],
  project: {
    contractVersion: '1.0',
    id: '00000000-0000-4000-8000-000000000001',
    style: 'SERIOUS',
    title: 'Product flow',
    sources: [],
    posts: [],
    comments: [],
    candidates: [],
    storyboard: [],
    audioAssets: [],
    mediaAssets: [],
    publishing: {
      title: '',
      caption: '',
      hashtags: [],
      language: 'vi',
      manualApprovalRequired: true,
    },
  },
  items: [],
  ...overrides,
});

describe('product pipeline snapshot', () => {
  it.each([
    [59.99, 'TOO_SHORT'],
    [60, 'PASS_BELOW_PREFERRED'],
    [65, 'PASS_PREFERRED'],
    [90, 'PASS_PREFERRED'],
    [90.001, 'TOO_LONG'],
  ] as const)('applies the SERIOUS DRAFT duration boundary at %s seconds', (seconds, expected) => {
    expect(seriousDraftDurationStatus(seconds)).toBe(expected);
  });

  it('uses the MP4 FFprobe duration as authoritative render duration', () => {
    expect(measuredMp4Duration({ probe: { format: { duration: '60.000000' } } })).toBe(60);
    expect(measuredMp4Duration({ probe: { format: { duration: '59.990000' } } })).toBe(59.99);
    expect(measuredMp4Duration({ probe: {} })).toBeNull();
  });

  it('bounds an autonomous SERIOUS DRAFT batch without widening production authority', () => {
    expect(autonomousProductRequest({ topic: 'công việc', targetVideos: 3 })).toMatchObject({
      style: 'SERIOUS', targetVideos: 3, maxCandidates: 30, maxEnrich: 10,
      voice: 'my_yen', speed: 1.3, keywords: ['công việc'], keywordExpansion: 'OFF',
    });
    expect(autonomousProductRequest({topic:'drama ca sĩ X',keywords:['ca sĩ X lên tiếng'],keywordExpansion:'EXPLICIT'}).keywords).toEqual(['drama ca sĩ X','ca sĩ X lên tiếng']);
    expect(autonomousProductRequest({topic:'review công ty Y'}).keywords).not.toEqual(expect.arrayContaining(['đi làm','công sở','nghề nghiệp']));
    expect(() => autonomousProductRequest({ topic: 'công việc', targetVideos: 4 })).toThrow('Invalid autonomous DRAFT request');
    expect(() => autonomousProductRequest({ topic: 'công việc', style: 'FUNNY' })).toThrow('Invalid autonomous DRAFT request');
  });

  it('preserves failed live discovery evidence instead of reporting an empty failure', () => {
    expect(autonomousDiscoveryErrors({
      status: 'PARTIAL', collections: [], errors: ['CONVERSATION_NAVIGATION_FAILED'],
      diagnosis: { stage: 'DISCOVERY', outcome: 'UNKNOWN' },
    })).toEqual(['CONVERSATION_NAVIGATION_FAILED', 'DISCOVERY_UNKNOWN_AT_DISCOVERY']);
  });
  it('re-evaluates only side-effect-free policy results on explicit resume', () => {
    const base = {
      sourceUrl: 'https://www.threads.com/@root/post/ROOT',
      collectionId: null,
      assessmentId: null,
      sessionId: null,
      renderJobId: null,
      selectedSourceIds: [],
      estimatedSeconds: null,
      measuredSeconds: null,
      timelineSeconds: null,
      warnings: [],
    } as any;
    const result = partitionAutomaticResumeResults([
      { ...base, status: 'NOT_ENOUGH_CONTENT' },
      { ...base, status: 'QUALITY_FAILED', collectionId: 'persisted' },
      { ...base, status: 'COMPLETED', sessionId: 'session' },
    ]);
    expect(result.retryable).toHaveLength(1);
    expect(result.retained.map((row) => row.status)).toEqual([
      'QUALITY_FAILED',
      'COMPLETED',
    ]);
  });
  it('resumes an existing DRAFT after either a TTS or resource stop', () => {
    const base = {
      sessionId: 'session',
      assessmentId: 'assessment',
    } as any;
    expect(
      resumableAutomaticVoiceResult({ ...base, status: 'TTS_FAILED' }),
    ).toBe(true);
    expect(
      resumableAutomaticVoiceResult({ ...base, status: 'RESOURCE_STOPPED' }),
    ).toBe(true);
    expect(
      resumableAutomaticVoiceResult({ ...base, status: 'COMPLETED' }),
    ).toBe(false);
  });
  it('resumes a TTS draft from current cached audio without repeating inference', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'product-voice-resume-'));
    try {
      const text = 'Nguồn thật đã chọn';
      const crypto = require('crypto');
      const url = 'https://www.threads.com/@root/post/ROOT';
      const ref = {entityId:'ROOT',entityType:'POST'};
      const ttsInputHash=prepareTtsInput(text).ttsInputHash;
      const audioFile=path.join(dir,'audio.wav');
      await writeFile(audioFile,Buffer.alloc(100));
      const active = session({
        id: '00000000-0000-4000-8000-000000000003',
        items: [
          {
            id: 'root',
            selected: true,
            spokenText: text, originalText:text, displayText:text,
            sourceReference:ref, sourceUrl:url, author:{handle:'root'},
            rawExtraction:{url,text,handle:'root'},
            voiceSettings:{voice:'my_yen',speed:1.3},
            automaticNormalization:{ttsInputHash,ambiguousTerms:[]},

            order: 0,
          },
        ],
        voiceAssets: [
          {
            id: 'audio',
            itemId: 'root',
            status: 'GENERATED',
            textHash: crypto.createHash('sha256').update(text).digest('hex'),
            durationMs: 59000, durationEvidence:'FFPROBE',ttsInputHash,voice:'my_yen',speed:1.3,
          },
        ],
        project: {
          ...session().project,
          timeline: {
            totalFrames: 1799,
            fps: 30,
            scenes: [{ scene: { id:'root',displayText:text,narrationText:text,subtitles:[],
              sourceReferences:[ref],styleProperties:{style:'SERIOUS'},audioAssetId:'audio' },
              subtitles:[],audioDurationMs:59000 }],
          },
        },
      });
      const studio: any = {
        jobs:{findRequest:async()=>null},
        audioFile:async()=>audioFile,
        restoreOperatorAvatars:async()=>active,
        preview:async()=>({request:{inputProps:{timeline:active.project.timeline,audioAssets:[],mediaAssets:[]}}}),
        load: jest.fn(async () => active),
        normalizeAutomaticDraft: jest.fn(async () => active),
        applyAutomaticSeriousAssets: jest.fn(async () => active),
        voiceAction: jest.fn(),
        preparePreview: jest.fn(async () => ({})),
      };
      const service = new ProductPipelineService(
        studio,
        {} as any,
        {} as any,
        {} as any,
      );
      (service as any).root = dir;
      const batch: any = {
        schemaVersion: 'product-auto-batch/1',
        id: '22222222-2222-4222-8222-222222222222',
        requestKey: 'key',
        request: autonomousProductRequest({ topic: 'công việc' }),
        status: 'RUNNING',
        stage: 'GENERATING_VOICE',
        discoveryRunId: 'run',
        results: [],
        errors: [],
        cancelRequested: false,
        startedAt: '2026-11-16T00:00:00Z',
        completedAt: null,
        createdAt: '2026-11-16T00:00:00Z',
        updatedAt: '2026-11-16T00:00:00Z',
      };
      const result: any = {
        sourceUrl: 'https://www.threads.com/@root/post/ROOT',
        collectionId: 'collection',
        assessmentId: 'assessment',
        sessionId: active.id,
        renderJobId: null,
        status: 'TTS_FAILED',
        selectedSourceIds: ['ROOT'],
        estimatedSeconds: { minimum: 65, maximum: 80 },
        measuredSeconds: null,
        timelineSeconds: null,
        warnings: ['prior runtime failure'],
      };
      batch.results.push(result);
      await (service as any).saveAuto(batch);
      await (service as any).continueAutomaticDraft(batch,result);
      expect(studio.normalizeAutomaticDraft).toHaveBeenCalledWith(
        active.id,
        active.revision,
      );
      expect(studio.applyAutomaticSeriousAssets).toHaveBeenCalledWith(
        active.id,
        active.revision,
      );
      expect(studio.voiceAction).not.toHaveBeenCalled();
      expect(result).toMatchObject({
        status: 'NOT_ENOUGH_CONTENT',
        measuredSeconds: 59,
        timelineSeconds: 1799/30,
      });
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
  it('never calls an observed context verified and waits for explicit review', () => {
    const value = productStageSnapshot(
      session({
        items: [
          {
            id: 'root',
            inclusion: 'TARGET',
            selected: true,
            spokenText: 'Root',
            order: 0,
          },
          {
            id: 'context',
            inclusion: 'EXPLICIT_CONTEXT',
            selected: false,
            spokenText: 'Observed',
            order: 1,
            observationEvidence: { level: 'OBSERVED_ON_TARGET_PAGE' },
          },
        ],
      }) as any,
      'SUCCEEDED',
      [],
    );
    expect(value.stages.SOURCE.status).toBe('COMPLETED');
    expect(value.stages.HUMAN_REVIEW.status).toBe('WAITING_USER');
    expect(value.stages.HUMAN_REVIEW.evidence).toContain('1/2 selected');
    expect(value.warnings.join(' ')).toContain('unverified');
  });

  it('uses measured current audio, saved timeline and real render evidence', () => {
    const text = 'Nội dung đã duyệt để dựng bản nháp';
    const crypto = require('crypto');
    const value = productStageSnapshot(
      session({
        items: [
          {
            id: 'root',
            inclusion: 'TARGET',
            selected: true,
            spokenText: text,
            order: 0,
          },
        ],
        voiceAssets: [
          {
            id: 'audio',
            itemId: 'root',
            status: 'GENERATED',
            textHash: crypto.createHash('sha256').update(text).digest('hex'),
            durationMs: 65000,
          },
        ],
        project: {
          ...session().project,
          timeline: { totalFrames: 2100, fps: 30, scenes: [{ scene: { id: 'root' } }] },
        },
      }) as any,
      'SUCCEEDED',
      [
        {
          jobId: 'render-1',
          status: 'COMPLETED',
          completedAt: '2026-11-14T01:00:00.000Z',
          expectedDurationSeconds: 70,
          width: 720,
          height: 1280,
        } as any,
      ],
    );
    expect(value.stages.VOICE.status).toBe('COMPLETED');
    expect(value.stages.EDITOR.status).toBe('COMPLETED');
    expect(value.stages.MP4.status).toBe('COMPLETED');
    expect(value.nextStage).toBe('AI_QUALITY');
    expect(value.latestRenderJobId).toBe('render-1');
  });

  it('materializes a reviewed AI proposal into the same project without upgrading observed evidence', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'product-materialize-'));
    try {
      const rootUrl = 'https://www.threads.com/@root/post/ROOT';
      const observedUrl = 'https://www.threads.com/@observer/post/OBS';
      const collection: any = {
        version: 'threads-conversation/1',
        root: {
          id: 'ROOT', url: rootUrl, author: { handle: 'root', name: null },
          originalText: 'Câu hỏi gốc', publishedAt: null,
          engagement: { likes: null, replies: null, reposts: null, shares: null },
          provenance: { documentUrl: rootUrl, observedAt: '2026-11-14T00:00:00Z', method: 'TEST', synthetic: true },
        },
        replies: [],
        unverified: [{
          url: observedUrl,
          reason: 'parent unavailable',
          observation: { level: 'OBSERVED_ON_TARGET_PAGE', targetUrl: rootUrl, observedAt: '2026-11-14T00:00:00Z', author: { handle: 'observer', name: null }, originalText: 'Góc nhìn quan sát được' },
        }],
        reportedReplyCount: null, observedReplyCount: 1, verifiedReplyCount: 0,
        unverifiedCandidateCount: 1, startedAt: '2026-11-14T00:00:00Z',
        completedAt: '2026-11-14T00:00:01Z', status: 'PARTIAL', warnings: [],
      };
      let activeSession: any = session({
        id: '00000000-0000-4000-8000-000000000002',
        items: [{ id: 'ROOT', inclusion: 'TARGET', selected: true, spokenText: 'Câu hỏi gốc', order: 0 }],
      });
      const plan: any = {
        id: 'a'.repeat(64), revision: 0, collectionId: 'collection', selectionRevision: 1,
        selectedReplyIds: [], selectedObservedUrls: [observedUrl],
        bundle: { collection, quality: {}, sourceLink: null },
        sections: [
          { id: 'hook', stage: 'HOOK', kind: 'COMMENTARY', sourceId: null, originalText: '', displayText: '', narrationText: '', sourceEvidence: 'AI_COMMENTARY' },
          { id: 'root', stage: 'CONTEXT', kind: 'QUOTE', sourceId: 'ROOT', originalText: 'Câu hỏi gốc', displayText: 'Câu hỏi gốc', narrationText: 'Câu hỏi gốc', sourceEvidence: 'ROOT_VERIFIED' },
          { id: 'observed-OBS', stage: 'DISCUSSION', kind: 'QUOTE', sourceId: 'OBS', originalText: 'Góc nhìn quan sát được', displayText: 'Góc nhìn quan sát được', narrationText: 'Góc nhìn quan sát được', sourceEvidence: 'OBSERVED_RELATIONSHIP_UNVERIFIED' },
          { id: 'commentary', stage: 'COMMENTARY', kind: 'COMMENTARY', sourceId: null, originalText: '', displayText: '', narrationText: '', sourceEvidence: 'AI_COMMENTARY' },
          { id: 'resolution', stage: 'RESOLUTION', kind: 'COMMENTARY', sourceId: null, originalText: '', displayText: '', narrationText: '', sourceEvidence: 'AI_COMMENTARY' },
        ],
      };
      const savedPlans: any[] = [];
      const studio: any = {
        load: jest.fn(async () => activeSession),
        renders: { list: jest.fn(async () => []) },
        jobs: { load: jest.fn() },
        applyEditorialDraft: jest.fn(async (_id: any, _revision: any, saved: any) => {
          activeSession = { ...activeSession, revision: 2, project: { ...activeSession.project, editorialPlan: saved }, items: saved.sections.filter((row: any) => row.narrationText).map((row: any, index: number) => ({ id: row.id, selected: true, spokenText: row.narrationText, order: index })) };
          return activeSession;
        }),
      };
      const conversations: any = { engine: {
        review: jest.fn(async () => ({ revision: 1, decision: 'ACCEPT', selectedReplyIds: [], selectedObservedUrls: [observedUrl] })),
        collection: jest.fn(async () => ({ collection })),
      } };
      const ai: any = {
        evaluator: { list: jest.fn(async () => [{ id: 'assessment', collectionId: 'collection', createdAt: '2026-11-14T00:00:00Z' }]) },
        agent: {
          proposal: jest.fn(async () => ({ id: 'b'.repeat(64), assessmentId: 'assessment' })),
          review: jest.fn(async () => ({ revision: 1, hook: 'Hook đã duyệt', sections: [
            { kind: 'QUOTE', sourceIds: ['ROOT'], text: 'Câu hỏi gốc', purpose: 'CONTEXT' },
            { kind: 'PARAPHRASE', sourceIds: ['OBS'], text: 'Góc nhìn đã biên tập', purpose: 'DISCUSSION' },
            { kind: 'COMMENTARY', sourceIds: [], text: 'Phân tích biên tập', purpose: 'ANALYSIS' },
            { kind: 'COMMENTARY', sourceIds: [], text: 'Kết luận biên tập', purpose: 'CONCLUSION' },
          ] })),
        },
      };
      const editorial: any = { engine: { list: jest.fn(async () => []) }, create: jest.fn(async () => plan), save: jest.fn(async (_id: any, body: any) => {
        const saved = { ...plan, revision: 1, sections: body.sections };
        savedPlans.push(saved);
        return saved;
      }) };
      const service = new ProductPipelineService(studio, conversations, ai, editorial);
      (service as any).root = dir;
      const id = '11111111-1111-4111-8111-111111111111';
      await writeFile(path.join(dir, id + '.json'), JSON.stringify({
        schemaVersion: 'product-pipeline/1', id, requestKey: 'key', sourceUrl: rootUrl,
        sessionId: activeSession.id, createdAt: '2026-11-14T00:00:00Z', updatedAt: '2026-11-14T00:00:00Z',
        sourceJobId: null, collectionId: 'collection', assessmentId: 'assessment', appliedReviewRevision: 1,
        editorialPlanId: null, scriptProposalId: null, scriptReviewRevision: null,
        stages: {}, nextStage: 'SCRIPT', latestRenderJobId: null, warnings: [],
      }));
      const result = await service.materializeScript(id, { proposalId: 'b'.repeat(64), reviewRevision: 1, sessionRevision: 1 });
      expect(savedPlans[0].sections.find((row: any) => row.id === 'observed-OBS')).toMatchObject({ kind: 'PARAPHRASE', narrationText: 'Góc nhìn đã biên tập', sourceEvidence: 'OBSERVED_RELATIONSHIP_UNVERIFIED' });
      expect(savedPlans[0].sections.find((row: any) => row.id === 'resolution').narrationText).toBe('Kết luận biên tập');
      expect(studio.applyEditorialDraft).toHaveBeenCalledTimes(1);
      expect(result.job.scriptProposalId).toBe('b'.repeat(64));
      expect(result.session.id).toBe(activeSession.id);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

it.each([
  ['ADMISSION_DENIED','ADMISSION_DENIED: COMMIT_RESERVE'],
  ['RESOURCE_GUARD_STOP','RESOURCE_GUARD_STOP'],
  ['TIMEOUT','Kokoro inference deadline exceeded'],
  ['ALLOCATION_FAILURE','Allocator failed'],
  ['CLEANUP_UNVERIFIED','RESOURCE_CLEANUP_UNVERIFIED'],
  ['AUDIO_VALIDATION_FAILED','Invalid measured PCM audio format'],
])('stops on %s and preserves the persisted voice error',async(failureCategory,error)=>{
  const contract=await import('./production-contract');
  const source=jest.spyOn(contract,'sourceBlockers').mockReturnValue([]);
  try{
    const items=[{id:'one',selected:true,order:0,spokenText:'Câu chuyện.'},
      {id:'two',selected:true,order:1,spokenText:'Câu trả lời.'}];
    const state={id:'draft',revision:1,items};
    const voiceAction=jest.fn(async()=>({...state,voiceJobs:[{itemId:'one',status:'ERROR',error,failureCategory,elapsedMs:123,
      checkpointReference:'chunks/test/manifest.json',resourceDiagnostics:{chunkProgress:[{index:9,total:11}]}}]}));
    const studio={load:async()=>state,jobs:{findRequest:async()=>null},restoreOperatorAvatars:async()=>state,
      applyAutomaticSeriousAssets:async()=>state,normalizeAutomaticDraft:async()=>state,voiceAction};
    const pipeline=new ProductPipelineService(studio as any,null,null,null);
    Object.assign(pipeline,{checkAuto:async()=>undefined,saveAuto:async()=>undefined});
    const row:any={sessionId:'draft',sourceUrl:'https://www.threads.com/@tester/post/ROOT'};
    await expect((pipeline as any).continueAutomaticDraft({id:'batch',request:{voice:'my_yen',speed:1.3}},row)).rejects.toThrow(error);
    expect(row.voiceFailure).toMatchObject({failureCategory,error,itemId:'one',elapsedMs:123,completedChunks:9,totalChunks:11,
      checkpointReference:'chunks/test/manifest.json'});
    expect(voiceAction).toHaveBeenCalledTimes(1);
  }finally{source.mockRestore();}
});

it('resumes the same saved TTS batch only after a sustained probe and does not reissue it', async()=>{
  const job:any={id:'existing-batch',status:'BLOCKED',completedAt:'2026-11-27T00:00:00.000Z',
    ttsWait:{status:'WAITING',sessionId:'existing-draft',sourceUrl:'source',inputHash:'exact',
      nextProbeAt:60_000,retries:0,probes:0,previousFailure:'RESOURCE_GUARD_STOP'},
    results:[{sessionId:'existing-draft',sourceUrl:'source',assessmentId:'existing-assessment',aiLedgerIds:['old']}]};
  let running=false, allowed=false;
  const measure=jest.fn(async()=>({allowed}));
  const studio={hasHeavyWorker:()=>false,productionTtsAdmission:measure,withProductionWorker:async (work)=>work()};
  const pipeline=new ProductPipelineService(studio as any,null,null,null);
  const send=jest.fn((_id: string)=>{running=true;});
  Object.assign(pipeline,{getAuto:async()=>job,saveAuto:async()=>undefined,exactTtsSession:async()=>({inputHash:'exact'}),
    hasActiveAuto:()=>running,scheduleAuto:send});
  await pipeline.probeTtsResourceWait(job.id,59_000);
  expect(measure).not.toHaveBeenCalled();
  await pipeline.probeTtsResourceWait(job.id,60_000);
  expect(send).not.toHaveBeenCalled();
  allowed=true;
  expect((await pipeline.probeTtsResourceWait(job.id,75_000))?.retries).toBe(0);
  await pipeline.probeTtsResourceWait(job.id,90_000);
  expect(send).toHaveBeenCalledTimes(1);
  expect(send).toHaveBeenCalledWith('existing-batch');
  expect(job.results[0].aiLedgerIds).toEqual(['old']);
  expect(job.results[0].assessmentId).toBe('existing-assessment');
  running=false;
  expect((await pipeline.probeTtsResourceWait(job.id,100_000))?.blockReason).toBe('RETRY_EXHAUSTED');
  expect(send).toHaveBeenCalledTimes(1);
});

it('exhausts three denied TTS probes without launching any worker',async()=>{
  const wait:any={status:'WAITING',sessionId:'draft',sourceUrl:'source',inputHash:'exact',
    nextProbeAt:0,retries:0,probes:0,previousFailure:'RESOURCE_GUARD_STOP'};
  const job:any={id:'job',ttsWait:wait,results:[{sessionId:'draft',sourceUrl:'source'}]};
  const measure=jest.fn(async()=>({allowed:false}));
  const pipeline=new ProductPipelineService({hasHeavyWorker:()=>false,productionTtsAdmission:measure,
    withProductionWorker:async (work)=>work()} as any,null,null,null);
  const send=jest.fn();
  Object.assign(pipeline,{getAuto:async()=>job,saveAuto:async()=>undefined,exactTtsSession:async()=>({inputHash:'exact'}),
    scheduleAuto:send});
  for(const now of [0,15000,30000,45000])await pipeline.probeTtsResourceWait(job.id,now);
  expect(measure).toHaveBeenCalledTimes(3);
  expect(send).not.toHaveBeenCalled();
  expect(wait).toMatchObject({status:'BLOCKED',blockReason:'ADMISSION_DENIED',retries:0});
});

it('authorizes only the latest exact timeout and preserves the consumed resource recovery',async()=>{
  const at='2026-11-28T04:06:00.000Z', text='Câu chuyện.';
  const normalized=prepareTtsInput(text);
  const job:any={id:'batch',status:'FAILED',dispatch:{recovery:{cacheOnly:true}},startedAt:at,request:{voice:'my_yen',speed:1.3},
    ttsWait:{status:'RESOLVED',retries:1,sessionId:'draft',sourceUrl:'source',inputHash:'exact'},
    results:[{sessionId:'draft',sourceUrl:'source',checkpoint:'DRAFT',collectionId:'collection',assessmentId:'assessment',status:'TTS_FAILED',
       aiLedgerIds:['previous']}]};
  const failure={itemId:'item',status:'ERROR',error:'Kokoro inference deadline exceeded',failureCategory:'TIMEOUT',
    completedAt:at,elapsedMs:122381,ttsInputHash:normalized.ttsInputHash,
    resourceDiagnostics:{ownedWorkerPid:42,chunkProgress:[{index:9,total:11}]}};
  const session={id:'draft',items:[{id:'item',selected:true,spokenText:text}],voiceJobs:[failure]};
  const checkpoint={checkpointReference:'chunks/exact/manifest.json',completedChunks:9,totalChunks:11};
  const verify=jest.fn(async()=>checkpoint);
  const studio={hasHeavyWorker:()=>false,withProductionWorker:async(work)=>work(),verifyTtsTimeoutRecovery:verify,
    productionTtsAdmission:async()=>({allowed:true})};
  const pipeline=new ProductPipelineService(studio as any,
    {engine:{collection:async()=>({collection:{root:{id:'root',url:'source'}}})}} as any,
    {evaluator:{get:async()=>({collectionId:'collection',rootSourceId:'root'})}} as any,null);
  const send=jest.fn((_id:string)=>undefined);
  Object.assign(pipeline,{getAuto:async()=>job,listAuto:async()=>[job],saveAuto:async()=>undefined,exactTtsSession:async()=>({session,inputHash:'exact'}),
    scheduleAuto:send});
  const request={batchId:'batch',sessionId:'draft',itemId:'item',failedAt:at};
  await expect(pipeline.authorizeTtsTimeoutRecovery({...request,failedAt:'stale'},'first')).rejects.toThrow('STALE_TTS_TIMEOUT_FAILURE');
  await pipeline.authorizeTtsTimeoutRecovery(request,'first');
  await pipeline.authorizeTtsTimeoutRecovery(request,'first');
  await expect(pipeline.authorizeTtsTimeoutRecovery(request,'second')).rejects.toThrow('TTS_TIMEOUT_RETRY_ALREADY_AUTHORIZED');
  expect(verify).toHaveBeenCalledTimes(1);
  expect(job.results[0].voiceFailure).toMatchObject({...checkpoint,itemId:'item',failureCategory:'TIMEOUT',elapsedMs:122381,error:failure.error});
  expect(job.ttsWait.retries).toBe(1);
  expect(job.results[0].aiLedgerIds).toEqual(['previous']);
  expect(send).not.toHaveBeenCalled();
  await pipeline.probeTtsResourceWait(job.id,Date.now()+1000);
  expect(send).toHaveBeenCalledTimes(1);
  expect(job.ttsTimeoutRecovery.retries).toBe(0);
  expect(job.ttsWait.retries).toBe(1);
  await expect(pipeline.authorizeTtsTimeoutRecovery(request,'first')).rejects.toThrow('TTS_TIMEOUT_RETRY_ALREADY_AUTHORIZED');
});

it('authorizes one continuation for the exact legacy warm denial and validates both reusable WAVs',async()=>{
  const at='2026-11-28T05:06:23.221Z', text='Câu chuyện.';
  const items=['first','second','remaining'].map((id,order)=>({id,order,selected:true,spokenText:text,voiceSettings:{voice:'my_yen',speed:1.3}}));
  const oldWait={status:'RESOLVED',retries:1,inputHash:'exact'};
  const timeout={...oldWait,status:'BLOCKED',blockReason:'RETRY_EXHAUSTED',sessionId:'draft',sourceUrl:'source'};
  const job:any={id:'batch',status:'BLOCKED',request:{voice:'my_yen',speed:1.3},dispatch:{recovery:{cacheOnly:true}},
    ttsWait:oldWait,ttsTimeoutRecovery:timeout,results:[{sessionId:'draft',sourceUrl:'source',checkpoint:'DRAFT',
      collectionId:'collection',assessmentId:'assessment',status:'RESOURCE_STOPPED',aiLedgerIds:['old'],
      voiceFailure:{itemId:'remaining'}}]};
  const failure={itemId:'remaining',status:'ERROR',error:'RESOURCE_GUARD_STOP: sustained WARM headroom admission denied',
    failureCategory:'RESOURCE_GUARD_STOP',completedAt:at,elapsedMs:2456,ttsInputHash:prepareTtsInput(text).ttsInputHash,
    resourceDiagnostics:{ownedWorkerPid:42,workerStarts:0,chunkProgress:[],phaseMs:{synthesis:null},
      admission:{phase:'WARM',allowed:false,samples:Array.from({length:5},(_,i)=>({
        atMs:i*500,availableMiB:483.88,systemCommitAvailableMiB:6713.83,
      }))}}};
  const session={id:'draft',items,voiceJobs:[failure]};
  const verifyWorker=jest.fn(async()=>undefined),verifyAudio=jest.fn(async(_session:string,_asset:{id:string})=>undefined);
  const studio={hasHeavyWorker:()=>false,withProductionWorker:async(work)=>work(),
    verifyPreviousTtsWorker:verifyWorker,verifyProductionAudio:verifyAudio,
    productionTtsAdmission:async()=>({allowed:true,warnings:['LOW_MEMORY_WARNING']})};
  const contract=await import('./production-contract');
  const narration=jest.spyOn(contract,'currentNarration').mockImplementation((_session,item)=>
    item.id==='remaining'?undefined:{id:item.id+'-wav',durationMs:24000} as any);
  try{
    const pipeline=new ProductPipelineService(studio as any,
      {engine:{collection:async()=>({collection:{root:{id:'root',url:'source'}}})}} as any,
      {evaluator:{get:async()=>({collectionId:'collection',rootSourceId:'root'})}} as any,null);
    const send=jest.fn();
    Object.assign(pipeline,{getAuto:async()=>job,listAuto:async()=>[job],saveAuto:async()=>undefined,
      exactTtsSession:async()=>({session,inputHash:'exact'}),scheduleAuto:send});
    const request={batchId:'batch',sessionId:'draft',itemId:'remaining',failedAt:at};
    await expect(pipeline.authorizeTtsAdmissionContinuation({...request,failedAt:'stale'},'first')).rejects.toThrow('STALE_TTS_ADMISSION_FAILURE');
    await pipeline.authorizeTtsAdmissionContinuation(request,'first');
    await pipeline.authorizeTtsAdmissionContinuation(request,'first');
    await expect(pipeline.authorizeTtsAdmissionContinuation(request,'second')).rejects.toThrow('TTS_ADMISSION_CONTINUATION_ALREADY_AUTHORIZED');
    expect(verifyWorker).toHaveBeenCalledTimes(1);
    expect(verifyAudio.mock.calls.map(call=>call[1].id)).toEqual(['first-wav','second-wav']);
    expect(job.ttsAdmissionContinuation).toMatchObject({reusedAssetIds:['first-wav','second-wav'],
      priorFailure:{classification:'ADMISSION_DENIED',inferenceStarted:false}});
    await pipeline.probeTtsResourceWait('batch',Date.now()+1000);
    expect(send).toHaveBeenCalledTimes(1);
    await expect(pipeline.authorizeTtsAdmissionContinuation(request,'first')).rejects.toThrow('TTS_ADMISSION_CONTINUATION_ALREADY_AUTHORIZED');
    expect(job).toMatchObject({ttsWait:oldWait,ttsTimeoutRecovery:timeout,ttsAdmissionContinuation:{retries:0}});
    expect(job.results[0].aiLedgerIds).toEqual(['old']);
  }finally{narration.mockRestore();}
});

it('reuses the two saved narrations and sends only the missing scene to Kokoro',async()=>{
  const contract=await import('./production-contract');
  const source=jest.spyOn(contract,'sourceBlockers').mockReturnValue([]);
  const temp=await mkdtemp(path.join(os.tmpdir(),'saved-wavs-'));
  try{
    const items=['first','second','remaining'].map((id,order)=>({id,order,selected:true,spokenText:'Câu chuyện.'}));
    const state:any={id:'draft',revision:1,items};
    const narration=jest.spyOn(contract,'currentNarration').mockImplementation((_session,item)=>
      item.id==='remaining'?undefined:{id:item.id+'-wav',durationMs:24000} as any);
    const audio=path.join(temp,'saved.wav');
    await writeFile(audio,Buffer.alloc(64));
    const voiceAction=jest.fn(async(_session:string,_item:string)=>({...state,voiceJobs:[{itemId:'remaining',status:'ERROR',error:'ADMISSION_DENIED: COMMIT_RESERVE',
      failureCategory:'ADMISSION_DENIED',resourceDiagnostics:{inferenceStarted:false},elapsedMs:2000}]}));
    const studio={load:async()=>state,jobs:{findRequest:async()=>null},restoreOperatorAvatars:async()=>state,
      applyAutomaticSeriousAssets:async()=>state,normalizeAutomaticDraft:async()=>state,voiceAction,audioFile:async()=>audio};
    try{
      const pipeline=new ProductPipelineService(studio as any,null,null,null);
      Object.assign(pipeline,{checkAuto:async()=>undefined,saveAuto:async()=>undefined});
      const row:any={sessionId:'draft',sourceUrl:'https://www.threads.com/@tester/post/ROOT',audioExecution:[]};
      await expect((pipeline as any).continueAutomaticDraft({id:'batch',request:{voice:'my_yen',speed:1.3},
        ttsAdmissionContinuation:{itemId:'remaining',reusedAssetIds:['first-wav','second-wav']}},row)).rejects.toThrow('ADMISSION_DENIED');
      expect(voiceAction).toHaveBeenCalledTimes(1);
      expect(voiceAction.mock.calls[0][1]).toBe('remaining');
      expect(row.audioExecution.map(entry=>[entry.itemId,entry.outcome])).toEqual([['first','REUSED'],['second','REUSED']]);
    }finally{narration.mockRestore();}
  }finally{source.mockRestore();await rm(temp,{recursive:true,force:true});}
});
