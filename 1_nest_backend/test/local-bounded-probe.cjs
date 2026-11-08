// OFFLINE/MOCK only. All synthesis spawns are redirected to a tiny Node protocol fixture.
const fs=require('fs'),p=require('path'),os=require('os'),assert=require('assert/strict'),cp=require('child_process'),{randomUUID}=require('crypto');
const {KokoroRuntime}=require('../dist/studio/kokoro-runtime'),policy=require('../dist/studio/tts-resource-policy'),{LOCAL_PROBE_LEASE,assertNoLocalProbe}=require('../dist/studio/local-probe-lease');
(async()=>{
 assert.equal(policy.ttsResourceBlock(512*1024**2),null);assert.ok(policy.ttsResourceWarnings(512*1024**2).length);assert.equal(policy.ttsResourceWarnings(1600*1024**2).length,0);assert.ok(policy.ttsResourceBlock(255*1024**2));assert.equal(policy.ttsFailureCategory(Error('OOM, process closed')),'UNKNOWN');
 const execution={mode:'LOCAL_BOUNDED_PROBE',approved:true,approvalId:randomUUID(),leaseToken:randomUUID()};assert.throws(()=>policy.validateBoundedProbe('test',{...execution,approved:false}));assert.throws(()=>policy.validateBoundedProbe('x'.repeat(161),execution));
 if(fs.existsSync(LOCAL_PROBE_LEASE))throw Error('TEST_REQUIRES_NO_ACTIVE_PROBE');
 fs.writeFileSync(LOCAL_PROBE_LEASE,JSON.stringify({pid:process.pid,token:execution.leaseToken}),{flag:'wx'});assert.throws(()=>assertNoLocalProbe(),/LOCAL_BOUNDED_PROBE_ACTIVE/);assertNoLocalProbe(execution.leaseToken);
 const spawn=cp.spawn,free=os.freemem,oldTimeout=policy.TTS_RESOURCE_POLICY.probeTimeoutMs;let fixture='success',spawns=0;os.freemem=()=>512*1024**2;cp.spawn=()=>{spawns++;return spawn(process.execPath,[p.join(__dirname,'fixtures/kokoro-resource-protocol.cjs'),fixture],{windowsHide:true});};
 try{
  for(const [mode,expected]of [['success',null],['allocation','ALLOCATION_FAILURE'],['exit','UNKNOWN'],['commit','RESOURCE_GUARD_STOP'],['hang','TIMEOUT']]){
   fixture=mode;policy.TTS_RESOURCE_POLICY.probeTimeoutMs=mode==='hang'?100:3000;const runtime=new KokoroRuntime();
   try{if(expected)await assert.rejects(runtime.synthesize('MOCK','my_yen','unused','TEST',execution),e=>e.category===expected);else assert.equal((await runtime.synthesize('MOCK','my_yen','unused','TEST',execution)).sentenceChunks,1);}finally{await runtime.closeAndWait()}
  }
  assert.equal(spawns,5);console.log('PASS OFFLINE/MOCK: 512 MiB warns without hard rejection; one approved bounded worker; invalid approval/length refused; allocation/unknown/commit guard/timeout classified; owned exits awaited. NO KOKORO INFERENCE.');
 }finally{cp.spawn=spawn;os.freemem=free;policy.TTS_RESOURCE_POLICY.probeTimeoutMs=oldTimeout;const lease=JSON.parse(fs.readFileSync(LOCAL_PROBE_LEASE));if(lease.pid===process.pid&&lease.token===execution.leaseToken)fs.unlinkSync(LOCAL_PROBE_LEASE);}
})().catch(e=>{console.error(e);process.exitCode=1});
