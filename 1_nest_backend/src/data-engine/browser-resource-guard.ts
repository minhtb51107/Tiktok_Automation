import {spawn, type ChildProcess} from 'child_process';
import {existsSync} from 'fs';
import * as path from 'path';
import {createInterface} from 'readline';
import {BROWSER_RESOURCE_POLICY as POLICY,browserResourceDecision,browserFailureCategory,type BrowserMemorySample,type BrowserResourceReport} from './browser-resource-policy';

export interface ResourceMonitor {
  start(sample:(s:BrowserMemorySample)=>void,stop:(code:string)=>void):Promise<void>;
  track(pid:number):Promise<void>;
  cleanup():Promise<{ownedPids:number[];forcedPids:number[];remainingPids:number[]}>;
  close():Promise<boolean>;
}
/** Internal, fixed native helper. No shell, arbitrary PID termination or credential forwarding. */
export class NativeBrowserMonitor implements ResourceMonitor {
  private child:ChildProcess; private handlers=new Map<string,{resolve:(x:any)=>void;reject:(e:Error)=>void;timer:ReturnType<typeof setTimeout>}>();
  private first:()=>void; private failure:(code:string)=>void; private firstReject:(e:Error)=>void;
  private lastCleanup:any;
  private shuttingDown=false;
  constructor(private timeoutMs:number,private testOwnedNode=false){}
  async start(sample:(s:BrowserMemorySample)=>void,stop:(code:string)=>void){
    if(process.platform!=='win32')throw Error('CONVERSATION_RESOURCE_MEASUREMENT_UNAVAILABLE');
    const python=[process.env.STUDIO_PYTHON,path.join(process.env.LOCALAPPDATA||'','Programs/Python/Python314/python.exe')].find(x=>x&&existsSync(x));
    if(!python)throw Error('CONVERSATION_RESOURCE_MEASUREMENT_UNAVAILABLE');
    const script=path.resolve(__dirname,'../../scripts/browser-resource-monitor.py');
    this.failure=stop;
    const ready=new Promise<void>((resolve,reject)=>{this.first=resolve;this.firstReject=reject});
    // Deliberately exclude THREADS/AI credentials from this read-only observer.
    const env=Object.fromEntries(Object.entries(process.env).filter(([k])=>/^(PATH|SYSTEMROOT|WINDIR|TEMP|TMP|USERPROFILE|APPDATA|LOCALAPPDATA|COMSPEC|PATHEXT)$/i.test(k)));
    this.child=spawn(python,['-B',script,String(process.pid),String((this.timeoutMs+15000)/1000),String(POLICY.emergencyAvailableMiB),String(POLICY.emergencyCommitReserveMiB),...(this.testOwnedNode?['--test-owned-node']:[])],{windowsHide:true,stdio:['pipe','pipe','ignore'],env});
    const input=createInterface({input:this.child.stdout!});
    input.on('line',line=>{try{
      const e=JSON.parse(line);
      if(e.event==='sample'){sample(e.sample);this.first?.();}
      else if(e.event==='stop')this.failure(e.code);
      else {if(e.event==='cleanup')this.lastCleanup=e;const key=e.event==='tracked'?'tracked:'+e.pid:e.event;const h=this.handlers.get(key);if(h){clearTimeout(h.timer);this.handlers.delete(key);if(e.event==='tracked'&&!e.accepted)h.reject(Error('CONVERSATION_BROWSER_OWNERSHIP_UNVERIFIED'));else h.resolve(e);}}
    }catch{this.failure('CONVERSATION_RESOURCE_MEASUREMENT_UNAVAILABLE')}});
    const failed=()=>{this.failure('CONVERSATION_RESOURCE_MEASUREMENT_UNAVAILABLE');this.firstReject?.(Error('CONVERSATION_RESOURCE_MEASUREMENT_UNAVAILABLE'));for(const h of this.handlers.values()){clearTimeout(h.timer);h.reject(Error('CONVERSATION_RESOURCE_MEASUREMENT_UNAVAILABLE'))}this.handlers.clear()};
    this.child.once('error',failed);
    this.child.stdin!.on('error',()=>this.failure('CONVERSATION_RESOURCE_MEASUREMENT_UNAVAILABLE'));
    this.child.once('exit',()=>{input.close();if(!this.shuttingDown||this.handlers.size)failed()});
    let timer:ReturnType<typeof setTimeout>;
    try{await Promise.race([ready,new Promise<never>((_,reject)=>{timer=setTimeout(()=>reject(Error('CONVERSATION_RESOURCE_MEASUREMENT_UNAVAILABLE')),POLICY.monitorResponseMs)})])}finally{clearTimeout(timer!)}
  }
  private request(key:string,body:unknown){return new Promise<any>((resolve,reject)=>{
    const timer=setTimeout(()=>{this.handlers.delete(key);reject(Error('CONVERSATION_BROWSER_CLEANUP_UNVERIFIED'))},POLICY.monitorResponseMs);
    this.handlers.set(key,{resolve,reject,timer});
    if(!this.child?.stdin?.writable){clearTimeout(timer);this.handlers.delete(key);reject(Error('CONVERSATION_RESOURCE_MEASUREMENT_UNAVAILABLE'));return}
    this.child.stdin.write(JSON.stringify(body)+'\n',e=>{if(e){clearTimeout(timer);this.handlers.delete(key);reject(Error('CONVERSATION_RESOURCE_MEASUREMENT_UNAVAILABLE'))}});
  })}
  async track(pid:number){await this.request('tracked:'+pid,{op:'track',pid})}
  async cleanup(){return this.request('cleanup',{op:'cleanup'})}
  async close(){
    if(!this.child)return true;
    if(this.child.exitCode!==null)return this.child.exitCode===0&&this.lastCleanup?.remainingPids?.length===0;
    this.shuttingDown=true;
    const exited=new Promise<boolean>(resolve=>this.child.once('exit',code=>resolve(code===0&&this.lastCleanup?.remainingPids?.length===0)));
    this.child.stdin?.end(JSON.stringify({op:'shutdown'})+'\n');
    let timer:ReturnType<typeof setTimeout>;
    try{return await Promise.race([exited,new Promise<boolean>(resolve=>{timer=setTimeout(()=>resolve(false),POLICY.monitorResponseMs)})])}finally{clearTimeout(timer!)}
  }
}

type BrowserLike={close():Promise<void>;process():ChildProcess|null};
let active=false,cleanupBlocked=false;
/** One lifecycle: monitor begins BEFORE launch; close/verification completes BEFORE another launch. */
export class BrowserResourceGuard {
  readonly abort=new AbortController();
  readonly report:BrowserResourceReport={policy:POLICY,samples:0,warnings:[],minimumAvailableMiB:null,minimumCommitReserveMiB:null,peakSampledBrowserRssMiB:null,peakSampledBrowserPrivateMiB:null,ownedPids:[],forcedPids:[],remainingPids:null,stopCode:null,failureCategory:null,cleanupVerified:false,monitorExited:false,windowsOomEvidence:null};
  private browser:BrowserLike;private deadline:ReturnType<typeof setTimeout>;private acquired=false;private closing:Promise<void>;
  private watchdog:ReturnType<typeof setInterval>;private lastSampleAt=0;
  constructor(private timeoutMs:number,private monitor:ResourceMonitor=new NativeBrowserMonitor(timeoutMs)){}
  async start(){
    if(active||cleanupBlocked)throw Error('CONVERSATION_BROWSER_BUSY_OR_CLEANUP_UNVERIFIED');
    active=true;this.acquired=true;
    this.deadline=setTimeout(()=>this.stop('CONVERSATION_TIME_BUDGET'),this.timeoutMs);
    try{await this.monitor.start(s=>this.sample(s),code=>this.stop(code));this.check();this.watchdog=setInterval(()=>{if(Date.now()-this.lastSampleAt>POLICY.sampleStaleMs)this.stop('CONVERSATION_RESOURCE_MEASUREMENT_STALE')},POLICY.sampleMs)}catch(e){this.stop(e instanceof Error?e.message:'CONVERSATION_RESOURCE_MEASUREMENT_UNAVAILABLE');throw e}
  }
  private sample(s:BrowserMemorySample){
    this.lastSampleAt=Date.now();
    const d=browserResourceDecision(s);this.report.samples++;
    if(Number.isFinite(s.availableMiB))this.report.minimumAvailableMiB=Math.min(this.report.minimumAvailableMiB??Infinity,s.availableMiB);
    if(Number.isFinite(s.systemCommitAvailableMiB))this.report.minimumCommitReserveMiB=Math.min(this.report.minimumCommitReserveMiB??Infinity,s.systemCommitAvailableMiB);
    this.report.peakSampledBrowserRssMiB=Math.max(this.report.peakSampledBrowserRssMiB??0,s.browserRssMiB||0);
    this.report.peakSampledBrowserPrivateMiB=Math.max(this.report.peakSampledBrowserPrivateMiB??0,s.browserPrivateMiB||0);
    this.report.ownedPids=[...new Set([...this.report.ownedPids,...s.ownedPids])];
    if(d.warning&&!this.report.warnings.includes(d.warning))this.report.warnings.push(d.warning);
    if(d.stop)this.stop(d.stop);
  }
  stop(code:string){if(!this.report.stopCode){this.report.stopCode=/^CONVERSATION_[A-Z0-9_]+$/.test(code)?code:'CONVERSATION_RESOURCE_MEASUREMENT_UNAVAILABLE';this.report.failureCategory=browserFailureCategory(this.report.stopCode);this.abort.abort()}}
  check(){if(this.report.stopCode)throw Error(this.report.stopCode)}
  async launch<T extends BrowserLike>(fn:(signal:AbortSignal)=>Promise<T>):Promise<T>{
    this.check();const browser=await fn(this.abort.signal);this.browser=browser;
    const child=browser.process();if(!child?.pid)throw Error('CONVERSATION_BROWSER_OWNERSHIP_UNVERIFIED');
    await this.monitor.track(child.pid);this.check();return browser;
  }
  async close(){
    if(!this.acquired)return;
    if(!this.closing)this.closing=this.finish();return this.closing;
  }
  private async finish(){
    clearTimeout(this.deadline);clearInterval(this.watchdog);let timer:ReturnType<typeof setTimeout>;
    try{
      if(this.browser)try{await Promise.race([this.browser.close().catch(()=>{}),new Promise<void>(r=>{timer=setTimeout(r,POLICY.gracefulCloseMs)})])}finally{clearTimeout(timer!)}
      const cleanup=await this.monitor.cleanup();this.report.ownedPids=[...new Set([...this.report.ownedPids,...cleanup.ownedPids])];
      this.report.forcedPids=cleanup.forcedPids;this.report.remainingPids=cleanup.remainingPids;
      this.report.monitorExited=await this.monitor.close();
      this.report.cleanupVerified=cleanup.remainingPids.length===0&&this.report.monitorExited;
      if(!this.report.cleanupVerified)throw Error('CONVERSATION_BROWSER_CLEANUP_UNVERIFIED');
    }catch{this.stop('CONVERSATION_BROWSER_CLEANUP_UNVERIFIED');this.report.monitorExited=await this.monitor.close().catch(()=>false);cleanupBlocked=true;throw Error('CONVERSATION_BROWSER_CLEANUP_UNVERIFIED')}
    finally{active=false;this.acquired=false}
  }
}
