import { expect, it, jest } from '@jest/globals';
import { PassThrough, Writable } from 'stream';
import { EventEmitter } from 'events';
import { KokoroRuntime, pcmCheckpointSamples } from './kokoro-runtime';
import { ttsAdmission, ttsDeadlines, ttsRemainingSynthesis } from './tts-resource-policy';

it('limits automatic draft audio to 240 seconds of synthesis and 300 total',()=>{
  expect(ttsDeadlines(1000,undefined,999999)).toEqual({policy:'AUTOMATIC_PRODUCTION',totalDeadlineAt:301000,synthesisLimitMs:240000});
  expect(ttsRemainingSynthesis(ttsDeadlines(1000,undefined,9000),5000)).toBe(4000);
  expect(ttsRemainingSynthesis(ttsDeadlines(1000,undefined,999999),1000)).toBe(240000);
  expect(ttsDeadlines(1000,{mode:'LOCAL_BOUNDED_PROBE',approved:true,approvalId:'a',leaseToken:'b'}))
    .toEqual({policy:'LOCAL_BOUNDED_PROBE',totalDeadlineAt:121000,synthesisLimitMs:90000});
});

it('keeps the absolute synthesis deadline even when the worker reports progress',async()=>{
  jest.useFakeTimers({now:1000});
  try {
    const runtime:any=new KokoroRuntime();
    const stdout=new PassThrough(), stdin=new Writable({write(_chunk,_encoding,done){done();}});
    const worker=Object.assign(new EventEmitter(),{stdout,stdin,pid:123,kill:jest.fn()});
    const cleanup=jest.fn(async()=>undefined);
    Object.assign(runtime,{requireAdmission:async()=>undefined, closeAndWait:cleanup, worker, workerKey:JSON.stringify(runtime.cfg())+'version',
      deadline:ttsDeadlines(1000,undefined,6500)});
    const running=runtime.synthesize('text','voice','output','version','base');
    const result=expect(running).rejects.toMatchObject({category:'TIMEOUT'});
    await jest.advanceTimersByTimeAsync(2000);
    stdout.write('@STUDIO@'+JSON.stringify({stage:'Synthesizing'})+'\n');
    stdout.write('@STUDIO@'+JSON.stringify({progress:{index:9,total:11}})+'\n');
    await jest.advanceTimersByTimeAsync(3499);
    expect(worker.kill).not.toHaveBeenCalled();
    await jest.advanceTimersByTimeAsync(1);
    await result;
    expect(runtime.diagnostics().chunkProgress).toEqual([{index:9,total:11}]);
    expect(cleanup).toHaveBeenCalledTimes(1);
  }finally{jest.useRealTimers();}
});

it('rejects truncated or incorrectly formatted PCM checkpoints',()=>{
  const b=Buffer.alloc(48);
  b.write('RIFF');b.writeUInt32LE(40,4);b.write('WAVEfmt ',8);b.writeUInt32LE(16,16);
  b.writeUInt16LE(1,20);b.writeUInt16LE(1,22);b.writeUInt32LE(24000,24);
  b.writeUInt16LE(2,32);b.writeUInt16LE(16,34);b.write('data',36);b.writeUInt32LE(4,40);
  expect(pcmCheckpointSamples(b)).toBe(2);
  expect(pcmCheckpointSamples(b.subarray(0,47))).toBeNull();
  b.writeUInt32LE(48000,24);
  expect(pcmCheckpointSamples(b)).toBeNull();
});

it.each([false,true])('reuses a warm worker through an advisory and still stops for low commit (%s)',async(emergency)=>{
  const runtime:any=new KokoroRuntime();
  const stdout=new PassThrough();
  const sent=jest.fn();
  const stdin=new Writable({write(_chunk,_encoding,done){sent();done();}});
  const worker=Object.assign(new EventEmitter(),{stdout,stdin,pid:123,exitCode:null,signalCode:null,kill:jest.fn()});
  const cleanup=jest.fn(async()=>undefined);
  const measure=jest.fn(async(phase:'WARM',automatic:boolean)=>ttsAdmission(
    Array.from({length:5},(_,i)=>({atMs:i*500,availableMiB:483.88,systemCommitAvailableMiB:6713.83})),phase,automatic));
  Object.assign(runtime,{resourceAdmission:measure,closeAndWait:cleanup,worker,workerKey:JSON.stringify(runtime.cfg())+'version',
    deadline:ttsDeadlines(Date.now(),undefined,Date.now()+2000)});
  await expect(runtime.productionAdmission()).resolves.toMatchObject({allowed:true,warnings:['LOW_MEMORY_WARNING']});
  expect(cleanup).not.toHaveBeenCalled();
  const running=runtime.synthesize('text','voice','output','version','base');
  const expected=emergency?expect(running).rejects.toMatchObject({category:'RESOURCE_GUARD_STOP'}):
    expect(running).resolves.toMatchObject({synthesizedChunks:1});
  await new Promise(resolve=>setImmediate(resolve));
  expect(measure).toHaveBeenCalledWith('WARM',true);
  expect(measure).toHaveBeenCalledTimes(process.platform==='win32'?2:1);
  expect(sent).toHaveBeenCalledTimes(1);
  stdout.write('@STUDIO@'+JSON.stringify({stage:'Synthesizing'})+'\n');
  stdout.write('@STUDIO@'+JSON.stringify(emergency?{resource:{systemCommitAvailableMiB:511}}:{ok:true,metrics:{synthesizedChunks:1}})+'\n');
  await expected;
  expect(runtime.diagnostics().workerStarts).toBe(0);
  expect(runtime.diagnostics().inferenceStarted).toBe(true);
  expect(cleanup).toHaveBeenCalledTimes(emergency?1:0);
  clearTimeout(runtime.idle);
});
