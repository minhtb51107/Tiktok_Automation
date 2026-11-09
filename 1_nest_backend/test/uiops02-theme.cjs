// Bounded, read-only REAL_DATA_COPY visual regression. No response mocks or LIVE requests.
const fs=require('node:fs'),p=require('node:path'),os=require('node:os'),assert=require('node:assert/strict'),puppeteer=require('puppeteer');
const {run}=JSON.parse(fs.readFileSync(p.resolve(__dirname,'../.studio-data/reports/uiops02/latest.json'))),out=p.join(run,'final-captures');
function luminance(s){const [r,g,b]=s.match(/[\d.]+/g).slice(0,3).map(Number).map(x=>{x/=255;return x<=.04045?x/12.92:((x+.055)/1.055)**2.4});return r*.2126+g*.7152+b*.0722}
(async()=>{
 if(os.freemem()<384*1024**2)throw Error('NOT_RUN_RESOURCE_BLOCKED');
 const browser=await puppeteer.connect({browserURL:'http://127.0.0.1:9222'}),context=await browser.createBrowserContext();let timer;
 try{
  const page=await context.newPage();await page.bringToFront();await (await page.createCDPSession()).send('Emulation.setFocusEmulationEnabled',{enabled:true});
  await page.setRequestInterception(true);page.on('request',r=>{const u=new URL(r.url());if(['http:','https:'].includes(u.protocol)&&u.origin!=='http://127.0.0.1:3105')return void r.abort();void r.continue()});
  timer=setInterval(()=>{if(os.freemem()<128*1024**2)void context.close().catch(()=>{})},1000);
  fs.mkdirSync(out,{recursive:true});await page.goto('http://127.0.0.1:3105/studio?area=Data%20Review',{waitUntil:'domcontentloaded'});
  await page.waitForFunction(()=>document.querySelectorAll('[data-library-record]').length===8,{polling:100,timeout:15000});
  await page.$eval('[data-library-group="ROOT"]',e=>e.click());await page.waitForFunction(()=>document.querySelectorAll('[data-library-record]').length===1,{polling:100,timeout:15000});
  await page.$eval('[data-library-record]',e=>e.click());await page.waitForSelector('[data-testid="catalog-original"]',{timeout:15000});const checks=[];
  for(const width of [1366,1920]){await page.setViewport({width,height:width===1366?768:1080});for(const theme of ['DARK','LIGHT']){
   if(await page.evaluate(()=>document.documentElement.dataset.studioTheme)!==theme)await page.$eval('[data-testid="global-theme"]',e=>e.click());
   // Existing Antigravity color transitions take 180 ms; inspect settled contrast.
   await new Promise(resolve=>setTimeout(resolve,250));
   const values=await page.evaluate(()=>['.v3-brand-text strong','.v2-area-btn:not(.active) .v3-nav-item-left','.v3-new-project-card strong','.uiops-source-card.selected p'].map(selector=>{
    const e=document.querySelector(selector);let a=e,background;while(a){background=getComputedStyle(a).backgroundColor;if(background!=='rgba(0, 0, 0, 0)'&&background!=='transparent')break;a=a.parentElement}return {selector,color:getComputedStyle(e).color,background};
   }));
   for(const v of values){const a=luminance(v.color),b=luminance(v.background),ratio=(Math.max(a,b)+.05)/(Math.min(a,b)+.05);assert.ok(ratio>=4.5,JSON.stringify({...v,ratio,theme}));checks.push({width,theme,selector:v.selector,ratio})}
   await page.screenshot({path:p.join(out,'library-'+width+'-'+theme.toLowerCase()+'.png')});
  }}
  fs.writeFileSync(p.join(out,'theme-contrast.json'),JSON.stringify({status:'PASS',checks},null,2));console.log('PASS 16 loaded-library/sidebar contrast checks, two themes and viewports');
 }finally{clearInterval(timer);await context.close().catch(()=>{});browser.disconnect()}
})().catch(e=>{console.error(e.message);process.exitCode=1});
