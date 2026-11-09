// Local isolated worker. No credential loading, browser downloads or production imports.
const fs=require('node:fs/promises'),path=require('node:path'),crypto=require('node:crypto');
const {createRequire}=require('node:module'),{execFile}=require('node:child_process');
const dir=path.resolve(process.argv[2]),project=path.resolve('../2_Remotion_Video');
const requireVideo=createRequire(path.join(project,'package.json'));
const renderer=requireVideo('@remotion/renderer'),{bundle}=requireVideo('@remotion/bundler');
const {replaceFile}=require('../dist/studio/atomic-file');
const muxers=new Set();
const command=(exe,args,cancellable=false)=>new Promise((resolve,reject)=>{const child=execFile(exe,args,{windowsHide:true,timeout:120000,maxBuffer:2*1024*1024},(e,out)=>{muxers.delete(child);e?reject(e):resolve(out);});if(cancellable)muxers.add(child);});
let cancelled=false;const signal=renderer.makeCancelSignal();
const cancel=()=>{cancelled=true;signal.cancel();for(const child of muxers)child.kill();};
process.on('message',m=>{if(m?.cancel)cancel();});
process.on('disconnect',cancel);
function check(){if(cancelled)throw Error('Cancelled');}
function tick(step,completed,total){if(process.connected)process.send({step,completed,total});}
const hash=v=>crypto.createHash('sha256').update(v).digest('hex');
const redact=s=>s.replace(/[A-Z]:[\\/][^\s"']+/gi,'[local path]').replace(/(?:hf_|sk-)[\w-]+/g,'[redacted]').slice(0,1200);
async function fingerprint(root){const parts=[];for(const e of (await fs.readdir(root,{withFileTypes:true})).sort((a,b)=>a.name.localeCompare(b.name))){const p=path.join(root,e.name);if(e.isDirectory())parts.push(await fingerprint(p));else if(/\.(tsx?|css)$/.test(e.name))parts.push(e.name,await fs.readFile(p));}return hash(Buffer.concat(parts.map(p=>Buffer.from(p))));}
async function main(){
 const snapshot=JSON.parse(await fs.readFile(path.join(dir,'snapshot.json'),'utf8')),m=snapshot.manifest;
 let browser,monitor,monitoring=false;const started=Date.now(),metrics={samples:[],workerPeakRssBytes:0};
 const save=async()=>{const f=path.join(dir,'manifest.json');await fs.writeFile(f+'.tmp',JSON.stringify(m,null,2));await replaceFile(f+'.tmp',f);};
 const sample=async()=>{if(monitoring)return;monitoring=true;try{metrics.workerPeakRssBytes=Math.max(metrics.workerPeakRssBytes,process.memoryUsage().rss);
   if(process.platform==='win32'){
    const ps=`$os=Get-CimInstance Win32_OperatingSystem; $all=Get-CimInstance Win32_Process; $ids=@(${process.pid}); do {$next=@($all | Where-Object {$_.ParentProcessId -in $ids -and $_.ProcessId -notin $ids} | ForEach-Object ProcessId); $ids+=$next} while($next.Count); $p=@($all | Where-Object {$_.ProcessId -in $ids}); [pscustomobject]@{freeRamKiB=$os.FreePhysicalMemory;freeVirtualKiB=$os.FreeVirtualMemory;workingBytes=($p|Measure-Object WorkingSetSize -Sum).Sum;privateBytes=($p|Measure-Object PrivatePageCount -Sum).Sum;cpu100ns=(($p|Measure-Object KernelModeTime -Sum).Sum+($p|Measure-Object UserModeTime -Sum).Sum)}|ConvertTo-Json -Compress`;
    const data=JSON.parse(await command('powershell.exe',['-NoProfile','-NonInteractive','-Command',ps]));metrics.samples.push({elapsedMs:Date.now()-started,...data});
    if(data.freeRamKiB<128*1024&&data.freeVirtualKiB<256*1024){m.warnings.push('Stopped: low physical and virtual memory');cancelled=true;signal.cancel();}
   }
 }catch{}finally{monitoring=false}};
 try{
  if(m.timelineHash!==hash(JSON.stringify(snapshot.props.timeline))||m.previewHash!==hash(JSON.stringify(snapshot.props)))throw Error('Immutable render snapshot hash mismatch');
  m.status='RUNNING';await save();await sample();monitor=setInterval(()=>void sample(),10000);
  tick('Preparing immutable saved timeline');check();
  const props=structuredClone(snapshot.props),origin=snapshot.appOrigin;
  const local=uri=>typeof uri==='string'&&uri.startsWith('/api/studio/')?origin+uri:null;
  for(const a of [...props.audioAssets,...props.mediaAssets]){
   const uri=local(a.uri);if(uri){a.uri=uri;if(a.kind==='GIF'){const response=await fetch(uri);if(!response.ok)throw Error('Selected GIF is unavailable');const b=Buffer.from(await response.arrayBuffer());if(b.length>10*1024*1024)throw Error('GIF exceeds 10MB');a.uri='data:image/gif;base64,'+b.toString('base64');}}
   else if(a.uri.startsWith('data:')){}else if(a.kind==='IMAGE'){
    a.uri='data:image/svg+xml,'+encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"/>');a.availability='MISSING';m.warnings.push(`${a.id}: remote image omitted in offline render`);
   }else throw Error(`Nonlocal required media: ${a.id}`);
  }
  for(const t of props.timeline.scenes){const c=t.scene.threadsCard;if(c?.avatarUrl){const uri=local(c.avatarUrl);if(uri)c.avatarUrl=uri;else{c.avatarUrl=null;m.warnings.push(`${t.scene.id}: remote avatar unavailable to offline render`);}}}
  metrics.resolvedPropsHash=hash(JSON.stringify(props));
  const cacheKey=hash((await fingerprint(path.join(project,'src/video-pipeline')))+(await fingerprint(path.join(project,'src/render')))+(await fingerprint(path.resolve('src/video-pipeline')))+requireVideo('remotion/package.json').version);
  const bundleDir=path.resolve('.studio-data/render-bundles',cacheKey),empty=path.resolve('.studio-data/render-public-empty');
  await fs.mkdir(empty,{recursive:true});const prep=Date.now();
  let serveUrl=bundleDir;
  if(await fs.stat(path.join(bundleDir,'index.html')).catch(()=>null)){tick('Using cached composition bundle');metrics.bundleCacheHit=true;}
  else {tick('Bundling existing preview composition');serveUrl=await bundle({entryPoint:path.join(project,'src/render/index.tsx'),outDir:bundleDir,publicDir:empty,gitSource:null,enableCaching:true});metrics.bundleCacheHit=false;}
  metrics.bundleMs=Date.now()-prep;check();
  tick('Opening installed browser');const init=Date.now();
  const noDownload=()=>{throw Error('Browser download prohibited; configure installed executable');};
  browser=await renderer.openBrowser('chrome',{browserExecutable:snapshot.browserExecutable,onBrowserDownload:noDownload,logLevel:'error'});
  metrics.browserInitializationMs=Date.now()-init;check();
  const composition=await renderer.selectComposition({serveUrl,id:'SeriousTimelinePreview',inputProps:props,puppeteerInstance:browser,browserExecutable:snapshot.browserExecutable,onBrowserDownload:noDownload,timeoutInMilliseconds:60000,logLevel:'error'});
  if(composition.durationInFrames!==m.totalFrames||composition.fps!==m.fps)throw Error('Composition metadata differs from saved timeline');
  const rendering=Date.now();let last=0;
  tick('Rendering frames',0,m.frameRange[1]-m.frameRange[0]+1);
  await renderer.renderMedia({serveUrl,composition,inputProps:props,codec:'h264',audioCodec:'pcm-16',separateAudioTo:path.join(dir,'mix.wav'),pixelFormat:'yuv420p',outputLocation:path.join(dir,'video-silent.mp4'),overwrite:false,concurrency:1,scale:m.width/props.timeline.width,frameRange:m.frameRange,puppeteerInstance:browser,browserExecutable:snapshot.browserExecutable,onBrowserDownload:noDownload,cancelSignal:signal.cancelSignal,timeoutInMilliseconds:60000,offthreadVideoThreads:1,offthreadVideoCacheSizeInBytes:32*1024*1024,mediaCacheSizeInBytes:32*1024*1024,disallowParallelEncoding:true,x264Preset:'ultrafast',crf:23,logLevel:'error',metadata:{comment:`${m.mode}; session=${m.sessionId}; revision=${m.revision}; timeline=${m.timelineHash}`},onProgress:p=>{metrics.renderedDoneIn=p.renderedDoneIn;metrics.encodedDoneIn=p.encodedDoneIn;if(Date.now()-last>=1000||p.progress===1){last=Date.now();tick(p.renderedDoneIn===null?'Rendering frames':p.stitchStage==='muxing'?'Muxing audio/video':'Encoding',p.renderedFrames,m.frameRange[1]-m.frameRange[0]+1);}}});
  check();metrics.renderMediaMs=Date.now()-rendering;metrics.averageRenderedFps=(m.frameRange[1]-m.frameRange[0]+1)/(metrics.renderMediaMs/1000);
  tick('Encoding AAC and muxing MP4');const muxStart=Date.now();
  // Remotion's ADTS AAC intermediate loses libfdk's priming metadata (measured
  // +2048/48000 seconds). Keep its exact mixer output as WAV, then encode once
  // directly into MP4 so AAC edit-list/skip-samples metadata is preserved.
  await command('ffmpeg',['-v','error','-n','-i',path.join(dir,'video-silent.mp4'),'-i',path.join(dir,'mix.wav'),'-map','0:v:0','-map','1:a:0','-c:v','copy','-c:a','aac','-b:a','192k','-ar','48000','-t',String(m.expectedDurationSeconds),'-movflags','+faststart','-metadata',`comment=${m.mode}; timeline=${m.timelineHash}`,path.join(dir,'video.mp4')],true);
  check();metrics.finalAudioEncodeMuxMs=Date.now()-muxStart;
  tick('FFprobe validation');const probe=JSON.parse(await command('ffprobe',['-v','error','-count_frames','-show_streams','-show_format','-of','json',path.join(dir,'video.mp4')]));
  const v=probe.streams.find(s=>s.codec_type==='video'),a=probe.streams.find(s=>s.codec_type==='audio'),frames=m.frameRange[1]-m.frameRange[0]+1;
  if(v?.codec_name!=='h264'||a?.codec_name!=='aac'||v.width!==m.width||v.height!==m.height||Number(v.nb_read_frames)!==frames||Math.abs(Number(v.duration)-m.expectedDurationSeconds)>1/m.fps+0.001)throw Error('Output does not match codec/resolution/frame/duration contract');
  m.probe={streams:probe.streams,format:{...probe.format,filename:'video.mp4'}};m.bytes=(await fs.stat(path.join(dir,'video.mp4'))).size;m.status='COMPLETED';m.downloadUrl=`/api/studio/sessions/${m.sessionId}/renders/${m.jobId}/video`;
  // DRAFT never becomes publishable. FINAL still requires the publishing stage's own gate.
  m.publishable=false;tick('Completed',frames,frames);
 }catch(e){m.status=cancelled||(typeof renderer.isUserCancelledRender==='function'&&renderer.isUserCancelledRender(e))?'CANCELLED':'FAILED';m.error=m.status==='CANCELLED'?null:redact(e.message||String(e));if(m.error)console.error(m.error);process.exitCode=m.status==='CANCELLED'?0:1;}
 finally{clearInterval(monitor);await browser?.close({silent:true}).catch(()=>{});m.completedAt=new Date().toISOString();metrics.endToEndMs=Date.now()-started;m.metrics=metrics;m.warnings=[...new Set(m.warnings)];await save();if(process.connected)process.disconnect();}
}
main().catch(e=>{console.error(redact(e.message));process.exitCode=1;if(process.connected)process.disconnect();});
