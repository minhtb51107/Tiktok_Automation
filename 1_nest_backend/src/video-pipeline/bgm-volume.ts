import type {VideoTimeline} from './contracts';
import type {BackgroundMusic} from './scene-visual';
export function bgmVolumeAtFrame(bgm:BackgroundMusic,timeline:VideoTimeline,frame:number){
 const active=timeline.scenes.find(s=>frame>=s.startFrame&&frame<s.endFrame);
 if(active?.scene.visual?.bgmEnabled===false)return 0;
 if(!bgm.ducking)return bgm.volume;
 const speech=timeline.scenes.some(s=>{
  const v=s.scene.visual;if(v?.voiceEnabled===false||(v?.voiceVolume??1)<=0||s.audioStartFrame===undefined||s.audioEndFrame===undefined)return false;
  const start=s.audioStartFrame+Math.ceil((v?.voiceStartMs||0)*timeline.fps/1000);
  const duration=s.audioEndFrame-s.audioStartFrame-Math.ceil((v?.voiceSourceInMs||0)*timeline.fps/1000);
  const end=Math.min(s.endFrame,start+duration,start+Math.ceil((v?.voiceDurationMs??86400000)*timeline.fps/1000));
  return frame>=start&&frame<end;
 });return speech?Math.min(bgm.volume,bgm.duckVolume??0.03):bgm.volume;
}
