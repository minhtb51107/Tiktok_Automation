import {describe,test,expect} from '@jest/globals';
import {existsSync,readFileSync,promises as fs} from 'fs';
import * as path from 'path';
import * as os from 'os';
import {createHash} from 'crypto';
import {cleanSourceProjection} from '../studio/source-quality';
import {classifyContext,type ContextRegionEvidence} from '../studio/context-classification';
import {newRequestTelemetry,decidePublicRequest} from '../studio/public-request-telemetry';
import {collectEvidence} from './conversation-evidence';
import {selectedReplies} from './editorial-feasibility';
import {verifiedLibraryReplies} from '../studio/library-contract';
import {selectConversation} from './content-selection';
import {StudioService} from '../studio/studio.service';
import type {PublicRecord} from '../studio/public-types';
import type {ThreadCollection} from './conversation-contracts';
const rootUrl='https://www.threads.com/@test/post/ROOT',replyUrl='https://www.threads.com/@reply/post/R01';
const raw=(text='TEST DATA Tôi đã làm việc ở nhà máy, nhưng cần hỏi rõ trách nhiệm.'):PublicRecord=>({text,bodyText:text,author:'reply',handle:'reply',url:replyUrl,createdAt:null,avatar:null,type:'UNKNOWN',parentReference:null,media:[],likeCount:null,replyCount:null,repostCount:null,provenance:{text:'SYNTHETIC TEST DATA'}});
const region=(kind:ContextRegionEvidence['kind']):ContextRegionEvidence=>({kind,documentUrl:rootUrl,targetUrl:rootUrl,subjectUrl:replyUrl,label:kind==='DISCUSSION_REGION'?'Replies':'Suggested posts',pointer:'/dom/region'});
describe('DATA-QUALITY-02 — SYNTHETIC offline contracts',()=>{
 test('clean header timestamp/badge, preserving original and authored dates/words elsewhere',()=>{
   const r={...raw('Nội dung thật\nTác giả\n06/10/2026'),bodyText:'06/10/2026\n·\nTác giả\nNội dung thật\nTác giả\n06/10/2026',createdAt:'2026-10-06T05:00:00Z',provenance:{text:'DOM',createdAt:'DOM time'}};
   // An authored date/label also present in original text is ambiguous: never delete it by regex.
   expect(cleanSourceProjection(r).text).toContain('06/10/2026');
   const clean={...raw('Nội dung thật'),bodyText:'06/10/2026\n·\nTác giả\nNội dung thật',createdAt:r.createdAt,provenance:r.provenance},before=JSON.stringify(clean);
   expect(cleanSourceProjection(clean).text).toBe('Nội dung thật');expect(JSON.stringify(clean)).toBe(before);
   expect(cleanSourceProjection({...raw('Tác giả\n06/10/2026\nLời tựa'),createdAt:r.createdAt,provenance:r.provenance}).text).toBe('Tác giả\n06/10/2026\nLời tựa');
   expect(()=>cleanSourceProjection({...raw(),createdAt:'bad',provenance:r.provenance})).not.toThrow();
 });
 test('same author, DOM order, topic and date never establish parent or conversation scope',()=>{
   expect(classifyContext(raw(),rootUrl).classification).toBe('UNKNOWN');
   expect(classifyContext({...raw(),contextEvidence:[{...region('DISCUSSION_REGION'),documentUrl:rootUrl.replace('ROOT','OTHER')}]},rootUrl).classification).toBe('UNKNOWN');
 });
 test('explicit region distinguishes observed discussion from recommended, without parent promotion',()=>{
   expect(classifyContext({...raw(),contextEvidence:[region('DISCUSSION_REGION')]},rootUrl).classification).toBe('OBSERVED_RELATIONSHIP_UNVERIFIED');
   expect(classifyContext({...raw(),contextEvidence:[region('RECOMMENDATION_REGION')]},rootUrl).classification).toBe('RELATED_OR_RECOMMENDED');
   expect(classifyContext({...raw(),contextEvidence:[region('DISCUSSION_REGION')]},rootUrl).parentId).toBeNull();
 });
 test('standalone series warning is explicit heuristic, not a claim of wrong parent',()=>{
   const r=classifyContext(raw('TEST DATA (PHẦN CUỐI)\nSau 2 phần nói về chủ đề trước, đây là phần tiếp theo.'),rootUrl);
   expect(r.classification).toBe('RELATED_OR_RECOMMENDED');expect(r.basis).toBe('CONTENT_RISK_HEURISTIC');expect(r.manualDraftAllowed).toBe(true);
   expect(classifyContext(raw('Không đồng ý vì yêu cầu công việc khác nhau.'),rootUrl).classification).toBe('UNKNOWN');
 });
 test('request decisions separate admitted/blocked events, including over-budget and private URLs',()=>{
   const t=newRequestTelemetry(),limits={events:150,navigation:4,blockHeavy:true};
   for(let i=0;i<100;i++)decidePublicRequest(t,'https://www.threads.com/a','image',1,limits);
   for(let i=0;i<70;i++)decidePublicRequest(t,'https://www.threads.com/a','script',1,limits);
   expect(t).toMatchObject({interceptionEvents:170,admittedRequests:50,blockedRequests:120});
   const u=newRequestTelemetry();expect(decidePublicRequest(u,'https://127.0.0.1/a','script',1,limits)).toBe(false);
 });
 test('alternative DOM header permalink evidence validates nested chains; a body/profile link cannot',()=>{
   const root:ThreadCollection['root']={id:'ROOT',url:rootUrl,author:{handle:'test',name:null},originalText:'TEST DATA root',publishedAt:null,engagement:{likes:null,replies:null,reposts:null,shares:null},provenance:{documentUrl:rootUrl,observedAt:'2026-11-11T00:00:00Z',method:'SYNTHETIC',synthetic:true}};
   const link=(subject=replyUrl,parent=rootUrl)=>({subjectUrl:subject,parentUrl:parent,documentUrl:rootUrl,authorUrl:'https://www.threads.com/@reply',bodyText:'TEST DATA Nội dung trả lời.',pointer:'/dom/header/a',label:'Replying to',subjectTimePermalink:subject,headerScoped:true});
   const doc={url:rootUrl,observedAt:root.provenance.observedAt,synthetic:true,visibleUrls:[replyUrl,replyUrl.replace('R01','R02')],jsonLd:[]};
   const c=collectEvidence(root,{...doc,domReplies:[link(replyUrl.replace('R01','R02'),replyUrl),link()]});
   expect(c.replies).toHaveLength(2);expect(c.replies[0].evidence.kind).toBe('DOM_EXPLICIT_REPLY_TARGET');
   expect(selectedReplies(c,['R01','R02'])).toHaveLength(2);expect(verifiedLibraryReplies(c)).toHaveLength(2);
   const wrong=structuredClone(c);wrong.replies[0].evidence.documentUrl=rootUrl.replace('ROOT','OTHER');expect(verifiedLibraryReplies(wrong)).toHaveLength(0);
   expect(collectEvidence(root,{...doc,domReplies:[link(),link(replyUrl,rootUrl.replace('ROOT','OTHER'))]}).replies).toHaveLength(0);
   for(const change of [{headerScoped:false},{subjectTimePermalink:rootUrl},{parentUrl:rootUrl.replace('ROOT','WRONG')},{authorUrl:'https://www.threads.com/@other'},{parentUrl:'https://www.threads.com/@test'}])expect(collectEvidence(root,{...doc,domReplies:[{...link(),...change}]}).replies).toHaveLength(0);
 });
});

const captureFile=process.env.DATA_QUALITY02_CAPTURE||path.resolve(__dirname,'../../.studio-data/reports/browser-policy-live01/report.json');
const liveTest=existsSync(captureFile)?test:test.skip;
describe('DATA-QUALITY-02 — saved REAL LIVE replay, NO new live calls (skips when capture absent)',()=>{
 liveTest('all 37 candidates survive; unsupported relationship remains unknown; series card is not auto-scripted',()=>{
   const bytes=readFileSync(captureFile),data=JSON.parse(bytes.toString()),asOf=data.completedAt;
   expect(data.captures.reduce((n:number,c:ThreadCollection)=>n+c.unverified.length,0)).toBe(37);
   const results=data.captures.map((c:ThreadCollection)=>selectConversation(c,'SERIOUS',asOf,['công việc']));
   expect(results.reduce((n:number,r:any)=>n+r.comments.length,0)).toBe(37);
   const gn=results.find((r:any)=>r.root.author.handle==='gnrtth'),tuan=gn.comments.find((r:any)=>r.author==='tuan27020');
   expect(tuan.context.classification).toBe('RELATED_OR_RECOMMENDED');expect(tuan.selected).toBe(false);expect(gn.scriptDraft).not.toContain('PHẦN CUỐI');
   expect(results.every((r:any)=>r.verifiedReplies===0&&r.rootType==='UNKNOWN')).toBe(true);
   for(const r of results)for(const comment of r.comments)expect(comment.displayText).not.toMatch(/^\d{2}\/\d{2}\/\d{4}\n/);
   expect(createHash('sha256').update(readFileSync(captureFile)).digest('hex')).toBe(createHash('sha256').update(bytes).digest('hex'));
 });
 liveTest('explicit editorial choice preserves order and enables observed DRAFT, never approval or parent claim',()=>{
   const data=JSON.parse(readFileSync(captureFile,'utf8')),c=data.captures.find((c:ThreadCollection)=>c.root.author.handle==='gnrtth');
   const selected=c.unverified.filter((u:any)=>['myhao1103','buiminhhoang1159'].includes(u.observation?.author.handle)).map((u:any)=>u.url.split('/').pop());
   expect(selected).toHaveLength(2);selected.reverse();
   const r=selectConversation(c,'SERIOUS',data.completedAt,[],{selectedIds:selected});
   expect(r.comments.filter(x=>x.selected)).toHaveLength(2);expect(r.quotes.slice(1).map(q=>q.id)).toEqual(selected);
   expect(r.verifiedReplies).toBe(0);expect(r.productionApproved).toBe(false);expect(r.estimate.authoritative).toBe(false);expect(r.projectProposal).toBeNull();
   expect(r.scriptDraft).not.toMatch(/\d{2}\/\d{2}\/\d{4}|Tác giả/);
   const comp=selectConversation(c,'SERIOUS',data.completedAt,[],{mode:'TOPIC_COMPILATION'});expect(comp.mode).toBe('TOPIC_COMPILATION');expect(comp.reasons).toContain('TOPIC_COMPILATION_NOT_A_SINGLE_VERIFIED_THREAD');
 });
 liveTest('one permalink -> saved source cards -> explicit selection -> Script text; raw/locks/revision retained',async()=>{
   const data=JSON.parse(readFileSync(captureFile,'utf8')),c=data.captures[0],root=await fs.mkdtemp(path.join(os.tmpdir(),'dq02-studio-'));
   const service=new StudioService({} as any);Object.assign(service,{root,extract:async()=>structuredClone(c.sourceCapture)});
   try{
     let s=await service.create();s=await service.mutate(s.id,{revision:s.revision,urls:[c.root.url],scope:'WITH_CONTEXT'},true);
     expect(s.items.length).toBe(c.sourceCapture.contextCandidates.length+1);expect(s.items.filter(i=>i.selected)).toHaveLength(1);
     const item=s.items.find(i=>i.author.handle==='myhao1103')!,rawBefore=JSON.stringify(item.rawExtraction),original=item.originalText,old=s.revision;
     expect(item.spokenText).not.toMatch(/^\d{2}\//);expect(item.contextAssessment?.classification).toBe('UNKNOWN');
     s=await service.mutate(s.id,{revision:s.revision,title:s.title,items:s.items.map(i=>({...i,selected:i.id===item.id||i.selected,spokenText:i.id===item.id?'Editor corrected narration':i.spokenText}))});
     const saved=await service.load(s.id),edited=saved.items.find(i=>i.id===item.id)!;
     expect(edited.selected).toBe(true);expect(edited.spokenText).toBe('Editor corrected narration');expect(edited.manualLocks).toContain('NARRATION_TEXT');expect(edited.originalText).toBe(original);expect(JSON.stringify(edited.rawExtraction)).toBe(rawBefore);
     await expect(service.mutate(s.id,{revision:old,title:'stale'})).rejects.toThrow('Session changed');
   }finally{if(!path.resolve(root).startsWith(path.resolve(os.tmpdir())+path.sep)||!path.basename(root).startsWith('dq02-studio-'))throw Error('UNSAFE_TEST_CLEANUP');await fs.rm(root,{recursive:true,force:true})}
 },20000);
});
