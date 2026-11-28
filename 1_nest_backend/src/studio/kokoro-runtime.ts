import { canonical } from '../data-engine/rules';
import { spawn, ChildProcessWithoutNullStreams } from 'child_process';
import { createHash, randomUUID } from 'crypto';
import { createReadStream, promises as fs } from 'fs';
import * as path from 'path';
import type { VoiceRuntime } from './voice.types';
import { atempoFilter } from './voice-settings';
import {freemem} from 'os';
import {TTS_RESOURCE_POLICY,ttsAdmission,ttsResourceBlock,ttsResourceWarnings,SynthesisMetrics,LocalTtsExecution,validateLocalExecution,TtsExecutionError,ttsDeadlines,ttsRemainingSynthesis} from './tts-resource-policy';
import {assertNoLocalProbe} from './local-probe-lease';
export const textHash = (text: string) =>
  createHash('sha256').update(text).digest('hex');
export function resolveStudioDataRoot(
  configured = process.env.STUDIO_DATA_ROOT,
  cwd = process.cwd(),
) {
  return configured ? path.resolve(configured) : path.resolve(cwd, '.studio-data');
}
export function ttsCacheKeys(text:string,voice:string,speed:number,runtime:VoiceRuntime,context?:{itemId:string;normalizationVersion:string}) {
  const baseKey=textHash(JSON.stringify({text,voice,version:runtime.packageVersion,model:runtime.modelVersion,device:runtime.device,context:context||null,synthesisRate:1}));
  return {baseKey,cacheKey:textHash(baseKey+':'+speed)};
}
async function fileSha256(file:string) {
  const hash=createHash('sha256');
  for await (const part of createReadStream(file)) hash.update(part);
  return hash.digest('hex');
}
export function pcmCheckpointSamples(data:Buffer) {
  if(data.length<44 || data.toString('ascii',0,4)!=='RIFF' ||
      data.toString('ascii',8,12)!=='WAVE' || data.readUInt32LE(4)+8!==data.length) return null;
  let format=false, samples:number|null=null;
  for(let offset=12;offset+8<=data.length;){
    const tag=data.toString('ascii',offset,offset+4), size=data.readUInt32LE(offset+4), start=offset+8;
    if(start+size>data.length)return null;
    if(tag==='fmt ' && size>=16)
      format=data.readUInt16LE(start)===1&&data.readUInt16LE(start+2)===1&&data.readUInt32LE(start+4)===24000&&
        data.readUInt16LE(start+12)===2&&data.readUInt16LE(start+14)===16;
    if(tag==='data')samples=size>0&&size%2===0?size/2:null;
    offset=start+size+(size%2);
  }
  return format?samples:null;
}
export class KokoroRuntime {
  private resourceSamples:Record<string,number>[]=[];
  private resourceInputHash:string|null=null;
  private chunkProgress: Record<string, unknown>[]=[];
  private modelLoads=0;
  private workerStarts=0;
  private deadline?: ReturnType<typeof ttsDeadlines>;
  private phases: Record<string,number>={};
  private phaseMs() {
    const p=this.phases, end=p.finished??Date.now();
    return {
      modelLoad:p.importing===undefined?null:(p.modelLoaded??end)-p.importing,
      synthesis:p.synthesizing===undefined?null:(p.assembling??end)-p.synthesizing,
      assembly:p.assembling===undefined?null:end-p.assembling,
    };
  }
  private lastAdmission?: ReturnType<typeof ttsAdmission>;
  diagnostics(){return {deadline:this.deadline,phaseMs:this.phaseMs(),inferenceStarted:this.phases.synthesizing!==undefined,chunkProgress:structuredClone(this.chunkProgress),modelLoads:this.modelLoads,workerStarts:this.workerStarts,
    admission:this.lastAdmission,inputHash:this.resourceInputHash,workerPid:this.worker?.pid??null,ownedWorkerPid:this.lastOwned?.pid??null,samples:structuredClone(this.resourceSamples)};}
  onStage?: (step:string)=>void;
  private worker?: ChildProcessWithoutNullStreams;
  private lastOwned?:ChildProcessWithoutNullStreams;
  private commands=new Set<ChildProcessWithoutNullStreams>();
  private boundedDeadline?:number;
  private workerKey = '';
  private idle?: ReturnType<typeof setTimeout>;
  private pending = false;
  private checked?: { key: string; at: number; result: VoiceRuntime };
  private cfg() {
    return {
      source:
        process.env.STUDIO_KOKORO_SOURCE ||
        path.resolve('../../tep_chua_python/Kokoro-Vietnamese'),
      model: process.env.STUDIO_KOKORO_MODEL || '',
      config: process.env.STUDIO_KOKORO_CONFIG || '',
      voiceDir: process.env.STUDIO_KOKORO_VOICE_DIR || '',
      device: process.env.STUDIO_TTS_DEVICE === 'cuda' ? 'cuda' : 'cpu',
    };
  }
  private dataRoot() {
    return resolveStudioDataRoot();
  }
  private python() {
    return process.env.STUDIO_PYTHON || 'python';
  }
  private env() {
    return {
      ...process.env,
      HF_HUB_OFFLINE: '1',
      TRANSFORMERS_OFFLINE: '1',
      PYTHONIOENCODING: 'utf-8',
      OMP_NUM_THREADS: '1',
      OPENBLAS_NUM_THREADS: '1',
      NUMEXPR_NUM_THREADS: '1',
      MKL_NUM_THREADS: '1',
      STUDIO_TTS_CONFIG: JSON.stringify(this.cfg()),
    };
  }
  private run(
    command: string,
    args: string[],
    timeout = 20000,
    captureStderr = false,
    commandDeadlineAt?: number,
  ): Promise<string> {
    return new Promise((resolve, reject) => {
      const deadline=commandDeadlineAt??this.boundedDeadline;
      if(deadline!==undefined&&Date.now()>=deadline){reject(new TtsExecutionError('TIMEOUT','Scene audio deadline exceeded'));return;}
      const p = spawn(command, args, { windowsHide: true, env: this.env() });
      this.commands.add(p);
      let out = '';
      const timer = setTimeout(() => {
        p.kill();
        reject(new TtsExecutionError('TIMEOUT','Runtime command deadline exceeded'));
      }, deadline!==undefined?Math.min(timeout,Math.max(1,deadline-Date.now())):timeout);
      p.stdout.on('data', (c) => {
        out += c.toString();
        if (out.length > 200000) {
          p.kill();
          reject(Error('Runtime output limit'));
        }
      });
      if (captureStderr)
        p.stderr.on('data', (c) => {
          out += c.toString();
        });
      else p.stderr.resume();
      p.on('error', () => {
        clearTimeout(timer);
        reject(Error('Runtime executable unavailable'));
      });
      p.on('close', (code) => {
        this.commands.delete(p);
        clearTimeout(timer);
        code === 0 ? resolve(out) : reject(Error('Runtime command failed'));
      });
    });
  }
  async preflight(force = false, deadlineAt?:number): Promise<VoiceRuntime> {
    // Repeated scenes must not start another Torch-importing process beside the worker.
    const cfg = this.cfg();
    const stamps: string[] = [];
    for (const file of [cfg.model, cfg.config, ...(await fs.readdir(cfg.voiceDir).catch(() => []))
      .filter(n => n.endsWith('.pt')).sort().map(n => path.join(cfg.voiceDir, n))]) {
      const stat = await fs.stat(file).catch(() => null);
      stamps.push(file + ':' + stat?.size + ':' + stat?.mtimeMs);
    }
    const key = JSON.stringify([cfg, this.python(), stamps]);
    if (!force && this.checked?.key === key && Date.now() - this.checked.at < 300000 && !this.checked.result.blockers.some(b=>b.includes('BLOCKED_RESOURCE')))
      return this.checked.result;
    let data: any = {};
    try {
      data = JSON.parse(
        await this.run(this.python(), [
          path.resolve('scripts/kokoro-studio.py'),
          '--inspect', // File/module metadata only; real imports occur in the single worker.
        ],20000,false,deadlineAt),
      );
    } catch(error) {
      if(deadlineAt!==undefined&&error instanceof TtsExecutionError&&error.category==='TIMEOUT')throw error;
      data = { blockers: ['Python preflight unavailable'] };
    }
    let ffmpeg = false,
      ffprobe = false;
    try {
      await this.run('ffmpeg', ['-version'],20000,false,deadlineAt);
      ffmpeg = true;
    } catch(error) {
      if(deadlineAt!==undefined&&error instanceof TtsExecutionError&&error.category==='TIMEOUT')throw error;
    }
    try {
      await this.run('ffprobe', ['-version'],20000,false,deadlineAt);
      ffprobe = true;
    } catch(error) {
      if(deadlineAt!==undefined&&error instanceof TtsExecutionError&&error.category==='TIMEOUT')throw error;
    }
    const blockers = [...(data.blockers || [])];
    if (!ffmpeg) blockers.push('FFmpeg unavailable');
    if (!ffprobe) blockers.push('FFprobe unavailable');
    const result: VoiceRuntime = {
      status: blockers.length ? 'BLOCKED_RUNTIME' : 'READY',
      python: data.python || 'unavailable',
      packageVersion: data.packageVersion || null,
      imports: data.imports || {},
      voices: data.voices || [],
      declaredVoices: data.declaredVoices || [],
      model: data.model || null,
      modelVersion: data.modelVersion || 'missing',
      device: data.device || 'cpu',
      gpuAvailable: data.gpuAvailable ?? null,
      ffmpeg,
      ffprobe,
      blockers,
      verification:data.importsVerified?'IMPORTS_VERIFIED':'STATIC_ONLY',
      warnings:[...(data.warnings||[]),...ttsResourceWarnings(freemem())],
      checkedAt: new Date().toISOString(),
    };
    this.checked = { key, at: Date.now(), result };
    return result;
  }
  close() {
    if (this.idle) clearTimeout(this.idle);
    this.worker?.kill();
    this.worker = undefined;
    for(const command of this.commands)command.kill();
  }
  async closeAndWait(){
    const owned=[...new Set([this.worker??this.lastOwned,...this.commands].filter((p):p is ChildProcessWithoutNullStreams=>!!p))];
    const waits=owned.filter(p=>p.exitCode===null&&p.signalCode===null).map(p=>new Promise<void>((resolve,reject)=>{const timer=setTimeout(()=>reject(new TtsExecutionError('TIMEOUT','Owned worker exit was not confirmed')),5000);p.once('close',()=>{clearTimeout(timer);resolve()});}));this.close();await Promise.all(waits);
  }
  private async checkpointManifests(sessionId:string,inputHash:string,baseKey:string) {
    if(!/^[a-f0-9-]{36}$/.test(sessionId))throw Error('TTS_CHECKPOINT_SESSION_INVALID');
    const root=path.join(this.dataRoot(),'audio',sessionId,'chunks');
    const matches=[];
    for(const key of await fs.readdir(root).catch(()=>[])){
      if(!/^[a-f0-9]{64}$/.test(key))continue;
      const dir=path.join(root,key), file=path.join(dir,'manifest.json');
      const st=await fs.lstat(file).catch(()=>null);
      if(!st?.isFile()||st.size>8*1024*1024||path.resolve(await fs.realpath(dir)).toLowerCase()!==path.resolve(dir).toLowerCase())continue;
      const m=JSON.parse(await fs.readFile(file,'utf8'));
      if(m.schemaVersion==='tts-chunks/1'&&m.synthesisKey===key&&m.inputHash===inputHash&&m.cacheIdentity===baseKey)
        matches.push({m,dir,reference:'chunks/'+key+'/manifest.json'});
    }
    return matches;
  }
  async verifyTimeoutCheckpoint(sessionId:string,text:string,voice:string,speed:number,context:{itemId:string;normalizationVersion:string}) {
    const runtime=await this.preflight();
    if(runtime.status!=='READY')throw Error('TTS_CHECKPOINT_RUNTIME_UNAVAILABLE');
    const cfg=this.cfg(), scripts=path.resolve('scripts');
    const {baseKey}=ttsCacheKeys(text,voice,speed,runtime,context);
    const [model,config,voicePack,worker,checkpoints]=await Promise.all([
      fileSha256(cfg.model),fileSha256(cfg.config),fileSha256(path.join(cfg.voiceDir,voice+'.pt')),
      fileSha256(path.join(scripts,'kokoro-studio.py')),fileSha256(path.join(scripts,'kokoro_chunks.py')),
    ]);
    const matches=(await this.checkpointManifests(sessionId,textHash(text),baseKey)).filter(({m})=>
      m.modelFingerprint===model&&m.configFingerprint===config&&m.voiceFingerprint===voicePack&&
      m.processingVersion===textHash(worker+checkpoints)&&m.device===cfg.device&&m.voice===voice&&
      m.chunkingVersion==='clauses-145/1'&&m.sampleRate===24000&&m.synthesisSpeed===1&&
      m.runtimeVersions?.python===runtime.python&&m.runtimeVersions?.['kokoro-vietnamese']===runtime.packageVersion&&
      ['OMP_NUM_THREADS','MKL_NUM_THREADS','OPENBLAS_NUM_THREADS'].every(key=>m.threadSettings?.[key]==='1'));
    if(matches.length!==1)throw Error('TTS_CHECKPOINT_IDENTITY_UNVERIFIED');
    const {m,dir,reference}=matches[0];
    if(!Array.isArray(m.chunks)||m.chunks.length<1||m.chunks.length>512)throw Error('TTS_CHECKPOINT_PLAN_INVALID');
    const {schemaVersion,synthesisKey,chunks,...identity}=m;
    const plan=chunks.map(row=>({index:row.index,textHash:row.textHash}));
    // Python canonical JSON persists the synthesis speed as the float 1.0.
    const key=textHash(canonical({identity,plan}).replace('"synthesisSpeed":1,','"synthesisSpeed":1.0,'));
    if(key!==synthesisKey)throw Error('TTS_CHECKPOINT_PLAN_INTEGRITY');
    const runtimeVersions=JSON.parse(await this.run(this.python(),['-B','-c',
      "import importlib.metadata as m,json; print(json.dumps({n:m.version(n) for n in ('torch','soundfile','vig2p','numpy')}))"]));
    if(Object.entries(runtimeVersions).some(([name,version])=>m.runtimeVersions[name]!==version))
      throw Error('TTS_CHECKPOINT_RUNTIME_CHANGED');
    let completedChunks=0;
    for(const [index,row] of m.chunks.entries()){
      if(row.index!==index+1||!/^[a-f0-9]{64}$/.test(row.textHash))throw Error('TTS_CHECKPOINT_PLAN_INVALID');
      if(row.status!=='COMPLETED')continue;
      const name=String(index+1).padStart(3,'0')+'.wav';
      if(row.relativePath!==name)throw Error('TTS_CHECKPOINT_PATH_INVALID');
      const file=path.join(dir,name), stat=await fs.lstat(file).catch(()=>null);
      if(!stat?.isFile()||stat.size<44||stat.size>64*1024*1024)continue;
      const data=await fs.readFile(file);
      if(pcmCheckpointSamples(data)===row.sampleCount&&Number.isInteger(row.sampleCount)&&
         Math.abs(row.sampleCount/24-row.durationMs)<=0.5&&createHash('sha256').update(data).digest('hex')===row.sha256)
        completedChunks++;
    }
    return {checkpointReference:reference,completedChunks,totalChunks:m.chunks.length};
  }
  async checkpointReference(sessionId:string,text:string,voice:string,speed:number,runtime:VoiceRuntime,context:{itemId:string;normalizationVersion:string}) {
    const {baseKey}=ttsCacheKeys(text,voice,speed,runtime,context);
    const rows=await this.checkpointManifests(sessionId,textHash(text),baseKey);
    return rows.length===1?rows[0].reference:null;
  }
  async resourceAdmission(phase: 'COLD'|'WARM'|'RENDER', automaticProduction=false) {
    this.lastAdmission=undefined;
    try {
      const samples=JSON.parse(await this.run(this.python(),[path.resolve('scripts/kokoro_memory.py'),'--series'],7000));
      this.lastAdmission=ttsAdmission(Array.isArray(samples)?samples:[],phase,automaticProduction);
    }catch{this.lastAdmission=ttsAdmission([],phase,automaticProduction);}
    return this.lastAdmission;
  }
  async productionAdmission() {
    if (this.worker && this.worker.exitCode===null && this.worker.signalCode===null)
      return this.resourceAdmission('WARM',true);
    await this.closeAndWait().catch(()=>{throw Error('RESOURCE_CLEANUP_UNVERIFIED');});
    return this.resourceAdmission('COLD',true);
  }
  private async requireAdmission(phase: 'COLD'|'WARM', automaticProduction: boolean) {
    const admission=await this.resourceAdmission(phase,automaticProduction);
    if(!admission.allowed)throw new TtsExecutionError('ADMISSION_DENIED',
      'ADMISSION_DENIED: sustained '+phase+' headroom: '+admission.denialReason,admission);
  }
  private async synthesize(
    text: string,
    voice: string,
    output: string,
    version: string,
    baseKey: string,
    execution?:LocalTtsExecution,
  ) {
    if (this.pending) throw Error('Sequential TTS worker busy');
    this.pending = true;
    if (this.idle) clearTimeout(this.idle);
    try {
      assertNoLocalProbe(execution?.leaseToken);
      if(execution){validateLocalExecution(text,execution);if(execution.mode==='LOCAL_BOUNDED_PROBE'&&this.worker)throw Error('BOUNDED_PROBE_REQUIRES_COLD_IDLE_RUNTIME');if(execution.mode==='LOCAL_DRAFT_BATCH'&&execution.inputHash!==textHash(text))throw Error('APPROVED_TTS_INPUT_CHANGED');}
      const key = JSON.stringify(this.cfg()) + version;
      this.resourceSamples=[];this.chunkProgress=[];this.phases={};this.modelLoads=0;this.workerStarts=0;this.lastAdmission=undefined;this.resourceInputHash=textHash(text);
      const automaticProduction=this.deadline?.policy==='AUTOMATIC_PRODUCTION';
      const warm=!!this.worker&&this.workerKey===key;
      const block=ttsResourceBlock(freemem(),warm);
      if(block&&(!automaticProduction||process.platform!=='win32'))throw new TtsExecutionError(
        automaticProduction?'ADMISSION_DENIED':'RESOURCE_GUARD_STOP',
        automaticProduction?'ADMISSION_DENIED: physical memory below emergency floor':block);
      if(!warm)await this.closeAndWait();
      if(process.platform==='win32')await this.requireAdmission(warm?'WARM':'COLD',automaticProduction);
      if (!this.worker || this.workerKey !== key) {
        this.workerStarts++;
        this.worker = spawn(
          this.python(),
          [path.resolve('scripts/kokoro-studio.py')],
          { windowsHide: true, env: this.env() },
        );
        this.workerKey = key;
        this.lastOwned=this.worker;
        this.worker.stderr.resume();
        this.worker.on('error', () => {});
        this.worker.stdin.on('error', () => {});
        const launched = this.worker;
        this.worker.on('close', () => {
          if (this.worker === launched) this.worker = undefined;
        });
      }
      const worker = this.worker;
      if(ttsRemainingSynthesis(this.deadline,Date.now())<=0)
        throw new TtsExecutionError('TIMEOUT','Scene audio deadline exceeded');
      return await new Promise<SynthesisMetrics|undefined>((resolve, reject) => {
        let buffer = '';
        let settled=false;
        let resourceTimer:ReturnType<typeof setInterval>|undefined;
        const duration=ttsRemainingSynthesis(this.deadline,Date.now());
        const timer = setTimeout(() => finish(new TtsExecutionError('TIMEOUT','Kokoro inference deadline exceeded')),Math.max(1,duration));
        const finish = (err?: Error,metrics?:SynthesisMetrics) => {
          if(settled)return;settled=true;this.phases.finished=Date.now();
          clearTimeout(timer);
          if(resourceTimer)clearInterval(resourceTimer);
          worker.stdout.off('data', read);
          worker.off('close', closed);
          worker.off('error', failed);
          if(err){this.close();reject(err);}else resolve(metrics&&{...metrics,admission:this.lastAdmission,deadline:this.deadline,phaseMs:this.phaseMs()});
        };
        resourceTimer=setInterval(()=>{if(freemem()/1024**2<TTS_RESOURCE_POLICY.stopMiB)finish(new TtsExecutionError('RESOURCE_GUARD_STOP','RESOURCE_GUARD_STOP: available RAM below 256 MiB; owned worker stopped'));},250);
        const closed = (code:number|null,signal:string|null) => {const allocation=code!==null&&[0xc0000017,0xc000012d].includes(code>>>0);finish(new TtsExecutionError(allocation?'ALLOCATION_FAILURE':'UNKNOWN',`Kokoro worker exited (code=${code}, signal=${signal}); no Windows OOM evidence`,{exitCode:code,signal}));};
        const failed = () => finish(Error('Kokoro worker launch failed'));
        const read = (chunk: Buffer) => {
          buffer += chunk.toString();
          if (buffer.length > 200000) {
            this.close();
            finish(Error('Kokoro worker output limit'));
            return;
          }
          const lines = buffer.split('\n');
          buffer = lines.pop() || '';
          for (const line of lines)
            if (line.startsWith('@STUDIO@')) {
              try {
                const r = JSON.parse(line.slice(8));
                if(r.resource){this.resourceSamples.push(r.resource);if(this.resourceSamples.length>2048)this.resourceSamples.shift();if(r.resource.systemCommitAvailableMiB!==undefined&&r.resource.systemCommitAvailableMiB<TTS_RESOURCE_POLICY.commitStopMiB){finish(new TtsExecutionError('RESOURCE_GUARD_STOP','RESOURCE_GUARD_STOP: system commit reserve below 512 MiB'));continue;}}
                if(r.progress){if(r.progress.index===r.progress.total)this.phases.assembling=Date.now();this.chunkProgress.push(r.progress);if(this.chunkProgress.length>512)this.chunkProgress.shift();}
                if(r.stage){
                  if(r.stage==='Importing runtime')this.phases.importing=Date.now();
                  if(r.stage==='Model loaded'){this.modelLoads++;this.phases.modelLoaded=Date.now();}
                  if(r.stage==='Synthesizing')this.phases.synthesizing=Date.now();
                  this.onStage?.(r.stage);continue;
                }
                if(r.ok===undefined)continue;
                const category=['RESOURCE_GUARD_STOP','ALLOCATION_FAILURE','UNKNOWN'].includes(r.category)?r.category:'UNKNOWN';
                finish(r.ok ? undefined : new TtsExecutionError(category,r.error,r.details),r.metrics);
              } catch {
                finish(Error('Kokoro worker protocol error'));
              }
            }
        };
        worker.stdout.on('data', read);
        worker.once('close', closed);
        worker.once('error', failed);
        worker.stdin.write(JSON.stringify({ text, voice, output, baseKey }) + '\n');
      });
    } catch(error) {
      try{await this.closeAndWait();}catch{throw new TtsExecutionError('CLEANUP_UNVERIFIED','RESOURCE_CLEANUP_UNVERIFIED');}
      throw error;
    } finally {
      this.pending = false;
      this.idle = setTimeout(() => this.close(), 60000);
      this.idle.unref();
    }
  }
  async generate(
    sessionId: string,
    text: string,
    voice: string,
    speed: number,
    runtime: VoiceRuntime,
    force = false,
    context?:{itemId:string;normalizationVersion:string},
    execution?:LocalTtsExecution,
    productionDeadlineAt?:number,
  ) {
    const filter = atempoFilter(speed);
    this.deadline=ttsDeadlines(Date.now(),execution,productionDeadlineAt);
    this.boundedDeadline=this.deadline.totalDeadlineAt;
    this.resourceInputHash=textHash(text);this.lastAdmission=undefined;this.phases={};this.chunkProgress=[];this.resourceSamples=[];this.modelLoads=0;this.workerStarts=0;
    try {
    if(this.boundedDeadline!==undefined&&Date.now()>=this.boundedDeadline)
      throw new TtsExecutionError('TIMEOUT','Scene audio deadline exceeded');
    if(execution){validateLocalExecution(text,execution);if(execution.mode==='LOCAL_BOUNDED_PROBE'&&!force)throw Error('BOUNDED_PROBE_MUST_MEASURE_UNCACHED_COLD_START');if(execution.mode==='LOCAL_DRAFT_BATCH'&&execution.inputHash!==textHash(text))throw Error('APPROVED_TTS_INPUT_CHANGED');}
    const cacheOnly=runtime.status==='BLOCKED_RUNTIME'&&runtime.blockers.length>0&&runtime.blockers.every(b=>b.includes('BLOCKED_RESOURCE'));
    if (
      runtime.status !== 'READY' && !cacheOnly ||
      !runtime.voices.some((v) => v.id === voice)
    )
      throw Error(
        'BLOCKED_RUNTIME: missing dependencies/model/voicepack; no download attempted',
      );
    const dataRoot = this.dataRoot();
    const root = path.join(dataRoot, 'audio', sessionId);
    const assets = path.join(root, 'assets');
    const temp = path.join(root, 'temp');
    await fs.mkdir(assets, { recursive: true });
    await fs.mkdir(temp, { recursive: true });
    const {baseKey,cacheKey}=ttsCacheKeys(text,voice,speed,runtime,context);
    const suffix = force ? '-' + Date.now() : '';
    const file = path.join(assets, cacheKey + suffix + '.wav');
    let cacheHit = false;
    let synthesisPerformed = false;
    let baseCacheHit = false;
    let synthesisMetrics:SynthesisMetrics|undefined;
    try {
      await fs.access(file);
      cacheHit = true;
    } catch {
      const base = path.join(assets, baseKey + suffix + '-base.wav');
      try {
        await fs.access(base);
        baseCacheHit = true;
      } catch {
        if(cacheOnly)throw Error('BLOCKED_RESOURCE: matching cached audio unavailable; inference was not started');
        const raw = path.join(temp, baseKey + '-' + Date.now() + '.wav');
        synthesisMetrics=await this.synthesize(text, voice, raw, runtime.modelVersion,baseKey,execution);
        synthesisPerformed = true;
        await fs.rename(raw, base);
      }
      this.onStage?.('Audio processing');
      const staged=path.join(temp,randomUUID()+'.wav');
      try {
        await this.run('ffmpeg',['-n','-i',base,'-filter:a',filter,'-c:a','pcm_s16le',staged],60000);
        await this.validateAudio(staged);
        const handle=await fs.open(staged,'r+');
        try{await handle.sync();}finally{await handle.close();}
        await fs.rename(staged,file);
      } finally {
        await fs.unlink(staged).catch(()=>undefined);
      }
    }
    const durationMs=await this.validateAudio(file);
    return {
      filePath: path
        .relative(dataRoot, file)
        .replace(/\\/g, '/'),
      durationMs,
      durationEvidence: 'FFPROBE' as const,
      cacheKey,
      cacheHit,
      baseCacheHit,
      synthesisPerformed,
      synthesisMetrics,
    };
    } finally { this.boundedDeadline=undefined; }
  }
  async validateAudio(file: string) {
    this.onStage?.('FFprobe validation');
    try {
    const probe = JSON.parse(
      await this.run('ffprobe', [
        '-v',
        'error',
        '-show_entries',
        'format=duration:stream=codec_name,sample_rate,channels',
        '-of',
        'json',
        file,
      ]),
    );
    const stream=probe.streams?.[0];
    if(probe.streams?.length!==1||stream?.codec_name!=='pcm_s16le'||Number(stream.sample_rate)!==24000||stream.channels!==1)
      throw Error('Invalid measured PCM audio format');
    const durationMs = Math.round(Number(probe.format?.duration) * 1000);
    if (!Number.isFinite(durationMs) || durationMs <= 0)
      throw Error('Invalid measured audio duration');
    const volume = await this.run(
      'ffmpeg',
      ['-hide_banner', '-xerror', '-nostats', '-i', file, '-af', 'volumedetect', '-f', 'null', '-'],
      60000,
      true,
    );
    const peak = Number(volume.match(/max_volume:\s*(-?[\d.]+|-?inf) dB/)?.[1]);
    if (!Number.isFinite(peak) || peak < -80)
      throw Error('Audio is silent or level could not be verified');
    return durationMs;
    } catch(error) {
      if(error instanceof TtsExecutionError)throw error;
      throw new TtsExecutionError('AUDIO_VALIDATION_FAILED',(error as Error).message);
    }
  }
}
