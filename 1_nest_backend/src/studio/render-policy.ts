import { createHash } from 'crypto';
import { BadRequestException } from '@nestjs/common';
import type { StudioSession } from './studio.contracts';
import type { VideoPreviewProps } from '../video-pipeline/contracts';
import type { RenderRequest } from './render.types';
import { textHash } from './kokoro-runtime';
import { spokenAmbiguities } from './voice-settings';
import { fitBackground } from '../video-pipeline/editing';
export function renderBackground(props:VideoPreviewProps,mode:'SAVED'|'FIT'|'LOOP'='SAVED'):VideoPreviewProps {
  if(!['SAVED','FIT','LOOP'].includes(mode))throw new BadRequestException('Invalid background mode');
  if(mode==='SAVED')return props;
  const out=structuredClone(props),total=Math.ceil(props.timeline.totalFrames*1000/props.timeline.fps);
  out.backgroundTracks=(out.backgroundTracks||[]).map(c=>{const a=out.mediaAssets.find(a=>a.id===c.assetId);return c.enabled?fitBackground(c,total,a?.durationMs||c.sourceOutMs,mode):c;});
  return out;
}

export const snapshotHash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
export function validateRenderRequest(body: RenderRequest, props: VideoPreviewProps) {
  if (!body || !Number.isInteger(body.revision) || !['DRAFT','FINAL'].includes(body.mode) ||
      !['1080P','720P'].includes(body.preset) || typeof body.requestId !== 'string' ||
      !/^[a-zA-Z0-9-]{1,100}$/.test(body.requestId)) throw new BadRequestException('Invalid render request');
  const range = body.frameRange ?? [0, props.timeline.totalFrames - 1];
  if (!Array.isArray(range) || range.length !== 2 || range.some(n=>!Number.isInteger(n)) || range[0]<0 || range[1]<range[0] || range[1]>=props.timeline.totalFrames)
    throw new BadRequestException('Frame range must be inside the saved timeline');
  return range as [number,number];
}
export function renderValidation(s: StudioSession, props: VideoPreviewProps) {
  const warnings: string[] = [], blockers: string[] = [], finalBlockers: string[] = [];
  for (const t of props.timeline.scenes) {
    const item = s.items.find(i=>i.id===t.scene.id && i.selected);
    const a = s.voiceAssets?.find(a=>a.id===t.scene.audioAssetId && a.itemId===item?.id);
    if (!item || !a || a.status==='STALE' || a.textHash!==textHash(item.spokenText) || a.spokenText!==item.spokenText || a.voice!==item.voiceSettings?.voice || a.speed!==item.voiceSettings?.speed)
      blockers.push(`${t.scene.id}: generate matching narration before rendering`);
    else {
      if (!item.spokenApproval?.valid || item.spokenApproval.textHash!==a.textHash || a.status!=='APPROVED' || !a.approvedAt)
        finalBlockers.push(`${item.id}: spoken text and audio require explicit approval`);
      if (spokenAmbiguities(item.spokenText).length || item.contentMapping?.status==='REVIEW_REQUIRED')
        finalBlockers.push(`${item.id}: unresolved language/topic review`);
      if (t.scene.visual?.voiceEnabled===false) warnings.push(`${item.id}: voice is muted in saved Editor`);
      if (t.scene.visual?.voiceDurationMs!==undefined && t.scene.visual.voiceDurationMs<a.durationMs-(t.scene.visual.voiceSourceInMs||0))
        warnings.push(`${item.id}: user-saved voice trim excludes part of the narration`);
    }
  }
  const remote=props.mediaAssets.filter(a=>/^https?:/.test(a.uri));
  if(remote.length)warnings.push(`${remote.length} remote media references are not available to offline render`);
  let covered=0;
  for(const c of (props.backgroundTracks||[]).filter(c=>c.enabled).sort((a,b)=>a.startMs-b.startMs)){
    if(c.startMs>covered)break;
    covered=Math.max(covered,c.startMs+c.durationMs);
  }
  if((props.backgroundTracks||[]).some(c=>c.enabled)&&covered+1000/props.timeline.fps<props.timeline.totalFrames*1000/props.timeline.fps)
    warnings.push(`Saved global background covers ${covered}ms from start; timeline is ${(props.timeline.totalFrames*1000/props.timeline.fps).toFixed(0)}ms. Scene fallback/background gaps are preserved; extend in Editor if desired.`);
  return {warnings,blockers,finalBlockers};
}
