import { describe, it, expect } from '@jest/globals';
import { renderValidation, validateRenderRequest, snapshotHash } from './render-policy';
import { buildStudioPreview } from '../video-pipeline/studio-preview';
import { StudioService } from './studio.service';
import { ScraperService } from '../modules/core/scraper/scraper.service';
import { StudioJobs } from './progress';
import { RenderStore } from './render-store';
import { promises as fs } from 'fs';
import * as path from 'path';
import * as os from 'os';
import { textHash } from './kokoro-runtime';

describe('Render safety contracts OFFLINE (not live MP4 proof)',()=>{
 it('gates stale/missing narration and FINAL separately from a playable DRAFT, without approving or rewriting source',async()=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'studio-render-policy-'));
  const service=new StudioService({} as ScraperService);Object.assign(service,{root});
  try{
   let s=await service.create();s=await service.mutate(s.id,{revision:s.revision,manual:{text:'Nội dung t cần review.',author:'Author',comments:''}});
   const i=s.items[0],before=i.originalText;i.voiceSettings={voice:'my_yen',speed:1.2};
   expect(renderValidation(s,buildStudioPreview(s).preview.request.inputProps).blockers).toHaveLength(1);
   s.voiceAssets=[{id:'draft',purpose:'DRAFT',itemId:i.id,itemRevision:i.revision,textHash:textHash(i.spokenText),spokenText:i.spokenText,voice:'my_yen',speed:1.2,model:'MOCK',modelVersion:'MOCK',cacheKey:'mock',durationMs:2100,filePath:'unused',uri:'/api/studio/mock',createdAt:new Date().toISOString(),approvedAt:null,status:'GENERATED',cacheHit:false}];
   const props=buildStudioPreview(s).preview.request.inputProps,v=renderValidation(s,props);
   expect(v.blockers).toEqual([]);expect(v.finalBlockers.length).toBeGreaterThan(0);
   const request={revision:s.revision,mode:'DRAFT' as const,preset:'1080P' as const,requestId:'same-click',frameRange:[1,20] as [number,number]};
   const hash=snapshotHash(props);expect(validateRenderRequest(request,props)).toEqual([1,20]);expect(snapshotHash(props)).toBe(hash);
   for(const frameRange of [[-1,20],[20,1],[0,props.timeline.totalFrames],[0,1.5]])expect(()=>validateRenderRequest({...request,frameRange:frameRange as [number,number]},props)).toThrow();
   i.spokenText+=' changed';expect(renderValidation(s,props).blockers).toHaveLength(1);
   expect(i.originalText).toBe(before);expect(s.voiceAssets[0].approvedAt).toBeNull();
  }finally{await fs.rm(root,{recursive:true,force:true});}
 });
 it('delivers cancellation to the active worker and refuses arbitrary output paths',async()=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'studio-render-cancel-')),jobs=new StudioJobs(root);
  let ready!:()=>void,release!:()=>void,cancelled=false;
  const started=new Promise<void>(r=>ready=r),gate=new Promise<void>(r=>release=r);
  try{
   const job=await jobs.submit('a'.repeat(36),'render',{requestId:'test'},async(_,id)=>{
    const off=jobs.onCancel(id,()=>{cancelled=true;release();});ready();await gate;off();return {};
   });
   await started;await jobs.cancel(job.jobId);
   for(let n=0;n<100;n++){if((await jobs.load(job.jobId)).status==='CANCELLED')break;await new Promise(r=>setTimeout(r,10));}
   expect(cancelled).toBe(true);expect((await jobs.load(job.jobId)).status).toBe('CANCELLED');
   expect(()=>new RenderStore(root).directory('../other','../../file')).toThrow();
  }finally{release?.();await fs.rm(root,{recursive:true,force:true});}
 });
});
