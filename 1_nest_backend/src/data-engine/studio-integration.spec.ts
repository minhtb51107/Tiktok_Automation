import {describe,it,expect} from '@jest/globals';
import {readFileSync} from 'fs';
import * as path from 'path';
import * as vm from 'vm';
import * as ts from 'typescript';
import * as gates from './studio-integration';
import * as voices from '../studio/voice-settings';
/** Execute the actual browser adapter in memory; no React/Chromium or file writes. */
function adapter(fetcher?:unknown){
 const file=path.resolve(__dirname,'../../../2_Remotion_Video/src/studio/studio-v2-adapter.ts');
 const out=ts.transpileModule(readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}}).outputText;
 const box={exports:{}};
 vm.runInNewContext(out,{module:box,exports:box.exports,URL,fetch:fetcher,require:(id:string)=>id.endsWith('studio-integration')?gates:voices},{timeout:2000});
 return box.exports as any;
}
const url='https://www.threads.com/@same_author/post/SYNTHETIC001';
const row=(id='SYNTHETIC001')=>({id:'a'.repeat(64),sourcePostId:id,sourceUrl:'https://www.threads.com/@same_author/post/'+id,author:{name:'SYNTHETIC TEST DATA',handle:'same_author',avatarUrl:null},state:'SCORED',score:70,labels:[],duplicate:null,quarantine:[],observations:1,revision:3,bodyPreview:'SYNTHETIC TEST DATA'});
describe('Integration checkpoint 3 — P0 gates / SYNTHETIC',()=>{
 it('never matches two posts merely by the same author',()=>{
  expect(gates.matchCatalogIdentity(url,[row('OTHER001')])).toBeNull();
  expect(gates.matchCatalogIdentity(url,[row()])?.sourcePostId).toBe('SYNTHETIC001');
 });
 it('requires valid HTTPS canonical URL and mutually consistent ID; rejects ambiguous identity',()=>{
  expect(gates.matchCatalogIdentity(url,[{...row(),sourceUrl:url.replace('SYNTHETIC001','OTHER001')}])).toBeNull();
  expect(gates.matchCatalogIdentity(url,[row(),row()])).toBeNull();
  expect(gates.canonicalTarget('https://localhost/@x/post/SYNTHETIC001')).toBeNull();
 });
 it('keeps UNKNOWN, requiring a deliberate choice for ACCEPT',()=>{
  expect(gates.targetType('UNKNOWN')).toBe('UNKNOWN');
  expect(()=>gates.reviewPayload(3,'ACCEPT','Synthetic review','UNKNOWN')).toThrow('TARGET_CONFIRMATION_REQUIRED');
  expect(gates.targetType('UNKNOWN','COMMENT')).toBe('COMMENT');
  expect(()=>gates.targetType('POST','COMMENT')).toThrow('CONFLICT');
 });
 it('does not invent a target type for REJECT or NEEDS_REVIEW',()=>{
  expect(gates.reviewPayload(3,'NEEDS_REVIEW','Synthetic reason','UNKNOWN')).not.toHaveProperty('confirmedType');
 });
 it('keeps quality feedback revision independent from source/production approval',()=>{
  expect(gates.feedbackPayload(0,'test-feedback','ACCEPT','Synthetic label')).toEqual({revision:0,requestId:'test-feedback',decision:'ACCEPT',reason:'Synthetic label'});
  expect(gates.feedbackPayload(0,'test-feedback','ACCEPT','Synthetic label')).not.toHaveProperty('confirmedType');
  expect(()=>gates.reviewPayload(-1,'ACCEPT','reason','POST')).toThrow('STALE_REVISION');
 });
 it('projects catalog posts without any open session and preserves unknown/nulls',()=>{
  const view=adapter().catalogPostView(row(),null,null);
  expect(view.scope).toBe('CATALOG_POST');expect(view.data01PostId).toBe(row().id);
  expect(view.sessionItemId).toBeNull();expect(view.entityType).toBe('UNKNOWN');
  expect(view.likesCount).toBeNull();expect(view.identityVerified).toBe(false);
 });
 it('does not link a catalog post to a different scene by author handle',()=>{
  const session={items:[{id:'scene-other',sourceUrl:row('OTHER001').sourceUrl}]};
  expect(adapter().catalogPostView(row(),null,session).sessionItemId).toBeNull();
 });
 it('uses full backend identity and evaluation revision for catalog actions',()=>{
  const r=row(),detail={post:{id:r.id},bronze:{sourcePostId:r.sourcePostId,sourceUrl:r.sourceUrl,originalBody:'SYNTHETIC TEST DATA',itemType:'UNKNOWN',author:r.author,engagement:{likes:0,replies:null,reposts:null,shares:null}},evaluation:{id:'eval',revision:8,state:'SCORED',gold:{score:70,labels:[],reasons:[]},silver:{quarantineReasons:[]}}};
  const v=adapter().catalogPostView(r,detail,null);expect(v.identityVerified).toBe(true);expect(v.data01Revision).toBe(8);expect(v.likesCount).toBe(0);
 });
 it('reads requested catalog pages beyond the current session with actual response projection',async()=>{
  const calls:string[]=[];
  const a=adapter(async(url:string)=>{calls.push(url);return {ok:true,json:async()=>({success:true,data:{total:51,rows:[row('PAGE003')],page:2}})};});
  const result=await a.fetchData01Catalog(2);
  expect(calls).toEqual(['/api/studio/data?page=2']);
  expect(result.catalog.total).toBe(51);expect(result.catalog.rows[0].sourcePostId).toBe('PAGE003');
 });
 it('never labels synthetic observations as REAL DATA',()=>{
  expect(adapter().catalogPostView({...row(),synthetic:true},null,null).provenanceBadge).toBe('MOCK DATA');
  expect(adapter().catalogPostView(row(),null,null).provenanceBadge).toBe('REAL DATA');
 });
 it('counts pending reviews across the catalog, not the open session',()=>{
  const counts={QUALIFIED:3,QUEUED:1,REJECTED:2,QUARANTINED:1,SCORED:4,DISCOVERED:1,FAILED:1};
  expect(gates.pendingReviewCount(counts)).toBe(6);
  expect(adapter().catalogPendingReview({counts})).toBe(6);
  expect(adapter().catalogPendingReview(null)).toBe(0);
  expect(gates.pendingReviewCount(undefined)).toBe(0);
 });
 it('treats pipeline QUALIFIED as approved only after an explicit user ACCEPT',()=>{
  expect(gates.isUserAccepted(null)).toBe(false);
  expect(gates.isUserAccepted(undefined)).toBe(false);
  expect(gates.isUserAccepted({decision:'NEEDS_REVIEW'})).toBe(false);
  expect(gates.isUserAccepted({decision:'REJECT'})).toBe(false);
  expect(gates.isUserAccepted({decision:'ACCEPT'})).toBe(true);
 });
});
