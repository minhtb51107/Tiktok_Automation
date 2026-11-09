const fs=require('node:fs'),p=require('node:path'),os=require('node:os'),{execFileSync}=require('node:child_process');
const {hash,within}=require('./studio-copy.cjs'),{allowed}=require('./studio-copy-policy.cjs');
const backend=p.resolve(__dirname,'..'),repo=p.dirname(backend),file=p.resolve(process.argv[2]||'');
if(!repo.endsWith('Tiktok_Automation_uiops02')||!within(p.join(backend,'.studio-data/reports/uiops02'),file)||p.basename(file)!=='isolation.json')throw Error('ISOLATION_MANIFEST_REQUIRED');
const cfg=JSON.parse(fs.readFileSync(file)),expected=p.resolve(repo,'../Tiktok_Automation_uiops02_acceptance',p.basename(p.dirname(file)),'1_nest_backend');
if(cfg.mode!=='REAL_DATA_COPY'||cfg.cwd!==expected||cfg.store!==p.join(expected,'.studio-data')||fs.realpathSync(cfg.store)!==cfg.store||fs.existsSync(p.join(expected,'.env')))throw Error('ISOLATION_REJECTED');
if(os.freemem()<384*1024**2)throw Error('RESOURCE_GATE_BELOW_384MIB');
process.chdir(cfg.cwd);for(const k of Object.keys(process.env))if(!/^(PATH|SYSTEMROOT|WINDIR|TEMP|TMP|USERPROFILE|APPDATA|LOCALAPPDATA|PROGRAMFILES(?:\(X86\))?|COMSPEC|PATHEXT|NUMBER_OF_PROCESSORS|PROCESSOR_ARCHITECTURE|OS|SYSTEMDRIVE)$/i.test(k))delete process.env[k];
process.env.STUDIO_REAL_DATA_COPY='1';
const audit={mode:'REAL_DATA_COPY',allowedWrites:[],blockedWrites:[],outboundBlocked:0};const deny=()=>{audit.outboundBlocked++;throw Error('REAL_DATA_COPY_OUTBOUND_DISABLED')};for(const x of ['node:http','node:https']){require(x).request=deny;require(x).get=deny}global.fetch=deny;
require('reflect-metadata');const {NestFactory}=require('@nestjs/core'),{AppModule}=require('../dist/app.module'),{TransformInterceptor}=require('../dist/common/interceptors/transform.interceptor'),{HttpExceptionFilter}=require('../dist/common/filters/http-exception.filter');
(async()=>{
 const verified=p.join(cfg.run,'initial-copy-verified.json'),restart=fs.existsSync(verified);
 for(const row of cfg.copied){const target=p.resolve(cfg.cwd,'..',row.file);if(!within(p.dirname(cfg.cwd),target)||fs.realpathSync(target)!==target)throw Error('COPY_PATH_CHANGED');const mutable=/^1_nest_backend[\\/]\.studio-data[\\/][a-f0-9-]{36}\.json$/.test(row.file)||/^1_nest_backend[\\/]\.studio-data[\\/]data-engine[\\/](evaluations|conversation-feedback|editorial-plans)[\\/][a-f0-9]{64}\.json$/.test(row.file);if(!(restart&&mutable)&&await hash(target)!==row.sha256)throw Error('COPY_HASH_CHANGED_BEFORE_START');}
 if(!restart)fs.writeFileSync(verified,JSON.stringify({verifiedAt:new Date().toISOString(),files:cfg.copied.length,bundleHash:cfg.bundleHash}));
 const runtime={mode:'REAL_DATA_COPY',port:3105,sourceHead:execFileSync('git',['rev-parse','HEAD'],{cwd:repo,encoding:'utf8'}).trim(),branch:execFileSync('git',['branch','--show-current'],{cwd:repo,encoding:'utf8'}).trim(),sourceDirty:!!execFileSync('git',['status','--porcelain'],{cwd:repo,encoding:'utf8'}).trim(),bundleHash:cfg.bundleHash,catalogOrigin:'Copied persisted extraction; not new online verification',capabilities:{localSave:true,review:true,editorialPlanning:true,collectionConfiguration:true,remote:false,tts:false,render:false,publish:false,approvals:false,upload:false,scheduler:false},reason:'Isolated real-data copy: local Script/Editor save and preview preparation only. Content review and configuration writes stay in sandbox. No production credentials, LIVE workers, production approval/enqueue or publishing.',scheduler:'OFF'};
 const app=await NestFactory.create(AppModule,{logger:['error','warn']});app.use(require('express').json({limit:'2mb'}));
 app.use((req,res,next)=>{if(req.path==='/api/studio/runtime')return res.json({data:runtime});if(req.path==='/uiops02-proof')return res.json({...audit,credentialsPresent:Object.keys(process.env).some(k=>/TOKEN|SECRET|PASSWORD|DATABASE_URL|API_KEY/i.test(k)),pid:process.pid});
 if(!allowed(req.method,req.path,req.body)){audit.blockedWrites.push({method:req.method,path:req.path});return res.status(403).json({success:false,error:{code:'DISABLED_BY_SAFETY',message:runtime.reason}})}
 if(!['GET','HEAD'].includes(req.method))audit.allowedWrites.push({method:req.method,path:req.path});next()});
 app.useGlobalInterceptors(new TransformInterceptor());app.useGlobalFilters(new HttpExceptionFilter());await app.listen(3105,'127.0.0.1');
 fs.writeFileSync(p.join(cfg.run,'runtime.json'),JSON.stringify({...runtime,pid:process.pid},null,2));console.log('REAL_DATA_COPY Studio READY http://127.0.0.1:3105/studio pid='+process.pid);
 async function close(){fs.writeFileSync(p.join(cfg.run,'runtime-audit.json'),JSON.stringify(audit,null,2));await app.close();process.exit(0)}process.on('SIGINT',()=>void close());process.on('SIGTERM',()=>void close());
})().catch(e=>{console.error('STUDIO_COPY_START_FAILED',e.message);process.exitCode=1});
