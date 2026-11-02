export interface ClipRange {
  startMs: number;
  durationMs: number;
  sourceInMs: number;
  sourceOutMs: number;
  loop: boolean;
}
// Chromium truncates requested media time to microseconds. At a fractional
// frame boundary that can select the previous PTS. Only correct this tiny
// undershoot after seeking; never shift by a frame or change playback rate.
export function correctSeekPrecision(
  current: number,
  expected: number,
): number | null {
  return Number.isFinite(current) &&
    Number.isFinite(expected) &&
    current < expected &&
    expected - current <= 0.000002
    ? (Math.ceil(expected * 1000000) + 1) / 1000000
    : null;
}
export interface BackgroundClip extends ClipRange {
  id: string;
  assetId: string;
  enabled: boolean;
  seed?: number;
  offsetMs?: number;
}
export function fitBackground(c:BackgroundClip,totalMs:number,sourceMs:number,mode:'FIT'|'TRIM'|'LOOP'):BackgroundClip {
  if(!Number.isInteger(totalMs)||totalMs<34||!Number.isFinite(sourceMs)||sourceMs<=c.sourceInMs)throw Error('Measured timeline/source durations required');
  if(mode==='TRIM')return {...c,loop:false,durationMs:Math.min(c.durationMs,c.sourceOutMs-c.sourceInMs),offsetMs:0};
  if(mode==='LOOP')return {...c,startMs:0,durationMs:totalMs,loop:true,offsetMs:0};
  return {...c,startMs:0,durationMs:totalMs,sourceOutMs:Math.min(Math.floor(sourceMs),c.sourceInMs+totalMs),loop:sourceMs-c.sourceInMs<totalMs,offsetMs:0};
}
export function frameRange(startMs:number,durationMs:number,fps:number){
  const start=Math.ceil(startMs*fps/1000),end=Math.max(start+1,Math.ceil((startMs+durationMs)*fps/1000));
  return {start,end,duration:end-start};
}
export function shiftSourceInMs(sourceInMs:number,deltaFrames:number,fps:number){
  return Math.floor(Math.max(0,Math.ceil(sourceInMs*fps/1000)+deltaFrames)*1000/fps);
}
export function autoSegment(
  sourceMs: number,
  durationMs: number,
  seed: number,
) {
  if (
    !Number.isFinite(sourceMs) ||
    sourceMs <= 0 ||
    !Number.isFinite(durationMs) ||
    durationMs <= 0
  )
    throw Error('Measured source and timeline durations required');
  let hash = seed >>> 0;
  hash = Math.imul(hash ^ (hash >>> 16), 0x7feb352d) >>> 0;
  hash = Math.imul(hash ^ (hash >>> 15), 0x846ca68b) >>> 0;
  hash = (hash ^ (hash >>> 16)) >>> 0;
  const start = Math.floor(
    (hash / 4294967296) * Math.max(0, sourceMs - durationMs),
  );
  return {
    sourceInMs: start,
    sourceOutMs: Math.min(sourceMs, start + durationMs),
    loop: sourceMs < durationMs,
  };
}
export function validateRange(c: ClipRange, sourceMs?: number) {
  for (const n of [c.startMs, c.durationMs, c.sourceInMs, c.sourceOutMs])
    if (!Number.isFinite(n) || !Number.isInteger(n) || n < 0)
      throw Error('Clip timing must be nonnegative integer milliseconds');
  if (
    c.durationMs < 34 ||
    c.durationMs > 86400000 ||
    c.startMs > 86400000 ||
    c.sourceOutMs <= c.sourceInMs ||
    (sourceMs !== undefined && c.sourceOutMs > sourceMs + 2)
  )
    throw Error('Invalid clip/source range');
  if (!c.loop && c.durationMs > c.sourceOutMs - c.sourceInMs + 34)
    throw Error('Clip exceeds source segment; shorten or enable loop');
  if (typeof c.loop !== 'boolean') throw Error('Invalid clip loop');
  return c;
}
