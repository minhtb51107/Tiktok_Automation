// CPU-only SYNTHETIC microbenchmark; excludes browser/network/persistence and predicts no LIVE latency.
const fs=require('node:fs'),p=require('node:path'),os=require('node:os');
const {fixture,url}=require('./data04-fixture.cjs');
const {collectEvidence}=require('../dist/data-engine/conversation-evidence');
const {evaluateConversation}=require('../dist/data-engine/conversation-quality');
const f=fixture(),bodies=['Nhưng công ty sai vì không giải thích rõ.','Tôi từng đi làm công ty, mỗi ngày mất ba giờ đi đường.','😂😂','Mua ngay giảm giá liên hệ zalo 0901234567'];
f.doc.visibleUrls=Array.from({length:20},(_,i)=>url('BENCH_'+i));
f.doc.jsonLd=f.doc.visibleUrls.map((u,i)=>({'@type':'Comment',url:u,parentItem:f.root.url,author:{url:'https://www.threads.com/@data04_test'},text:bodies[i%bodies.length]}));
const collection=collectEvidence(f.root,f.doc),times=[],before=process.memoryUsage().rss,cpu=process.cpuUsage();
for(let i=0;i<105;i++){const start=performance.now();evaluateConversation(collection,'2026-11-05T00:00:00Z');if(i>=5)times.push(performance.now()-start);}
times.sort((a,b)=>a-b);
const used=process.cpuUsage(cpu),result={mode:'SYNTHETIC_CPU_ONLY',verifiedReplies:collection.verifiedReplyCount,iterations:100,warmup:5,medianMs:times[50],p95Ms:times[95],rssBeforeMiB:before/1048576,rssAfterMiB:process.memoryUsage().rss/1048576,availableMiB:os.freemem()/1048576,cpuUserMs:used.user/1000,cpuSystemMs:used.system/1000,excluded:['browser','network','disk persistence','live Threads']};
const out=p.resolve(__dirname,'../.studio-data/reports/data04/benchmark.json');fs.writeFileSync(out,JSON.stringify(result,null,2));console.log(JSON.stringify(result));
