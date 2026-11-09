// Audit saved image/text/trace, or clone a sandbox. No crawler, TTS or render.
const fs=require('fs'),p=require('path'),{createHash,randomUUID}=require('crypto'),{execFileSync}=require('child_process');
const backend=p.resolve(__dirname,'..'),base=p.resolve(backend,'../../Tiktok_Automation_e2e01'),run=p.resolve(process.argv[2]||''),old=p.join(base,'run-media-narration01'),phase=process.argv[3]||'audit';
if(p.dirname(run)!==base||run===old)throw Error('NEW_ISOLATED_SANDBOX_REQUIRED');
const hash=x=>createHash('sha256').update(x).digest('hex'),read=file=>JSON.parse(fs.readFileSync(file));
function distance(a,b){let row=Array.from({length:b.length+1},(_,i)=>i);for(let i=0;i<a.length;i++){const next=[i+1];for(let j=0;j<b.length;j++)next.push(Math.min(next[j]+1,row[j+1]+1,row[j]+(a[i]===b[j]?0:1)));row=next;}return row[b.length]}
const canonical=s=>s.normalize('NFC').replace(/[“”]/g,'"').replace(/[‘’]/g,"'").replace(/^"|"$/g,'').replace(/\s+/g,' ').trim();
const cfg=read(p.join(old,'config.json')),s=read(p.join(cfg.store,cfg.sessionId+'.json'));
if(phase==='init'){
 if(fs.existsSync(run))throw Error('NO_OVERWRITE');const id=randomUUID(),store=p.join(run,'backend/.studio-data');fs.mkdirSync(store,{recursive:true});
 s.derivedFrom=s.id;s.id=id;s.project.id=id;s.title='MEDIA-NARRATION-02 — reviewed image DRAFT';s.project.title=s.title;s.revision=0;delete s.project.timeline;
 for(const a of s.voiceAssets){a.filePath=a.filePath.replace(cfg.sessionId,id);a.uri=a.uri.replace(cfg.sessionId,id);}
 fs.cpSync(p.join(cfg.store,'audio',cfg.sessionId),p.join(store,'audio',id),{recursive:true});fs.cpSync(p.join(cfg.store,'conversation-media'),p.join(store,'conversation-media'),{recursive:true});fs.copyFileSync(p.join(old,'tts.local.json'),p.join(run,'tts.local.json'));
 fs.writeFileSync(p.join(store,id+'.json'),JSON.stringify(s,null,2));fs.writeFileSync(p.join(run,'config.json'),JSON.stringify({sessionId:id,store,cwd:p.join(run,'backend'),sourceSession:cfg.sessionId,sourceRoot:cfg.store,port:3110,speed:1.3},null,2));
 for(const name of ['scripts','dist','src'])fs.symlinkSync(p.join(backend,name),p.join(run,'backend',name),'junction');fs.symlinkSync(p.resolve(backend,'../2_Remotion_Video'),p.join(run,'2_Remotion_Video'),'junction');
 console.log(JSON.stringify({status:'SANDBOX_CLONED',id,selected:s.items.filter(i=>i.selected).length}));process.exit(0);
}
if(!fs.existsSync(p.join(run,'config.json')))throw Error('INIT_REQUIRED');
const originalFiles=[p.join(cfg.store,cfg.sessionId+'.json'),p.join(old,'tts-memory.json'),p.join(old,'ocr-proof.json')],before=originalFiles.map(f=>hash(fs.readFileSync(f)));
const resources=JSON.parse(execFileSync('powershell.exe',['-NoProfile','-NonInteractive','-File',p.join(__dirname,'studio-resource-audit.ps1')],{encoding:'utf8',windowsHide:true}));
const {speechProjection}=require('../dist/studio/speech-dictionary'),{normalizeSpokenNumbers}=require('../dist/studio/spoken-numbers');
const inputs=s.items.filter(i=>i.selected).sort((a,b)=>a.order-b.order).map(i=>({itemId:i.id,text:normalizeSpokenNumbers(speechProjection(i.spokenText,i.pronunciationOverrides).text).text}));
const local=read(p.join(old,'tts.local.json'));
const inspect=`import ast,json,re,sys,pathlib\nfile=pathlib.Path(sys.argv[1])/'src/kokoro_vietnamese/core.py'\nnode=next(n for n in ast.parse(file.read_text(encoding='utf8')).body if isinstance(n,ast.FunctionDef) and n.name=='split_text')\nnamespace={'re':re}\nexec(compile(ast.Module(body=[node],type_ignores=[]),str(file),'exec'),namespace)\nitems=json.load(sys.stdin)\nprint(json.dumps([{'itemId':i['itemId'],'characters':len(i['text']),'chunks':len(namespace['split_text'](i['text'])),'maxChunkCharacters':max(map(len,namespace['split_text'](i['text'])),default=0)} for i in items]))`;
const sentences=JSON.parse(execFileSync(local.STUDIO_PYTHON,['-B','-c',inspect,local.STUDIO_KOKORO_SOURCE],{input:JSON.stringify(inputs),encoding:'utf8',windowsHide:true,env:{...process.env,PYTHONIOENCODING:'utf-8',PYTHONUTF8:'1'}}));
if(sentences.some((row,n)=>row.characters!==[...inputs[n].text].length))throw Error('AUDIT_TEXT_ENCODING_MISMATCH');
const item=s.items.find(i=>i.inclusion==='TARGET'),ocr=Object.values(item.mediaOcr)[0],rawBody=ocr.rawText.slice(ocr.rawText.indexOf('"')),a=canonical(rawBody),b=canonical(ocr.correctedText),aw=a.split(' '),bw=b.split(' '),trace=read(p.join(old,'tts-memory.json'));
const comparison={reference:'AGENT_VISUAL_NOT_HUMAN_GROUND_TRUTH',engine:ocr.engine,language:ocr.language,confidence:ocr.confidence,rawBodyCharacters:a.length,referenceCharacters:b.length,characterEditRate:distance([...a],[...b])/[...b].length,wordEditRate:distance(aw,bw)/bw.length,rawOcrHash:hash(ocr.rawText),correctionHash:hash(ocr.correctedText),humanApproval:false,rawPreserved:true};
const result={at:new Date().toISOString(),resources,oldFailure:{samples:trace.length,seconds:(trace.at(-1).at-trace[0].at)/1000,firstAvailableMiB:trace[0].freeMiB,minimumAvailableMiB:Math.min(...trace.map(x=>x.freeMiB)),workerRss:'NOT_RECORDED_CANNOT_RECONSTRUCT',cause:'Smoke runner closed owned worker below 128 MiB; not proof of Windows OOM'},ocr:comparison,ttsInputs:sentences.map(x=>({...x,inputHash:hash(inputs.find(i=>i.itemId===x.itemId).text)})),sentenceSplitter:'INSTALLED_KOKORO_CORE_AST_ONLY_NO_MODEL_IMPORT',sourcePreservation:{hashes:before,unchanged:originalFiles.every((f,n)=>hash(fs.readFileSync(f))===before[n])},liveTts:'NOT_RUN',mp4:'NOT_RUN'};
const output=p.join(run,'audit-'+Date.now()+'.json');fs.writeFileSync(output,JSON.stringify(result,null,2));console.log(JSON.stringify({...result,output},null,2));
