// Actual sandbox TTS manifests and shared timeline; no new inference/render.
const fs=require('fs'),p=require('path'),assert=require('assert/strict');
const run=p.resolve(__dirname,'../../../Tiktok_Automation_e2e01/run-20261107-01'),cfg=JSON.parse(fs.readFileSync(p.join(run,'config.json'))),s=JSON.parse(fs.readFileSync(p.join(cfg.store,cfg.sessionId+'.json')));
const original=JSON.parse(fs.readFileSync(p.join(cfg.sourceRoot,cfg.sourceSession+'.json')));
const {prepareEditor}=require('../dist/studio/editor-adapter');const b=prepareEditor(s,[]),props=b.preview.request.inputProps;
assert.equal(props.timeline.scenes.length,3);assert.ok(props.timeline.totalFrames/30>=15&&props.timeline.totalFrames/30<=30);assert.equal(b.preview.missingAudioItemIds.length,0);
for(const t of props.timeline.scenes){const i=s.items.find(i=>i.id===t.scene.id),o=original.items.find(x=>x.id===i.id);assert.equal(i.originalText,o.originalText);assert.deepEqual(i.rawExtraction,o.rawExtraction);assert.deepEqual(i.manualLocks,o.manualLocks);assert.ok(!/\d+ ngày|Tiết lộ nội dung/.test(i.spokenText));assert.equal(t.subtitles.length,1);assert.equal(t.subtitles[0].startFrame,t.audioStartFrame);assert.equal(t.subtitles[0].endFrame,t.audioEndFrame);}
assert.ok(props.mediaAssets.some(a=>a.uri==='/api/studio/data/conversations/media/c03981ab1b2b131c7ff80e39a884cc531de0222a9883e01c2d5175ed0052ca13'));
const current=s.voiceAssets.filter(a=>a.status==='GENERATED');assert.equal(current.length,3);assert.ok(current.every(a=>a.purpose==='DRAFT'&&a.approvedAt===null&&a.baseCacheHit===true&&a.synthesisPerformed===false));
console.log('PASS: real audio duration, 3 scenes, local source image, caption/audio boundaries, cache, immutable source and locks.');
