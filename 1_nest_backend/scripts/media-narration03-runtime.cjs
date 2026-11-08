// Dedicated copied-store Studio. Never starts TTS/render/collection from HTTP.
const fs=require('fs'),p=require('path');
const backend=p.resolve(__dirname,'..'),run=p.resolve(backend,'../../Tiktok_Automation_e2e01/run-media-narration03-render01'),cfg=JSON.parse(fs.readFileSync(p.join(run,'config.json')));
if(cfg.port!==3111||cfg.store!==p.join(run,'backend/.studio-data')||cfg.cwd!==p.join(run,'backend')||fs.existsSync(p.join(cfg.cwd,'.env')))throw Error('ISOLATION_INVALID');
for(const k of Object.keys(process.env))if(!/^(PATH|SYSTEMROOT|WINDIR|TEMP|TMP|USERPROFILE|APPDATA|LOCALAPPDATA|PROGRAMFILES(?:\(X86\))?|COMSPEC|PATHEXT|NUMBER_OF_PROCESSORS|PROCESSOR_ARCHITECTURE|OS|SYSTEMDRIVE)$/i.test(k))delete process.env[k];
process.chdir(cfg.cwd);Object.assign(process.env,{PORT:'3111',STUDIO_DATA_ROOT:cfg.store,STUDIO_DATA04_MEDIA_ROOT:p.join(cfg.store,'conversation-media')});
const deny=()=>{throw Error('MEDIA03_OUTBOUND_DISABLED')};for(const x of ['node:http','node:https']){require(x).request=deny;require(x).get=deny}global.fetch=deny;
require('reflect-metadata');const {NestFactory}=require('@nestjs/core'),{AppModule}=require('../dist/app.module'),{TransformInterceptor}=require('../dist/common/interceptors/transform.interceptor'),{HttpExceptionFilter}=require('../dist/common/filters/http-exception.filter');
(async()=>{
 const app=await NestFactory.create(AppModule,{logger:['error','warn']});app.use(require('express').json({limit:'2mb'}));
 app.use((req,res,next)=>{
  if(req.path==='/studio')return res.sendFile(p.resolve(backend,'../2_Remotion_Video/studio/index.html'));
  if(['/studio/app.js','/studio/app.css'].includes(req.path))return res.sendFile(p.resolve(backend,'../2_Remotion_Video/studio-dist',p.basename(req.path)));
  if(req.path==='/api/studio/runtime')return res.json({data:{mode:'REAL_DATA_COPY',reason:'MEDIA-NARRATION-03 copied store: saved audio/MP4, local edits only. No TTS/render/crawler/publishing permission from HTTP.',capabilities:{localSave:true,tts:false,render:false,publish:false},scheduler:'OFF',runtimePid:process.pid}});
  if(/\/oauth\//.test(req.path))return res.status(403).json({message:'OAuth disabled'});
  const save=req.method==='PUT'&&new RegExp('^/api/studio/sessions/'+cfg.sessionId+'(?:/editor)?$').test(req.path);
  const prepare=req.method==='POST'&&req.path==='/api/studio/sessions/'+cfg.sessionId+'/editor/prepare';
  if(!['GET','HEAD'].includes(req.method)&&!save&&!prepare)return res.status(403).json({message:'Only local save/preview preparation is allowed. No new TTS/render/collection/approval/publishing.'});next();
 });
 app.useGlobalInterceptors(new TransformInterceptor());app.useGlobalFilters(new HttpExceptionFilter());await app.listen(3111,'127.0.0.1');
 console.log('MEDIA03 Studio http://127.0.0.1:3111/studio?session='+cfg.sessionId+'&area=Video%20Studio&step=Render pid='+process.pid);
 process.on('SIGINT',async()=>{await app.close();process.exit(0)});
})().catch(e=>{console.error(e.message);process.exitCode=1});
