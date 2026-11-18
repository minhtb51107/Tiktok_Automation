// Standalone adapter over the existing StudioService/KokoroRuntime.
// It checkpoints the session after every scene and never starts HTTP, crawler or AI.
require('./load-local-env.cjs');
const fs=require('node:fs');
const path=require('node:path');

const runtimeFile=path.resolve(__dirname,'../.studio-data/runtime.local.json');
if(fs.existsSync(runtimeFile)){
  const config=JSON.parse(fs.readFileSync(runtimeFile,'utf8').replace(/^\uFEFF/,''));
  const allowed=['STUDIO_PYTHON','STUDIO_KOKORO_SOURCE','STUDIO_KOKORO_MODEL','STUDIO_KOKORO_CONFIG','STUDIO_KOKORO_VOICE_DIR','STUDIO_TTS_DEVICE'];
  for(const name of Object.keys(config)){
    if(!allowed.includes(name)||typeof config[name]!=='string')throw Error('Invalid local runtime configuration field');
    process.env[name]??=config[name];
  }
}
const args=Object.fromEntries(process.argv.slice(2).map(value=>{const [key,...rest]=value.split('=');return [key.replace(/^--/,''),rest.join('=')]}));
if(!/^[a-f0-9-]{36}$/.test(args.session||''))throw Error('Usage: --session=<uuid> --root=<isolated-store>');
if(!args.root)throw Error('Isolated --root is required');
if(args.draft!==undefined&&!['true','false'].includes(args.draft))throw Error('--draft must be true or false');
process.env.STUDIO_DATA_ROOT=path.resolve(args.root);
process.env.OMP_NUM_THREADS='1';
process.env.OPENBLAS_NUM_THREADS='1';
process.env.NUMEXPR_NUM_THREADS='1';
process.env.MKL_NUM_THREADS='1';

const {StudioService}=require('../dist/studio/studio.service.js');
const {ScraperService}=require('../dist/modules/core/scraper/scraper.service.js');

(async()=>{
  const service=new StudioService(new ScraperService());
  try{
    let session=await service.load(args.session);
    const selected=session.items.filter(item=>item.selected).sort((a,b)=>a.order-b.order);
    for(let index=0;index<selected.length;index++){
      session=await service.load(args.session);
      const item=session.items.find(row=>row.id===selected[index].id);
      process.stdout.write(JSON.stringify({event:'scene-start',index:index+1,total:selected.length,itemId:item.id,characters:item.spokenText.length})+'\n');
      session=await service.voiceAction(args.session,item.id,{revision:session.revision,action:'GENERATE',regenerate:false,draft:args.draft==='true'});
      const job=session.voiceJobs[session.voiceJobs.length-1];
      const asset=(session.voiceAssets||[]).find(row=>row.id===job.assetId);
      process.stdout.write(JSON.stringify({event:'scene',index:index+1,total:selected.length,itemId:item.id,outcome:job.status,error:job.error||null,durationMs:asset?.durationMs||null,metrics:asset?.synthesisMetrics||job.resourceDiagnostics||null})+'\n');
      if(job.status==='ERROR'){
        process.exitCode=2;
        break;
      }
    }
  }finally{
    service.onModuleDestroy();
  }
})().catch(error=>{process.stderr.write((error&&error.stack)||String(error));process.exitCode=1});
