import {DATA_SCHEMA} from './contracts';
import {hash} from './rules';
import {ConversationEngine} from './conversation-engine';
import {EDITORIAL_VERSION,type EditorialPlan,type EditorialSection} from './editorial-contracts';
import {feasibility,selectedReplies} from './editorial-feasibility';
const key=(id:string)=>{if(!/^[a-f0-9]{64}$/.test(id))throw Error('EDITORIAL_INVALID_ID');return 'editorial-plans/'+id+'.json';};
/** Explicit operations only. Quality labels, editorial selection and production approval remain independent. */
export class EditorialEngine {
 private tail:Promise<unknown>=Promise.resolve();
 constructor(readonly conversations:ConversationEngine){}
 private serial<T>(fn:()=>Promise<T>){const next=this.tail.catch(()=>{}).then(fn);this.tail=next;return next;}
 async get(id:string){const plan=await this.conversations.data.store.read<EditorialPlan>(key(id));if(!plan||plan.version!==EDITORIAL_VERSION||hash(plan.bundle)!==plan.bundleHash)throw Error('EDITORIAL_PLAN_INTEGRITY');return plan;}
 async list(){const rows:EditorialPlan[]=[];for await(const row of this.conversations.data.store.rows<EditorialPlan>('editorial-plans'))rows.push(row);return rows.sort((a,b)=>b.updatedAt.localeCompare(a.updatedAt));}
 async create(body:any){return this.serial(async()=>{
  if(!body||!/^[\w-]{1,100}$/.test(body.requestId||'')||body.selectionConfirmed!==true||body.style&&body.style!=='SERIOUS')throw Error('EDITORIAL_EXPLICIT_SELECTION_REQUIRED');
  const record=await this.conversations.collection(body.collectionId),review=await this.conversations.review(body.collectionId);
  if(review.revision!==body.selectionRevision)throw Error('EDITORIAL_STALE_REVISION');
  if(!review.selectedReplyIds.length)throw Error('EDITORIAL_SELECT_VERIFIED_REPLY');
  const replies=selectedReplies(record.collection,review.selectedReplyIds),id=hash({version:EDITORIAL_VERSION,collectionId:body.collectionId,selectionRevision:review.revision,style:'SERIOUS'});
  for await(const row of this.conversations.data.store.rows<EditorialPlan>('editorial-plans'))if(row.requestId===body.requestId&&row.id!==id)throw Error('EDITORIAL_REQUEST_CONFLICT');
  const existing=await this.conversations.data.store.read<EditorialPlan>(key(id));if(existing)return this.get(id);
  const quote=(id:string,stage:EditorialSection['stage'],text:string,sourceId:string,parentId:string|null,url:string):EditorialSection=>({id,stage,kind:'QUOTE',sourceId,parentId,permalink:url,originalText:text,displayText:text,narrationText:text,locked:false});
  const commentary=(stage:'HOOK'|'COMMENTARY'|'RESOLUTION'):EditorialSection=>({id:stage.toLowerCase(),stage,kind:'COMMENTARY',sourceId:null,parentId:null,permalink:null,originalText:'',displayText:'',narrationText:'',locked:false});
  const sections=[commentary('HOOK'),quote('root','CONTEXT',record.collection.root.originalText,record.collection.root.id,null,record.collection.root.url),...replies.map(r=>quote('reply-'+r.id,'DISCUSSION',r.originalText,r.id,r.parentId,r.url)),commentary('COMMENTARY'),commentary('RESOLUTION')];
  const bundle={collection:record.collection,quality:record.evaluation,humanReplyLabels:review.replyLabels,sourceLink:record.sourceLink},at=new Date().toISOString();
  const plan:EditorialPlan={schemaVersion:DATA_SCHEMA,version:EDITORIAL_VERSION,id,requestId:body.requestId,revision:0,collectionId:record.id,selectionRevision:review.revision,selectedReplyIds:[...review.selectedReplyIds],bundle,bundleHash:hash(bundle),sections,feasibility:feasibility(bundle.collection,bundle.quality,review.selectedReplyIds,sections,bundle.humanReplyLabels),style:'SERIOUS',scriptStatus:'DRAFT',editorialSelectionConfirmed:true,rightsStatus:'UNKNOWN',updatedAt:at,history:[{at,revision:0,action:'DRAFT_PLAN_CREATED',reason:'Explicit editorial selection; no script, audio, rights or production approval implied'}]};
  await this.conversations.data.store.write(key(id),plan);return plan;
 });}
 async save(id:string,body:any){return this.serial(async()=>{
  const plan=await this.get(id);if(plan.revision!==body?.revision)throw Error('EDITORIAL_STALE_REVISION');
  if(!Array.isArray(body.sections)||body.sections.length!==plan.sections.length||new Set(body.sections.map((s:any)=>s.id)).size!==plan.sections.length)throw Error('EDITORIAL_INVALID_SECTIONS');
  const sections:EditorialSection[]=body.sections.map((patch:any)=>{
   const original=plan.sections.find(s=>s.id===patch.id);if(!original||!['QUOTE','PARAPHRASE','COMMENTARY'].includes(patch.kind)||typeof patch.displayText!=='string'||typeof patch.narrationText!=='string'||patch.displayText.length>30000||patch.narrationText.length>30000||typeof patch.locked!=='boolean')throw Error('EDITORIAL_INVALID_SECTION');
   if((original.sourceId===null)!==(patch.kind==='COMMENTARY'))throw Error('EDITORIAL_SOURCE_ROLE_IMMUTABLE');
   if(original.locked&&(patch.displayText!==original.displayText||patch.narrationText!==original.narrationText||patch.kind!==original.kind))throw Error('EDITORIAL_SECTION_LOCKED');
   if(patch.kind==='QUOTE'&&(patch.displayText!==original.originalText||patch.narrationText!==original.originalText))throw Error('EDITORIAL_QUOTE_REQUIRES_PARAPHRASE_LABEL');
   return {...original,kind:patch.kind,displayText:patch.displayText,narrationText:patch.narrationText,locked:patch.locked};
  });
  plan.sections=sections;plan.revision++;plan.updatedAt=new Date().toISOString();plan.feasibility=feasibility(plan.bundle.collection,plan.bundle.quality,plan.selectedReplyIds,sections,plan.bundle.humanReplyLabels);plan.history.push({at:plan.updatedAt,revision:plan.revision,action:'MANUAL_DRAFT_EDIT',reason:'No facts or rights automatically verified; DRAFT remains unapproved'});await this.conversations.data.store.write(key(id),plan);return plan;
 });}
 async handoff(id:string,body:any,produce:(input:any,snapshot:{plan:EditorialPlan;planHash:string})=>Promise<any>){return this.serial(async()=>{
  const plan=await this.get(id);if(body?.planRevision!==plan.revision)throw Error('EDITORIAL_STALE_REVISION');
  if(body.confirmDraftCreation!==true)throw Error('EDITORIAL_PRODUCTION_CONFIRMATION_REQUIRED');
  const review=await this.conversations.review(plan.collectionId);if(review.revision!==plan.selectionRevision||hash(review.selectedReplyIds)!==hash(plan.selectedReplyIds))throw Error('EDITORIAL_SELECTION_CHANGED');
  const f=feasibility(plan.bundle.collection,plan.bundle.quality,plan.selectedReplyIds,plan.sections,plan.bundle.humanReplyLabels);if(f.status!=='READY_FOR_SCRIPT')throw Error('EDITORIAL_NOT_FEASIBLE');
  if(!plan.bundle.sourceLink||body.postId!==plan.bundle.sourceLink.postId)throw Error('EDITORIAL_ROOT_MISMATCH');
  return produce(body,{plan,planHash:hash(plan)});
 });}
}
