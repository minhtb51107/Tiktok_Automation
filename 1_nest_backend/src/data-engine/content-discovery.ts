import { DATA_SCHEMA } from './contracts';
import { DataEngine } from './engine';
import { hash } from './rules';
import { rankCandidates } from './conversation-popularity';
import { canonicalPost } from './conversation-evidence';
import type { ConversationCollectionBudget, PopularityCandidate, ThreadCollection } from './conversation-contracts';
import { rankConversations,CONTENT_SELECTION } from './content-selection';
import type { ContentStyle } from '../video-pipeline/contracts';
import { crawlerInput } from './crawler-adapter';
import { GoldShadowEngine } from './gold-shadow';
import { DISCOVERY_TOPICS } from './gold-v2';
import { discoveryFailure, type DiscoveryOutcome } from './discovery-diagnostics';
import type { PublicAccessAudit } from './conversation-public';
export interface QualityRequest {requestId:string;style:ContentStyle;topic:string;keywords:string[];maxPosts:number;maxEnrich:number;priority:'BALANCED'|'HOT'|'RECENT';minInteractions:number;maxRunMs:number;collectionBudget?:ConversationCollectionBudget}
export function qualityRequest(b:any):QualityRequest {
  const maxEnrich=b?.maxEnrich??Math.min(b?.maxPosts??0,10),priority=b?.priority??'BALANCED',minInteractions=b?.minInteractions??0,collectionBudget=b?.collectionBudget;
  const invalidBudget=collectionBudget&&(!Number.isInteger(collectionBudget.maxDurationMs)||collectionBudget.maxDurationMs<30000||collectionBudget.maxDurationMs>180000||!Number.isInteger(collectionBudget.maxActions)||collectionBudget.maxActions<0||collectionBudget.maxActions>15||!Number.isInteger(collectionBudget.maxCards)||collectionBudget.maxCards<1||collectionBudget.maxCards>100||!Number.isInteger(collectionBudget.maxRequestEvents)||collectionBudget.maxRequestEvents<50||collectionBudget.maxRequestEvents>500||!Number.isInteger(collectionBudget.maxUnchangedActions)||collectionBudget.maxUnchangedActions<1||collectionBudget.maxUnchangedActions>5||!Number.isInteger(collectionBudget.maxPermalinkValidations)||collectionBudget.maxPermalinkValidations<0||collectionBudget.maxPermalinkValidations>2);
  if(!b||!/^[-\w]{1,100}$/.test(b.requestId)||!['SERIOUS','FUNNY'].includes(b.style)||typeof b.topic!=='string'||!b.topic.trim()||b.topic.length>120||!Array.isArray(b.keywords)||b.keywords.length<1||b.keywords.length>8||b.keywords.some((q:any)=>typeof q!=='string'||!q.trim()||q.length>120)||!Number.isInteger(b.maxPosts)||b.maxPosts<1||b.maxPosts>50||!Number.isInteger(maxEnrich)||maxEnrich<1||maxEnrich>10||maxEnrich>b.maxPosts||!['BALANCED','HOT','RECENT'].includes(priority)||!Number.isSafeInteger(minInteractions)||minInteractions<0||minInteractions>1_000_000_000||!Number.isInteger(b.maxRunMs)||b.maxRunMs<1000||b.maxRunMs>3600000||invalidBudget)throw Error('QUALITY_INVALID_REQUEST');
  return {requestId:b.requestId,style:b.style,topic:b.topic.trim(),keywords:[...new Set<string>(b.keywords.map((x:string)=>x.trim()))],maxPosts:b.maxPosts,maxEnrich,priority,minInteractions,maxRunMs:b.maxRunMs,...(collectionBudget?{collectionBudget:structuredClone(collectionBudget)}:{})};
}
export interface QualityProvider {execution:'LIVE'|'SYNTHETIC';discover(keyword:string,audit?:(event:PublicAccessAudit)=>void,limit?:number):Promise<PopularityCandidate[]>;enrich(url:string,audit?:(event:PublicAccessAudit)=>void,budget?:ConversationCollectionBudget):Promise<ThreadCollection>}
export interface QualityRun {schemaVersion:typeof DATA_SCHEMA;version:'content-discovery/1';diagnosis?:{stage:string;outcome:DiscoveryOutcome};accessAudits?:PublicAccessAudit[];configHash:string;captureHashes:Record<string,string>;id:string;request:QualityRequest;execution:'LIVE'|'SYNTHETIC';status:'RUNNING'|'COMPLETED'|'PARTIAL'|'BLOCKED';stage:string;startedAt:string;completedAt:string|null;elapsedMs:number;keywordCursor:number;targetCursor:number;candidates:PopularityCandidate[];urls:string[]|null;collections:ThreadCollection[];imports:string[];errors:string[];result:ReturnType<typeof rankConversations>|null;history:Array<{at:string;stage:string}>}
export interface ContentSearchRequest {requestId:string;query:string;limit:10|20|30;priority:'BALANCED'|'HOT'|'RECENT';minInteractions:number;maxRunMs:number}
export interface ContentSearchRun {schemaVersion:typeof DATA_SCHEMA;version:'content-search/1';id:string;request:ContentSearchRequest;execution:'LIVE'|'SYNTHETIC';status:'RUNNING'|'COMPLETED'|'PARTIAL'|'BLOCKED';stage:'SEARCHING'|'RESULTS_READY'|'COLLECTING_REPLIES'|'STOPPED';startedAt:string;completedAt:string|null;elapsedMs:number;candidates:PopularityCandidate[];ranking:ReturnType<typeof rankCandidates>|null;results:Array<{url:string;post:NonNullable<PopularityCandidate['post']>;relevanceScore:number;relevanceMatchedTerms:string[];popularityScore:number|null;supplyScore:number|null;coverage:string;rankingReasons:string[]}>;collections:ThreadCollection[];collectionHashes:Record<string,string>;conversationIds:Record<string,string>;accessAudits:PublicAccessAudit[];errors:string[]}
export function contentSearchRequest(b:any):ContentSearchRequest {
  const query=typeof b?.query==='string'?b.query.trim():'',limit=b?.limit??10,priority=b?.priority??'BALANCED',minInteractions=b?.minInteractions??0,maxRunMs=b?.maxRunMs??120000;
  if(!/^[\w-]{1,100}$/.test(b?.requestId??'')||!query||query.length>120||![10,20,30].includes(limit)||!['BALANCED','HOT','RECENT'].includes(priority)||!Number.isSafeInteger(minInteractions)||minInteractions<0||minInteractions>1_000_000_000||!Number.isInteger(maxRunMs)||maxRunMs<1000||maxRunMs>600000)throw Error('QUALITY_INVALID_SEARCH_REQUEST');
  return {requestId:b.requestId,query,limit,priority,minInteractions,maxRunMs};
}
/** Small sequential coordinator over existing DATA04 discovery/enrichment and DATA01 storage. */
export class ContentDiscovery {
  private busy=false;
  constructor(readonly data:DataEngine,readonly provider:QualityProvider,private now=()=>Date.now()){}
  private key(id:string){if(!/^[a-f0-9]{64}$/.test(id))throw Error('QUALITY_INVALID_RUN');return 'content-quality-runs/'+id+'.json'}
  private searchKey(id:string){if(!/^[a-f0-9]{64}$/.test(id))throw Error('QUALITY_INVALID_SEARCH');return 'content-search-runs/'+id+'.json'}
  async get(id:string){const r=await this.data.store.read<QualityRun>(this.key(id));if(!r)throw Error('QUALITY_UNKNOWN_RUN');if(r.collections.some(c=>r.captureHashes[c.root.url]!==hash(c)))throw Error('QUALITY_CAPTURE_INTEGRITY');return r}
  async list(){const out:QualityRun[]=[];for await(const r of this.data.store.rows<QualityRun>('content-quality-runs'))out.push(r);return out.map(r=>({id:r.id,status:r.status,request:r.request,execution:r.execution,startedAt:r.startedAt,elapsedMs:r.elapsedMs,collected:r.collections.length,errors:r.errors}))}
  async listSearches(){const out:ContentSearchRun[]=[];for await(const r of this.data.store.rows<ContentSearchRun>('content-search-runs'))out.push(r);return out.sort((a,b)=>b.startedAt.localeCompare(a.startedAt)).map(r=>({id:r.id,status:r.status,stage:r.stage,request:r.request,execution:r.execution,startedAt:r.startedAt,elapsedMs:r.elapsedMs,results:r.results.length,collected:r.collections.length,errors:r.errors}))}
  async getSearch(id:string){const r=await this.data.store.read<ContentSearchRun>(this.searchKey(id));if(!r||r.version!=='content-search/1')throw Error('QUALITY_UNKNOWN_SEARCH');if(r.collections.some(c=>r.collectionHashes[c.root.url]!==hash(c)))throw Error('QUALITY_CAPTURE_INTEGRITY');return r}
  private async saveSearch(r:ContentSearchRun){r.elapsedMs=this.now()-Date.parse(r.startedAt);await this.data.store.write(this.searchKey(r.id),r)}
  async search(body:unknown){
    const request=contentSearchRequest(body),id=hash({contentSearchRequest:request.requestId}),old=await this.data.store.read<ContentSearchRun>(this.searchKey(id));
    if(old){if(hash(old.request)!==hash(request))throw Error('QUALITY_IDEMPOTENCY_CONFLICT');return old}
    if(this.busy)throw Error('QUALITY_BUSY');this.busy=true;
    const run:ContentSearchRun={schemaVersion:DATA_SCHEMA,version:'content-search/1',id,request,execution:this.provider.execution,status:'RUNNING',stage:'SEARCHING',startedAt:new Date(this.now()).toISOString(),completedAt:null,elapsedMs:0,candidates:[],ranking:null,results:[],collections:[],collectionHashes:{},conversationIds:{},accessAudits:[],errors:[]};
    try{
      await this.saveSearch(run);const audit=(event:PublicAccessAudit)=>run.accessAudits.push(structuredClone(event));
      const rows=await this.provider.discover(request.query,audit,request.limit);
      for(const row of rows){const identity=canonicalPost(row.url);if(identity&&!run.candidates.some(x=>canonicalPost(x.url)?.id===identity.id))run.candidates.push({...row,url:identity.url,observedOrder:run.candidates.length})}
      run.ranking=rankCandidates(run.candidates,request.limit,new Date(this.now()).toISOString(),{priority:request.priority,minInteractions:request.minInteractions,queryTerms:[request.query]});
      run.results=run.ranking.ranked.flatMap(row=>{const candidate=run.candidates.find(x=>canonicalPost(x.url)?.url===row.url);if(!candidate?.post||row.relevanceScore===null||row.relevanceScore<70)return[];return[{url:row.url,post:structuredClone(candidate.post),relevanceScore:row.relevanceScore,relevanceMatchedTerms:row.relevanceMatchedTerms,popularityScore:row.score,supplyScore:row.supplyScore,coverage:row.coverage,rankingReasons:[...row.supplyReasons,...run.ranking!.reasons]}]});
      run.status='COMPLETED';run.stage='RESULTS_READY';
    }catch(e){const code=e instanceof Error?e.message:'QUALITY_SEARCH_FAILED';run.errors.push(/^[A-Z0-9_]+$/.test(code)?code:'QUALITY_SEARCH_FAILED');run.status=/ACCESS|HTTP_(401|403|429)|RESOURCE|BROWSER_MISSING/.test(code)?'BLOCKED':'PARTIAL';run.stage='STOPPED'}
    finally{run.completedAt=new Date(this.now()).toISOString();await this.saveSearch(run);this.busy=false}
    return run;
  }
  async collectSearch(id:string,url:string,budget?:ConversationCollectionBudget){
    if(this.busy)throw Error('QUALITY_BUSY');const run=await this.getSearch(id),identity=canonicalPost(url);if(!identity||!run.results.some(x=>x.url===identity.url))throw Error('QUALITY_SEARCH_RESULT_REQUIRED');
    const existing=run.collections.find(c=>c.root.url===identity.url);if(existing)return{run,collection:existing};
    this.busy=true;run.status='RUNNING';run.stage='COLLECTING_REPLIES';run.completedAt=null;await this.saveSearch(run);
    try{const collection=await this.provider.enrich(identity.url,event=>run.accessAudits.push(structuredClone(event)),budget);if(canonicalPost(collection.root.url)?.url!==identity.url)throw Error('QUALITY_WRONG_TARGET');run.collections.push(collection);run.collectionHashes[identity.url]=hash(collection);run.status='COMPLETED';run.stage='RESULTS_READY';run.completedAt=new Date(this.now()).toISOString();await this.saveSearch(run);return{run,collection}}
    catch(e){const code=e instanceof Error?e.message:'QUALITY_COLLECTION_FAILED';run.errors.push(/^[A-Z0-9_]+$/.test(code)?code:'QUALITY_COLLECTION_FAILED');run.status=/ACCESS|HTTP_(401|403|429)|RESOURCE|BROWSER_MISSING/.test(code)?'BLOCKED':'PARTIAL';run.stage='STOPPED';run.completedAt=new Date(this.now()).toISOString();await this.saveSearch(run);throw e}
    finally{this.busy=false}
  }
  async linkSearchConversation(id:string,url:string,conversationId:string){const run=await this.getSearch(id),identity=canonicalPost(url);if(!identity||!run.collections.some(c=>c.root.url===identity.url)||!/^[a-f0-9]{64}$/.test(conversationId))throw Error('QUALITY_INVALID_CONVERSATION_LINK');run.conversationIds[identity.url]=conversationId;await this.saveSearch(run);return run}
  private async save(r:QualityRun){r.elapsedMs=this.now()-Date.parse(r.startedAt);r.history.push({at:new Date(this.now()).toISOString(),stage:r.stage});await this.data.store.write(this.key(r.id),r)}
  async start(body:unknown){const input=qualityRequest(body),id=hash({qualityRequest:input.requestId}),old=await this.data.store.read<QualityRun>(this.key(id));if(old){if(hash(input)!==hash(old.request))throw Error('QUALITY_IDEMPOTENCY_CONFLICT');return old}return this.execute({schemaVersion:DATA_SCHEMA,version:'content-discovery/1',configHash:hash(CONTENT_SELECTION),captureHashes:{},id,request:input,execution:this.provider.execution,status:'RUNNING',stage:'DISCOVERY',startedAt:new Date(this.now()).toISOString(),completedAt:null,elapsedMs:0,keywordCursor:0,targetCursor:0,candidates:[],urls:null,collections:[],imports:[],errors:[],result:null,history:[]})}
  async resume(id:string){const r=await this.get(id);if(r.status==='COMPLETED')return r;if(r.status==='BLOCKED'||r.errors.some(x=>/ACCESS|HTTP_(401|403|429)|RESOURCE|TIME_BUDGET/.test(x)))throw Error('QUALITY_NEW_APPROVAL_AND_PREFLIGHT_REQUIRED');return this.execute(r)}
  private async execute(r:QualityRun){if(this.busy)throw Error('QUALITY_BUSY');this.busy=true;try{
    // Compatibility view for durable runs created before discovery and
    // enrichment limits were separated. The persisted request remains intact.
    const maxEnrich=r.request.maxEnrich??Math.min(r.request.maxPosts,10),priority=r.request.priority??'BALANCED',minInteractions=r.request.minInteractions??0;
    const budget=()=>{if(this.now()-Date.parse(r.startedAt)>=r.request.maxRunMs)throw Error('QUALITY_TIME_BUDGET')};
    if(r.configHash!==hash(CONTENT_SELECTION))throw Error('QUALITY_CONFIG_CHANGED');
    if(r.collections.some(c=>r.captureHashes[c.root.url]!==hash(c)))throw Error('QUALITY_CAPTURE_INTEGRITY');
    await this.save(r);
    const audit=(event:PublicAccessAudit)=>{(r.accessAudits??=[]).push(structuredClone(event))};
    while(r.keywordCursor<r.request.keywords.length&&r.candidates.length<r.request.maxPosts){budget();r.stage='DISCOVERY';await this.save(r);const rows=await this.provider.discover(r.request.keywords[r.keywordCursor],audit,Math.min(30,r.request.maxPosts-r.candidates.length));
      for(const row of rows){const link=canonicalPost(row.url);if(link&&!r.candidates.some(x=>canonicalPost(x.url)?.id===link.id)&&r.candidates.length<r.request.maxPosts)r.candidates.push({...row,url:link.url,observedOrder:r.candidates.length})}r.keywordCursor++;await this.save(r);
    }
    const topicTerms=[...new Set([r.request.topic,...r.request.keywords,...Object.entries(DISCOVERY_TOPICS).filter(([key,value])=>r.request.topic.includes(key)||r.request.keywords.includes(value.keyword)).flatMap(([,value])=>[...value.terms])])];
    if(!r.urls)r.urls=rankCandidates(r.candidates,maxEnrich,new Date(this.now()).toISOString(),{priority,minInteractions,queryTerms:topicTerms}).selected;
    while(r.targetCursor<r.urls.length){budget();const url=r.urls[r.targetCursor];let collection=r.collections.find(c=>c.root.url===url);r.stage='EXACT_ROOT_AND_REPLIES';await this.save(r);
      if(!collection){
        try{
          collection=await this.provider.enrich(url,audit,r.request.collectionBudget);
          if(canonicalPost(collection.root.url)?.url!==url)throw Error('QUALITY_WRONG_TARGET');
          if(collection.root.provenance.synthetic!==(this.provider.execution==='SYNTHETIC'))throw Error('QUALITY_PROVENANCE_MISMATCH');
          r.collections.push(collection);r.captureHashes[url]=hash(collection);await this.save(r);
        }catch(rootError){
          const code=rootError instanceof Error?rootError.message:'QUALITY_FAILED';
          const perRootRecoverable=/^CONVERSATION_(?:EXACT_ROOT_BODY_UNVERIFIED|ROOT_IDENTITY_MISMATCH|NAVIGATION_TIMEOUT|HTTP_404|HTTP_410)$|^QUALITY_WRONG_TARGET$/.test(code);
          if(!perRootRecoverable)throw rootError;
          r.errors.push(`ROOT_SKIPPED_${code}`);
          r.targetCursor++;await this.save(r);continue;
        }
      }
      if(collection.sourceCapture){const input=crawlerInput(collection.sourceCapture,r.id,this.provider.execution==='SYNTHETIC');if(input){const imported=await this.data.import([input],collection.root.provenance.observedAt);if(!r.imports.includes(imported.id))r.imports.push(imported.id);await new GoldShadowEngine(this.data).evaluateImport(imported.id);}}
      r.targetCursor++;await this.save(r);
    }
    r.status=r.errors.length&&!r.collections.length?'PARTIAL':'COMPLETED';r.stage='WAITING_HUMAN_REVIEW';
  }catch(e){r.diagnosis={stage:r.stage,outcome:discoveryFailure(e)};const code=e instanceof Error?e.message:'QUALITY_FAILED';r.errors.push(/^[A-Z0-9_]+$/.test(code)?code:'QUALITY_FAILED');r.status=/ACCESS|HTTP_(401|403|429)|RESOURCE|BROWSER_MISSING/.test(code)?'BLOCKED':'PARTIAL';r.stage='STOPPED_NO_AUTOMATIC_RETRY';}
  finally{try{try{const terms=[...r.request.keywords,...Object.entries(DISCOVERY_TOPICS).filter(([key,value])=>r.request.topic.includes(key)||r.request.keywords.includes(value.keyword)).flatMap(([,value])=>[...value.terms])];r.result=rankConversations(r.collections,r.request.style,new Date(this.now()).toISOString(),terms)}catch{r.result=null;r.status='PARTIAL';r.errors.push('QUALITY_SCORING_FAILED')}r.completedAt=new Date(this.now()).toISOString();await this.save(r)}finally{this.busy=false}}return r}
}
