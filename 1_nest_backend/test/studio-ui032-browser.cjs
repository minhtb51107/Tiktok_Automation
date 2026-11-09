// Browser LIVE playback of real TTS outputs from studio-ui032-live.cjs.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const puppeteer=require('puppeteer');
const resultsFile=path.resolve('.studio-data/reports/ui032/live-results.json');
const live=JSON.parse(fs.readFileSync(resultsFile,'utf8'));
const base='http://127.0.0.1:3000';
(async()=>{
 // Prepare only the smoke project's saved settings, so repeated browser runs
 // still exercise a real slider change. This does not approve or synthesize.
 const latest=(await(await fetch(`${base}/api/studio/sessions/${live.sessionId}`)).json()).data;
 const prepare=await fetch(`${base}/api/studio/sessions/${live.sessionId}/voice/${latest.items[0].id}`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({revision:latest.revision,action:'SETTINGS',voice:'my_yen',speed:1.2})});assert(prepare.ok);
 const browser=await puppeteer.launch({headless:true,executablePath:'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',args:['--disable-background-networking','--autoplay-policy=no-user-gesture-required']});
 const errors=[],playback=[];
 try{
  const page=await browser.newPage();let shownReport;page.on('response',async r=>{try{if(r.ok()&&r.url().includes('/report?stage=VOICE'))shownReport=(await r.json()).data;}catch{/* Navigation can cancel a previous report response. */}});await page.setViewport({width:1440,height:1100});page.on('pageerror',e=>errors.push(e.message));
  await page.setRequestInterception(true);page.on('request',r=>void(r.url().startsWith(base+'/')?r.continue():r.abort()));
  async function open(title){await page.goto(base+'/studio',{waitUntil:'networkidle0'});await page.waitForSelector('.sessions button');await page.evaluate(t=>[...document.querySelectorAll('.sessions button')].find(b=>b.textContent.includes(t)).click(),title);await page.waitForSelector('.content-card');await page.evaluate(()=>[...document.querySelectorAll('nav button')].find(b=>b.textContent.endsWith('Voice')).click());await page.waitForSelector('.voice-scene');}
  await open('UI-03.2 LIVE smoke');assert.equal(await page.$$eval('.voice-scene',n=>n.length),2);
  assert.equal(await page.$$eval('.voice-scene select',n=>[...n[0].options].filter(o=>o.value&&!o.disabled).length),5);
  assert.deepEqual(await page.$eval('.voice-scene input[type=range]',e=>[e.min,e.max,e.step]),['0.5','3','0.05']);
  await page.focus('.voice-scene input[type=range]');await page.keyboard.press('End');
  const saved=page.waitForResponse(r=>r.url().includes('/voice/')&&r.request().method()==='POST'&&r.ok());
  await page.evaluate(()=>[...document.querySelectorAll('.voice-scene button')].find(b=>b.textContent==='Save voice / speed').click());await saved;
  await page.waitForFunction(()=>document.querySelector('.voice-scene')?.textContent.includes('SETTINGS_CHANGED'));
  assert.equal(await page.$$eval('.voice-scene section:not(details section) audio',n=>n.length),1); // only male remains current
  const gen=page.waitForResponse(r=>r.url().includes('/voice/')&&r.ok());await page.evaluate(()=>[...document.querySelectorAll('.voice-scene button')].find(b=>b.textContent==='Generate').click());await gen;
  await page.waitForFunction(()=>!document.querySelector('nav button')?.disabled);
  await open('UI-03.2 LIVE smoke');assert.equal(await page.$eval('.voice-scene input[type=range]',e=>Number(e.value)),3);
  const batch=page.waitForResponse(r=>r.url().endsWith('/voice-batch')&&r.ok());await page.evaluate(()=>[...document.querySelectorAll('button')].find(b=>b.textContent==='Generate all selected (sequential)').click());const bj=(await (await batch).json()).data;assert(bj.voiceBatch.results.every(r=>r.outcome==='REUSED'));
  for(const a of [...live.multiVoice,...live.speeds]){
   const p=await page.evaluate(async uri=>{const a=document.createElement('audio');a.src=uri;a.preload='auto';document.body.append(a);try{await a.play();const start=a.currentTime;await new Promise(r=>setTimeout(r,650));const result={duration:a.duration,advanced:a.currentTime>start,readyState:a.readyState,error:a.error?.code??null};a.pause();return result;}finally{a.remove();}},a.uri);
   assert(p.advanced&&p.readyState>=2&&!p.error,JSON.stringify(p));playback.push({voice:a.voice??'my_yen',speed:a.speed??1,...p});
  }
  const cdp=await page.createCDPSession();await cdp.send('Browser.grantPermissions',{origin:base,permissions:['clipboardReadWrite','clipboardSanitizedWrite']});
  await page.waitForFunction(()=>[...document.querySelectorAll('button')].some(b=>b.textContent==='Copy Report'&&!b.disabled));
  await page.evaluate(()=>[...document.querySelectorAll('button')].find(b=>b.textContent==='Copy Report').click());await page.waitForFunction(()=>document.body.textContent.includes('Report copied.'));
  const clip=(await page.evaluate(()=>navigator.clipboard.readText())).replace(/\r\n/g,'\n');const data=shownReport;assert.equal(clip,data.markdown);
  await page.evaluate(()=>{const original=URL.createObjectURL;URL.createObjectURL=blob=>{window.stageBlob=blob;return original(blob);};});await page.evaluate(()=>[...document.querySelectorAll('button')].find(b=>b.textContent==='Export JSON').click());const exported=JSON.parse(await page.evaluate(()=>window.stageBlob.text()));assert.equal(exported.stageName,'VOICE');assert.equal(exported.revision,data.report.revision);
  fs.writeFileSync(path.resolve('.studio-data/reports/ui032/voice-report.json'),JSON.stringify(data.report,null,2));fs.writeFileSync(path.resolve('.studio-data/reports/ui032/voice-report.md'),data.markdown);
  await page.screenshot({path:process.argv[2],fullPage:false});
  assert(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth),'horizontal overflow');
  await page.$eval('.voice-scene',e=>e.scrollIntoView());await page.screenshot({path:process.argv[2].replace(/\.png$/,'-scene.png'),fullPage:false});
  await open('5 exact targets');assert.equal(await page.$$eval('.voice-scene',n=>n.length),5);assert((await page.content()).includes('clm'));assert((await page.content()).includes('cmn'));
  assert.deepEqual(errors,[]);const result={PASS:true,voicesAvailable:5,speedRange:[0.5,3],savedAndReopened:3,individualGenerate:true,generateAll:'REUSED x2',copyReport:true,playback,runtimeErrors:errors};fs.writeFileSync(path.resolve('.studio-data/reports/ui032/browser-results.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result));
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
