import { promises as fs } from 'fs';
import * as path from 'path';
import { spawn } from 'child_process';
import { BadRequestException, ConflictException } from '@nestjs/common';
import type { RenderManifest, RenderSnapshot } from './render.types';
import { JobCancelled, StudioJobs, type ProgressSink } from './progress';

export class RenderStore {
  constructor(private root = path.resolve('.studio-data/renders')) {}
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
    let cancelled=false;
    const child=spawn(process.execPath,[path.resolve('scripts/studio-render.cjs'),dir],{
      windowsHide:true,stdio:['ignore','pipe','pipe','ipc'],
      env:{...process.env,NODE_OPTIONS:'--max-old-space-size=768'},
    });
    const unsubscribe=jobs.onCancel(m.jobId,()=>{cancelled=true;if(child.connected)child.send({cancel:true});});
    let tail='',pending=Promise.resolve();
    const log=await fs.open(path.join(dir,'worker.log'),'a');
    child.stderr.on('data',b=>{tail=(tail+b.toString()).slice(-2000);void log.write(b).catch(()=>{});});
    child.stdout.on('data',b=>{void log.write(b).catch(()=>{});});
    child.on('message',(event:any)=>{
      if(event?.step) pending=pending.then(()=>tick(event.step,event.completed,event.total));
    });
    // The worker owns Remotion cancellation and closes browser/server/encoder in finally.
    const watchdog=setTimeout(()=>{cancelled=true;if(child.connected)child.send({cancel:true});},45*60*1000);
    try {
      const code=await new Promise<number|null>((resolve,reject)=>{child.once('error',reject);child.once('close',resolve);});
      await pending;
      let result=await this.load(m.sessionId,m.jobId);
      if(result.status==='QUEUED'||result.status==='RUNNING') {
        result={...result,status:cancelled?'CANCELLED':'FAILED',completedAt:new Date().toISOString(),error:cancelled?null:'Render worker stopped unexpectedly; inspect local worker log'};
        await fs.writeFile(path.join(dir,'manifest.json'),JSON.stringify(result,null,2));
      }
      if(cancelled||result.status==='CANCELLED')throw new JobCancelled('Render cancelled; source and existing outputs retained');
      if(code!==0||result.status!=='COMPLETED')throw Error(result.error||'Render failed');
      return result;
    } finally {clearTimeout(watchdog);unsubscribe();await log.close();}
  }
}
