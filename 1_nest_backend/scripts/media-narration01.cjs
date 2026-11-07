// Offline saved LIVE02 replay only. No network, no approvals, no source mutation.
const fs=require('fs'),p=require('path'),{randomUUID}=require('crypto');
const backend=p.resolve(__dirname,'..'),base=p.resolve(backend,'../../Tiktok_Automation_e2e01'),run=p.resolve(process.argv[2]||''),phase=process.argv[3];
if(p.dirname(run)!==base)throw Error('ISOLATED_RUN_REQUIRED');
(async()=>{
 if(phase==='init'){
  if(fs.existsSync(run))throw Error('NO_OVERWRITE');const old=p.join(base,'run-vid-quality02'),cfg=JSON.parse(fs.readFileSync(p.join(old,'config.json'))),s=JSON.parse(fs.readFileSync(p.join(cfg.store,cfg.sessionId+'.json'))),id=randomUUID(),store=p.join(run,'backend/.studio-data');fs.mkdirSync(store,{recursive:true});
  s.id=id;s.project.id=id;s.derivedFrom=cfg.sessionId;s.title='MEDIA-NARRATION-01 — OCR reviewed DRAFT';s.project.title=s.title;s.revision=0;delete s.project.timeline;delete s.sourceImages;
  for(const a of s.voiceAssets){a.filePath=a.filePath.replace(cfg.sessionId,id);a.uri=a.uri.replace(cfg.sessionId,id);}
  fs.cpSync(p.join(cfg.store,'audio',cfg.sessionId),p.join(store,'audio',id),{recursive:true});fs.cpSync(p.join(cfg.store,'conversation-media'),p.join(store,'conversation-media'),{recursive:true});
  for(const scene of s.editor.scenes){scene.visual={...scene.visual,subtitlesEnabled:false,imageMode:'FULL',imageZoom:1,imagePanX:0,imagePanY:0};}
  fs.writeFileSync(p.join(store,id+'.json'),JSON.stringify(s,null,2));fs.copyFileSync(p.join(old,'tts.local.json'),p.join(run,'tts.local.json'));
  for(const name of ['scripts','dist','src'])fs.symlinkSync(p.join(backend,name),p.join(run,'backend',name),'junction');fs.symlinkSync(p.resolve(backend,'../2_Remotion_Video'),p.join(run,'2_Remotion_Video'),'junction');
  fs.writeFileSync(p.join(run,'config.json'),JSON.stringify({sessionId:id,store,cwd:p.join(run,'backend'),sourceSession:cfg.sessionId,sourceRoot:cfg.store,port:3110,speed:1.3},null,2));console.log(JSON.stringify({sessionId:id,run}));return;
 }
 const cfg=JSON.parse(fs.readFileSync(p.join(run,'config.json')));process.chdir(cfg.cwd);process.env.STUDIO_DATA_ROOT=cfg.store;process.env.STUDIO_DATA04_MEDIA_ROOT=p.join(cfg.store,'conversation-media');
 const {StudioService}=require('../dist/studio/studio.service'),service=new StudioService({});
 try{
  let s=await service.load(cfg.sessionId),item=s.items.find(i=>i.inclusion==='TARGET'),sha=item.localSourceMedia.find(a=>a.status==='DOWNLOADED').sha256;
  if(phase==='ocr')s=await service.mediaOcr(s.id,item.id,sha,{revision:s.revision,action:'OCR'});
  else if(phase==='correct'){
   // Agent visual transcription of the cached 1080x344 image. Excludes screenshot chrome,
   // not a user approval or statement attributed to the Threads post's author.
   const text=fs.readFileSync(p.join(run,'corrected-image.txt'),'utf8').trim();
   s=await service.mediaOcr(s.id,item.id,sha,{revision:s.revision,action:'SAVE',ocrRevision:item.mediaOcr[sha].revision,text,summary:'',mode:'READ_FULL',confirmReview:true,reviewer:'AGENT_VISUAL'});
   item=s.items.find(i=>i.id===item.id);s=await service.mediaOcr(s.id,item.id,sha,{revision:s.revision,action:'APPLY',ocrRevision:item.mediaOcr[sha].revision,confirmReplaceLocked:true});
  }else if(phase==='apply')s=await service.mediaOcr(s.id,item.id,sha,{revision:s.revision,action:'APPLY',ocrRevision:item.mediaOcr[sha].revision,confirmReplaceLocked:true});
  else throw Error('Unknown phase');
  item=s.items.find(i=>i.id===item.id);fs.writeFileSync(p.join(run,'ocr-proof.json'),JSON.stringify({itemId:item.id,ocr:item.mediaOcr,spokenText:item.spokenText,revision:s.revision},null,2));console.log(JSON.stringify({phase,revision:s.revision,rawPreserved:true,ocr:item.mediaOcr[sha].review,reviewer:item.mediaOcr[sha].reviewer,spokenCharacters:item.spokenText.length}));
 }finally{service.onModuleDestroy()}
})().catch(e=>{console.error(e);process.exitCode=1});
