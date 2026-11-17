import type {VideoTimeline} from './contracts';
import type {BackgroundMusic} from './scene-visual';
export function bgmVolumeAtFrame(bgm:BackgroundMusic,timeline:VideoTimeline,frame:number){
 const active=timeline.scenes.find(s=>frame>=s.startFrame&&frame<s.endFrame);
 if(active?.scene.visual?.bgmEnabled===false)return 0;
 if(!bgm.ducking)return bgm.volume;
 const windows=timeline.scenes.flatMap(s=>{
  const v=s.scene.visual;if(v?.voiceEnabled===false||(v?.voiceVolume??1)<=0||s.audioStartFrame===undefined||s.audioEndFrame===undefined)return [];
  const start=s.audioStartFrame+Math.ceil((v?.voiceStartMs||0)*timeline.fps/1000);
  const duration=s.audioEndFrame-s.audioStartFrame-Math.ceil((v?.voiceSourceInMs||0)*timeline.fps/1000);
  const end=Math.min(s.endFrame,start+duration,start+Math.ceil((v?.voiceDurationMs??86400000)*timeline.fps/1000));
  return end>start?[{start,end}]:[];
 });
 const full=Math.max(0,bgm.volume),duck=Math.min(full,bgm.duckVolume??0.03);
 if(windows.some(w=>frame>=w.start&&frame<w.end))return duck;
 // A short deterministic ramp avoids gain discontinuities at narration edges.
 const fade=Math.max(1,Math.ceil(timeline.fps*0.15));
 let volume=full;
 for(const w of windows){
  const before=w.start-frame;
  if(before>0&&before<=fade)volume=Math.min(volume,full+(duck-full)*(fade-before)/fade);
  const after=frame-w.end;
  if(after>=0&&after<fade)volume=Math.min(volume,duck+(full-duck)*after/fade);
 }
 return volume;
}
