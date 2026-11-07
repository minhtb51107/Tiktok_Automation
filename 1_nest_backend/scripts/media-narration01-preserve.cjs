const fs=require('fs'),p=require('path'),{createHash}=require('crypto');
(async()=>{
 const backend=p.resolve(__dirname,'..'),production=p.resolve(backend,'../../Tiktok_Automation/1_nest_backend/.studio-data'),baseline=p.join(backend,'.studio-data/reports/uiops02/2026-11-06T11-41-24-096Z-1a8a0795-e5f3-49a3-a59f-ef6f35d82a3b/production-before.json'),rows=JSON.parse(fs.readFileSync(baseline));
 let unchanged=0,changed=0,unreadable=0;
 for(const row of rows){const file=p.resolve(production,row.file);if(!file.startsWith(production+p.sep))throw Error('BASELINE_PATH_OUTSIDE_PRODUCTION');try{const h=createHash('sha256');for await(const b of fs.createReadStream(file))h.update(b);if(h.digest('hex')===row.sha256&&fs.statSync(file).size===row.bytes)unchanged++;else changed++;}catch{unreadable++;}}
 const result={at:new Date().toISOString(),baselineHash:createHash('sha256').update(fs.readFileSync(baseline)).digest('hex'),files:rows.length,unchanged,changed,unreadable};
 const run=p.resolve(process.argv[2]||'');if(p.dirname(run)!==p.resolve(backend,'../../Tiktok_Automation_e2e01'))throw Error('ISOLATED_RUN_REQUIRED');fs.writeFileSync(p.join(run,'production-preservation.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result));if(changed||unreadable)process.exitCode=1;
})().catch(e=>{console.error(e.message);process.exitCode=1});
