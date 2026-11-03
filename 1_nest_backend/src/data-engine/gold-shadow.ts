import { DATA_SCHEMA, type Evaluation, type DataRun, type Bronze } from './contracts';
import { DataEngine } from './engine';
import { hash } from './rules';
import { shadowResult, qualityMetrics, topic, type DiscoveryTopic } from './gold-v2';
import type { GoldShadow } from "./discovery-contracts";
export type { GoldShadow } from "./discovery-contracts";
export interface Feedback {
  schemaVersion: typeof DATA_SCHEMA; id: string; shadowId: string; revision: number;
  requestId: string; decision: 'ACCEPT' | 'REJECT' | 'NEEDS_REVIEW'; reason: string; at: string;
}
/** Shadow snapshots and user labels are separate immutable records, never V1 mutations. */
export class GoldShadowEngine {
  private busy = false;
  constructor(readonly data: DataEngine) {}
  private key(kind: string, id: string) {
    if (!/^[a-f0-9]{64}$/.test(id)) throw Error('CRAWLER_INVALID_SHADOW_ID');
    return `${kind}/${id}.json`;
  }
  async evaluate(postId: string, evaluationId: string, selected: DiscoveryTopic = 'ALL') {
    selected = topic(selected);
    const e = await this.data.history(postId, evaluationId);
    if (!e) throw Error('CRAWLER_EVALUATION_REQUIRED');
    const b = await this.data.observation(postId, e.bronzeId);
    if (!b) throw Error('CRAWLER_BRONZE_REQUIRED');
    const result = shadowResult(b,e,selected);
    const id = hash({ evaluationId, revision:e.revision, configHash:result.configHash });
    const old = await this.data.store.read<GoldShadow>(this.key('gold-shadows',id));
    if (old) return old;
    const row: GoldShadow = { schemaVersion: DATA_SCHEMA,id,postId,bronzeId:b.id,evaluationId,
      evaluationRevision:e.revision,createdAt:new Date().toISOString(),result };
    await this.data.store.write(this.key('gold-shadows',id),row,true);
    return row;
  }
  async evaluateImport(id: string, selected: DiscoveryTopic = 'ALL') {
    const run = await this.data.store.read<DataRun>(this.key('runs',id));
    if (!run || run.status !== 'COMPLETED') throw Error('CRAWLER_IMPORT_FAILED');
    const rows: GoldShadow[] = [];
    for (const r of run.results) rows.push(await this.evaluate(r.postId,hash({bronzeId:r.bronzeId,configHash:run.configHash}),selected));
    return rows;
  }
  async get(id: string) {
    const row = await this.data.store.read<GoldShadow>(this.key('gold-shadows',id));
    if (!row) throw Error('CRAWLER_UNKNOWN_SHADOW');
    return row;
  }
  async feedbackHistory(id: string) {
    await this.get(id);
    const history: Feedback[] = [];
    for await (const f of this.data.store.rows<Feedback>('gold-feedback')) if (f.shadowId === id) history.push(f);
    return history.sort((a,b) => a.revision-b.revision);
  }
  async feedback(id: string, body: any) {
    if(this.busy) throw Error('CRAWLER_BUSY');
    this.busy=true;
    try {
      if(!body || !Number.isSafeInteger(body.revision) || body.revision < 0 || !['ACCEPT','REJECT','NEEDS_REVIEW'].includes(body.decision)
        || typeof body.reason !== 'string' || !body.reason.trim() || body.reason.length>1000 || !/^[A-Za-z0-9-]{1,100}$/.test(body.requestId || '')) throw Error('CRAWLER_INVALID_FEEDBACK');
      const history = await this.feedbackHistory(id), old = history.find(f => f.requestId===body.requestId);
      if(old) {
        if(old.decision!==body.decision || old.reason!==body.reason.trim() || old.revision!==body.revision+1) throw Error('CRAWLER_IDEMPOTENCY_CONFLICT');
        return old;
      }
      const row = await this.get(id), current = await this.data.detail(row.postId);
      if(current.evaluation?.id!==row.evaluationId || current.evaluation.revision!==row.evaluationRevision || body.revision!==history.length) throw Error('CRAWLER_STALE_REVISION');
      const f:Feedback = {schemaVersion:DATA_SCHEMA,id:hash({id,requestId:body.requestId}),shadowId:id,revision:history.length+1,requestId:body.requestId,decision:body.decision,reason:body.reason.trim(),at:new Date().toISOString()};
      await this.data.store.write(this.key('gold-feedback',f.id),f,true);
      return f;
    } finally { this.busy=false; }
  }
  async list(selected?:string, page=0, bucket?:string) {
    const t=topic(selected);
    if(!Number.isSafeInteger(page)||page<0)throw Error('CRAWLER_INVALID_PAGE');
    if(bucket&&!['GOLD_CANDIDATE','NEEDS_REVIEW','LOW_PRIORITY','REJECTED','QUARANTINED'].includes(bucket))throw Error('CRAWLER_INVALID_BUCKET');
    const counts:Record<string,number>={}, rows:any[]=[];
    let matching=0;
    for await(const r of this.data.store.rows<GoldShadow>('gold-shadows')){
      if(r.result.topic!==t)continue;
      const d=await this.data.detail(r.postId);
      if(d.evaluation?.id!==r.evaluationId || d.evaluation.revision!==r.evaluationRevision)continue;
      counts[r.result.bucket]=(counts[r.result.bucket]||0)+1;
      if(bucket&&r.result.bucket!==bucket)continue;
      if(matching++<page*25 || rows.length>=25)continue;
      const history=await this.feedbackHistory(r.id);
      rows.push({...r,sourceUrl:d.bronze?.sourceUrl,author:d.bronze?.author,bodyPreview:d.bronze?.originalBody?.slice(0,240),feedback:history[history.length-1]||null,feedbackRevision:history.length});
    }
    return {topic:t,page,pageSize:25,matching,counts,rows};
  }
  async metrics(selected?:string) {
    const t=topic(selected), rows:Parameters<typeof qualityMetrics>[0]=[];
    for await(const r of this.data.store.rows<GoldShadow>('gold-shadows')) {
      if(r.result.topic!==t)continue;
      const d=await this.data.detail(r.postId);
      if(d.evaluation?.id!==r.evaluationId||d.evaluation.revision!==r.evaluationRevision)continue;
      const history=await this.feedbackHistory(r.id);
      if(r.result.v2) rows.push({postId:r.postId,score:r.result.v2.score,bucket:r.result.bucket,decision:history[history.length-1]?.decision||null});
    }
    return qualityMetrics(rows);
  }
}
