const fs=require('fs'),p=require('path'),{randomUUID}=require('crypto');
const backend=p.resolve(__dirname,'..'),base=p.resolve(backend,'../../Tiktok_Automation_e2e01'),root=p.resolve(process.argv[2]||''),phase=process.argv[3];if(p.dirname(root)!==base)throw Error('ISOLATED_RUN_REQUIRED');
(async()=>{if(phase==='init'){
 if(fs.existsSync(root))throw Error('NO_OVERWRITE');const old=p.join(base,'run-20261107-01'),cfg=JSON.parse(fs.readFileSync(p.join(old,'config.json'))),s=JSON.parse(fs.readFileSync(p.join(cfg.store,cfg.sessionId+'.json'))),id=randomUUID(),store=p.join(root,'backend/.studio-data');fs.mkdirSync(store,{recursive:true});
 s.id=id;s.project.id=id;s.derivedFrom=cfg.sessionId;s.title='VID-QUALITY-02 DRAFT';s.project.title=s.title;s.revision=0;delete s.project.timeline;
 for(const a of s.voiceAssets){a.filePath=a.filePath.replace(cfg.sessionId,id);a.uri=a.uri.replace(cfg.sessionId,id);a.status='STALE';}
 for(const i of s.items.filter(i=>i.selected)){i.voiceSettings={voice:'my_yen',speed:1.3};}
 for(const scene of s.editor.scenes){scene.visual={...scene.visual,subtitlesEnabled:false,imageMode:'FULL',imageZoom:1,imagePanX:0,imagePanY:0};}
 fs.cpSync(p.join(cfg.store,'audio',cfg.sessionId),p.join(store,'audio',id),{recursive:true});fs.cpSync(p.join(cfg.store,'conversation-media'),p.join(store,'conversation-media'),{recursive:true});
 fs.writeFileSync(p.join(store,id+'.json'),JSON.stringify(s,null,2));fs.copyFileSync(p.join(old,'tts.local.json'),p.join(root,'tts.local.json'));
 for(const name of ['scripts','dist','src'])fs.symlinkSync(p.join(backend,name),p.join(root,'backend',name),'junction');fs.symlinkSync(p.resolve(backend,'../2_Remotion_Video'),p.join(root,'2_Remotion_Video'),'junction');
 fs.writeFileSync(p.join(root,'config.json'),JSON.stringify({sessionId:id,store,cwd:p.join(root,'backend'),sourceSession:cfg.sessionId,sourceRoot:cfg.store,port:3109,speed:1.3},null,2));console.log(JSON.stringify({sessionId:id,root}));return;
 }
 const cfg=JSON.parse(fs.readFileSync(p.join(root,'config.json'))),file=p.join(cfg.store,cfg.sessionId+'.json'),s=JSON.parse(fs.readFileSync(file));
 if(phase==='avatars'){
 const {cacheSourceImage}=require('../dist/studio/source-images');s.sourceImages={};
 for(const i of s.items.filter(i=>i.selected)){const url=i.metadata?.avatar||i.author.avatarUrl;if(!url||/\/rsrc\.php\//.test(url)){s.sourceImages[i.id]={itemId:i.id,sourceUrl:url||'',status:'UNAVAILABLE',uri:null,provenance:'PUBLIC_CDN',checkedAt:new Date().toISOString(),error:'No verified personal avatar URL; generic site resource excluded'};continue;}s.sourceImages[i.id]=await cacheSourceImage(s.id,i.id,url,p.join(cfg.store,'source-images'));}
 s.revision++;fs.writeFileSync(file,JSON.stringify(s,null,2));console.log(JSON.stringify(Object.entries(s.sourceImages).map(([id,a])=>({id,status:a.status,error:a.error})),null,2));
 }else if(phase==='variants'){
 process.chdir(cfg.cwd);Object.assign(process.env,JSON.parse(fs.readFileSync(p.join(root,'tts.local.json'))),{STUDIO_DATA_ROOT:cfg.store});const {StudioService}=require('../dist/studio/studio.service'),service=new StudioService({});try{let current=s;for(const speed of [1.2,1.4,1.3]){current=await service.voiceAction(s.id,s.items.find(i=>i.selected).id,{revision:current.revision,action:'GENERATE',draft:true,voice:'my_yen',speed});const job=current.voiceJobs.at(-1);if(job.status==='ERROR')throw Error(job.error);}console.log(JSON.stringify(current.voiceAssets.filter(a=>a.itemId===s.items.find(i=>i.selected).id&&a.numberReadingVersion?.includes('vi-social-speech')).map(a=>({speed:a.speed,durationMs:a.durationMs,synthesisPerformed:a.synthesisPerformed,baseCacheHit:a.baseCacheHit,filePath:a.filePath})),null,2));}finally{service.onModuleDestroy()}
 }else throw Error('Unknown phase');
})().catch(e=>{console.error(e.message);process.exitCode=1});
