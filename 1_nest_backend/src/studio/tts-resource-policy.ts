/** Conservative cold-start budget after a 52-MiB abort; not a measured RSS limit. */
export const TTS_RESOURCE_POLICY = {version:'tts-resource/1',preflightMiB:768,coldStartMiB:1536,warmStartMiB:384,stopMiB:256};
export function ttsResourceBlock(availableBytes:number,warm=false){
 const availableMiB=Math.floor(availableBytes/1024**2),requiredMiB=warm?TTS_RESOURCE_POLICY.warmStartMiB:TTS_RESOURCE_POLICY.coldStartMiB;
 return availableMiB<requiredMiB?`BLOCKED_RESOURCE: ${availableMiB} MiB available; ${requiredMiB} MiB ${warm?'warm':'cold'}-start headroom required. No inference started.`:null;
}
export interface SynthesisMetrics {
 inputCharacters:number; sentenceChunks:number; maxSentenceCharacters:number;
 elapsedMs:number; peakRssMiB:number|null; peakPrivateMiB:number|null; minimumAvailableMiB:number|null;
 modelBefore?:unknown; modelAfter?:unknown;
}
