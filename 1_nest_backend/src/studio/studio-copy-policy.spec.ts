import {describe,it,expect} from '@jest/globals';
const {allowed}=require('../../scripts/studio-copy-policy.cjs');
describe('REAL_DATA_COPY safety boundary',()=>{
 it('enables explicit sandbox content review independently of production queue',()=>{const id='a'.repeat(64);expect(allowed('POST','/api/studio/data/posts/'+id+'/review')).toBe(true);expect(allowed('POST','/api/studio/data/posts/'+id+'/enqueue')).toBe(false)});
 it('allows configuration states but never starts a collector',()=>{expect(allowed('POST','/api/studio/ops/collection-config',{action:'SAVE'})).toBe(true);expect(allowed('POST','/api/studio/ops/collection-config',{action:'START'})).toBe(false)});
 it('allows planning but not project creation or script/production approval',()=>{const id='b'.repeat(64);expect(allowed('POST','/api/studio/data/editorial/plans')).toBe(true);expect(allowed('POST','/api/studio/data/editorial/plans/'+id+'/project')).toBe(false);expect(allowed('POST','/api/studio/data/editorial/sessions/x/approve-script')).toBe(false)});
 it('allows saved sessions and local preview without any live worker',()=>{
  const id='35b8a880-b8b5-49ec-be42-0991228eb45e';
  expect(allowed('GET','/api/studio/data/posts')).toBe(true);
  expect(allowed('PUT','/api/studio/sessions/'+id)).toBe(true);
  expect(allowed('POST','/api/studio/sessions/'+id+'/jobs',{operation:'editor/prepare'})).toBe(true);
 });
 it.each(['fetch','voice-runtime','voice/x','voice-batch','render','source-images/cache'])('rejects %s before starting a job',operation=>{
  expect(allowed('POST','/api/studio/sessions/35b8a880-b8b5-49ec-be42-0991228eb45e/jobs',{operation})).toBe(false);
 });
 it.each(['/api/studio/data/posts/a/review','/api/studio/data/posts/a/enqueue','/api/studio/data/production/jobs','/api/studio/data/crawler/runs','/api/studio/data/conversations/runs','/api/studio/threads/auth/verify','/api/studio/threads/scheduler','/api/studio/threads/collector/runs','/api/studio/publishing/accounts'])('fails closed for %s',path=>expect(allowed('POST',path)).toBe(false));
 it('rejects OAuth GET and media deletion',()=>{expect(allowed('GET','/api/studio/threads/oauth/login')).toBe(false);expect(allowed('DELETE','/api/studio/sessions/a/media/b')).toBe(false)});
});
