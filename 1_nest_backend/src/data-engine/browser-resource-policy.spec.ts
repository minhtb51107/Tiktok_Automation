import {describe,test,expect} from '@jest/globals';
import {browserResourceDecision,browserFailureCategory,type BrowserMemorySample} from './browser-resource-policy';
import {BrowserResourceGuard,NativeBrowserMonitor,type ResourceMonitor} from './browser-resource-guard';
import {spawn} from 'child_process';
import {existsSync} from 'fs';
import * as path from 'path';

const sample=(physical=600,commit=4000):BrowserMemorySample=>({availableMiB:physical,systemCommitAvailableMiB:commit,systemCommitUsedMiB:24000,systemCommitLimitMiB:28000,browserRssMiB:20,browserPrivateMiB:10,ownedPids:[]});
class FakeMonitor implements ResourceMonitor {
  onSample:(s:BrowserMemorySample)=>void;onStop:(c:string)=>void;events:string[]=[];
  forced:number[]=[];remaining:number[]=[];exited=true;
  constructor(readonly initial=sample()){}
  async start(s:(x:BrowserMemorySample)=>void,f:(c:string)=>void){this.events.push('monitor-before-launch');this.onSample=s;this.onStop=f;s(this.initial)}
  async track(pid:number){this.events.push('track-'+pid)}
  async cleanup(){this.events.push('cleanup-captured-handles');return {ownedPids:[101,102],forcedPids:this.forced,remainingPids:this.remaining}}
  async close(){this.events.push('monitor-exit');return this.exited}
}
const browser=(events:string[])=>({process:()=>({pid:101} as any),close:async()=>{events.push('graceful-browser-close')}});

describe('Browser resource policy — OFFLINE, no Chromium/network',()=>{
  test.each([384,377,300,256])('%s MiB is not an absolute cold-start ban',ram=>{
    const d=browserResourceDecision(sample(ram));expect(d.stop).toBeNull();expect(!!d.warning).toBe(ram<384);
  });
  test.each([[255.99,5000,'PHYSICAL'],[500,511.99,'COMMIT']])('emergency at physical=%s, reserve=%s',(physical,reserve,reason)=>expect(browserResourceDecision(sample(Number(physical),Number(reserve))).stop).toBe('CONVERSATION_RESOURCE_GUARD_STOP_'+reason));
  test('commit boundary and unavailable measurements do not become invented values',()=>{
    expect(browserResourceDecision(sample(256,512)).stop).toBeNull();
    expect(browserResourceDecision(sample(600,NaN)).stop).toBe('CONVERSATION_RESOURCE_MEASUREMENT_UNAVAILABLE');
  });
  test('guard stops, allocation failures, timeouts and Windows OOM are distinct',()=>{
    expect(browserFailureCategory('CONVERSATION_RESOURCE_GUARD_STOP_PHYSICAL')).toBe('RESOURCE_GUARD_STOP');
    expect(browserFailureCategory('CONVERSATION_TIME_BUDGET')).toBe('TIMEOUT');
    expect(browserFailureCategory('ENOMEM')).toBe('ALLOCATION_FAILURE');
    expect(browserFailureCategory('browser crashed OOM')).toBe('UNKNOWN');
  });
  test('377 MiB proceeds with warning; monitor precedes launch and cleanup precedes release',async()=>{
    const m=new FakeMonitor(sample(377)),g=new BrowserResourceGuard(5000,m);
    try{await g.start();await g.launch(async()=>{m.events.push('launch');return browser(m.events)});g.check()}finally{await g.close()}
    expect(m.events).toEqual(['monitor-before-launch','launch','track-101','graceful-browser-close','cleanup-captured-handles','monitor-exit']);
    expect(g.report.cleanupVerified).toBe(true);expect(g.report.warnings).toHaveLength(1);expect(g.report.windowsOomEvidence).toBeNull();
  });
  test('physical/commit stop aborts in-flight operation; only owned scope is passed to cleanup',async()=>{
    const m=new FakeMonitor(),g=new BrowserResourceGuard(5000,m);
    try{await g.start();await g.launch(async()=>browser(m.events));m.onSample({...sample(400,511),ownedPids:[101,102]});expect(()=>g.check()).toThrow('CONVERSATION_RESOURCE_GUARD_STOP_COMMIT');expect(g.abort.signal.aborted).toBe(true)}finally{await g.close()}
    expect(g.report.ownedPids).toEqual([101,102]);expect(g.report.failureCategory).toBe('RESOURCE_GUARD_STOP');
  });
  test('a preflight emergency never launches; another worker is rejected while one owns the lifecycle',async()=>{
    const low=new BrowserResourceGuard(5000,new FakeMonitor(sample(255)));
    try{await expect(low.start()).rejects.toThrow('CONVERSATION_RESOURCE_GUARD_STOP_PHYSICAL')}finally{await low.close()}
    const g=new BrowserResourceGuard(5000,new FakeMonitor()),other=new BrowserResourceGuard(5000,new FakeMonitor());
    try{await g.start();await expect(other.start()).rejects.toThrow('CONVERSATION_BROWSER_BUSY_OR_CLEANUP_UNVERIFIED')}finally{await other.close();await g.close()}
  });
  test('slow launch deadline aborts, late browser is tracked and cleaned, no retry',async()=>{
    const m=new FakeMonitor(),g=new BrowserResourceGuard(40,m);let launches=0;
    try{await g.start();await expect(g.launch(async signal=>{launches++;await new Promise(r=>setTimeout(r,70));expect(signal.aborted).toBe(true);return browser(m.events)})).rejects.toThrow('CONVERSATION_TIME_BUDGET')}finally{await g.close()}
    expect(launches).toBe(1);expect(g.report.cleanupVerified).toBe(true);expect(g.report.failureCategory).toBe('TIMEOUT');
  });
  test('native monitor failure is diagnostic failure, not Windows OOM',async()=>{
    const m=new FakeMonitor(),g=new BrowserResourceGuard(5000,m);
    try{await g.start();m.onStop('CONVERSATION_RESOURCE_MEASUREMENT_UNAVAILABLE');expect(()=>g.check()).toThrow('MEASUREMENT_UNAVAILABLE')}finally{await g.close()}
    expect(g.report.failureCategory).toBe('UNKNOWN');
  });
  test('stale resource measurements stop the operation instead of running blind',async()=>{
    const g=new BrowserResourceGuard(5000,new FakeMonitor());
    try{await g.start();await new Promise(r=>setTimeout(r,2300));expect(()=>g.check()).toThrow('CONVERSATION_RESOURCE_MEASUREMENT_STALE')}finally{await g.close()}
  });
  test('simulated lingering descendant is cleaned from captured ownership after graceful root exit',async()=>{
    const m=new FakeMonitor();m.forced=[102];const g=new BrowserResourceGuard(5000,m);
    try{await g.start();await g.launch(async()=>browser(m.events))}finally{await g.close()}
    expect(g.report.ownedPids).toEqual([101,102]);expect(g.report.forcedPids).toEqual([102]);expect(g.report.cleanupVerified).toBe(true);
  });

  const python=path.join(process.env.LOCALAPPDATA||'','Programs/Python/Python314/python.exe');
  const nativeTest=process.platform==='win32'&&existsSync(python)?test:test.skip;
  nativeTest('REAL local process fixture: force-closes owned parent/grandchild; leaves pre-existing sibling alive (NO browser LIVE)',async()=>{
    const sibling=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{windowsHide:true,stdio:'ignore'});
    const m=new NativeBrowserMonitor(20000,true);let child:ReturnType<typeof spawn>,grandchild:number;let last:BrowserMemorySample;
    try{
      await m.start(s=>{last=s},()=>{});
      await expect(m.track(sibling.pid!)).rejects.toThrow('CONVERSATION_BROWSER_OWNERSHIP_UNVERIFIED');
      child=spawn(process.execPath,['-e',"const c=require('child_process').spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'ignore'});process.send(c.pid);setInterval(()=>{},1000)"],{windowsHide:true,stdio:['ignore','ignore','ignore','ipc']});
      grandchild=await new Promise<number>((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('FIXTURE_START_TIMEOUT')),3000);child.once('message',pid=>{clearTimeout(timer);resolve(Number(pid))})});
      await m.track(child.pid!);
      expect(()=>process.kill(grandchild,0)).not.toThrow(); // Existence probe only, before native cleanup.
      const closed=await m.cleanup();
      expect(closed.ownedPids).toEqual(expect.arrayContaining([child.pid!,grandchild]));expect(closed.remainingPids).toEqual([]);
      expect(closed.forcedPids).toContain(grandchild);
      expect(closed.ownedPids).not.toContain(sibling.pid);expect(sibling.exitCode).toBeNull();expect(last!.systemCommitAvailableMiB).toBeGreaterThan(0);
      expect(await m.close()).toBe(true);
    }finally{await m.close();if(child!?.exitCode===null)child.kill();if(sibling.exitCode===null)sibling.kill();}
  },30000);

  // Keep this last: fail-closed intentionally blocks further launches in this process.
  test('unverified cleanup blocks a replacement worker instead of reporting success',async()=>{
    const m=new FakeMonitor();m.remaining=[102];const g=new BrowserResourceGuard(5000,m);
    await g.start();await expect(g.close()).rejects.toThrow('CONVERSATION_BROWSER_CLEANUP_UNVERIFIED');
    expect(g.report.cleanupVerified).toBe(false);
    await expect(new BrowserResourceGuard(5000,new FakeMonitor()).start()).rejects.toThrow('CONVERSATION_BROWSER_BUSY_OR_CLEANUP_UNVERIFIED');
  });
});
