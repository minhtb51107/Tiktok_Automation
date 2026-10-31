const {extractPublicThreads}=require('../dist/studio/public-threads');
const fs=require('node:fs/promises');
(async()=>{const results=[];for(const url of ['https://www.threads.com/share/BmdO69W7tN/','https://www.threads.com/share/EENEe0Zev/']){
 const r=await extractPublicThreads(url);results.push(r);console.log(JSON.stringify(r));
}if(results[0].canonicalUrl){const r=await extractPublicThreads(results[0].canonicalUrl);results.push(r);console.log(JSON.stringify(r));}
await fs.mkdir('.studio-data',{recursive:true});await fs.writeFile('.studio-data/ui011-live-diagnostics.json',JSON.stringify(results,null,2));})().catch(e=>{console.error(e);process.exitCode=1;});
