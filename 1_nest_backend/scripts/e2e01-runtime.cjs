const fs=require('fs'),p=require('path');
const backend=p.resolve(__dirname,'..'),run=p.resolve(process.argv[2]||''),parent=p.resolve(backend,'../../Tiktok_Automation_e2e01');
if(p.dirname(run)!==parent)throw Error('E2E01_ISOLATED_RUN_REQUIRED');const cfg=JSON.parse(fs.readFileSync(p.join(run,'config.json')));
if(cfg.cwd!==p.join(run,'backend')||cfg.store!==p.join(cfg.cwd,'.studio-data')||fs.existsSync(p.join(cfg.cwd,'.env')))throw Error('ISOLATION_INVALID');
for(const k of Object.keys(process.env))if(!/^(PATH|SYSTEMROOT|WINDIR|TEMP|TMP|USERPROFILE|APPDATA|LOCALAPPDATA|PROGRAMFILES(?:\(X86\))?|COMSPEC|PATHEXT|NUMBER_OF_PROCESSORS|PROCESSOR_ARCHITECTURE|OS|SYSTEMDRIVE)$/i.test(k))delete process.env[k];
const port=cfg.port||3108;if(![3108,3109,3110].includes(port))throw Error('INVALID_SANDBOX_PORT');
process.chdir(cfg.cwd);Object.assign(process.env,{PORT:String(port),STUDIO_DATA_ROOT:cfg.store,STUDIO_DATA04_MEDIA_ROOT:p.join(cfg.store,'conversation-media')});
const local=JSON.parse(fs.readFileSync(p.join(run,'tts.local.json')));for(const [key,value] of Object.entries(local)){if(!/^STUDIO_(PYTHON|KOKORO_SOURCE|KOKORO_MODEL|KOKORO_CONFIG|KOKORO_VOICE_DIR|TTS_DEVICE)$/.test(key)||typeof value!=='string')throw Error('INVALID_LOCAL_TTS_SETTING');process.env[key]=value;}
// Nest operations stay local; the child render worker independently resolves only local assets.
const deny=()=>{throw Error('E2E01_OUTBOUND_DISABLED')};for(const x of ['node:http','node:https']){require(x).request=deny;require(x).get=deny}global.fetch=deny;
require('reflect-metadata');const {NestFactory}=require('@nestjs/core'),{AppModule}=require('../dist/app.module'),{TransformInterceptor}=require('../dist/common/interceptors/transform.interceptor'),{HttpExceptionFilter}=require('../dist/common/filters/http-exception.filter');
(async()=>{const app=await NestFactory.create(AppModule,{logger:['error','warn']});app.use(require('express').json({limit:'2mb'}));app.use((req,res,next)=>{
 if(req.path==='/studio')return res.sendFile(p.resolve(backend,'../2_Remotion_Video/studio/index.html'));
 if(['/studio/app.js','/studio/app.css'].includes(req.path))return res.sendFile(p.resolve(backend,'../2_Remotion_Video/studio-dist',p.basename(req.path)));
 if(req.path==='/api/studio/runtime')return res.json({data:{mode:'E2E01_SANDBOX',reason:'Local editable draft, explicit DRAFT TTS/render. Publishing and source access disabled.',capabilities:{localSave:true,tts:true,render:true,publish:false},scheduler:'OFF'}});
 if(/\/oauth\//.test(req.path))return res.status(403).json({message:'OAuth disabled'});
 const local=req.method==='PUT'&&new RegExp('^/api/studio/sessions/'+cfg.sessionId+'(?:/editor)?$').test(req.path);
 const prepare=req.method==='POST'&&req.path==='/api/studio/sessions/'+cfg.sessionId+'/editor/prepare';
 const render=req.method==='POST'&&req.path==='/api/studio/sessions/'+cfg.sessionId+'/jobs'&&req.body.operation==='render'&&req.body.input?.mode==='DRAFT';
 const cancel=req.method==='POST'&&/^\/api\/studio\/jobs\/[a-f0-9-]{36}\/cancel$/.test(req.path);
 const voice=req.method==='POST'&&new RegExp('^/api/studio/sessions/'+cfg.sessionId+'/voice/[a-f0-9-]{36}$').test(req.path)&&(req.body.action==='SETTINGS'||req.body.action==='GENERATE'&&req.body.draft===true);
 const preflight=req.method==='POST'&&req.path==='/api/studio/sessions/'+cfg.sessionId+'/voice-runtime';
 const ocr=cfg.port===3110&&req.method==='POST'&&new RegExp('^/api/studio/sessions/'+cfg.sessionId+'/media-ocr/[a-f0-9-]{36}/[a-f0-9]{64}$').test(req.path);
 if(!['GET','HEAD'].includes(req.method)&&!local&&!prepare&&!render&&!cancel&&!voice&&!preflight&&!ocr)return res.status(403).json({message:'E2E01 local edits and explicit DRAFT TTS/render only; no source/API/approval/publishing.'});next();});app.useGlobalInterceptors(new TransformInterceptor());app.useGlobalFilters(new HttpExceptionFilter());await app.listen(port,'127.0.0.1');console.log('DRAFT Studio READY http://127.0.0.1:'+port+'/studio?session='+cfg.sessionId+'&area=Video%20Studio&step=Editor pid='+process.pid);process.on('SIGINT',async()=>{await app.close();process.exit(0)});})().catch(e=>{console.error(e.message);process.exitCode=1});
