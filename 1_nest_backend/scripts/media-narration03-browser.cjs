// One installed browser after render completion. No TTS/render submission.
const fs=require('fs'),p=require('path'),assert=require('assert/strict'),{createHash}=require('crypto'),puppeteer=require('puppeteer');
const base=p.resolve(__dirname,'../../../Tiktok_Automation_e2e01'),run=p.join(base,'run-media-narration03-render01'),read=f=>JSON.parse(fs.readFileSync(f)),cfg=read(p.join(run,'config.json')),render=read(p.join(run,'report.json')),verified=read(p.join(run,'mp4-verification.json'));
assert.equal(render.status,'COMPLETED');assert.ok(!fs.existsSync(p.resolve(__dirname,'../.local-bounded-probe.lock')));
const output=p.join(run,'browser'),download=p.join(output,'downloads');fs.mkdirSync(download,{recursive:true});
const origin='http://127.0.0.1:3111',url=origin+'/studio?session='+cfg.sessionId+'&area=Video%20Studio&step=Render',endpoint='/api/studio/sessions/'+cfg.sessionId;
const sleep=ms=>new Promise(r=>setTimeout(r,ms)),sha=b=>createHash('sha256').update(b).digest('hex');
(async()=>{let browser,guard,guardStop=false;const errors=[],requests=[],result={status:'PARTIAL',url,screenshots:[]};
 try{
  assert.ok(require('os').freemem()>256*1024**2,'RESOURCE_GUARD_STOP_BEFORE_BROWSER');
  const installed=read(p.join(cfg.store,'renders',cfg.sessionId,render.jobId,'snapshot.json')).browserExecutable;assert.ok(fs.existsSync(installed));
  browser=await puppeteer.launch({executablePath:installed,headless:true,args:['--no-sandbox','--disable-dev-shm-usage','--autoplay-policy=no-user-gesture-required'],defaultViewport:{width:1366,height:900},userDataDir:p.join(output,'profile')});
  guard=setInterval(()=>{if(require('os').freemem()<256*1024**2){guardStop=true;void browser.close()}},250);
  const page=await browser.newPage();await page.setRequestInterception(true);page.on('request',req=>{if(req.url().startsWith(origin)||req.url().startsWith('data:')||req.url().startsWith('blob:')){if(!['GET','HEAD'].includes(req.method()))requests.push({method:req.method(),path:new URL(req.url()).pathname});void req.continue()}else void req.abort()});page.on('pageerror',e=>errors.push(e.message));
  await page.goto(url,{waitUntil:'domcontentloaded'});await page.waitForSelector('[data-render-job="'+render.jobId+'"]',{timeout:30000});
  await page.waitForFunction(()=>document.querySelector('[data-testid="start-render"]')?.disabled===true);
  result.renderButtonDisabled=true;
  await page.$eval('[data-render-job="'+render.jobId+'"] details',e=>e.open=true);
  await page.$eval('.render-job video',v=>v.load());await page.waitForFunction(()=>document.querySelector('.render-job video')?.readyState>=2);
  result.video=await page.$eval('.render-job video',v=>({duration:v.duration,width:v.videoWidth,height:v.videoHeight}));assert.equal(result.video.duration,37.9);assert.equal(result.video.width,720);assert.equal(result.video.height,1280);
  await page.$eval('.render-job video',v=>{v.scrollIntoView({block:'center'});v.muted=false;v.volume=1;return v.play()});
  await page.waitForFunction(()=>{const v=document.querySelector('.render-job video');return v&&v.currentTime>0.3&&!v.paused},{timeout:15000});
  result.playback=await page.$eval('.render-job video',v=>{const result={time:v.currentTime,paused:v.paused,muted:v.muted,decoded:v.getVideoPlaybackQuality().totalVideoFrames};v.pause();return result});assert.ok(result.playback.time>0.3&&!result.playback.paused&&!result.playback.muted&&result.playback.decoded>0);
  result.seeks=[];for(const time of [0.2,28.766667,28.966667,32.533333,32.733333,37.866667]){
   const state=await page.$eval('.render-job video',(v,time)=>new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('Seek timeout')),10000);v.addEventListener('seeked',()=>{clearTimeout(timer);resolve({requested:time,actual:v.currentTime,ready:v.readyState})},{once:true});v.currentTime=time}),time);assert.ok(Math.abs(state.actual-time)<1/30);result.seeks.push(state);
  }
  await page.screenshot({path:p.join(output,'render-playback.png'),fullPage:true});result.screenshots.push('render-playback.png');
  const cdp=await page.createCDPSession();await cdp.send('Page.setDownloadBehavior',{behavior:'allow',downloadPath:download});await page.click('a[href$="?download=1"]');
  const file=p.join(download,'studio-'+render.jobId+'.mp4');for(let n=0;n<100&&!fs.existsSync(file);n++)await sleep(100);assert.equal(sha(fs.readFileSync(file)),verified.sha256);result.download={status:'PASS_BROWSER_CLICK_HASH_MATCH',bytes:fs.statSync(file).size};
  await page.evaluate(()=>[...document.querySelectorAll('button')].find(b=>b.textContent==='Preview render settings').click());await page.waitForSelector('input[aria-label="Render preview frame"]');
  const seekPreview=async frame=>{await page.$eval('input[aria-label="Render preview frame"]',(e,frame)=>{Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(e,String(frame));e.dispatchEvent(new Event('input',{bubbles:true}));e.dispatchEvent(new Event('change',{bubbles:true}))},frame);await sleep(350)};
  await seekPreview(6);await page.waitForFunction(()=>[...document.querySelectorAll('[data-testid="threads-attachments"] img')].some(i=>i.complete&&i.naturalWidth===1080));
  result.image=await page.$eval('[data-testid="threads-attachments"] img',i=>{const b=i.getBoundingClientRect(),parent=i.parentElement.getBoundingClientRect();return {natural:[i.naturalWidth,i.naturalHeight],width:b.width,height:b.height,containerWidth:parent.width,containerHeight:parent.height,objectFit:getComputedStyle(i).objectFit,transform:getComputedStyle(i).transform}});
  assert.deepEqual(result.image.natural,[1080,344]);assert.equal(result.image.objectFit,'contain');assert.ok(Math.abs(result.image.width/result.image.height-1080/344)<0.03);
  assert.equal(await page.$$eval('[data-testid="subtitle"]',e=>e.length),0);
  await (await page.$('.render-preview')).screenshot({path:p.join(output,'root-player.png')});result.screenshots.push('root-player.png');
  result.previewScenes=[];for(const [frame,id]of [[6,'a3f51095-aa63-485d-94a9-bb979a3900ec'],[869,'2eceb433-f666-4885-90cc-4febddfd1471'],[982,'6fc8f52a-33c9-42b5-847e-d10b2b15108c']]){await seekPreview(frame);const actual=await page.$eval('[data-testid="threads-video-card"]',e=>e.getAttribute('data-scene-id'));assert.equal(actual,id);result.previewScenes.push({frame,id:actual})}
  // Save unchanged effective settings in this render copy only; retain item/source fields.
  result.save=await page.evaluate(async endpoint=>{const get=async url=>{const r=await fetch(url),j=await r.json();if(!r.ok)throw Error(j.message);return j.data??j};const before=await get(endpoint),editor=await get(endpoint+'/editor');let r=await fetch(endpoint+'/editor',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({revision:before.revision,settings:editor.settings})}),j=await r.json();if(!r.ok)throw Error(JSON.stringify(j));const saved=j.data??j; r=await fetch(endpoint+'/editor/prepare',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({revision:saved.revision})});j=await r.json();if(!r.ok)throw Error(JSON.stringify(j));const reopened=await get(endpoint),preview=await get(endpoint+'/editor/preview'),renders=await get(endpoint+'/render');if(JSON.stringify(before.items)!==JSON.stringify(reopened.items))throw Error('Item/source changed during save');return {beforeRevision:before.revision,afterRevision:reopened.revision,itemsUnchanged:true,totalFrames:preview.request.inputProps.timeline.totalFrames,renders:renders.renders.map(m=>({id:m.jobId,status:m.status}))}},endpoint);
  assert.equal(result.save.totalFrames,1137);assert.equal(result.save.renders.length,1);assert.equal(result.save.renders[0].status,'COMPLETED');
  await page.reload({waitUntil:'domcontentloaded'});await page.waitForSelector('[data-render-job="'+render.jobId+'"]');await page.screenshot({path:p.join(output,'render-reopened.png'),fullPage:true});result.screenshots.push('render-reopened.png');
  assert.equal(errors.length,0);assert.ok(requests.every(r=>r.path===endpoint+'/editor'||r.path===endpoint+'/editor/prepare'));
  result.status='PASS_REAL_BROWSER_PLAYBACK_SEEK_DOWNLOAD_PREVIEW_SAVE_REOPEN';
 }catch(e){result.error=e.message;result.status=guardStop?'NOT_RUN_RESOURCE_GUARD_STOP':'FAIL';process.exitCode=1}
 finally{clearInterval(guard);await browser?.close();result.pageErrors=errors;result.writeRequests=requests;result.browserClosed=true;fs.writeFileSync(p.join(run,'browser-verification.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result,null,2))}
})().catch(e=>{console.error(e.message);process.exitCode=1});
