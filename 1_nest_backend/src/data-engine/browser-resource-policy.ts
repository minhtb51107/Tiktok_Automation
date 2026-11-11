/** Protective thresholds, not benchmarked browser minimums. No environment bypass. */
export const BROWSER_RESOURCE_POLICY = {
  version: 'threads-browser-resource/2', advisoryAvailableMiB: 384,
  emergencyAvailableMiB: 256, emergencyCommitReserveMiB: 512,
  sampleMs: 250, sampleStaleMs:2000, gracefulCloseMs: 3000, monitorResponseMs: 5000,
} as const;
export interface BrowserMemorySample {
  availableMiB: number; systemCommitAvailableMiB: number;
  systemCommitUsedMiB: number; systemCommitLimitMiB: number;
  browserRssMiB: number; browserPrivateMiB: number;
  ownedPids: number[];
}
export function browserResourceDecision(s: BrowserMemorySample) {
  if (![s.availableMiB,s.systemCommitAvailableMiB,s.systemCommitUsedMiB,s.systemCommitLimitMiB]
    .every(v=>typeof v==='number'&&Number.isFinite(v)&&v>=0))
    return {warning:null,stop:'CONVERSATION_RESOURCE_MEASUREMENT_UNAVAILABLE'};
  const warning=s.availableMiB<BROWSER_RESOURCE_POLICY.advisoryAvailableMiB?'LOW_HEADROOM_ADVISORY_NOT_BENCHMARKED_MINIMUM':null;
  return {warning,stop:s.availableMiB<BROWSER_RESOURCE_POLICY.emergencyAvailableMiB
    ?'CONVERSATION_RESOURCE_GUARD_STOP_PHYSICAL'
    :s.systemCommitAvailableMiB<BROWSER_RESOURCE_POLICY.emergencyCommitReserveMiB
      ?'CONVERSATION_RESOURCE_GUARD_STOP_COMMIT':null};
}
export type BrowserFailureCategory='RESOURCE_GUARD_STOP'|'TIMEOUT'|'ALLOCATION_FAILURE'|'UNKNOWN';
export function browserFailureCategory(code: string): BrowserFailureCategory {
  if(code.startsWith('CONVERSATION_RESOURCE_GUARD_STOP'))return 'RESOURCE_GUARD_STOP';
  if(code==='CONVERSATION_TIME_BUDGET')return 'TIMEOUT';
  if(code==='ENOMEM')return 'ALLOCATION_FAILURE';
  return 'UNKNOWN'; // Process exits and error text containing OOM are not Windows OOM evidence.
}
export interface BrowserResourceReport {
  policy:typeof BROWSER_RESOURCE_POLICY; samples:number; warnings:string[];
  minimumAvailableMiB:number|null; minimumCommitReserveMiB:number|null;
  peakSampledBrowserRssMiB:number|null; peakSampledBrowserPrivateMiB:number|null;
  ownedPids:number[]; forcedPids:number[]; remainingPids:number[]|null;
  stopCode:string|null; failureCategory:BrowserFailureCategory|null;
  cleanupVerified:boolean; monitorExited:boolean; windowsOomEvidence:null;
}
