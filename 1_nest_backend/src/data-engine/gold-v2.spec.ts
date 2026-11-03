import { describe, it, expect, afterEach, jest } from '@jest/globals';
import { promises as fs } from 'fs';
import * as os from 'os';
import * as path from 'path';
import { DataStore } from './store';
import { DataEngine } from './engine';
import type { SourceInput } from './contracts';
import { GoldShadowEngine } from './gold-shadow';
import { qualityMetrics, shadowResult } from './gold-v2';
import { hash } from './rules';
const roots:string[]=[];
const body='Mình đi làm và gặp đồng nghiệp mỗi ngày. Mình luôn nghĩ rằng cách trao đổi với nhau rất quan trọng. Có những người không nói rõ điều mình muốn rồi lại cảm thấy bị hiểu lầm. Mọi người có gặp chuyện như vậy không?';
const source=(text=body):SourceInput=>({sourcePlatform:'THREADS',sourcePostId:'SYNTHETIC02C',sourceUrl:'https://www.threads.com/@synthetic/post/SYNTHETIC02C',author:{name:'SYNTHETIC TEST DATA',handle:'synthetic',avatarUrl:null},originalBody:text,topic:null,itemType:'POST',parentReference:null,publishedAt:'2026-11-03T00:00:00Z',fetchedAt:'2026-11-03T01:00:00Z',engagement:{likes:100,replies:10,reposts:null,shares:null},fetch:{source:'SYNTHETIC_TEST_DATA',query:null},rawPayload:{text,synthetic:true},provenance:{synthetic:true,discoveryReviewRequired:true}});
async function fixture(text=body, patch:Partial<SourceInput>={}) {
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'data02c-test-'));roots.push(root);
  const data=new DataEngine(new DataStore(root));
  const run=await data.import([{...source(text),...patch}], '2026-11-03T01:00:00Z');
  const detail=await data.detail(run.results[0].postId);
  const shadow=new GoldShadowEngine(data);
  return {root,data,run,detail,shadow};
}
afterEach(async()=>{jest.restoreAllMocks();for(const root of roots.splice(0)){
  if(!path.resolve(root).startsWith(path.resolve(os.tmpdir())+path.sep)||!path.basename(root).startsWith('data02c-test-'))throw Error('Unsafe cleanup');
  await fs.rm(root,{recursive:true,force:true});
}});
describe('Gold V2 shadow — SYNTHETIC TEST DATA / OFFLINE',()=>{
  it('expands đi làm/đồng nghiệp without overwriting V1, original text, review or queue',async()=>{
    const f=await fixture(), e=f.detail.evaluation!, before=JSON.stringify(f.detail);
    expect(e.gold!.labels).toContain('OFF_TOPIC');
    const s=await f.shadow.evaluate(f.detail.post.id,e.id,'WORK');
    expect(s.result.v2!.labels).not.toContain('OFF_TOPIC');
    expect(s.result.v2!.score).toBeGreaterThan(e.gold!.score);
    expect(s.result.bucket).toBe('GOLD_CANDIDATE');
    expect(JSON.stringify(await f.data.detail(f.detail.post.id))).toBe(before);
    expect((await f.shadow.evaluate(f.detail.post.id,e.id,'WORK')).id).toBe(s.id);
    expect(s.result.productionAllowed).toBe(false);
  });
  it('keeps UNKNOWN entity in review even with a high heuristic score',async()=>{
    const f=await fixture(body,{itemType:'UNKNOWN'}),s=await f.shadow.evaluate(f.detail.post.id,f.detail.evaluation!.id);
    expect(s.result.bucket).toBe('NEEDS_REVIEW');
  });
  it.each([
    ['Mua ngay, đặt hàng, giảm giá, ưu đãi! Liên hệ hotline để mua ngay và đặt hàng sản phẩm hôm nay.', 'REJECTED'],
    ['Mình rất thất vọng vì thấy tin tuyển dụng ghi mức lương rồi yêu cầu gửi CV qua hotline. Đây là trải nghiệm đi làm của mình.', 'NEEDS_REVIEW'],
    ['Mình đang nuôi cây xương rồng bên cửa sổ. Mỗi ngày mình chăm sóc và tưới cây, có những cành cây rất đẹp khi có nắng.', 'LOW_PRIORITY'],
    ['Mình đi làm rất mệt. clm những chuyện xảy ra khiến mình bức xúc và không biết phải nói như thế nào với mọi người.', 'NEEDS_REVIEW'],
  ])('classifies conservatively: %s',async(text,bucket)=>{
    const f=await fixture(text),s=await f.shadow.evaluate(f.detail.post.id,f.detail.evaluation!.id);
    expect(s.result.bucket).toBe(bucket);
  });
  it('separates quarantine from low priority and does not score invalid source',async()=>{
    const f=await fixture('',{publishedAt:'invalid'}),s=await f.shadow.evaluate(f.detail.post.id,f.detail.evaluation!.id);
    expect(s.result.bucket).toBe('QUARANTINED');expect(s.result.v2).toBeNull();
    expect(s.result.reasons).toContain('EMPTY_CONTENT');
  });
  it('persists independent feedback with reason, idempotency and stale-revision checks',async()=>{
    const f=await fixture(),s=await f.shadow.evaluate(f.detail.post.id,f.detail.evaluation!.id);
    const input={revision:0,requestId:'feedback-one',decision:'ACCEPT',reason:'Synthetic user label'};
    const a=await f.shadow.feedback(s.id,input);
    const restart=new GoldShadowEngine(new DataEngine(new DataStore(f.root)));
    expect(await restart.feedback(s.id,input)).toEqual(a);
    await expect(restart.feedback(s.id,{...input,requestId:'stale'})).rejects.toThrow('STALE_REVISION');
    await expect(restart.feedback(s.id,{...input,reason:'changed'})).rejects.toThrow('CONFLICT');
    expect((await f.data.detail(f.detail.post.id)).evaluation!.review).toBeNull();
    expect((await restart.list()).rows[0].feedback.decision).toBe('ACCEPT');
    expect((await restart.metrics()).precisionAt10.status).toBe('NOT_MEASURED');
    await f.data.review(f.detail.post.id,f.detail.evaluation!.revision,'NEEDS_REVIEW','Synthetic change');
    await expect(restart.feedback(s.id,{...input,revision:1,requestId:'stale-eval'})).rejects.toThrow('STALE_REVISION');
  });
  it('is reproducible and matches phrases at word boundaries, not substrings',async()=>{
    const f=await fixture();const b=f.detail.bronze!,e=f.detail.evaluation!;
    expect(hash(shadowResult(b,e))).toBe(hash(shadowResult(b,e)));
    const copy=JSON.parse(JSON.stringify(e));copy.silver.normalized.body='Mình đi làmx và đồng nghiệpx mỗi ngày, không có câu chuyện nào để kể ở đây.';
    expect(shadowResult(b,copy,'WORK').v2!.labels).toContain('OFF_TOPIC');
  });
  it('requires complete labels; calculates Precision@10 and false positive/negative IDs',()=>{
    const rows=Array.from({length:10},(_,i)=>({postId:String(i),score:100-i,bucket:(i<5?'GOLD_CANDIDATE':'LOW_PRIORITY') as 'GOLD_CANDIDATE'|'LOW_PRIORITY',decision:i%2===0?'ACCEPT':'REJECT'}));
    const m=qualityMetrics(rows);expect(m.precisionAt10.value).toBe(.5);
    expect(m.confusion.falsePositives).toEqual(['1','3']);expect(m.confusion.falseNegatives).toEqual(['6','8']);
    rows[0].decision='NEEDS_REVIEW';expect(qualityMetrics(rows).confusion.status).toBe('NOT_MEASURED');
  });
});
