// INTEGRATION-02 / Checkpoint 6 browser end-to-end regression.
// Target: the isolated SYNTHETIC runtime (test/synthetic-runtime.cjs) on 127.0.0.1:3100 only.
// It drives the real Studio bundle in headless Chrome against the real backend modules. The only
// substitution is the public crawler source, which is a local synthetic fixture. No network, AI, TTS,
// render or publishing action is performed.
const path = require('node:path');
const fs = require('node:fs');
const assert = require('node:assert/strict');

const backend = path.resolve(__dirname, '..');
if (!/Tiktok_Automation_integration[\\/]1_nest_backend$/.test(backend)) throw new Error('Run from the integration worktree');
process.chdir(backend);
const BASE = 'http://127.0.0.1:3100';
const ORIGIN = { Origin: BASE };
const puppeteer = require('puppeteer');
const dataDir = path.join(backend, '.studio-data');
const shots = process.env.E2E_SHOTS || path.join(dataDir, 'reports', 'integration02');
fs.mkdirSync(shots, { recursive: true });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function api(method, url, body) {
  const r = await fetch(BASE + url, {
    method, headers: { 'Content-Type': 'application/json', ...(method !== 'GET' ? ORIGIN : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const j = await r.json().catch(() => ({}));
  return { status: r.status, body: j, data: j.data ?? j };
}
const counters = () => { try { return JSON.parse(fs.readFileSync(path.join(dataDir, 'synthetic-counters.json'), 'utf8')); } catch { return { scrape: 0, extract: 0, extractedUrls: [] }; } };

const results = [];
let group = '';
let currentCheck = '';
async function check(name, fn) {
  if (process.env.E2E_ONLY_D && !/^(D|Z)-/.test(group)) return;
  const started = Date.now(); currentCheck = name;
  try { const detail = await fn(); results.push({ group, name, pass: true, detail: detail ?? null, ms: Date.now() - started }); console.log(`PASS [${group}] ${name}`); }
  catch (e) { results.push({ group, name, pass: false, error: String(e.message || e).slice(0, 600), ms: Date.now() - started }); console.log(`FAIL [${group}] ${name}\n     ${String(e.message || e).split('\n')[0]}`); }
}

(async () => {
  const browser = await puppeteer.launch({
    headless: true, executablePath: 'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
    args: ['--disable-gpu', '--disable-extensions', '--disable-background-networking', '--renderer-process-limit=1', '--autoplay-policy=no-user-gesture-required'],
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 1000 });
  const net = { posts: [], errors: [], pageErrors: [], consoleErrors: [], dialogs: [], expected: 0 };
  let expectStatuses = null;
  page.on('dialog', (d) => { net.dialogs.push(`[${currentCheck}] ${d.type()} @ ${page.url().replace(BASE, '').slice(0, 90)}`); void d.accept(); });
  page.on('pageerror', (e) => net.pageErrors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error' && !/favicon|Failed to load resource/.test(m.text())) net.consoleErrors.push(m.text()); });
  page.on('request', (r) => { if (r.method() !== 'GET' && r.url().startsWith(BASE)) net.posts.push(r.method() + ' ' + r.url().replace(BASE, '')); });
  page.on('response', (r) => {
    if (r.status() >= 400 && !r.url().endsWith('favicon.ico')) {
      if (expectStatuses?.includes(r.status())) net.expected++; else net.errors.push(r.status() + ' ' + r.request().method() + ' ' + r.url().replace(BASE, ''));
    }
  });
  const expect = async (statuses, fn) => { expectStatuses = statuses; try { return await fn(); } finally { expectStatuses = null; } };
  const settle = () => page.waitForNetworkIdle({ idleTime: 600, timeout: 8000 }).catch(() => {});
  const open = async (area, extra = '') => {
    await page.goto(`${BASE}/studio?area=${encodeURIComponent(area)}${extra}`, { waitUntil: 'domcontentloaded' });
    await settle(); await sleep(500);
  };
  const reload = async () => { await page.reload({ waitUntil: 'domcontentloaded' }); await settle(); await sleep(400); };
  const text = () => page.evaluate(() => document.body.innerText);
  const waitText = (re, timeout = 20000) => page.waitForFunction((s, f) => new RegExp(s, f).test(document.body.innerText), { timeout }, re.source, re.flags);
  const tid = (id) => `[data-testid="${id}"]`;
  const clickText = (scope, label) => page.evaluate((scope, label) => {
    const root = scope ? document.querySelector(scope) : document;
    const b = [...root.querySelectorAll('button')].find((x) => x.innerText.trim().includes(label));
    if (!b) throw new Error('button not found: ' + label); b.click(); return true;
  }, scope, label);
  const shot = (name) => page.screenshot({ path: path.join(shots, name + '.png'), fullPage: false }).catch(() => {});
  const catalog = async () => (await api('GET', '/api/studio/data')).data;
  const rowBySource = async (sid) => (await catalog()).rows.find((r) => r.sourcePostId === sid);
  const detail = async (postId) => (await api('GET', '/api/studio/data/posts/' + postId)).data;

  const state = { runs: [], ids: {} };

  // ===================================================================== A. Discovery
  group = 'A-Discovery';
  await check('page load and refresh never start a crawler (0 POST, 0 runs, 0 scrape calls)', async () => {
    await open('Discovery'); await sleep(1500); await reload(); await sleep(1500);
    const runs = (await api('GET', '/api/studio/data/crawler/runs')).data;
    assert.equal(runs.length, 0); assert.equal(counters().scrape, 0); assert.equal(net.posts.length, 0, net.posts.join(','));
    const opts = (await api('GET', '/api/studio/data/crawler/options')).data;
    assert.equal(opts.schedulerEnabled, false); assert.equal(opts.browserWorkers, 1);
    const sched = (await api('GET', '/api/studio/data/crawler/schedule')).data;
    assert.equal(sched.enabled, false); assert.equal(sched.automaticTriggerSupported, false);
  });
  await check('WORK / LIFE / FAMILY selectable; choosing a topic does not collect', async () => {
    const options = await page.$$eval(tid('crawler-topic') + ' option', (o) => o.map((x) => x.value));
    assert.deepEqual(options, ['WORK', 'LIFE', 'FAMILY']);
    for (const t of ['LIFE', 'FAMILY', 'WORK']) { await page.select(tid('crawler-topic'), t); await sleep(400); assert.equal(await page.$eval(tid('crawler-topic'), (s) => s.value), t); }
    assert.equal(net.posts.length, 0); assert.equal(counters().scrape, 0);
  });
  await check('user click starts exactly one MOCK run; double-click does not duplicate', async () => {
    await page.select(tid('crawler-topic'), 'WORK');
    await page.$eval(tid('crawler-start'), (b) => { b.click(); b.click(); });
    await waitText(/MOCK · COMPLETED/);
    await sleep(500);
    const runs = (await api('GET', '/api/studio/data/crawler/runs')).data;
    assert.equal(runs.length, 1, 'runs=' + runs.length);
    const c = counters(); assert.equal(c.scrape, 1); assert.equal(c.extract, 2);
    state.runs.push(runs[0].id);
    const posts = net.posts.filter((p) => p.includes('/crawler/runs') && !p.includes('/resume'));
    return { postsToRuns: posts.length, scrape: c.scrape, extract: c.extract };
  });
  await check('report visible with Found/matched/new counts, status and stage', async () => {
    const report = await page.$eval(tid('crawler-report'), (e) => e.innerText);
    assert.match(report, /MOCK · COMPLETED · WAITING_HUMAN_REVIEW/); assert.match(report, /Found 2 · matched 2 · new 2/);
    await shot('A-report'); return report.split('\n').slice(0, 2);
  });
  await check('Bronze → Silver → Gold stored for each crawled post (API detail)', async () => {
    const cat = await catalog(); assert.equal(cat.total, 6);
    const rows = cat.rows.filter((r) => /^SYNCRAWLWORK/.test(r.sourcePostId)); assert.equal(rows.length, 2);
    const out = [];
    for (const r of rows) {
      const d = await detail(r.id);
      assert.equal(d.bronze.provenance.synthetic, true); assert.equal(d.bronze.sourcePostId, r.sourcePostId);
      assert.ok(d.evaluation.silver && d.evaluation.silver.status); assert.ok(d.evaluation.gold && Number.isFinite(d.evaluation.gold.score));
      out.push({ id: r.sourcePostId, state: d.evaluation.state, silver: d.evaluation.silver.status, score: d.evaluation.gold.score, rev: d.evaluation.revision });
    }
    return out;
  });
  await check('Gold V2 panel shows V1→V2, version, bucket and reasons; one article per canonical permalink', async () => {
    const expected = ['SYNCRAWLWORK1', 'SYNCRAWLWORK2'];
    const rows = (await api('GET', '/api/studio/data/crawler/quality?topic=WORK')).data.rows;
    assert.equal(rows.length, 2);
    const seen = [];
    for (const row of rows) {
      await page.select(tid('quality-item'), row.id); await sleep(500);
      const art = await page.$eval(tid('gold-shadow'), (e) => ({ text: e.innerText, href: e.querySelector('a').href, json: e.querySelector('pre').textContent }));
      assert.match(art.text, /V1 [\d.]+ → V2 [\d.]+ · serious-gold-shadow-v2\.1 · (GOLD_CANDIDATE|NEEDS_REVIEW|LOW_PRIORITY|REJECTED|QUARANTINED)/);
      const id = art.href.split('/post/')[1]; seen.push(id);
      assert.equal(art.href, row.sourceUrl, 'permalink must be the canonical URL of the selected candidate');
      assert.equal(row.sourceUrl.split('/post/')[1], (await api('GET', '/api/studio/data/posts/' + row.postId)).data.post.sourcePostId, 'candidate/post identity mismatch');
      assert.ok(art.text.includes(row.bodyPreview.slice(0, 80)), 'displayed body differs from the selected candidate');
      assert.ok(art.json.includes('"reasons"') || art.json.includes('reason'), 'no reasons in breakdown');
    }
    assert.deepEqual(seen.sort(), expected);
    await shot('A-gold');
    return seen;
  });
  await check('quality report: shadow only, never automatic acceptance', async () => {
    const report = (await api('GET', `/api/studio/data/crawler/runs/${state.runs[0]}/report`)).data;
    assert.equal(report.quality.automaticAcceptance, false); assert.equal(report.quality.comparisons.length, 2);
    const metrics = (await api('GET', '/api/studio/data/crawler/quality/metrics?topic=WORK')).data;
    return { precision: metrics.precisionAt10?.status, confusion: metrics.confusion?.status };
  });
  await check('refresh keeps run and data, triggers no new collection', async () => {
    const before = counters(); await reload(); await sleep(1200);
    const runs = (await api('GET', '/api/studio/data/crawler/runs')).data;
    assert.equal(runs.length, 1); assert.equal(counters().scrape, before.scrape); assert.equal(counters().extract, before.extract);
    assert.equal((await catalog()).total, 6);
  });
  await check('injected failure → FAILED, Resume continues from checkpoint without duplicate import/fetch', async () => {
    fs.writeFileSync(path.join(dataDir, 'synthetic-fail-once'), '1');
    await page.select(tid('crawler-topic'), 'LIFE');
    await sleep(500);
    await page.$eval(tid('crawler-start'), (b) => b.click());
    await page.waitForSelector(tid('crawler-resume'), { timeout: 30000 });
    let runs = (await api('GET', '/api/studio/data/crawler/runs')).data;
    const failed = runs.find((r) => r.status === 'FAILED'); assert.ok(failed, 'no FAILED run'); assert.equal(failed.captured, 1);
    assert.equal((await catalog()).total, 7, 'first capture must be imported once');
    // re-clicking "Discover now" with the same intent returns the stored run (idempotent)
    const extractBefore = counters().extract;
    await page.$eval(tid('crawler-start'), (b) => b.click()); await sleep(2500);
    assert.equal((await api('GET', '/api/studio/data/crawler/runs')).data.length, 2);
    assert.equal(counters().extract, extractBefore, 'idempotent re-click must not fetch');
    await page.$eval(tid('crawler-resume'), (b) => b.click());
    await waitText(/MOCK · COMPLETED/, 30000); await sleep(800);
    runs = (await api('GET', '/api/studio/data/crawler/runs')).data;
    assert.equal(runs.length, 2); assert.ok(runs.every((r) => r.status === 'COMPLETED'));
    assert.equal((await catalog()).total, 8);
    const urls = counters().extractedUrls;
    assert.equal(urls.filter((u) => /SYNCRAWLLIFE1$/.test(u)).length, 1, 'LIFE1 fetched once');
    assert.equal(urls.filter((u) => /SYNCRAWLLIFE2$/.test(u)).length, 2, 'LIFE2 fetched once failed + once resumed');
    state.runs.push(failed.id);
    return { catalogTotal: 8, lifeFetches: urls.filter((u) => /SYNCRAWLLIFE/.test(u)).length };
  });
  await check('Official API Collector (DATA-02) and DATA-02C stay separate sources', async () => {
    const crawlerRuns = (await api('GET', '/api/studio/data/crawler/runs')).data;
    assert.ok(crawlerRuns.every((r) => r.input && r.input.mode));
    const t = await text();
    assert.match(t, /Public crawler, separate from Official API/);
    assert.match(t, /DATA-02C · ON DEMAND/);
    const official = await api('GET', '/api/studio/threads/status').catch(() => null);
    return { crawlerRoute: '/api/studio/data/crawler', officialRouteProbe: official && official.status };
  });

  console.log('--- groups A done: ' + results.filter((r) => r.pass).length + ' pass / ' + results.filter((r) => !r.pass).length + ' fail');

  // ===================================================================== helpers for B/C/D
  const { StudioService } = require('../dist/studio/studio.service');
  const svc = new StudioService({});
  const sourceUrl = (handle, id) => `https://www.threads.com/@${handle}/post/${id}`;
  async function linkedSession() {
    let s = await svc.create();
    s = await svc.mutate(s.id, { revision: s.revision, manual: { text: 'SYNTHETIC linked scene for identity regression.', author: 'SYNTHETIC LINKED', comments: '' } });
    const x = await svc.load(s.id);
    x.items[0].sourceUrl = sourceUrl('synthetic_author_a', 'SYNSAME00001');
    x.items[0].sourceReference = { entityType: 'POST', entityId: 'SYNSAME00001' };
    await svc.persist(x);
    return x.id;
  }
  const cards = () => page.$$eval('[data-post-id]', (n) => n.map((c) => ({ id: c.dataset.postId, text: c.innerText })));
  const selectCard = async (postId) => { await page.$eval(`[data-post-id="${postId}"]`, (c) => c.click()); await sleep(400); };
  const inspector = () => page.$eval(tid('data-review-inspector'), (e) => e.innerText);
  const confirmModal = async () => { await page.waitForSelector(tid('review-confirm-modal')); return page.$eval(tid('review-confirm-modal'), (e) => e.innerText); };
  const submitModal = async () => { await page.$eval(tid('confirm-review-submit'), (b) => b.click()); };
  const modalGone = () => page.waitForSelector(tid('review-confirm-modal'), { hidden: true, timeout: 15000 });
  const closeModal = async () => { await clickText(tid('review-confirm-modal'), 'Quay lại'); await modalGone(); };
  const sid = async (id) => (await rowBySource(id));

  // ===================================================================== B. Data Review
  group = 'B-DataReview';
  await check('catalog posts appear with NO session open; every card is bound to its own post id', async () => {
    assert.equal((await api('GET', '/api/studio/sessions')).data.length, 0);
    await open('Data Review'); await page.waitForSelector('[data-post-id]');
    const api8 = (await catalog()).rows.map((r) => r.id).sort();
    const ui = (await cards()).map((c) => c.id).sort();
    assert.deepEqual(ui, api8); assert.equal(ui.length, 8);
    await shot('B-catalog-no-session');
    const rows = (await catalog()).rows; assert.ok(rows.every((r) => r.synthetic === true), 'API must flag synthetic rows');
    const badges = await page.$$(tid('synthetic-badge')); assert.equal(badges.length, ui.length, 'every synthetic card must be labelled');
    assert.ok(await page.$(tid('synthetic-catalog-warning')), 'catalog-level synthetic warning missing');
    return { cards: ui.length, syntheticBadges: badges.length };
  });
  await check('two posts by the same author are never confused', async () => {
    const one = await sid('SYNSAME00001'), two = await sid('SYNSAME00002');
    assert.ok(one && two && one.id !== two.id && one.author.handle === two.author.handle);
    await selectCard(two.id); await page.$eval(tid('inspector-tab-script'), (b) => b.click()); await sleep(300);
    let original = await page.$eval('.s2-readonly-original', (e) => e.textContent);
    assert.ok(original.includes('Bài thứ hai khác') && !original.includes('Bài thứ nhất'), 'inspector shows another post');
    await selectCard(one.id); await sleep(300);
    original = await page.$eval('.s2-readonly-original', (e) => e.textContent);
    assert.ok(original.includes('Bài thứ nhất') && !original.includes('Bài thứ hai'));
  });
  await check('a session scene links only by exact canonical identity (not author handle)', async () => {
    const sessionId = await linkedSession(); state.linkedSession = sessionId;
    await open('Data Review', '&session=' + sessionId); await page.waitForSelector('[data-post-id]');
    const one = await sid('SYNSAME00001'), two = await sid('SYNSAME00002');
    await selectCard(one.id); await page.$eval(tid('inspector-tab-script'), (b) => b.click()); await sleep(300);
    const enabledOne = await page.$$eval(tid('data-review-inspector') + ' textarea', (t) => t.map((x) => !x.disabled));
    await selectCard(two.id); await sleep(300);
    const enabledTwo = await page.$$eval(tid('data-review-inspector') + ' textarea', (t) => t.map((x) => !x.disabled));
    assert.ok(enabledOne.some(Boolean), 'linked post must expose the scene editor');
    assert.ok(!enabledTwo.some(Boolean), 'same-author post must NOT bind to the scene');
    return { linkedEditable: enabledOne, sameAuthorEditable: enabledTwo };
  });
  await check('UNKNOWN target: ACCEPT blocked until user confirms POST/COMMENT; never silently becomes POST', async () => {
    const unk = await sid('SYNUNKNOWN001'); const before = await detail(unk.id);
    assert.equal(before.bronze.itemType, 'UNKNOWN');
    await open('Data Review'); await page.waitForSelector('[data-post-id]'); await selectCard(unk.id);
    await page.$eval(tid('inspector-btn-accept'), (b) => b.click()); await sleep(500);
    assert.match(await text(), /Explicitly confirm POST or COMMENT first/);
    assert.equal((await page.$(tid('review-confirm-modal'))), null, 'modal must not open for unconfirmed UNKNOWN');
    assert.equal((await detail(unk.id)).evaluation.review ?? null, null, 'no review may be saved');
    await clickText(tid('data-review-inspector'), 'Bài đăng gốc (POST)'); await sleep(300);
    await page.$eval(tid('inspector-btn-accept'), (b) => b.click());
    const modal = await confirmModal(); assert.match(modal, /POST/);
    await submitModal(); await modalGone(); await sleep(600);
    const after = await detail(unk.id);
    assert.equal(after.evaluation.review.decision, 'ACCEPT'); assert.equal(after.evaluation.review.confirmedType, 'POST');
    assert.equal(after.bronze.itemType, 'UNKNOWN', 'raw observation must stay UNKNOWN');
    assert.equal(after.bronze.originalBody, before.bronze.originalBody);
    return { decision: after.evaluation.review.decision, confirmedType: after.evaluation.review.confirmedType, rawType: after.bronze.itemType };
  });
  await check('Gold V2 feedback ACCEPT is a quality label only: no DATA-01 review, no queue, saved & restored after refresh', async () => {
    const crawl = (await api('GET', '/api/studio/data/crawler/quality?topic=WORK')).data.rows[0];
    const post = crawl.postId; const before = await detail(post); const readyBefore = (await api('GET', '/api/studio/data/production/ready')).data.total;
    await open('Discovery'); await page.waitForSelector(tid('quality-item'));
    await page.select(tid('quality-item'), crawl.id); await sleep(300);
    await page.select(tid('quality-decision'), 'ACCEPT');
    await page.type(tid('quality-reason'), 'SYNTHETIC quality label');
    await page.$eval(tid('quality-save'), (b) => b.click());
    await waitText(/Quality label saved; DATA-01 review and production approval unchanged/);
    const after = await detail(post);
    assert.equal(after.evaluation.revision, before.evaluation.revision, 'DATA-01 revision must not change');
    assert.equal(after.evaluation.review ?? null, null); assert.notEqual(after.evaluation.state, 'QUEUED');
    assert.equal((await api('GET', '/api/studio/data/production/ready')).data.total, readyBefore);
    const hist = (await api('GET', '/api/studio/data/crawler/quality/' + crawl.id)).data;
    assert.equal(hist.feedback.length, 1); assert.equal(hist.feedback[0].decision, 'ACCEPT');
    await reload(); await sleep(800);
    await page.select(tid('quality-item'), crawl.id); await sleep(400);
    assert.match(await page.$eval(tid('gold-shadow'), (e) => e.innerText), /Current quality feedback: ACCEPT · revision 1/);
    state.feedbackId = crawl.id;
    return { feedbackEntries: hist.feedback.length };
  });
  await check('stale revision is rejected, shown in the modal, and the concurrent decision is preserved', async () => {
    const two = await sid('SYNSAME00002'); const d0 = await detail(two.id);
    await open('Data Review'); await page.waitForSelector('[data-post-id]'); await selectCard(two.id);
    await page.$eval(tid('inspector-btn-accept'), (b) => b.click()); await confirmModal();
    const r = await api('POST', `/api/studio/data/posts/${two.id}/review`, { revision: d0.evaluation.revision, decision: 'NEEDS_REVIEW', reason: 'SYNTHETIC concurrent decision' });
    assert.equal(r.status, 201);
    await expect([409], async () => { await submitModal(); await page.waitForSelector(tid('review-confirm-error'), { timeout: 10000 }); });
    assert.match(await page.$eval(tid('review-confirm-error'), (e) => e.innerText), /STALE_REVISION/);
    assert.equal((await detail(two.id)).evaluation.review.decision, 'NEEDS_REVIEW', 'UI must not overwrite the newer decision');
    await closeModal();
  });
  await check('API failure is shown (not swallowed) and nothing is saved', async () => {
    const two = await sid('SYNSAME00002'); const rev = (await detail(two.id)).evaluation.revision;
    await page.setRequestInterception(true);
    const handler = (req) => req.url().includes('/review') && req.method() === 'POST'
      ? req.respond({ status: 500, contentType: 'application/json', body: JSON.stringify({ success: false, error: { message: 'SYNTHETIC API failure' } }) })
      : req.continue();
    page.on('request', handler);
    try {
      await open('Data Review'); await page.waitForSelector('[data-post-id]'); await selectCard(two.id);
      await page.$eval(tid('inspector-btn-accept'), (b) => b.click()); await confirmModal();
      await expect([500], async () => { await submitModal(); await page.waitForSelector(tid('review-confirm-error'), { timeout: 10000 }); });
      assert.match(await page.$eval(tid('review-confirm-error'), (e) => e.innerText), /SYNTHETIC API failure/);
      await closeModal();
    } finally { page.off('request', handler); await page.setRequestInterception(false); }
    assert.equal((await detail(two.id)).evaluation.revision, rev, 'failed request must not change data');
  });
  await check('review history survives refresh and keeps original text', async () => {
    const unk = await sid('SYNUNKNOWN001');
    await open('Data Review'); await page.waitForSelector('[data-post-id]'); await selectCard(unk.id);
    await page.$eval(tid('inspector-tab-history'), (b) => b.click()); await sleep(500);
    const timeline = await page.$eval(tid('review-history-timeline'), (e) => e.innerText);
    assert.match(timeline, /ACCEPT|QUALIFIED/i);
    return { timelineChars: timeline.length };
  });
  console.log('--- groups A+B done: ' + results.filter((r) => r.pass).length + ' pass / ' + results.filter((r) => !r.pass).length + ' fail');

  // ===================================================================== C. DATA-03
  group = 'C-DATA03';
  const readyTotal = async () => (await api('GET', '/api/studio/data/production/ready')).data;
  const reviewVia = async (sourceId, decision) => {
    const row = await sid(sourceId);
    await open('Data Review'); await page.waitForSelector('[data-post-id]'); await selectCard(row.id);
    await page.$eval(tid('inspector-btn-' + decision), (b) => b.click()); await confirmModal();
    await submitModal(); await modalGone(); await sleep(600);
    return detail(row.id);
  };
  const enqueueVia = async (sourceId) => {
    const row = await sid(sourceId);
    await open('Data Review'); await page.waitForSelector('[data-post-id]'); await selectCard(row.id);
    await clickText(tid('data-review-inspector'), 'Đưa vào Hàng đợi Sản xuất'); await confirmModal();
    await submitModal();
  };
  await check('Ready Queue is empty: pipeline-QUALIFIED, UNKNOWN-accepted and unreviewed posts are NOT queued', async () => {
    const r = await readyTotal(); assert.equal(r.total, 0); assert.equal(r.rows.length, 0);
    await open('Production Queue'); await page.waitForSelector(tid('data03-bridge'));
    assert.equal((await page.$$(tid('production-ready-row'))).length, 0);
    assert.match(await text(), /No accepted queued content awaiting project creation/);
  });
  await check('unreviewed pipeline-QUALIFIED post is NOT shown as approved and cannot be enqueued (UI hides the action, backend refuses)', async () => {
    const one = await sid('SYNSAME00001'); assert.equal((await detail(one.id)).evaluation.review ?? null, null);
    await open('Data Review'); await page.waitForSelector('[data-post-id]'); await selectCard(one.id);
    const card = await page.$eval(`[data-post-id="${one.id}"]`, (c) => c.innerText);
    assert.match(card, /Chưa được bạn duyệt/); assert.ok(!/Sẵn sàng dựng/.test(card), 'unreviewed post shown as ready');
    assert.ok(await page.$(tid('enqueue-needs-accept')), 'explanation missing');
    assert.ok(!(await page.evaluate(() => [...document.querySelectorAll('button')].some((b) => b.innerText.includes('Đưa vào Hàng đợi Sản xuất')))), 'enqueue offered before ACCEPT');
    const r = await expect([400], () => api('POST', `/api/studio/data/posts/${one.id}/enqueue`, { revision: (one.revision) }));
    assert.equal(r.status, 400); assert.match(JSON.stringify(r.body), /ACCEPT review required before enqueue/);
    assert.equal((await readyTotal()).total, 0); assert.notEqual((await detail(one.id)).evaluation.state, 'QUEUED');
  });
  await check('explicit ACCEPT then explicit enqueue puts exactly the reviewed posts in the Ready Queue', async () => {
    const accepted = await reviewVia('SYNSAME00001', 'accept');
    assert.equal(accepted.evaluation.review.decision, 'ACCEPT');
    await open('Data Review'); await page.waitForSelector('[data-post-id]'); await selectCard((await sid('SYNSAME00001')).id); await sleep(500);
    assert.ok(await page.$(`[data-post-id="${(await sid('SYNSAME00001')).id}"] ${tid('badge-user-accepted')}`), 'accepted badge missing after ACCEPT');
    await enqueueVia('SYNSAME00001'); await modalGone(); await sleep(600);
    assert.equal((await readyTotal()).total, 1);
    await enqueueVia('SYNUNKNOWN001'); await modalGone(); await sleep(600);
    const r = await readyTotal(); assert.equal(r.total, 2);
    await open('Production Queue'); await page.waitForSelector(tid('production-ready-row'));
    const rows = await page.$$eval(tid('production-ready-row'), (n) => n.map((x) => x.innerText));
    assert.equal(rows.length, 2); assert.ok(rows.every((t) => /DRAFT_ONLY/.test(t)));
    state.queueRows = r.rows;
    await shot('C-ready-queue');
    return r.rows.map((x) => ({ author: x.author?.handle, canCreate: x.canCreateProject }));
  });
  await check('Create editable project: double-click creates one job and one project (idempotent)', async () => {
    const sessionsBefore = (await api('GET', '/api/studio/sessions')).data.length;
    const row = state.queueRows[0];
    state.queueRow = row;
    await page.$$eval(tid('create-production-project'), (b) => { b[0].click(); b[0].click(); });
    await page.waitForFunction(() => /SUCCEEDED/.test(document.body.innerText), { timeout: 40000 }).catch(() => {});
    await sleep(1500);
    const jobs = (await api('GET', '/api/studio/data/production/jobs')).data;
    const sessions = (await api('GET', '/api/studio/sessions')).data;
    assert.equal(jobs.length, 1, 'jobs=' + jobs.length); assert.equal(jobs[0].status, 'SUCCEEDED');
    assert.equal(sessions.length, sessionsBefore + 1, 'sessions=' + sessions.length);
    state.job = jobs[0];
    return { job: jobs[0].id.slice(0, 8), status: jobs[0].status, sessions: sessions.length };
  });
  await check('retry with a new requestId or repeated API call never creates a second project', async () => {
    const before = (await api('GET', '/api/studio/sessions')).data.length;
    const j = state.job; const row = state.queueRow;
    const again = await api('POST', '/api/studio/data/production/jobs', { postId: row.postId, evaluationId: row.evaluationId, queueId: row.queueId, revision: row.revision, requestId: crypto.randomUUID() });
    const after = (await api('GET', '/api/studio/sessions')).data.length;
    assert.equal(after, before, 'a duplicate project was created');
    assert.equal((await api('GET', '/api/studio/data/production/jobs')).data.length, 1);
    return { status: again.status, sameJob: (again.data && again.data.id) === j.id };
  });
  await check('productionOrigin and source reference are preserved on the project', async () => {
    const full = (await api('GET', '/api/studio/data/production/jobs/' + state.job.id)).data;
    const s = (await api('GET', '/api/studio/sessions/' + state.job.projectId)).data;
    assert.equal(s.productionOrigin.jobId, state.job.id);
    assert.equal(s.productionOrigin.postId, state.queueRow.postId);
    const row = (await catalog()).rows.find((r) => r.id === state.queueRow.postId);
    assert.ok(s.items.length >= 1);
    assert.equal(s.items[0].sourceReference.entityId, row.sourcePostId);
    assert.equal(s.items[0].sourceUrl, row.sourceUrl);
    assert.equal(s.items[0].originalText.length > 0, true);
    const origin = (await detail(row.id)).bronze.originalBody;
    assert.equal(s.items[0].originalText, origin, 'original text must equal the DATA-01 bronze body');
    state.project = s;
    return { origin: Object.keys(s.productionOrigin), entity: s.items[0].sourceReference };
  });
  await check('open Script, Voice and Editor from the project; navigation between workspaces works', async () => {
    const id = state.job.projectId; const seen = {};
    await open('Production Queue', '&session=' + id); await page.waitForSelector('[data-testid^="open-production-"]');
    for (const [step, probe] of [['Script', /Script & spoken text|02 \/ Script/i], ['Voice', /Voice Studio/i], ['Video-Editor', null]]) {
      await open('Production Queue', '&session=' + id); await page.waitForSelector(tid('open-production-' + step));
      await page.$eval(tid('open-production-' + step), (b) => b.click()); await sleep(1500);
      if (probe) { await waitText(probe, 15000); seen[step] = true; }
      else { await page.waitForSelector(tid('professional-editor'), { timeout: 20000 }); seen[step] = true; }
    }
    await shot('C-editor-from-project');
    return seen;
  });
  await check('DRAFT project is never presented as FINAL; readiness comes from the backend', async () => {
    const id = state.job.projectId;
    const r = (await api('GET', `/api/studio/sessions/${id}/readiness`)).data;
    assert.equal(r.finalAllowed, false); assert.equal(r.publishingAllowed, false); assert.equal(r.renderMode, 'DRAFT_ONLY');
    assert.ok(r.items.every((i) => i.productionApproved === false && i.voice === 'MISSING' && i.script === 'DRAFT'));
    const jr = (await api('GET', `/api/studio/data/production/jobs/${state.job.id}/readiness`)).data;
    await open('Production Queue', '&session=' + id); await page.waitForSelector(tid('production-job'));
    await clickText(tid('production-job'), 'Readiness / history'); await page.waitForSelector(tid('production-readiness'));
    const shown = JSON.parse(await page.$eval(tid('production-readiness') + ' pre', (e) => e.textContent));
    assert.deepEqual(shown, jr, 'UI readiness must equal the backend payload');
    const strip = await page.$eval(tid('production-approval-gate-strip'), (e) => e.innerText);
    assert.ok(!/\bFINAL\b/i.test(strip.replace(/(không|chưa|not)[^.\n]*FINAL/gi, '')), 'UI claims FINAL: ' + strip);
    return { renderMode: r.renderMode, backendReadinessKeys: Object.keys(jr), strip: strip.slice(0, 200) };
  });
  await check('STALE audio is not counted as ready; a valid draft is DRAFT, never approved', async () => {
    const id = state.job.projectId; let s = await svc.load(id); const it = s.items[0];
    const crypto2 = require('node:crypto'); const hash = crypto2.createHash('sha256').update(it.spokenText).digest('hex');
    const dir = path.join(dataDir, 'audio', id, 'assets'); fs.mkdirSync(dir, { recursive: true });
    const wav = (name) => { const n = 12000, b = Buffer.alloc(44 + n * 2); b.write('RIFF', 0); b.writeUInt32LE(36 + n * 2, 4); b.write('WAVEfmt ', 8); b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22); b.writeUInt32LE(24000, 24); b.writeUInt32LE(48000, 28); b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34); b.write('data', 36); b.writeUInt32LE(n * 2, 40); fs.writeFileSync(path.join(dir, name), b); return `audio/${id}/assets/${name}`; };
    it.voiceSettings = { voice: 'synthetic_voice', speed: 1 };
    const base = { itemId: it.id, itemRevision: it.revision, textHash: hash, spokenText: it.spokenText, voice: 'synthetic_voice', speed: 1, model: 'SYNTHETIC', modelVersion: 'SYNTHETIC', cacheKey: 'SYNTHETIC', durationMs: 500, createdAt: new Date().toISOString(), approvedAt: null, cacheHit: false };
    s.voiceAssets = [{ ...base, id: 'synthetic-stale', filePath: wav('stale.wav'), uri: '/x', status: 'STALE' }];
    await svc.persist(s);
    let r = (await api('GET', `/api/studio/sessions/${id}/readiness`)).data;
    assert.equal(r.items[0].voice, 'MISSING', 'STALE asset must not count'); assert.equal(r.items[0].assetId, null);
    s = await svc.load(id); s.voiceAssets.push({ ...base, id: 'synthetic-valid', filePath: wav('valid.wav'), uri: '/x', status: 'GENERATED' }); await svc.persist(s);
    r = (await api('GET', `/api/studio/sessions/${id}/readiness`)).data;
    assert.equal(r.items[0].voice, 'DRAFT'); assert.equal(r.items[0].assetId, 'synthetic-valid'); assert.equal(r.items[0].productionApproved, false);
    s = await svc.load(id); s.items[0].spokenText = s.items[0].spokenText + ' (đã sửa)'; await svc.persist(s);
    r = (await api('GET', `/api/studio/sessions/${id}/readiness`)).data;
    assert.equal(r.items[0].voice, 'MISSING', 'edited text must invalidate the audio'); assert.equal(r.items[0].script, 'DRAFT');
    const after = await svc.load(id);
    assert.ok(after.voiceAssets.every((a) => a.status === 'STALE'), 'assets must be marked STALE after a text edit');
    return { staleAfterEdit: after.voiceAssets.map((a) => a.status) };
  });
  console.log('--- groups A+B+C done: ' + results.filter((r) => r.pass).length + ' pass / ' + results.filter((r) => !r.pass).length + ' fail');

  // ===================================================================== D. Antigravity UI regression
  group = 'D-UI-regression';
  if (process.env.E2E_ONLY_D) state.job = (await api('GET', '/api/studio/data/production/jobs')).data[0]; // re-run D/Z against an existing synthetic store
  const pid = state.job.projectId;
  const setField = (label, value, kind) => page.evaluate((label, value, kind) => {
    for (const l of [...document.querySelectorAll('label')].filter((x) => x.innerText.trim().startsWith(label))) {
      const i = [...l.querySelectorAll('input,select,textarea')].find((x) => (kind === 'select' ? x.tagName === 'SELECT' : x.type === kind));
      if (!i) continue;
      const proto = i.tagName === 'SELECT' ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
      Object.getOwnPropertyDescriptor(proto, 'value').set.call(i, String(value));
      i.dispatchEvent(new Event(kind === 'select' ? 'change' : 'input', { bubbles: true })); return true;
    }
    throw new Error('field not found: ' + label);
  }, label, value, kind);
  const fieldValue = (label, kind) => page.evaluate((label, kind) => {
    for (const l of [...document.querySelectorAll('label')].filter((x) => x.innerText.trim().startsWith(label))) {
      const i = [...l.querySelectorAll('input,select')].find((x) => (kind === 'select' ? x.tagName === 'SELECT' : x.type === kind)); if (i) return i.value;
    } return null;
  }, label, kind);
  await check('Dashboard renders the open project without errors', async () => {
    await open('Dashboard', '&session=' + pid); await page.waitForSelector(tid('active-session'));
    const t = await text(); assert.match(t, /Tổng quan Studio/); assert.match(t, /Nguồn bài Threads/); assert.match(t, /Mở Bàn dựng 9:16/);
    await shot('D-dashboard');
  });
  await check('navigation badge "Duyệt dữ liệu" equals the real pending-review count', async () => {
    const counts = (await catalog()).counts;
    const pending = Object.entries(counts).filter(([k]) => !['QUALIFIED', 'QUEUED', 'REJECTED', 'QUARANTINED'].includes(k)).reduce((n, [, v]) => n + v, 0);
    await open('Data Review', '&session=' + pid); await page.waitForSelector('[data-post-id]');
    const nav = await page.evaluate(() => [...document.querySelectorAll('button')].find((b) => b.innerText.startsWith('Duyệt dữ liệu'))?.innerText);
    assert.equal(parseInt((nav.match(/(\d+)\s*chờ/) || [])[1], 10), pending, 'nav badge: ' + nav);
    const tab = await page.evaluate(() => [...document.querySelectorAll('button')].find((b) => b.innerText.startsWith('Cần bạn duyệt'))?.innerText);
    assert.equal(parseInt((tab.match(/(\d+)/) || [])[1], 10), pending, 'tab: ' + tab);
    return { pending };
  });
  await check('Discovery with a project: Official API collector and One-Click crawler are separate sections', async () => {
    const posts0 = net.posts.length;
    await open('Discovery', '&session=' + pid + '&step=Source');
    await page.waitForSelector(tid('controlled-discovery'));
    const hasOfficial = await page.$(tid('discovery-workspace'));
    assert.ok(hasOfficial, 'Official API collector workspace missing');
    const crawlerText = await page.$eval(tid('controlled-discovery'), (e) => e.innerText);
    await page.$eval(tid('discovery-tab-keywords'), (b) => b.click()); await page.waitForSelector(tid('collector-runs-panel'));
    const officialText = await page.$$eval(tid('collector-runs-panel') + ',' + tid('threads-auth-status-card'), (n) => n.map((x) => x.innerText).join('\n'));
    assert.ok(!(await page.$(tid('collector-runs-panel') + ' ' + tid('controlled-discovery'))), 'crawler UI must not live inside the Official API run panel');
    assert.ok(!(await page.$(tid('threads-auth-status-card') + ' ' + tid('controlled-discovery'))), 'crawler UI must not live inside the Official API auth card');
    assert.match(crawlerText, /DATA-02C/); assert.ok(!/DATA-02C/.test(officialText), 'official panel must not show crawler runs');
    const officialRuns = (await api('GET', '/api/studio/threads/collector/runs')).data;
    assert.equal((Array.isArray(officialRuns) ? officialRuns : officialRuns.runs || []).length, 0, 'official collector history must not contain crawler runs');
    assert.ok((await api('GET', '/api/studio/data/crawler/runs')).data.length >= 2, 'crawler history must be intact');
    assert.ok(await page.$(tid('collector-runs-empty')), 'official collector run history must be empty (crawler runs are separate)');
    assert.ok(await page.$eval(tid('discovery-start-collector-btn'), (b) => b.disabled), 'official collector must be disabled without a token');
    await page.$eval(tid('discovery-tab-schedule'), (b) => b.click()); await page.waitForSelector(tid('discovery-schedule-panel'));
    assert.ok(await page.$eval(tid('scheduler-save-btn'), (b) => b.disabled), 'scheduler mutation must be disabled (Scheduler OFF)');
    assert.equal(net.posts.slice(posts0).filter((p) => /threads|crawler\/runs/.test(p)).length, 0, 'viewing must not POST');
    await shot('D-discovery-both');
  });
  await check('Script step shows editable spoken text for the project (no AI call)', async () => {
    const posts0 = net.posts.length;
    await open('Discovery', '&session=' + pid + '&step=Script');
    await waitText(/Script & spoken text|02 \/ Script/i);
    assert.equal((await page.$$('textarea')).length >= 2, true);
    assert.equal(net.posts.slice(posts0).filter((p) => /propose|jobs/.test(p)).length, 0);
  });
  await check('Voice step: no TTS can start (runtime not READY); disabled reasons are explained', async () => {
    const posts0 = net.posts.length;
    await open('Discovery', '&session=' + pid + '&step=Voice');
    await page.waitForSelector(tid('available-voices'));
    const gen = await page.evaluate(() => [...document.querySelectorAll('button')].filter((b) => /^(Generate|Regenerate)/.test(b.innerText.trim())).map((b) => b.disabled));
    assert.ok(gen.length > 0 && gen.every(Boolean), 'Generate must be disabled: ' + JSON.stringify(gen));
    assert.match(await text(), /Why disabled/);
    assert.equal(net.posts.slice(posts0).filter((p) => /\/voice/.test(p)).length, 0, 'no voice/TTS request');
  });
  await check('Editor: storyboard/preview plays, inspector tabs switch, no crash', async () => {
    await open('Video Studio', '&session=' + pid + '&step=Video%20Editor');
    for (const id of ['professional-editor', 'editor-frame', 'object-inspector', 'save-state']) await page.waitForSelector(tid(id));
    assert.match(await text(), /Scenes 1/);
    const frame = () => page.evaluate(() => Number((document.body.innerText.match(/Frame (\d+) \//) || [])[1]));
    const f0 = await frame(); await clickText(null, 'Play / pause'); await sleep(1500); const f1 = await frame(); await clickText(null, 'Play / pause');
    assert.ok(f1 > f0, `preview did not advance (${f0} → ${f1})`);
    for (const tab of ['Card', 'Meme', 'BG', 'Voice', 'SFX', 'BGM', 'Card']) {
      await page.evaluate((t) => [...document.querySelectorAll('button')].find((b) => b.innerText.trim() === t)?.click(), tab); await sleep(250);
      assert.ok(await page.$(tid('professional-editor')), 'editor vanished after tab ' + tab);
    }
    await shot('D-editor');
    assert.match(await page.$eval(tid('save-state'), (e) => e.innerText), /Saved locally/, 'viewing/playing/switching tabs must not make the project dirty');
    return { frames: [f0, f1] };
  });
  await check('Editor save → reload → reopen keeps edits; background/media/timeline state intact', async () => {
    const mark = (s) => { currentCheck = 'Editor save :: ' + s; };
    mark('read before'); const before = (await api('GET', `/api/studio/sessions/${pid}/editor`)).data.settings;
    mark('open editor'); await open('Video Studio', '&session=' + pid + '&step=Video%20Editor'); await page.waitForSelector(tid('object-inspector'));
    // Toggle values so the test is re-runnable against the same synthetic store.
    const pad = before.scenes[0].paddingBeforeMs === 250 ? 260 : 250, silent = before.scenes[0].silentDurationMs === 3500 ? 3600 : 3500;
    mark('edit fields'); await setField('Card scale', 1.1, 'number'); await setField('Padding before (ms)', pad, 'number'); await setField('Visual-only duration (ms)', silent, 'number');
    await setField('Card appearance', 'DARK', 'select'); await sleep(300);
    assert.ok(!(await page.$eval(tid('save-state'), (e) => /Saved locally/.test(e.innerText))), 'must be dirty after edit');
    mark('click save'); await clickText(null, 'Save project'); await page.waitForFunction(() => /Saved locally/.test(document.querySelector('[data-testid="save-state"]')?.innerText || ''), { timeout: 20000 });
    mark('verify api'); const after = (await api('GET', `/api/studio/sessions/${pid}/editor`)).data.settings;
    assert.equal(after.scenes[0].paddingBeforeMs, pad); assert.equal(after.scenes[0].silentDurationMs, silent);
    assert.deepEqual([after.backgroundId, after.backgroundTracks, after.backgroundMusic], [before.backgroundId, before.backgroundTracks, before.backgroundMusic], 'background state changed');
    assert.deepEqual(after.scenes[0].mediaAssetIds, before.scenes[0].mediaAssetIds);
    // "Saved locally" shows before the App-level dirty flag effect has re-registered beforeunload; let it settle like a real user would.
    await sleep(700); mark('reload after save'); await reload(); await page.waitForSelector(tid('object-inspector')); await sleep(600);
    assert.equal(await fieldValue('Card scale', 'number'), '1.1'); assert.equal(await fieldValue('Padding before (ms)', 'number'), String(pad));
    assert.equal(await fieldValue('Visual-only duration (ms)', 'number'), String(silent)); assert.equal(await fieldValue('Card appearance', 'select'), 'DARK');
    return { paddingBeforeMs: after.scenes[0].paddingBeforeMs, silentDurationMs: after.scenes[0].silentDurationMs };
  });
  await check('Production Queue shows the project as a DRAFT job and Settings opens', async () => {
    await open('Production Queue', '&session=' + pid); await page.waitForSelector(tid('production-job'));
    assert.match(await page.$eval(tid('production-job'), (e) => e.innerText), /SUCCEEDED/);
    await open('Settings', '&session=' + pid); await page.waitForSelector(tid('settings-workspace'));
  });

  group = 'Z-global';
  await check('idle pages do not poll the backend aggressively (low-RAM laptop)', async () => {
    const out = {};
    for (const [name, area, extra] of [['editor', 'Video Studio', '&session=' + pid + '&step=Video%20Editor'], ['production-queue', 'Production Queue', '&session=' + pid], ['data-review', 'Data Review', '&session=' + pid]]) {
      await open(area, extra); await sleep(1000);
      let n = 0; const count = (r) => { if (r.method() === 'GET' && r.url().includes('/api/')) n++; }; page.on('request', count);
      await sleep(6000); page.off('request', count); out[name] = n;
      assert.ok(n <= 18, `${name} issued ${n} API GETs in 6s while idle`);
    }
    return out;
  });
  await check('only read-only voice preflight ran; no TTS, render, publish or AI job exists', async () => {
    const jobs = (await api('GET', `/api/studio/sessions/${pid}/jobs`)).data;
    const ops = [...new Set(jobs.map((j) => j.operation))];
    assert.ok(ops.every((o) => ['voice-runtime', 'editor/prepare'].includes(o)), 'unexpected job operations: ' + ops.join(','));
    const s = (await api('GET', '/api/studio/sessions/' + pid)).data;
    assert.ok(!(s.voiceAssets || []).some((a) => a.id !== 'synthetic-stale' && a.id !== 'synthetic-valid'), 'a real TTS asset exists');
    assert.equal(fs.existsSync(path.join(dataDir, 'renders')) ? fs.readdirSync(path.join(dataDir, 'renders')).length : 0, 0, 'render output exists');
    return { jobOperations: ops };
  });
  await check('no JavaScript runtime errors, no unexpected API errors, no forbidden requests', async () => {
    assert.deepEqual(net.pageErrors, [], 'page errors'); assert.deepEqual(net.consoleErrors, [], 'console errors');
    assert.deepEqual(net.errors, [], 'unexpected HTTP errors');
    assert.deepEqual(net.dialogs, [], 'unexpected browser dialogs (e.g. "unsaved changes" without edits)');
    const forbidden = net.posts.filter((p) => /\/render|\/publish|\/voice\/|\/voice-batch|voice-runtime|\/threads\/|\/script\/.*propose/.test(p));
    assert.deepEqual(forbidden, [], 'forbidden request issued');
    return { expectedErrorResponses: net.expected, postsIssued: net.posts.length };
  });
  console.log('--- all groups: ' + results.filter((r) => r.pass).length + ' pass / ' + results.filter((r) => !r.pass).length + ' fail');
  state.page = page;
  svc.onModuleDestroy?.();
  fs.writeFileSync(path.join(shots, 'report.json'), JSON.stringify({ results, net }, null, 1));
  await browser.close();
  process.exitCode = results.some((r) => !r.pass) ? 1 : 0;
})().catch((e) => { console.error('E2E CRASH', e); process.exitCode = 2; });
