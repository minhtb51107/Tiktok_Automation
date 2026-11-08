// OFFLINE. Policy/protocol are MOCK; native RSS/inspect are real, never synthesis.
const assert=require('assert/strict'),os=require('os'),p=require('path'),fs=require('fs'),{spawn,execFileSync}=require('child_process');
const {KokoroRuntime,ttsCacheKeys}=require('../dist/studio/kokoro-runtime'),{ttsResourceBlock}=require('../dist/studio/tts-resource-policy');
(async()=>{
 for(const [mib,warm,blocked] of [[1535,false,true],[1536,false,false],[383,true,true],[384,true,false]])assert.equal(!!ttsResourceBlock(mib*1024**2,warm),blocked);
 const run=p.resolve(__dirname,'../../../Tiktok_Automation_e2e01/run-media-narration01'),local=JSON.parse(fs.readFileSync(p.join(run,'tts.local.json')));Object.assign(process.env,local);
 const native=JSON.parse(execFileSync(local.STUDIO_PYTHON,['-B','scripts/kokoro_memory.py'],{encoding:'utf8',windowsHide:true}));assert.ok(native.pid>0&&native.rssMiB>0&&native.privateMiB>0&&native.availableMiB>0);
 const original=os.freemem;let available=100*1024**2;os.freemem=()=>available;
 const runtime=new KokoroRuntime();
 try{
  const status=await runtime.preflight();assert.equal(status.status,'BLOCKED_RUNTIME');assert.ok(status.blockers.some(b=>b.includes('BLOCKED_RESOURCE')));assert.equal(status.voices.length,5);assert.equal(runtime.diagnostics().workerPid,null);
  await assert.rejects(runtime.synthesize('test','my_yen','unused','TEST'),/BLOCKED_RESOURCE/);assert.equal(runtime.diagnostics().workerPid,null);
  available=2048*1024**2;
  const install=mode=>{runtime.worker=spawn(process.execPath,[p.join(__dirname,'fixtures/kokoro-resource-protocol.cjs'),mode],{windowsHide:true});runtime.workerKey=JSON.stringify(runtime.cfg())+'TEST';return runtime.worker};
  install('success');const metrics=await runtime.synthesize('test','my_yen','unused','TEST');assert.equal(metrics.sentenceChunks,1);assert.equal(runtime.diagnostics().samples.length,1);assert.match(runtime.diagnostics().inputHash,/^[a-f0-9]{64}$/);assert.ok(!JSON.stringify(runtime.diagnostics()).includes('TEST_STAGE'));assert.ok(runtime.diagnostics().workerPid);runtime.close();
  const child=install('hang'),timer=setTimeout(()=>available=200*1024**2,50);
  await assert.rejects(runtime.synthesize('test','my_yen','unused','TEST'),/BLOCKED_RESOURCE/);clearTimeout(timer);assert.equal(runtime.diagnostics().workerPid,null);if(child.exitCode===null)await new Promise(resolve=>child.once('close',resolve));
  const r={packageVersion:'TEST',modelVersion:'TEST',device:'cpu'},context={itemId:'SYNTHETIC',normalizationVersion:'dict/1'},a=ttsCacheKeys('hello','my_yen',1.3,r,context),b=ttsCacheKeys('hello','my_yen',1.4,r,context);
  assert.equal(a.baseKey,b.baseKey);assert.notEqual(a.cacheKey,b.cacheKey);assert.notEqual(a.cacheKey,ttsCacheKeys('hello','my_yen',1.3,r,{...context,normalizationVersion:'dict/2'}).cacheKey);assert.notEqual(a.cacheKey,ttsCacheKeys('changed','my_yen',1.3,r,context).cacheKey);assert.notEqual(a.cacheKey,ttsCacheKeys('hello','hung_thinh',1.3,r,context).cacheKey);
  console.log(JSON.stringify({status:'PASS_OFFLINE',protocol:'MOCK_ONLY',nativeOwnProcess:{rssMiB:native.rssMiB,privateMiB:native.privateMiB},preflight:'STATIC_ONLY_BLOCKED_RESOURCE',voicesPresent:status.voices.length,guard:'cold/warm/low-memory PASS',cache:'voice/text/speed/dictionary version PASS',liveTts:'NOT_RUN'}));
 }finally{os.freemem=original;runtime.close()}
})().catch(e=>{console.error(e);process.exitCode=1});
