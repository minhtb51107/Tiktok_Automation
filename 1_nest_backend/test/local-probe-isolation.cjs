// OFFLINE: no collection/render/model. Invalid IDs provide a second fail-safe.
const fs=require('fs'),assert=require('assert/strict'),{randomUUID}=require('crypto'),{StudioService}=require('../dist/studio/studio.service'),{LOCAL_PROBE_LEASE}=require('../dist/studio/local-probe-lease');
(async()=>{if(fs.existsSync(LOCAL_PROBE_LEASE))throw Error('Existing probe must not be disturbed');const token=randomUUID();fs.writeFileSync(LOCAL_PROBE_LEASE,JSON.stringify({pid:process.pid,token}),{flag:'wx'});const service=new StudioService({});let ran=false;
try{await assert.rejects(service.withControlledCollection(async()=>{ran=true}),/LOCAL_BOUNDED_PROBE_ACTIVE/);await assert.rejects(service.renderJob('INVALID_SYNTHETIC_ID',{},async()=>{},'INVALID_SYNTHETIC_JOB'),/LOCAL_BOUNDED_PROBE_ACTIVE/);assert.equal(ran,false);console.log('PASS OFFLINE: active probe lease refuses collection/render before callbacks or source loading; no worker started.');}
finally{service.onModuleDestroy();const lease=JSON.parse(fs.readFileSync(LOCAL_PROBE_LEASE));if(lease.pid===process.pid&&lease.token===token)fs.unlinkSync(LOCAL_PROBE_LEASE);}
})().catch(e=>{console.error(e);process.exitCode=1});
