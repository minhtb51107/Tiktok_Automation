import { DATA_SCHEMA } from './contracts';
import { DataEngine } from './engine';
import { hash } from './rules';
import { rankCandidates } from './conversation-popularity';
import { canonicalPost } from './conversation-evidence';
import type { PopularityCandidate, ThreadCollection } from './conversation-contracts';
import { rankConversations,CONTENT_SELECTION } from './content-selection';
import type { ContentStyle } from '../video-pipeline/contracts';
import { crawlerInput } from './crawler-adapter';
import { GoldShadowEngine } from './gold-shadow';
import { DISCOVERY_TOPICS } from './gold-v2';
export interface QualityRequest {requestId:string;style:ContentStyle;topic:string;keywords:string[];maxPosts:number;maxRunMs:number}
export function qualityRequest(b:any):QualityRequest {
  if(!b||!/^[-\w]{1,100}$/.test(b.requestId)||!['SERIOUS','FUNNY'].includes(b.style)||typeof b.topic!=='string'||b.topic.length>120||!Array.isArray(b.keywords)||b.keywords.length<1||b.keywords.length>8||b.keywords.some((q:any)=>typeof q!=='string'||!q.trim()||q.length>120)||!Number.isInteger(b.maxPosts)||b.maxPosts<1||b.maxPosts>50||!Number.isInteger(b.maxRunMs)||b.maxRunMs<1000||b.maxRunMs>600000)throw Error('QUALITY_INVALID_REQUEST');
  return {requestId:b.requestId,style:b.style,topic:b.topic,keywords:[...new Set<string>(b.keywords.map((x:string)=>x.trim()))],maxPosts:b.maxPosts,maxRunMs:b.maxRunMs};
}
export interface QualityProvider {execution:'LIVE'|'SYNTHETIC';discover(keyword:string):Promise<PopularityCandidate[]>;enrich(url:string):Promise<ThreadCollection>}
export interface QualityRun {schemaVersion:typeof DATA_SCHEMA;version:'content-discovery/1';configHash:string;captureHashes:Record<string,string>;id:string;request:QualityRequest;execution:'LIVE'|'SYNTHETIC';status:'RUNNING'|'COMPLETED'|'PARTIAL'|'BLOCKED';stage:string;startedAt:string;completedAt:string|null;elapsedMs:number;keywordCursor:number;targetCursor:number;candidates:PopularityCandidate[];urls:string[]|null;collections:ThreadCollection[];imports:string[];errors:string[];result:ReturnType<typeof rankConversations>|null;history:Array<{at:string;stage:string}>}
/** Small sequential coordinator over existing DATA04 discovery/enrichment and DATA01 storage. */
export class ContentDiscovery {
  private busy=false;
  constructor(readonly data:DataEngine,readonly provider:QualityProvider,private now=()=>Date.now()){}
  private key(id:string){if(!/^[a-f0-9]{64}$/.test(id))throw Error('QUALITY_INVALID_RUN');return 'content-quality-runs/'+id+'.json'}
  async get(id:string){const r=await this.data.store.read<QualityRun>(this.key(id));if(!r)throw Error('QUALITY_UNKNOWN_RUN');if(r.collections.some(c=>r.captureHashes[c.root.url]!==hash(c)))throw Error('QUALITY_CAPTURE_INTEGRITY');return r}
  async list(){const out:QualityRun[]=[];for await(const r of this.data.store.rows<QualityRun>('content-quality-runs'))out.push(r);return out.map(r=>({id:r.id,status:r.status,request:r.request,execution:r.execution,startedAt:r.startedAt,elapsedMs:r.elapsedMs,collected:r.collections.length,errors:r.errors}))}
  private async save(r:QualityRun){r.elapsedMs=this.now()-Date.parse(r.startedAt);r.history.push({at:new Date(this.now()).toISOString(),stage:r.stage});await this.data.store.write(this.key(r.id),r)}
  async start(body:unknown){const input=qualityRequest(body),id=hash({qualityRequest:input.requestId}),old=await this.data.store.read<QualityRun>(this.key(id));if(old){if(hash(input)!==hash(old.request))throw Error('QUALITY_IDEMPOTENCY_CONFLICT');return old}return this.execute({schemaVersion:DATA_SCHEMA,version:'content-discovery/1',configHash:hash(CONTENT_SELECTION),captureHashes:{},id,request:input,execution:this.provider.execution,status:'RUNNING',stage:'DISCOVERY',startedAt:new Date(this.now()).toISOString(),completedAt:null,elapsedMs:0,keywordCursor:0,targetCursor:0,candidates:[],urls:null,collections:[],imports:[],errors:[],result:null,history:[]})}
  async resume(id:string){const r=await this.get(id);if(r.status==='COMPLETED')return r;if(r.status==='BLOCKED'||r.errors.some(x=>/ACCESS|HTTP_(401|403|429)|RESOURCE|TIME_BUDGET/.test(x)))throw Error('QUALITY_NEW_APPROVAL_AND_PREFLIGHT_REQUIRED');return this.execute(r)}
  private async execute(r:QualityRun){if(this.busy)throw Error('QUALITY_BUSY');this.busy=true;try{
    const budget=()=>{if(this.now()-Date.parse(r.startedAt)>=r.request.maxRunMs)throw Error('QUALITY_TIME_BUDGET')};
    if(r.configHash!==hash(CONTENT_SELECTION))throw Error('QUALITY_CONFIG_CHANGED');
    if(r.collections.some(c=>r.captureHashes[c.root.url]!==hash(c)))throw Error('QUALITY_CAPTURE_INTEGRITY');
    await this.save(r);
    while(r.keywordCursor<r.request.keywords.length&&r.candidates.length<r.request.maxPosts){budget();r.stage='DISCOVERY';await this.save(r);const rows=await this.provider.discover(r.request.keywords[r.keywordCursor]);
      for(const row of rows){const link=canonicalPost(row.url);if(link&&!r.candidates.some(x=>canonicalPost(x.url)?.id===link.id)&&r.candidates.length<r.request.maxPosts)r.candidates.push({...row,url:link.url,observedOrder:r.candidates.length})}r.keywordCursor++;await this.save(r);
    }
    if(!r.urls)r.urls=rankCandidates(r.candidates,r.request.maxPosts,new Date(this.now()).toISOString()).selected;
    while(r.targetCursor<r.urls.length){budget();const url=r.urls[r.targetCursor];let collection=r.collections.find(c=>c.root.url===url);r.stage='EXACT_ROOT_AND_REPLIES';await this.save(r);
      if(!collection){collection=await this.provider.enrich(url);if(canonicalPost(collection.root.url)?.url!==url)throw Error('QUALITY_WRONG_TARGET');if(collection.root.provenance.synthetic!==(this.provider.execution==='SYNTHETIC'))throw Error('QUALITY_PROVENANCE_MISMATCH');r.collections.push(collection);r.captureHashes[url]=hash(collection);await this.save(r)}
      if(collection.sourceCapture){const input=crawlerInput(collection.sourceCapture,r.id,this.provider.execution==='SYNTHETIC');if(input){const imported=await this.data.import([input],collection.root.provenance.observedAt);if(!r.imports.includes(imported.id))r.imports.push(imported.id);await new GoldShadowEngine(this.data).evaluateImport(imported.id);}}
      r.targetCursor++;await this.save(r);
    }
    r.status='COMPLETED';r.stage='WAITING_HUMAN_REVIEW';
  }catch(e){const code=e instanceof Error?e.message:'QUALITY_FAILED';r.errors.push(/^[A-Z0-9_]+$/.test(code)?code:'QUALITY_FAILED');r.status=/ACCESS|HTTP_(401|403|429)|RESOURCE|BROWSER_MISSING/.test(code)?'BLOCKED':'PARTIAL';r.stage='STOPPED_NO_AUTOMATIC_RETRY';}
  finally{try{try{const terms=[...r.request.keywords,...Object.entries(DISCOVERY_TOPICS).filter(([key,value])=>r.request.topic.includes(key)||r.request.keywords.includes(value.keyword)).flatMap(([,value])=>[...value.terms])];r.result=rankConversations(r.collections,r.request.style,new Date(this.now()).toISOString(),terms)}catch{r.result=null;r.status='PARTIAL';r.errors.push('QUALITY_SCORING_FAILED')}r.completedAt=new Date(this.now()).toISOString();await this.save(r)}finally{this.busy=false}}return r}
}
