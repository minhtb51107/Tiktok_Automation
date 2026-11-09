// Offline cache-reference repair. Never calls the collector or downloads media.
const fs=require('node:fs'),p=require('node:path');
const base=p.resolve(__dirname,'../../../Tiktok_Automation_restore01_live02'),root=p.resolve(process.argv[2]||'');
if(p.dirname(root)!==base)throw Error('ISOLATED_RUN_REQUIRED');
const r=JSON.parse(fs.readFileSync(p.join(root,'result.json')));
const file=p.join(root,'backend/.studio-data',r.sessionId+'.json'),s=JSON.parse(fs.readFileSync(file));
if(s.items[0].sourceUrl!==r.target)throw Error('TARGET_MISMATCH');
if(!s.items[0].localSourceMedia){fs.copyFileSync(file,file+'.before-local-cache');s.items[0].localSourceMedia=r.attachments;fs.writeFileSync(file,JSON.stringify(s,null,2));}
console.log('Local media references ready; source text unchanged.');
