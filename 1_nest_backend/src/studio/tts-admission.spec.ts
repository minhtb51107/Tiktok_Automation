import { describe, expect, it } from '@jest/globals';
import { ttsAdmission } from './tts-resource-policy';

const sample = (availableMiB=1100, systemCommitAvailableMiB=1900) =>
  Array.from({length:5},(_,i)=>({atMs:100000+i*500, availableMiB, systemCommitAvailableMiB}));

describe('sustained TTS admission',()=>{
  it('admits a cold worker only with valid physical and commit headroom across the series',()=>{
    expect(ttsAdmission(sample(),'COLD')).toMatchObject({allowed:true,minimumAvailableMiB:1100,minimumCommitReserveMiB:1900});
    const low=sample();
    low[2].availableMiB=900;
    expect(ttsAdmission(low,'COLD').allowed).toBe(false);
    expect(ttsAdmission(low,'WARM').allowed).toBe(true);
    expect(ttsAdmission(sample(1100,1200),'COLD').allowed).toBe(false);
    expect(ttsAdmission(sample().slice(0,1),'COLD').allowed).toBe(false);
  });
  it.each([['COLD',700,1900],['WARM',483.88,6713.83]] as const)(
    'admits %s production at %s MiB with an advisory and preserves the default policy',
    (phase,ram,commit)=>{
      expect(ttsAdmission(sample(ram,commit),phase,true)).toMatchObject({
        allowed:true, warnings:['LOW_MEMORY_WARNING'], requiredAvailableMiB:256,
      });
      expect(ttsAdmission(sample(ram,commit),phase).allowed).toBe(false);
    },
  );
  it('retains mandatory physical, commit and measurement protection in production',()=>{
    expect(ttsAdmission(sample(255,1900),'COLD',true).denialReason).toBe('PHYSICAL_FLOOR');
    expect(ttsAdmission(sample(700,1791),'COLD',true).denialReason).toBe('COMMIT_RESERVE');
    expect(ttsAdmission(sample(483.88,1023),'WARM',true).denialReason).toBe('COMMIT_RESERVE');
    expect(ttsAdmission([], 'WARM',true).denialReason).toBe('INVALID_MEASUREMENT');
  });
  it('fails closed for stale, null and out-of-order readings and preserves render floors',()=>{
    expect(ttsAdmission(Array(5).fill(sample()[0]),'COLD').allowed).toBe(false);
    expect(ttsAdmission([null,...sample().slice(1)],'COLD').allowed).toBe(false);
    expect(ttsAdmission(sample(256,512),'RENDER').allowed).toBe(true);
    expect(ttsAdmission(sample(255,512),'RENDER').allowed).toBe(false);
    expect(ttsAdmission(sample(256,511),'RENDER').allowed).toBe(false);
  });
});

it('waits for the exact owned child to exit and leaves an unrelated child alone',async()=>{
  const { spawn }=await import('node:child_process');
  const { KokoroRuntime }=await import('./kokoro-runtime');
  const command=()=>spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{windowsHide:true});
  const owned=command(), unrelated=command();
  try{
    const runtime=new KokoroRuntime();
    Object.assign(runtime,{worker:owned,lastOwned:owned});
    await runtime.closeAndWait();
    expect(owned.exitCode!==null||owned.signalCode!==null).toBe(true);
    expect(unrelated.exitCode).toBeNull();
    expect(unrelated.signalCode).toBeNull();
  }finally{
    if(owned.exitCode===null&&owned.signalCode===null)owned.kill();
    if(unrelated.exitCode===null&&unrelated.signalCode===null){
      const exited=new Promise<void>(resolve=>unrelated.once('close',()=>resolve()));
      unrelated.kill();
      await exited;
    }
  }
});
