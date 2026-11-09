// OFFLINE/MOCK: only the tiny Node protocol fixture is allowed to spawn.
const assert=require('assert/strict'),cp=require('child_process'),os=require('os'),p=require('path'),{randomUUID}=require('crypto');
const {KokoroRuntime,textHash}=require('../dist/studio/kokoro-runtime'),policy=require('../dist/studio/tts-resource-policy');
(async()=>{
 const text='SYNTHETIC TEST DATA '.repeat(32),execution={mode:'LOCAL_DRAFT_BATCH',approved:true,approvalId:randomUUID(),leaseToken:randomUUID(),inputHash:textHash(text),deadlineAt:Date.now()+300000};
 policy.validateLocalExecution(text,execution);
 for(const changed of [{approved:false},{deadlineAt:Date.now()-1},{deadlineAt:Date.now()+400000},{inputHash:'invalid'}])assert.throws(()=>policy.validateLocalExecution(text,{...execution,...changed}));
 assert.throws(()=>policy.validateBoundedProbe(text,{...execution,mode:'LOCAL_BOUNDED_PROBE'}));
 assert.equal(policy.TTS_RESOURCE_POLICY.probeTimeoutMs,90000);assert.equal(policy.TTS_RESOURCE_POLICY.stopMiB,256);assert.equal(policy.TTS_RESOURCE_POLICY.commitStopMiB,512);
 const spawn=cp.spawn,free=os.freemem,workerLimit=policy.DRAFT_TTS_LIMITS.workerTimeoutMs;let starts=0,fixture='success';os.freemem=()=>512*1024**2;
 cp.spawn=()=>{starts++;return spawn(process.execPath,[p.join(__dirname,'fixtures/kokoro-resource-protocol.cjs'),fixture],{windowsHide:true})};
 const runtime=new KokoroRuntime();
 try{
  await assert.rejects(runtime.synthesize(text+'changed','my_yen','unused','TEST',execution),/APPROVED_TTS_INPUT_CHANGED/);assert.equal(starts,0);
  await runtime.synthesize(text,'my_yen','unused','TEST',execution);
  await runtime.synthesize(text,'my_yen','unused','TEST',execution);
  assert.equal(starts,1,'same model process reused across sequential requests');
  await runtime.closeAndWait();fixture='hang';policy.DRAFT_TTS_LIMITS.workerTimeoutMs=100;
  await assert.rejects(runtime.synthesize(text,'my_yen','unused','TEST',execution),e=>e.category==='TIMEOUT');
 }finally{await runtime.closeAndWait();cp.spawn=spawn;os.freemem=free;policy.DRAFT_TTS_LIMITS.workerTimeoutMs=workerLimit}
 assert.equal(runtime.diagnostics().workerPid,null);
 console.log('PASS OFFLINE/MOCK: long draft approval/hash/deadline; one retained process; owned close; probe and emergency limits unchanged. NO MODEL INFERENCE.');
})().catch(e=>{console.error(e);process.exitCode=1});
