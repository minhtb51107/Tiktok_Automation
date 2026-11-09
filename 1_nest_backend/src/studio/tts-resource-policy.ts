/** Advisory headroom is deliberately separate from emergency stop conditions. */
export const TTS_RESOURCE_POLICY = {version:'tts-resource/2',coldWarningMiB:1536,warmWarningMiB:384,stopMiB:256,commitStopMiB:512,probeMaxCharacters:160,probeTimeoutMs:90000};
export type TtsFailureCategory='RESOURCE_GUARD_STOP'|'ALLOCATION_FAILURE'|'TIMEOUT'|'WINDOWS_OOM_EVIDENCE'|'UNKNOWN';
export class TtsExecutionError extends Error {
 constructor(readonly category:TtsFailureCategory,message:string,readonly evidence?:Record<string,unknown>){super(message);}
}
export function ttsResourceBlock(availableBytes:number,warm=false){
 const availableMiB=Math.floor(availableBytes/1024**2);
 return availableMiB<TTS_RESOURCE_POLICY.stopMiB?`RESOURCE_GUARD_STOP: ${availableMiB} MiB available, below ${TTS_RESOURCE_POLICY.stopMiB} MiB emergency floor. No inference started.`:null;
}
export function ttsResourceWarnings(availableBytes:number,warm=false){
 const availableMiB=Math.floor(availableBytes/1024**2),warning=warm?TTS_RESOURCE_POLICY.warmWarningMiB:TTS_RESOURCE_POLICY.coldWarningMiB;
 return availableMiB<warning?[`LOW_HEADROOM_WARNING: ${availableMiB} MiB available; ${warning} MiB is advisory, NOT a benchmarked minimum.`]:[];
}
export function ttsFailureCategory(error:unknown):TtsFailureCategory {
 if(error instanceof TtsExecutionError)return error.category;
 const message=error instanceof Error?error.message:'';
 if(/^(?:RESOURCE_GUARD_STOP|BLOCKED_RESOURCE):/.test(message))return 'RESOURCE_GUARD_STOP';
 return 'UNKNOWN'; // A process exit or the word OOM is not Windows evidence.
}
export interface BoundedProbeExecution {
 mode:'LOCAL_BOUNDED_PROBE';approvalId:string;leaseToken:string;approved:true;
}
export const DRAFT_TTS_LIMITS={workerTimeoutMs:240000,totalTimeoutMs:300000,maxCharacters:2000};
export interface ApprovedDraftExecution {
 mode:'LOCAL_DRAFT_BATCH';approvalId:string;leaseToken:string;approved:true;
 inputHash:string;deadlineAt:number;
}
export type LocalTtsExecution=BoundedProbeExecution|ApprovedDraftExecution;
export function validateLocalExecution(text:string,execution:LocalTtsExecution){
 if(execution.mode==='LOCAL_BOUNDED_PROBE')return validateBoundedProbe(text,execution);
 if(execution.mode!=='LOCAL_DRAFT_BATCH'||execution.approved!==true||!/^[a-f0-9-]{36}$/.test(execution.approvalId)||!/^[a-f0-9-]{36}$/.test(execution.leaseToken)||!/^[a-f0-9]{64}$/.test(execution.inputHash)||!text.trim()||[...text].length>DRAFT_TTS_LIMITS.maxCharacters||!Number.isFinite(execution.deadlineAt)||execution.deadlineAt<=Date.now()||execution.deadlineAt>Date.now()+DRAFT_TTS_LIMITS.totalTimeoutMs+1000)throw Error('INVALID_APPROVED_DRAFT_EXECUTION');
}
export function validateBoundedProbe(text:string,execution:BoundedProbeExecution){
 if(execution.mode!=='LOCAL_BOUNDED_PROBE'||execution.approved!==true||!/^[a-f0-9-]{36}$/.test(execution.approvalId)||!/^[a-f0-9-]{36}$/.test(execution.leaseToken)||!text.trim()||[...text].length>TTS_RESOURCE_POLICY.probeMaxCharacters)throw Error('INVALID_BOUNDED_PROBE_APPROVAL_OR_TEXT');
}
export interface SynthesisMetrics {
 inputCharacters:number; sentenceChunks:number; maxSentenceCharacters:number;
 elapsedMs:number; peakRssMiB:number|null; peakPrivateMiB:number|null; minimumAvailableMiB:number|null;
 modelBefore?:unknown; modelAfter?:unknown;
 runtimeBefore?:unknown;runtimeAfter?:unknown;inferenceBefore?:unknown;inferenceAfter?:unknown;
}
