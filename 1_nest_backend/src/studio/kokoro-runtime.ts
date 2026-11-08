import { spawn, ChildProcessWithoutNullStreams } from 'child_process';
import { createHash } from 'crypto';
import { promises as fs } from 'fs';
import * as path from 'path';
import type { VoiceRuntime } from './voice.types';
import { atempoFilter } from './voice-settings';
import {freemem} from 'os';
import {TTS_RESOURCE_POLICY,ttsResourceBlock,ttsResourceWarnings,SynthesisMetrics,LocalTtsExecution,validateLocalExecution,TtsExecutionError,DRAFT_TTS_LIMITS} from './tts-resource-policy';
import {assertNoLocalProbe} from './local-probe-lease';
export const textHash = (text: string) =>
  createHash('sha256').update(text).digest('hex');
export function ttsCacheKeys(text:string,voice:string,speed:number,runtime:VoiceRuntime,context?:{itemId:string;normalizationVersion:string}) {
  const baseKey=textHash(JSON.stringify({text,voice,version:runtime.packageVersion,model:runtime.modelVersion,device:runtime.device,context:context||null,synthesisRate:1}));
  return {baseKey,cacheKey:textHash(baseKey+':'+speed)};
}
export class KokoroRuntime {
  private resourceSamples:Record<string,number>[]=[];
  private resourceInputHash:string|null=null;
  diagnostics(){return {inputHash:this.resourceInputHash,workerPid:this.worker?.pid??null,ownedWorkerPid:this.lastOwned?.pid??null,samples:structuredClone(this.resourceSamples)};}
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
  ): Promise<string> {
    return new Promise((resolve, reject) => {
      if(this.boundedDeadline&&Date.now()>=this.boundedDeadline){reject(new TtsExecutionError('TIMEOUT','Bounded probe total deadline exceeded'));return;}
      const p = spawn(command, args, { windowsHide: true, env: this.env() });
      this.commands.add(p);
      let out = '';
      const timer = setTimeout(() => {
        p.kill();
        reject(new TtsExecutionError('TIMEOUT','Runtime command deadline exceeded'));
      }, this.boundedDeadline?Math.min(timeout,Math.max(1,this.boundedDeadline-Date.now())):timeout);
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
  async preflight(force = false): Promise<VoiceRuntime> {
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
        ]),
      );
    } catch {
      data = { blockers: ['Python preflight unavailable'] };
    }
    let ffmpeg = false,
      ffprobe = false;
    try {
      await this.run('ffmpeg', ['-version']);
      ffmpeg = true;
    } catch {}
    try {
      await this.run('ffprobe', ['-version']);
      ffprobe = true;
    } catch {}
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
  private async synthesize(
    text: string,
    voice: string,
    output: string,
    version: string,
    execution?:LocalTtsExecution,
  ) {
    if (this.pending) throw Error('Sequential TTS worker busy');
    this.pending = true;
    if (this.idle) clearTimeout(this.idle);
    try {
      assertNoLocalProbe(execution?.leaseToken);
      if(execution){validateLocalExecution(text,execution);if(execution.mode==='LOCAL_BOUNDED_PROBE'&&this.worker)throw Error('BOUNDED_PROBE_REQUIRES_COLD_IDLE_RUNTIME');if(execution.mode==='LOCAL_DRAFT_BATCH'&&execution.inputHash!==textHash(text))throw Error('APPROVED_TTS_INPUT_CHANGED');}
      const key = JSON.stringify(this.cfg()) + version;
      this.resourceSamples=[];this.resourceInputHash=textHash(text);
      const block=ttsResourceBlock(freemem(),!!this.worker&&this.workerKey===key);
      if(block)throw new TtsExecutionError('RESOURCE_GUARD_STOP',block);
      if (!this.worker || this.workerKey !== key) {
        this.close();
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
      return await new Promise<SynthesisMetrics|undefined>((resolve, reject) => {
        let buffer = '';
        let settled=false;
        let resourceTimer:ReturnType<typeof setInterval>|undefined;
        const duration=execution?.mode==='LOCAL_DRAFT_BATCH'?Math.min(DRAFT_TTS_LIMITS.workerTimeoutMs,execution.deadlineAt-Date.now()):execution?TTS_RESOURCE_POLICY.probeTimeoutMs:120000;
        const timer = setTimeout(() => finish(new TtsExecutionError('TIMEOUT','Kokoro inference deadline exceeded')),Math.max(1,duration));
        const finish = (err?: Error,metrics?:SynthesisMetrics) => {
          if(settled)return;settled=true;
          clearTimeout(timer);
          if(resourceTimer)clearInterval(resourceTimer);
          worker.stdout.off('data', read);
          worker.off('close', closed);
          worker.off('error', failed);
          if(err){this.close();reject(err);}else resolve(metrics);
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
                if(r.stage){this.onStage?.(r.stage);continue;}
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
        worker.stdin.write(JSON.stringify({ text, voice, output }) + '\n');
      });
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
  ) {
    const filter = atempoFilter(speed);
    this.boundedDeadline=execution?.mode==='LOCAL_DRAFT_BATCH'?execution.deadlineAt:execution?Date.now()+120000:undefined;
    if(execution){validateLocalExecution(text,execution);if(execution.mode==='LOCAL_BOUNDED_PROBE'&&!force)throw Error('BOUNDED_PROBE_MUST_MEASURE_UNCACHED_COLD_START');if(execution.mode==='LOCAL_DRAFT_BATCH'&&execution.inputHash!==textHash(text))throw Error('APPROVED_TTS_INPUT_CHANGED');}
    const cacheOnly=runtime.status==='BLOCKED_RUNTIME'&&runtime.blockers.length>0&&runtime.blockers.every(b=>b.includes('BLOCKED_RESOURCE'));
    if (
      runtime.status !== 'READY' && !cacheOnly ||
      !runtime.voices.some((v) => v.id === voice)
    )
      throw Error(
        'BLOCKED_RUNTIME: missing dependencies/model/voicepack; no download attempted',
      );
    const root = path.resolve('.studio-data/audio', sessionId);
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
        synthesisMetrics=await this.synthesize(text, voice, raw, runtime.modelVersion,execution);
        synthesisPerformed = true;
        await fs.rename(raw, base);
      }
      this.onStage?.('Audio processing');
      await this.run(
        'ffmpeg',
        ['-n', '-i', base, '-filter:a', filter, '-c:a', 'pcm_s16le', file],
        60000,
      );
    }
    this.onStage?.('FFprobe validation');
    const probe = JSON.parse(
      await this.run('ffprobe', [
        '-v',
        'error',
        '-show_entries',
        'format=duration',
        '-of',
        'json',
        file,
      ]),
    );
    const durationMs = Math.round(Number(probe.format?.duration) * 1000);
    if (!Number.isFinite(durationMs) || durationMs <= 0)
      throw Error('Invalid measured audio duration');
    const volume = await this.run(
      'ffmpeg',
      ['-hide_banner', '-i', file, '-af', 'volumedetect', '-f', 'null', '-'],
      60000,
      true,
    );
    const peak = Number(volume.match(/max_volume:\s*(-?[\d.]+|-?inf) dB/)?.[1]);
    if (!Number.isFinite(peak) || peak < -80)
      throw Error('Audio is silent or level could not be verified');
    return {
      filePath: path
        .relative(path.resolve('.studio-data'), file)
        .replace(/\\/g, '/'),
      durationMs,
      cacheKey,
      cacheHit,
      baseCacheHit,
      synthesisPerformed,
      synthesisMetrics,
    };
  }
}
