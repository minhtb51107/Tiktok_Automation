import { spawn, ChildProcessWithoutNullStreams } from 'child_process';
import { createHash } from 'crypto';
import { promises as fs } from 'fs';
import * as path from 'path';
import type { VoiceRuntime } from './voice.types';
import { atempoFilter } from './voice-settings';
import {freemem} from 'os';
import {TTS_RESOURCE_POLICY,ttsResourceBlock,SynthesisMetrics} from './tts-resource-policy';
export const textHash = (text: string) =>
  createHash('sha256').update(text).digest('hex');
export function ttsCacheKeys(text:string,voice:string,speed:number,runtime:VoiceRuntime,context?:{itemId:string;normalizationVersion:string}) {
  const baseKey=textHash(JSON.stringify({text,voice,version:runtime.packageVersion,model:runtime.modelVersion,device:runtime.device,context:context||null,synthesisRate:1}));
  return {baseKey,cacheKey:textHash(baseKey+':'+speed)};
}
export class KokoroRuntime {
  private resourceSamples:Record<string,number>[]=[];
  private resourceInputHash:string|null=null;
  diagnostics(){return {inputHash:this.resourceInputHash,workerPid:this.worker?.pid??null,samples:structuredClone(this.resourceSamples)};}
  onStage?: (step:string)=>void;
  private worker?: ChildProcessWithoutNullStreams;
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
      const p = spawn(command, args, { windowsHide: true, env: this.env() });
      let out = '';
      const timer = setTimeout(() => {
        p.kill();
        reject(Error('Runtime command timeout'));
      }, timeout);
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
          freemem()/1024**2<TTS_RESOURCE_POLICY.preflightMiB?'--inspect':'--preflight',
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
      checkedAt: new Date().toISOString(),
    };
    this.checked = { key, at: Date.now(), result };
    return result;
  }
  close() {
    if (this.idle) clearTimeout(this.idle);
    this.worker?.kill();
    this.worker = undefined;
  }
  private async synthesize(
    text: string,
    voice: string,
    output: string,
    version: string,
  ) {
    if (this.pending) throw Error('Sequential TTS worker busy');
    this.pending = true;
    if (this.idle) clearTimeout(this.idle);
    try {
      const key = JSON.stringify(this.cfg()) + version;
      this.resourceSamples=[];this.resourceInputHash=textHash(text);
      const block=ttsResourceBlock(freemem(),!!this.worker&&this.workerKey===key);
      if(block)throw Error(block);
      if (!this.worker || this.workerKey !== key) {
        this.close();
        this.worker = spawn(
          this.python(),
          [path.resolve('scripts/kokoro-studio.py')],
          { windowsHide: true, env: this.env() },
        );
        this.workerKey = key;
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
        const timer = setTimeout(() => {
          this.close();
          reject(Error('Kokoro inference timeout'));
        }, 120000);
        const finish = (err?: Error,metrics?:SynthesisMetrics) => {
          if(settled)return;settled=true;
          clearTimeout(timer);
          if(resourceTimer)clearInterval(resourceTimer);
          worker.stdout.off('data', read);
          worker.off('close', closed);
          worker.off('error', failed);
          if(err){this.close();reject(err);}else resolve(metrics);
        };
        resourceTimer=setInterval(()=>{if(freemem()/1024**2<TTS_RESOURCE_POLICY.stopMiB)finish(Error('BLOCKED_RESOURCE: available RAM below 256 MiB; owned Kokoro worker stopped'));},250);
        const closed = () => finish(Error('Kokoro worker closed'));
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
                if(r.resource){this.resourceSamples.push(r.resource);if(this.resourceSamples.length>512)this.resourceSamples.shift();}
                if(r.stage){this.onStage?.(r.stage);continue;}
                if(r.ok===undefined)continue;
                finish(r.ok ? undefined : Error(r.error),r.metrics);
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
  ) {
    const filter = atempoFilter(speed);
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
        synthesisMetrics=await this.synthesize(text, voice, raw, runtime.modelVersion);
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
