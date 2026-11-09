import { createHash } from 'crypto';
import { promises as fs } from 'fs';
import * as path from 'path';
import type { StudioSession } from './studio.contracts';
import { normalizeSpokenNumbers,NUMBER_READING_VERSION } from './spoken-numbers';
const digest=(text:string)=>createHash('sha256').update(text).digest('hex');
export async function sessionReadiness(s:StudioSession,root=path.resolve('.studio-data')) {
 const items=[];
 for(const i of s.items.filter(i=>i.selected)){
  const text=digest(i.spokenText), normalized=normalizeSpokenNumbers(i.spokenText);
  let asset:NonNullable<StudioSession['voiceAssets']>[number]|undefined;
  for(const a of [...(s.voiceAssets||[])].reverse()){
   if(a.itemId!==i.id||a.status==='STALE'||a.itemRevision!==i.revision||a.textHash!==text||a.spokenText!==i.spokenText||a.voice!==i.voiceSettings?.voice||a.speed!==i.voiceSettings?.speed||!Number.isFinite(a.durationMs)||a.durationMs<=0)continue;
   if(/\d/.test(i.spokenText)&&(a.numberReadingVersion!==NUMBER_READING_VERSION||a.ttsInputHash!==digest(normalized.text)))continue;
   const file=path.resolve(root,a.filePath),prefix=path.resolve(root,'audio',s.id,'assets')+path.sep;
   if(!file.startsWith(prefix)||!(await fs.stat(file).catch(()=>null))?.isFile())continue;
   asset=a;break;
  }
  const script=i.spokenApproval?.valid&&i.spokenApproval.revision===i.revision&&i.spokenApproval.textHash===text?'APPROVED':'DRAFT';
  items.push({itemId:i.id,revision:i.revision,script,voice:asset?.status==='APPROVED'&&asset.approvedAt?'APPROVED':asset?'DRAFT':'MISSING',assetId:asset?.id||null,durationMs:asset?.durationMs||null,
   productionApproved:false,reason:'Readiness is not FINAL/publishing authorization'});
 }
 return {sessionId:s.id,sessionRevision:s.revision,scope:'PROJECT_PREPARATION_ONLY',items,renderMode:s.productionOrigin?'DRAFT_ONLY':'REQUIRES_RENDER_VALIDATION',publishingAllowed:false,finalAllowed:false};
}
