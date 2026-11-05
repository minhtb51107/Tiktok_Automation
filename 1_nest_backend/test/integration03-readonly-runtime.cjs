// Real-data acceptance server: exact copied records, no writable API, no outbound network.
const fs=require('node:fs'),p=require('node:path');
const file=p.resolve(process.argv[2]||'');const backend=p.resolve(__dirname,'..'),runs=p.join(backend,'.studio-data/reports/integration03');
if(!file.startsWith(runs+p.sep)||p.basename(file)!=='isolation.json')throw Error('Verified isolation manifest required');
const cfg=JSON.parse(fs.readFileSync(file));
const expectedCwd=p.resolve(backend,'../../Tiktok_Automation_acceptance',p.basename(p.dirname(file)),'sandbox/1_nest_backend');
if(cfg.mode!=='ISOLATED_REAL_DATA_READ_ONLY'||cfg.cwd!==expectedCwd||cfg.store!==p.join(cfg.cwd,'.studio-data')||fs.realpathSync(cfg.cwd)!==cfg.cwd||fs.existsSync(p.join(cfg.cwd,'.env'))||fs.lstatSync(cfg.store).isSymbolicLink())throw Error('Isolation guard rejected runtime');
process.chdir(cfg.cwd);
for(const name of Object.keys(process.env))if(!/^(PATH|SYSTEMROOT|WINDIR|TEMP|TMP|USERPROFILE|APPDATA|LOCALAPPDATA|PROGRAMFILES(?:\(X86\))?|COMSPEC|PATHEXT|NUMBER_OF_PROCESSORS|PROCESSOR_ARCHITECTURE|OS|SYSTEMDRIVE)$/i.test(name))delete process.env[name];
process.env.PORT='3101';
for(const flag of ['ENABLE_DISCORD','ENABLE_WATCHER','ENABLE_AUTO_HUNTER','ENABLE_TIKTOK_UPLOADER'])process.env[flag]='false';
const audit={mode:'ISOLATED_REAL_DATA_READ_ONLY',mutations:[],outboundBlocked:0};
function deny(){audit.outboundBlocked++;throw Error('OUTBOUND_DISABLED_ACCEPTANCE');}
for(const protocol of ['node:http','node:https']){const mod=require(protocol);mod.request=deny;mod.get=deny;}
global.fetch=deny;
require('reflect-metadata');
const {NestFactory}=require('@nestjs/core'),{AppModule}=require('../dist/app.module');
const {TransformInterceptor}=require('../dist/common/interceptors/transform.interceptor');
const {HttpExceptionFilter}=require('../dist/common/filters/http-exception.filter');
(async()=>{const app=await NestFactory.create(AppModule,{logger:['error','warn']});
 app.use((req,res,next)=>{
  if(req.path==='/integration03-proof')return res.json({...audit,credentialsPresent:Object.keys(process.env).some(k=>/TOKEN|SECRET|PASSWORD|CREDENTIAL|DATABASE_URL|API_KEY/i.test(k)),port:3101});
  if(!['GET','HEAD'].includes(req.method)||/\/oauth\//.test(req.path)){audit.mutations.push({method:req.method,path:req.path});return res.status(403).json({success:false,error:{message:'ACCEPTANCE_READ_ONLY'}});}
  next();
 });
 app.useGlobalInterceptors(new TransformInterceptor());app.useGlobalFilters(new HttpExceptionFilter());
 await app.listen(3101,'127.0.0.1');console.log('INTEGRATION03 READ_ONLY READY pid='+process.pid);
 async function close(){fs.writeFileSync(p.join(p.dirname(file),'runtime-audit.json'),JSON.stringify(audit,null,2));await app.close();process.exit(0);}
 process.on('SIGINT',()=>void close());process.on('SIGTERM',()=>void close());
})().catch(e=>{console.error('ACCEPTANCE_START_FAILED',e.message);process.exitCode=1;});
