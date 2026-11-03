import {describe,it,expect,jest} from '@jest/globals';
import {readFileSync} from 'fs';
import * as path from 'path';
import * as vm from 'vm';
import * as ts from 'typescript';
function client(fetcher:any){const f=path.resolve(__dirname,'../../../2_Remotion_Video/src/studio/integration-api.ts'),box={exports:{}};vm.runInNewContext(ts.transpileModule(readFileSync(f,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}}).outputText,{exports:box.exports,module:box,fetch:fetcher,crypto:{randomUUID:()=> 'SYNTHETIC-UUID'}},{timeout:2000});return box.exports as any;}
describe('Integrated Studio API contracts — MOCK',()=>{
 it('preserves discovery requestId across double click / saved intent reload',()=>{
  const api=client(null),input={topic:'WORK',limit:2},a=api.discoveryIntent(input,null);
  expect(api.discoveryIntent(input,JSON.parse(JSON.stringify(a)))).toEqual(a);
  expect(api.discoveryIntent({...input,limit:1},a,()=> 'NEW-INTENT').body.requestId).toBe('NEW-INTENT');
 });
 it('does not fetch until explicitly called and unwraps the standard response',async()=>{
  const fetcher=jest.fn(async(_url:any,_request:any)=>({ok:true,json:async()=>({success:true,data:{id:'run',status:'COMPLETED'}})})),api=client(fetcher);
  expect(fetcher).not.toHaveBeenCalled();
  expect(await api.studioRequest('/data/crawler/runs',{mode:'SEARCH',topic:'WORK',limit:1,requestId:'test'})).toEqual({id:'run',status:'COMPLETED'});
  expect(fetcher.mock.calls[0][0]).toBe('/api/studio/data/crawler/runs');
  expect(JSON.parse(fetcher.mock.calls[0][1].body)).not.toHaveProperty('keywords');
 });
 it('returns HTTP errors without treating 409 stale revision as success',async()=>{
  const api=client(async()=>({ok:false,status:409,json:async()=>({error:{message:'CRAWLER_STALE_REVISION'}})}));
  await expect(api.studioRequest('/data/crawler/quality/test/feedback',{})).rejects.toMatchObject({status:409,message:'CRAWLER_STALE_REVISION'});
 });
});
