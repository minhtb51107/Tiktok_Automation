// Real Chromium + actual Nest API/store. Public source is explicitly synthetic, not a LIVE test.
const fs = require('node:fs'),
  p = require('node:path'),
  os = require('node:os'),
  assert = require('node:assert/strict'),
  puppeteer = require('puppeteer');
const { fixture, url } = require('./data04-fixture.cjs'),
  {
    observePublicDocument,
  } = require('../dist/data-engine/conversation-public'),
  { collectEvidence } = require('../dist/data-engine/conversation-evidence');
const base = 'http://127.0.0.1:3102',
  backend = p.resolve(__dirname, '..');
if (!/Tiktok_Automation_data04[\\/]1_nest_backend$/.test(backend))
  throw Error('Dedicated worktree required');
const reports = p.join(backend, '.studio-data/reports/data04');
const out = p.join(reports,'browser-'+Date.now());
fs.mkdirSync(out, { recursive: true });
fs.writeFileSync(p.join(reports,'browser-latest.json'),JSON.stringify({directory:out},null,2));
const checks = [],
  ram = [];
let browser;
const sample = (stage) =>
  ram.push({
    stage,
    availableMiB: Math.round(os.freemem() / 1048576),
    processRssMiB: Math.round(process.memoryUsage().rss / 1048576),
  });
async function api(path, body) {
  const r = await fetch(base + path, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { 'Content-Type': 'application/json', Origin: base },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const j = await r.json();
  assert.ok(r.ok, 'Unexpected HTTP '+r.status+' '+path);
  return j.data ?? j;
}
async function check(name, fn) {
  try {
    await fn();
    checks.push({
      name,
      status: 'PASS',
      mode: 'SYNTHETIC_REAL_BROWSER_AND_BACKEND',
    });
    console.log('PASS ' + name);
  } catch (e) {
    checks.push({
      name,
      status: 'FAIL',
      error: String(e.message).slice(0, 250),
    });
    console.log('FAIL ' + name + ': ' + e.message);
  }
}
(async () => {
  sample('before-browser');
  const executable = [
    'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  ].find(fs.existsSync);
  assert.ok(executable, 'Installed browser required');
  browser = await puppeteer.launch({
    headless: true,
    executablePath: executable,
    args: [
      '--disable-background-networking','--disable-gpu',
      '--disable-extensions',
      '--renderer-process-limit=1',
    ],
  });
  const page = (await browser.pages())[0] || await browser.newPage();
  await page.setViewport({ width: 1440, height: 1000 });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.setRequestInterception(true);
  page.on(
    'request',
    (r) =>
      void (r.url().startsWith(base + '/') ||
      r.url() === 'about:blank' ||
      r.url().startsWith('data:')
        ? r.continue()
        : r.abort()),
  );
  await check(
    'public DOM reader verifies nested replies and excludes wrong-thread context',
    async () => {
      const f = fixture();
      await page.goto(base + '/data04-proof');
      await page.setContent(
        `<article><a href="${f.root.url}">post</a></article>` +
          f.doc.visibleUrls
            .map((url) => `<article><a href="${url}">reply</a></article>`)
            .join('') +
          `<script type="application/ld+json">${JSON.stringify(f.doc.jsonLd)}</script>`,
      );
      const observed = await page.evaluate(observePublicDocument);
      const c = collectEvidence(f.root, {
        ...f.doc,
        jsonLd: observed.jsonLd,
        visibleUrls: observed.rows.flatMap((x) => x.urls),
      });
      assert.equal(c.verifiedReplyCount, 3);
      assert.equal(c.replies[1].parentId, 'R1');
      assert.equal(c.unverifiedCandidateCount, 2);
    },
  );
  await page.goto(base + '/studio?area=Discovery', {
    waitUntil: 'domcontentloaded',
  });
  await page.waitForSelector('[data-testid="conversation-panel"]');
  await page.click('[data-testid="conversation-panel"] summary');
  await check(
    'opening Discovery performs no crawl and runtime has no credentials',
    async () => {
      const a = await api('/data04-proof');
      assert.equal(a.discover, 0);
      assert.equal(a.enrich, 0);
      assert.equal(a.credentialsPresent, false);
      assert.equal(a.outboundBlocked, 0);
    },
  );
  await check(
    'one-click discovery ranks candidates and persists exact root/replies in DATA01',
    async () => {
      await page.waitForFunction(
        () =>
          !document.querySelector('[data-testid="conversation-start"]')
            .disabled,
      );
      await page.click('[data-testid="conversation-start"]');
      await page.waitForSelector('[data-testid="conversation-result"]', {
        timeout: 20000,
      });
      assert.match(
        await page.$eval(
          '[data-testid="conversation-counts"]',
          (e) => e.textContent,
        ),
        /PARTIAL.*verified 3.*unverified 2/,
      );
      const runs = await api('/api/studio/data/conversations/runs'),
        run = runs[0];
      assert.equal(run.execution, 'SYNTHETIC');
      assert.ok(run.ranking.selected[0].endsWith('/ROOT_B'));
      assert.equal(run.ranking.status, 'SUFFICIENT');
      assert.equal((await api('/api/studio/data')).total, 1);
    },
  );
  await check(
    'reply selection, individual label, quality ACCEPT and history persist without production approval',
    async () => {
      await page.click('[data-reply-id="R2"] [data-testid="reply-selected"]');
      await page.select('[aria-label="Human quality R2"]', 'SUBSTANTIVE');
      await page.select('[data-testid="conversation-decision"]', 'ACCEPT');
      await page.type(
        '[data-testid="conversation-reason"]',
        'TEST DATA quality review only',
      );
      await page.click('[data-testid="conversation-feedback-save"]');
      await page.waitForFunction(() =>
        document.body.innerText.includes('Feedback saved.'),
      );
      const run = (await api('/api/studio/data/conversations/runs'))[0],
        id = run.results[0].collectionId,
        v = await api('/api/studio/data/conversations/collections/' + id);
      assert.deepEqual(v.review.selectedReplyIds, ['R2']);
      assert.equal(v.review.replyLabels.R2, 'SUBSTANTIVE');
      assert.equal(v.review.revision, 1);
      const detail = await api(
        '/api/studio/data/posts/' + v.record.sourceLink.postId,
      );
      assert.equal(detail.evaluation.review, null);
      assert.equal(detail.evaluation.queue, null);
      assert.equal((await api('/api/studio/data/production/jobs')).length, 0);
      const bundle = await api(
        '/api/studio/data/conversations/collections/' + id + '/bundle',
      );
      assert.equal(bundle.productionApproved, false);
      assert.equal(bundle.replyReferences[0].id, 'R2');
    },
  );
  await check(
    'refresh/reopen preserves selection and quality report',
    async () => {
      await page.reload({ waitUntil: 'domcontentloaded' });
      await page.click('[data-testid="conversation-panel"] summary');
      await page.waitForSelector('[data-reply-id="R2"]');
      assert.equal(
        await page.$eval(
          '[data-reply-id="R2"] [data-testid="reply-selected"]',
          (e) => e.checked,
        ),
        true,
      );
      assert.equal(
        await page.$eval('[aria-label="Human quality R2"]', (e) => e.value),
        'SUBSTANTIVE',
      );
      assert.equal((await api('/data04-proof')).enrich, 1);
    },
  );
  await check(
    'Copy Report uses persisted results and JSON export is valid',
    async () => {
      await browser
        .defaultBrowserContext()
        .overridePermissions(base, [
          'clipboard-read',
          'clipboard-write',
          'clipboard-sanitized-write',
        ]);
      await page.bringToFront();
      await page.click('[data-testid="conversation-copy-report"]');
      await page.waitForFunction(() =>
        document.body.innerText.includes('Persisted report copied'),
      );
      const md = await page.evaluate(() => navigator.clipboard.readText());
      assert.match(md, /VERIFIED_OBSERVED_SAMPLE/);
      assert.match(md, /SYNTHETIC/);
      assert.match(md, /R2/);
      const cdp = await page.createCDPSession();
      await cdp.send('Browser.setDownloadBehavior', {
        behavior: 'allow',
        downloadPath: out,
      });
      await page.click('[data-testid="conversation-export-json"]');
      let file = p.join(out, 'conversation-report.json');
      for (let i = 0; i < 30 && !fs.existsSync(file); i++)
        await new Promise((r) => setTimeout(r, 100));
      const j = JSON.parse(fs.readFileSync(file));
      assert.equal(j.review.revision, 1);
      assert.equal(j.record.collection.verifiedReplyCount, 3);
      assert.equal(j.run.id,(await api('/api/studio/data/conversations/runs'))[0].id);
    },
  );
  await page.screenshot({ path: p.join(out, 'conversation-discovery.png') });
  sample('conversation-visible');
  await check(
    'Data Review reopens same collection without triggering enrichment',
    async () => {
      await page.goto(
        base + '/studio?area=' + encodeURIComponent('Data Review'),
        { waitUntil: 'domcontentloaded' },
      );
      await page.waitForSelector('[data-testid="conversation-panel"]');
      await page.click('[data-testid="conversation-panel"] summary');
      await page.waitForSelector('[data-reply-id="R2"]');
      assert.equal(
        await page.$eval(
          '[data-reply-id="R2"] [data-testid="reply-selected"]',
          (e) => e.checked,
        ),
        true,
      );
      assert.equal((await api('/data04-proof')).enrich, 1);
    },
  );
  await page.screenshot({ path: p.join(out, 'conversation-review.png') });
  await check('stale revision returns 409 without overwriting persisted feedback',async()=>{
    const run=(await api('/api/studio/data/conversations/runs'))[0],id=run.results[0].collectionId;
    const response=await fetch(base+'/api/studio/data/conversations/collections/'+id+'/feedback',{method:'POST',headers:{'Content-Type':'application/json',Origin:base},body:JSON.stringify({requestId:'stale-browser-check',revision:0,selectedReplyIds:[],decision:'REJECT',reason:'TEST DATA stale'})});
    assert.equal(response.status,409);assert.equal((await api('/api/studio/data/conversations/collections/'+id)).review.revision,1);
  });
  await check('same author different post: catalog selection never shows another root collection',async()=>{
    await api('/api/studio/data/conversations/runs',{requestId:'second-root-browser',urls:[url('ROOT_A')],limit:1});
    await page.reload({waitUntil:'domcontentloaded'});await page.waitForSelector('[data-testid="conversation-panel"]');await page.click('[data-testid="conversation-panel"] summary');
    const catalog=await api('/api/studio/data');assert.equal(catalog.total,2);
    for(const id of ['ROOT_A','ROOT_B']){const post=catalog.rows.find(x=>x.sourcePostId===id);await page.waitForSelector('[data-post-id="'+post.id+'"]');await page.$eval('[data-post-id="'+post.id+'"]',e=>e.click());await page.waitForFunction(expected=>document.querySelector('[data-testid="conversation-result"] a')?.href===expected,{},url(id));const shown=await page.$eval('[data-testid="conversation-result"] a',e=>e.href);assert.equal(shown,url(id));}
    assert.equal(await page.$eval('[data-reply-id="R2"] [data-testid="reply-selected"]',e=>e.checked),true);
  });
  await check(
    'no browser exception, outbound request or automated production job',
    async () => {
      assert.deepEqual(errors, []);
      assert.equal((await api('/data04-proof')).outboundBlocked, 0);
      assert.equal((await api('/api/studio/data/production/jobs')).length, 0);
    },
  );
  await browser.close();
  browser = null;
  sample('after-browser');
  fs.writeFileSync(
    p.join(out, 'browser-report.json'),
    JSON.stringify(
      { checks, ram, live: 'NOT_RUN', mode: 'ISOLATED_SYNTHETIC' },
      null,
      2,
    ),
  );
  console.log(
    JSON.stringify({
      passed: checks.filter((x) => x.status === 'PASS').length,
      failed: checks.filter((x) => x.status === 'FAIL').length,
      ram,
    }),
  );
  if (checks.some((x) => x.status === 'FAIL')) process.exitCode = 1;
})().catch(async (e) => {
  console.error('DATA04_BROWSER_FAILED', String(e.message).slice(0, 300));
  fs.writeFileSync(
    p.join(out, 'browser-failure.json'),
    JSON.stringify({ error: String(e.message), checks, ram }, null, 2),
  );
  if (browser) await browser.close();
  process.exitCode = 1;
});
