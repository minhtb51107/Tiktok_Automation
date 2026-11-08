import {existsSync,readFileSync} from 'fs';
import * as path from 'path';
export const LOCAL_PROBE_LEASE=path.resolve(__dirname,'../../.local-bounded-probe.lock');
export function assertNoLocalProbe(token?:string){
 if(!existsSync(LOCAL_PROBE_LEASE))return;
 const lease=JSON.parse(readFileSync(LOCAL_PROBE_LEASE,'utf8'));
 if(!token||lease.token!==token||lease.pid!==process.pid)throw Error('LOCAL_BOUNDED_PROBE_ACTIVE: do not start TTS/render/crawler concurrently');
}
