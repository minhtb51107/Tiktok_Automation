// Real saved LIVE02 replay; synthetic edge cases explicitly labelled below.
const fs=require('fs'),p=require('path'),assert=require('assert/strict'),os=require('os');
const {sourceReport,reportMarkdown,sourceQuickMarkdown}=require('../dist/studio/stage-report');
const {cleanSourceProjection,analyzeSourceCards}=require('../dist/studio/source-quality');
const {StudioService}=require('../dist/studio/studio.service');
const root=p.resolve(__dirname,'../../../Tiktok_Automation_restore01_live02/run-20261107-01');
if(!fs.existsSync(p.join(root,'capture.json')))throw Error('LIVE02_CAPTURE_ABSENT: real replay cannot run');
(async()=>{
 const capture=JSON.parse(fs.readFileSync(p.join(root,'capture.json'))),result=JSON.parse(fs.readFileSync(p.join(root,'result.json'))),s=JSON.parse(fs.readFileSync(p.join(result.store,result.sessionId+'.json')));
 const before=JSON.stringify(s),rawBefore=JSON.stringify(capture),r=sourceReport(s),md=reportMarkdown(r),quick=sourceQuickMarkdown(r);
 assert.equal(capture.contextCandidates.length,8);assert.equal(r.sourceCards.filter(x=>x.role==='CONTEXT').length,8);assert.equal(r.counts.observed,9);assert.equal(r.counts.parentVerified,0);
 for(const card of capture.contextCandidates){assert.ok(md.includes(card.text));assert.ok(quick.includes(card.text));assert.ok(md.includes(card.url));assert.ok(quick.includes(card.url));}
 assert.ok(!quick.includes('_nc_'));assert.equal(JSON.stringify(s),before);assert.equal(JSON.stringify(capture),rawBefore);
 const q=analyzeSourceCards(capture.contextCandidates,capture.records[0].text);assert.equal(q.length,8);assert.ok(q.every(x=>x.reasons&&x.version));
 const clean=cleanSourceProjection(capture.records[0]);assert.ok(!clean.text.split('\n').includes('Tiết lộ nội dung'));assert.ok(clean.removed.includes('Tiết lộ nội dung'));
 // SYNTHETIC: duplicate and short counterargument; keep all cards.
 const example=text=>({...capture.records[0],text,bodyText:text,fields:{}});
 const edges=analyzeSourceCards([example('👍'),example('👍'),example('Không đồng ý vì học phí quá cao.')],'học phí');assert.equal(edges.length,3);assert.equal(edges[1].duplicateOf,0);assert.equal(edges[2].bucket,'RECOMMENDED');
 const temp=fs.mkdtempSync(p.join(os.tmpdir(),'sq01-')),service=new StudioService({});Object.assign(service,{root:temp});
 try{fs.writeFileSync(p.join(temp,s.id+'.json'),JSON.stringify(s));const saved=await service.mutate(s.id,{revision:s.revision,title:s.title,items:s.items.map((i,n)=>({...i,selected:n<2}))});const reopened=await service.load(s.id);assert.equal(reopened.items.filter(i=>i.selected).length,2);assert.equal(reopened.revision,s.revision+1);assert.deepEqual(reopened.items.map(i=>i.originalText),s.items.map(i=>i.originalText));}
 finally{service.onModuleDestroy();if(p.dirname(temp)!==os.tmpdir()||!p.basename(temp).startsWith('sq01-'))throw Error('Unsafe cleanup');fs.rmSync(temp,{recursive:true,force:true})}
 const out=p.join(root,'source-quality01');fs.mkdirSync(out,{recursive:true});fs.writeFileSync(p.join(out,'quick.md'),quick);fs.writeFileSync(p.join(out,'full.md'),md);fs.writeFileSync(p.join(out,'report.json'),JSON.stringify(r,null,2));console.log(JSON.stringify({status:'PASS_OFFLINE_REAL_CAPTURE_REPLAY',contextCards:8,observed:r.counts.observed,projectionRemoved:clean.removed,qualityBuckets:q.map(x=>x.bucket),artifacts:out}));
})().catch(e=>{console.error(e);process.exitCode=1});
