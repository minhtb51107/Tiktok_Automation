import { promises as fs } from 'fs';
import * as path from 'path';
import { spawn } from 'child_process';
import { BadRequestException, ConflictException } from '@nestjs/common';
import type { RenderManifest, RenderSnapshot } from './render.types';
import { JobCancelled, StudioJobs, type ProgressSink } from './progress';
import { RenderProgress, RENDER_BUDGET_MS, type RenderFailure } from './render-progress';
import { replaceFile } from './atomic-file';

export function resolveRenderRoot(
  configured = process.env.STUDIO_DATA_ROOT,
  cwd = process.cwd(),
) {
  const dataRoot = configured
    ? path.resolve(configured)
    : path.resolve(cwd, '.studio-data');
  return path.join(dataRoot, 'renders');
}

export class RenderStore {
  constructor(private root = resolveRenderRoot()) {}
  directory(session: string, job: string) {
    if (![session,job].every(x=>/^[a-f0-9-]{36}$/.test(x))) throw new BadRequestException('Invalid render ID');
    return path.join(this.root,session,job);
  }
  async list(session: string): Promise<RenderManifest[]> {
    this.directory(session,session);
    const rows:RenderManifest[]=[];
    for(const name of await fs.readdir(path.join(this.root,session)).catch(()=>[])) {
      if(!/^[a-f0-9-]{36}$/.test(name))continue;
      const value=await this.load(session,name).catch(()=>null);
      if(value)rows.push(value);
    }
    return rows.sort((a,b)=>b.startedAt.localeCompare(a.startedAt));
  }
  async load(session: string, job: string): Promise<RenderManifest> {
    return JSON.parse(await fs.readFile(path.join(this.directory(session,job),'manifest.json'),'utf8'));
  }
  async output(session:string,job:string) {
    const m=await this.load(session,job);
    if(m.status!=='COMPLETED')throw new ConflictException('Render output is not completed');
    const file=path.join(this.directory(session,job),'video.mp4');
    if(!(await fs.stat(file)).size)throw new ConflictException('Output is missing');
    return file;
  }
  async run(snapshot:RenderSnapshot,jobs:StudioJobs,tick:ProgressSink) {
    const m=snapshot.manifest,dir=this.directory(m.sessionId,m.jobId);
    await fs.mkdir(dir,{recursive:true});
    await fs.writeFile(path.join(dir,'snapshot.json'),JSON.stringify(snapshot));
    await fs.writeFile(path.join(dir,'manifest.json'),JSON.stringify(m,null,2));
    const tracker = new RenderProgress(Date.now(), m.frameRange[1] - m.frameRange[0] + 1);
    let stopReason: RenderFailure | undefined;
    let lastStep = '', lastWrite = 0;
    const child=spawn(process.execPath,[path.resolve('scripts/studio-render.cjs'),dir],{
      windowsHide:true,stdio:['ignore','pipe','pipe','ipc'],
      env:{...process.env,NODE_OPTIONS:'--max-old-space-size=768'},
    });
    const stop = (reason: RenderFailure) => {
      if (stopReason) return;
      stopReason = reason;
      if (child.connected) child.send({cancel:true, reason}, () => {});
    };
    const unsubscribe=jobs.onCancel(m.jobId,()=>stop('USER_CANCELLED'));
    let pending=Promise.resolve();
    const log=await fs.open(path.join(dir,'worker.log'),'a');
    child.stderr.on('data',b=>{void log.write(b).catch(()=>{});});
    child.stdout.on('data',b=>{void log.write(b).catch(()=>{});});
    child.on('message',(event:any)=>{
      if (!event?.step && !event?.resource) return;
      const now = Date.now();
      tracker.update(now,event);
      const reading = tracker.view(now);
      jobs.setRenderProgress(m.jobId, reading);
      if (event.step && (event.step !== lastStep || now - lastWrite >= 15_000)) {
        lastWrite = now;
        lastStep = event.step;
        pending = pending.catch(()=>{}).then(()=>tick(event.step,reading.renderedFrames,reading.totalFrames));
      }
    });
    // The worker owns Remotion cancellation and closes browser/server/encoder in finally.
    const watchdog=setTimeout(()=>stop('RENDER_TIMEOUT'),RENDER_BUDGET_MS);
    const stallWatch=setInterval(()=>{
      const now=Date.now();
      jobs.setRenderProgress(m.jobId,tracker.view(now));
      if(tracker.stalled(now))stop('RENDER_STALLED');
    },5000);
    try {
      const code=await new Promise<number|null>((resolve)=>{child.once('error',()=>resolve(null));child.once('close',resolve);});
      await pending;
      let result=await this.load(m.sessionId,m.jobId);
      const progress = tracker.view(Date.now());
      jobs.setRenderProgress(m.jobId,progress);
      if(result.status!=='COMPLETED' || code!==0 || stopReason) {
        const failureCode = stopReason ?? result.failureCode ??
          (result.status === 'FAILED' ? 'RENDER_FAILED' : 'RENDER_WORKER_CRASH');
        result={...result,status:failureCode==='USER_CANCELLED'?'CANCELLED':'FAILED',
          completedAt:result.completedAt ?? new Date().toISOString(),
          failureCode,error:result.error?.startsWith(failureCode) ? result.error : failureCode,
          metrics:{...result.metrics,progress}};
        const manifest = path.join(dir,'manifest.json');
        await fs.writeFile(manifest+'.final.tmp',JSON.stringify(result,null,2));
        await replaceFile(manifest+'.final.tmp',manifest);
        if(failureCode==='USER_CANCELLED')throw new JobCancelled('USER_CANCELLED');
        throw Error(result.error);
      }
      return result;
    } finally {clearTimeout(watchdog);clearInterval(stallWatch);unsubscribe();await log.close();}
  }
}
