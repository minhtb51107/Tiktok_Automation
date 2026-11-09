import { useLayoutEffect, useRef, useState } from 'react';
import { cancelRender, continueRender, delayRender, getRemotionEnvironment, useCurrentFrame, useVideoConfig } from 'remotion';

// Chromium's existing WebCodecs decoder: no new package/runtime or flattened first frame.
// Only compressed GIF data and a single decoded frame are retained, not video frames.
export function AnimatedGif({uri,style,startMs=0}:{uri:string;style:React.CSSProperties;startMs?:number}) {
 const frame=useCurrentFrame(),{fps}=useVideoConfig(),canvas=useRef<HTMLCanvasElement>(null);
 const state=useRef<{decoder:any;ends:number[];total:number}|null>(null);
 const [error,setError]=useState('');
 const init=useRef<Promise<void>|null>(null);
 useLayoutEffect(()=>{
  let disposed=false;
  const handle=delayRender('Decode selected GIF');
  if(!init.current)init.current=(async()=>{
   const Decoder=(globalThis as any).ImageDecoder;
   if(!Decoder)throw Error('Animated GIF requires ImageDecoder in the installed Chromium');
   const response=await fetch(uri);if(!response.ok)throw Error('GIF unavailable');
   const data=await response.arrayBuffer();if(data.byteLength>10*1024*1024)throw Error('GIF exceeds 10MB decode limit');
   const decoder=new Decoder({data,type:'image/gif',preferAnimation:true});
   await decoder.tracks.ready;
   const count=decoder.tracks.selectedTrack.frameCount;
   if(count<1||count>1000){decoder.close();throw Error('GIF must have 1–1000 frames');}
   const ends:number[]=[];let total=0;
   try{for(let n=0;n<count;n++){const {image}=await decoder.decode({frameIndex:n});try{if(image.displayWidth*image.displayHeight>24e6)throw Error('GIF dimensions exceed decode limit');total+=Math.max(10,(image.duration||100000)/1000);ends.push(total);}finally{image.close();}}}
   catch(e){decoder.close();throw e;}
   state.current={decoder,ends,total};
  })();
  void init.current.then(async()=>{
   if(disposed)return;
   const s=state.current!,time=(Math.max(0,frame-Math.ceil(startMs*fps/1000))*1000/fps)%s.total,index=s.ends.findIndex(end=>time<end);
   const {image}=await s.decoder.decode({frameIndex:Math.max(0,index)});
   try{if(!disposed&&canvas.current){const c=canvas.current;c.width=image.displayWidth;c.height=image.displayHeight;c.getContext('2d')!.drawImage(image,0,0);}}finally{image.close();}
  }).catch(e=>{if(disposed)return;setError((e as Error).message);if(getRemotionEnvironment().isRendering)cancelRender(e);}).finally(()=>continueRender(handle));
  return()=>{disposed=true;continueRender(handle);};
 },[frame,fps,uri,startMs]);
 useLayoutEffect(()=>()=>{void init.current?.finally(()=>{state.current?.decoder.close();state.current=null;}).catch(()=>{});},[]);
 return error?<div role="alert" style={style}>GIF unavailable: {error}</div>:<canvas ref={canvas} style={style} data-testid="animated-gif"/>;
}
