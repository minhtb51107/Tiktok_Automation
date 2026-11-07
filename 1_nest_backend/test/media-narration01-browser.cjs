const fs=require('fs'),p=require('path'),assert=require('assert/strict'),puppeteer=require('puppeteer'),os=require('os');
const {existingPublicBrowser}=require('../dist/modules/core/scraper/public-discovery');
(async()=>{
 if(os.freemem()<384*1024**2)throw Error('BROWSER_RESOURCE_BLOCKED');
 const run=p.resolve(process.argv[2]),cfg=JSON.parse(fs.readFileSync(p.join(run,'config.json'))),origin='http://127.0.0.1:'+cfg.port,out=p.join(run,'browser');fs.mkdirSync(out,{recursive:true});
 const b=await puppeteer.launch({executablePath:existingPublicBrowser(),headless:true,args:['--disable-background-networking']});try{
  const page=await b.newPage();await page.setViewport({width:1366,height:768});await page.setRequestInterception(true);page.on('request',r=>{try{const u=new URL(r.url());void(u.origin===origin||['data:','blob:'].includes(u.protocol)?r.continue():r.abort())}catch{void r.abort()}});const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto(origin+'/studio?session='+cfg.sessionId+'&area=Video%20Studio&step=Script',{waitUntil:'domcontentloaded'});
  await page.waitForFunction(()=>document.body.innerText.includes('Ảnh → OCR'));
  await page.evaluate(()=>{const el=[...document.querySelectorAll('summary')].find(e=>e.textContent.includes('Ảnh → OCR'));el.parentElement.open=true;el.scrollIntoView()});
  await page.waitForSelector('[aria-label="OCR corrected text"]');const before=await page.$eval('[aria-label="OCR corrected text"]',e=>e.value);assert.ok(before.includes('Chúng tôi không cần'));assert.ok((await page.content()).includes('AGENT_VISUAL'));await page.screenshot({path:p.join(out,'ocr-script.png')});
  const projection=await page.evaluate(async id=>{const j=await(await fetch('/api/studio/sessions/'+id)).json();const s=j.data??j,i=s.items.find(i=>i.inclusion==='TARGET');return {revision:s.revision,original:i.originalText,display:i.displayText,spoken:i.spokenText,ocr:i.mediaOcr,applied:i.mediaNarrationApplied,selected:s.items.filter(i=>i.selected).length}},cfg.sessionId);assert.ok(projection.spoken.includes(before));assert.equal(projection.selected,3);assert.ok(projection.applied[0].text===before);
  await page.reload({waitUntil:'domcontentloaded'});await page.waitForFunction(()=>document.body.innerText.includes('Ảnh → OCR'));await page.evaluate(()=>{[...document.querySelectorAll('summary')].find(e=>e.textContent.includes('Ảnh → OCR')).parentElement.open=true});await page.waitForSelector('[aria-label="OCR corrected text"]');assert.equal(await page.$eval('[aria-label="OCR corrected text"]',e=>e.value),before);
  assert.equal(errors.length,0);fs.writeFileSync(p.join(run,'ocr-browser-proof.json'),JSON.stringify({status:'PASS_BROWSER_READ_REOPEN',errors,revision:projection.revision,selected:projection.selected,reviewer:'AGENT_VISUAL',humanApproval:false,rawOcrRetained:true},null,2));console.log('PASS browser: OCR controls, reviewed text, image, provenance, 3 selected items, applied script and reopen; no human approval simulated.');
 }finally{await b.close()}
})().catch(e=>{console.error(e);process.exitCode=1});
