// Prepare an immutable local plan only. Never imports Torch, starts TTS, or renders.
const fs=require('fs'),p=require('path'),cp=require('child_process'),assert=require('assert/strict'),{createHash}=require('crypto');
const backend=p.resolve(__dirname,'..'),base=p.resolve(backend,'../../Tiktok_Automation_e2e01');
const read=f=>JSON.parse(fs.readFileSync(f)),hash=x=>createHash('sha256').update(x).digest('hex');
const cfg=read(p.join(base,'run-media-narration02/config.json')),source=p.join(cfg.store,cfg.sessionId+'.json'),bytes=fs.readFileSync(source),s=JSON.parse(bytes);
const {speechProjection,SPEECH_DICTIONARY_VERSION}=require('../dist/studio/speech-dictionary'),{normalizeSpokenNumbers,NUMBER_READING_VERSION}=require('../dist/studio/spoken-numbers'),{ttsCacheKeys}=require('../dist/studio/kokoro-runtime'),{DRAFT_TTS_LIMITS,TTS_RESOURCE_POLICY}=require('../dist/studio/tts-resource-policy');
const items=s.items.filter(i=>i.selected).sort((a,b)=>a.order-b.order),normalizationVersion=NUMBER_READING_VERSION+' / '+SPEECH_DICTIONARY_VERSION;
const inputs=items.map(i=>{
 const speech=speechProjection(i.spokenText,i.pronunciationOverrides),normalized=normalizeSpokenNumbers(speech.text),text=normalized.text;
 assert.equal(normalized.warnings.length,0,'unresolved numeric input');
 const keys=ttsCacheKeys(text,'my_yen',1.3,s.voiceRuntime,{itemId:i.id,normalizationVersion}),folder=p.join(cfg.store,'audio',s.id,'assets'),wav=p.join(folder,keys.cacheKey+'.wav'),baseWav=p.join(folder,keys.baseKey+'-base.wav');
 const cached=fs.existsSync(wav)?{sha256:hash(fs.readFileSync(wav)),ffprobe:JSON.parse(cp.execFileSync('ffprobe',['-v','error','-show_entries','format=duration:stream=codec_name,sample_rate,channels','-of','json',wav],{encoding:'utf8',windowsHide:true}))}:null;
 const scene=s.editor.scenes.find(x=>x.itemId===i.id);assert.equal(scene.visual.subtitlesEnabled,false);assert.equal(scene.visual.imageMode,'FULL');
 return {itemId:i.id,itemRevision:i.revision,inclusion:i.inclusion,text,characters:[...text].length,inputHash:hash(text),voice:'my_yen',speed:1.3,normalizationVersion,cacheKey:keys.cacheKey,cacheExists:!!cached,baseCacheExists:fs.existsSync(baseWav),cached,sourceHashes:{original:hash(i.originalText),display:hash(i.displayText),spoken:hash(i.spokenText),locks:hash(JSON.stringify(i.manualLocks??null))},subtitleEnabled:scene.visual.subtitlesEnabled,visual:scene.visual};
});
const root=items.find(i=>i.inclusion==='TARGET'),ocr=Object.values(root.mediaOcr)[0];assert.equal(inputs.find(i=>i.itemId===root.id).characters,591);assert.equal(ocr.reviewer,'AGENT_VISUAL');assert.equal(ocr.mode,'READ_FULL');
assert.ok(inputs.filter(i=>i.inclusion!=='TARGET').every(i=>i.cacheExists),'do not expand synthesis to comments without a new plan');
assert.equal(root.mediaNarrationApplied[0].text,ocr.correctedText);assert.equal(root.mediaNarrationApplied[0].ocrRevision,ocr.revision);assert.equal(root.mediaNarrationApplied[0].imageHash,ocr.imageHash);
const mediaFolder=p.join(cfg.store,'conversation-media'),imageFiles=fs.readdirSync(mediaFolder,{recursive:true}).map(x=>p.join(mediaFolder,x)).filter(f=>fs.statSync(f).isFile()&&p.basename(f).startsWith(ocr.imageHash)&&!f.endsWith('.json'));
assert.ok(imageFiles.some(f=>hash(fs.readFileSync(f))===ocr.imageHash),'local image hash must match OCR provenance');
const resources=JSON.parse(cp.execFileSync('powershell.exe',['-NoProfile','-NonInteractive','-File',p.join(__dirname,'studio-resource-audit.ps1')],{encoding:'utf8',windowsHide:true}));
const plan={version:'media-narration03/1',createdAt:new Date().toISOString(),status:'WAITING_SEPARATE_TTS_APPROVAL',source:{sessionId:s.id,revision:s.revision,sha256:hash(bytes)},inputs,ocr:{imageHash:ocr.imageHash,rawHash:hash(ocr.rawText),correctedHash:hash(ocr.correctedText),review:ocr.review,reviewer:ocr.reviewer,humanApproved:false,confidence:ocr.confidence,warnings:ocr.warnings},resources,limits:{...DRAFT_TTS_LIMITS,emergencyPhysicalMiB:TTS_RESOURCE_POLICY.stopMiB,emergencyCommitReserveMiB:TTS_RESOURCE_POLICY.commitStopMiB,retries:0,workers:1},execution:{newSynthesisItems:[root.id],reuseExistingCommentWavs:true,modelLoads:1,splitter:'existing installed Kokoro split_text, six chunks, maximum 195 characters; no external rechunking',closeAndAwaitKokoroBeforeRender:true},render:{status:'NOT_AUTHORIZED_NOT_RUN',width:720,height:1280,fps:30,concurrency:1,subtitles:false,format:'H264/AAC MP4 DRAFT',duration:'NOT_MEASURED_UNTIL_NEW_WAV'},tts:'NOT_AUTHORIZED_NOT_RUN'};
assert.equal(hash(fs.readFileSync(source)),plan.source.sha256,'source changed during preflight');
const run=p.join(base,'run-media-narration03-plan-'+Date.now());fs.mkdirSync(run);const file=p.join(run,'plan.json');fs.writeFileSync(file,JSON.stringify(plan,null,2),{flag:'wx'});
console.log(JSON.stringify({plan:file,planHash:hash(fs.readFileSync(file)),source:plan.source,inputs:inputs.map(({text,...x})=>x),ocr:plan.ocr,resources,limits:plan.limits,tts:plan.tts,render:plan.render},null,2));
