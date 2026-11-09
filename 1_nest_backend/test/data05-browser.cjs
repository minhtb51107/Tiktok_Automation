// SYNTHETIC source + FFprobe-measured fixture tones. Actual UI/API/store/Remotion Player, not LIVE speech.
const fs = require('node:fs'),
  p = require('node:path'),
  os = require('node:os'),
  assert = require('node:assert/strict'),
  puppeteer = require('puppeteer');
const {
  TEST_COMMENTARY,
} = require('../dist/data-engine/editorial-test.fixture');
const base = 'http://127.0.0.1:3103',
  backend = p.resolve(__dirname, '..');
if (!/Tiktok_Automation_data05[\\/]1_nest_backend$/.test(backend))
  throw Error('Dedicated worktree required');
const reports = p.join(backend, '.studio-data/reports/data05'),
  out = p.join(reports, 'browser-' + Date.now());
fs.mkdirSync(out, { recursive: true });
fs.writeFileSync(
  p.join(reports, 'browser-latest.json'),
  JSON.stringify({ directory: out }),
);
const checks = [],
  ram = [];
let browser, projectId;
const sample = (stage) =>
  ram.push({
    stage,
    availableMiB: Math.round(os.freemem() / 1048576),
    clientRssMiB: Math.round(process.memoryUsage().rss / 1048576),
  });
async function api(path, body, method) {
  const r = await fetch(base + path, {
    method: method || (body === undefined ? 'GET' : 'POST'),
    headers: { 'Content-Type': 'application/json', Origin: base },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const j = await r.json();
  assert.ok(r.ok, 'HTTP ' + r.status + ' ' + path);
  return j.data ?? j;
}
async function check(name, fn) {
  try {
    await fn();
    checks.push({ name, status: 'PASS', mode: 'ISOLATED_SYNTHETIC' });
    console.log('PASS ' + name);
  } catch (e) {
    checks.push({
      name,
      status: 'FAIL',
      error: String(e.message).slice(0, 300),
    });
    console.log('FAIL ' + name + ': ' + String(e.message).split('\n')[0]);
  }
}
async function setValue(page, selector, value) {
  await page.$eval(
    selector,
    (e, v) => {
      const setter = Object.getOwnPropertyDescriptor(
        Object.getPrototypeOf(e),
        'value',
      ).set;
      setter.call(e, v);
      e.dispatchEvent(new Event('input', { bubbles: true }));
    },
    value,
  );
}
(async () => {
  sample('before-browser');
  const executable = [
    'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  ].find(fs.existsSync);
  assert.ok(executable, 'Existing browser required');
  browser = await puppeteer.launch({
    headless: true,
    executablePath: executable,
    args: [
      '--disable-background-networking',
      '--disable-gpu',
      '--disable-extensions',
      '--renderer-process-limit=1',
      '--autoplay-policy=no-user-gesture-required',
    ],
  });
  const page = (await browser.pages())[0] || (await browser.newPage());
  await page.setViewport({ width: 1440, height: 1000 });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.setRequestInterception(true);
  page.on(
    'request',
    (r) =>
      void (r.url().startsWith(base + '/') ||
      r.url().startsWith('data:') ||
      r.url() === 'about:blank'
        ? r.continue()
        : r.abort()),
  );
  await page.goto(base + '/studio?area=' + encodeURIComponent('Data Review'), {
    waitUntil: 'domcontentloaded',
  });
  await page.waitForSelector('[data-testid="conversation-panel"]');
  await page.click('[data-testid="conversation-panel"] summary');
  await page.waitForSelector('[data-reply-id="REPLY"]');
  await check(
    'opening review causes no plan, project, TTS or production approval',
    async () => {
      assert.equal((await api('/api/studio/data/editorial/plans')).length, 0);
      assert.equal((await api('/api/studio/data/production/jobs')).length, 0);
      const c = await api('/api/studio/data');
      assert.equal(c.total, 1);
      const d = await api('/api/studio/data/posts/' + c.rows[0].id);
      assert.equal(d.evaluation.review, null);
      assert.equal(d.evaluation.queue, null);
      assert.equal((await api('/data05-proof')).credentialsPresent, false);
    },
  );
  await check(
    'human selects verified reply and confirms editorial planning independently',
    async () => {
      await page.click(
        '[data-reply-id="REPLY"] [data-testid="reply-selected"]',
      );
      await page.type(
        '[data-testid="conversation-reason"]',
        'SYNTHETIC editorial selection, no quality ACCEPT',
      );
      await page.click('[data-testid="conversation-feedback-save"]');
      await page.waitForFunction(() =>
        document.body.innerText.includes('Feedback saved.'),
      );
      await page.click('[data-testid="editorial-selection-confirm"]');
      await page.click('[data-testid="editorial-create-plan"]');
      await page.waitForSelector('[data-testid="editorial-feasibility"]');
      assert.match(
        await page.$eval(
          '[data-testid="editorial-feasibility"]',
          (e) => e.textContent,
        ),
        /NEEDS_EDITORIAL_ENRICHMENT/,
      );
      assert.equal(
        await page.$eval(
          '[data-testid="editorial-create-project"]',
          (e) => e.disabled,
        ),
        true,
      );
    },
  );
  await check(
    'manual original hook/commentary/resolution save produces advisory READY; quote original immutable',
    async () => {
      await setValue(
        page,
        '[data-testid="editorial-narration-hook"]',
        'Điều gì tạo ra khoảng cách giữa kỳ vọng công việc và trải nghiệm của mỗi người? Hãy nhìn vào câu chuyện và góc nhìn được chia sẻ.',
      );
      await setValue(
        page,
        '[data-testid="editorial-narration-commentary"]',
        TEST_COMMENTARY,
      );
      await setValue(
        page,
        '[data-testid="editorial-narration-resolution"]',
        'Bạn sẽ đặt thêm câu hỏi nào trước khi đưa ra kết luận? Hãy giữ sự khác biệt giữa trải nghiệm cá nhân, lời khuyên và dữ kiện đã xác minh.',
      );
      await page.click('[data-testid="editorial-save"]');
      await page.waitForFunction(() =>
        document
          .querySelector('[data-testid="editorial-feasibility"]')
          ?.textContent.includes('READY_FOR_SCRIPT'),
      );
      const plan = (await api('/api/studio/data/editorial/plans'))[0];
      assert.equal(
        plan.sections.find((x) => x.id === 'root').originalText,
        plan.bundle.collection.root.originalText,
      );
      assert.equal(plan.feasibility.estimate.authoritative, false);
      assert.equal(plan.scriptStatus, 'DRAFT');
      assert.equal(
        await page.$eval(
          '[data-testid="editorial-create-project"]',
          (e) => e.disabled,
        ),
        true,
      );
    },
  );
  await page.screenshot({ path: p.join(out, 'editorial-plan.png') });
  await check('editorial save/reopen keeps manual commentary and source snapshot',async()=>{
    const plan=(await api('/api/studio/data/editorial/plans'))[0];await page.reload({waitUntil:'domcontentloaded'});await page.waitForSelector('[data-testid="conversation-panel"]');await page.click('[data-testid="conversation-panel"] summary');await page.waitForSelector('[data-testid="editorial-narration-commentary"]');assert.equal(await page.$eval('[data-testid="editorial-narration-commentary"]',e=>e.value),TEST_COMMENTARY);assert.equal((await api('/api/studio/data/editorial/plans/'+plan.id)).bundleHash,plan.bundleHash);
  });
  await check(
    'DATA01 synthetic approval/enqueue is separate; explicit Create DRAFT reuses DATA03 once',
    async () => {
      const c = await api('/api/studio/data'),
        post = c.rows[0];
      let d = await api('/api/studio/data/posts/' + post.id);
      d = await api('/api/studio/data/posts/' + post.id + '/review', {
        revision: d.evaluation.revision,
        decision: 'ACCEPT',
        confirmedType: 'POST',
        reason: 'SYNTHETIC TEST approval, no real content accepted',
      });
      await api('/api/studio/data/posts/' + post.id + '/enqueue', {
        revision: d.evaluation.revision,
      });
      await page.$eval('[data-testid="editorial-panel"]', (e) =>
        [...e.querySelectorAll('button')]
          .find((b) => b.textContent.includes('Refresh DATA-01'))
          .click(),
      );
      await page.waitForFunction(() =>
        document
          .querySelector('[data-testid="editorial-production-gates"]')
          ?.textContent.includes('READY'),
      );
      await page.click('[data-testid="editorial-confirm-project"]');
      await page.click('[data-testid="editorial-create-project"]');
      await page.waitForSelector('[data-testid="editorial-open-script"]');
      const jobs = await api('/api/studio/data/production/jobs');
      assert.equal(jobs.length, 1);
      projectId = jobs[0].projectId;
      assert.equal(jobs[0].status, 'SUCCEEDED');
      assert.equal((await api('/api/studio/data/production/ready')).total, 0);
    },
  );
  await check(
    'CTA opens real Script workspace with separate quote/commentary and NOT_MEASURED duration',
    async () => {
      await page.click('[data-testid="editorial-open-script"]');
      await page.waitForSelector('[data-testid="editorial-duration"]');
      await page.waitForFunction(() =>
        document
          .querySelector('[data-testid="editorial-duration"]')
          ?.textContent.includes('NOT_MEASURED'),
      );
      assert.equal(
        await page.$$eval(
          '[data-testid="script-editorial-role"]',
          (es) => es.length,
        ),
        5,
      );
      const s = await api('/api/studio/sessions/' + projectId);
      assert.deepEqual(s.productionOrigin.conversation.selectedReplyIds, [
        'REPLY',
      ]);
      assert.equal(s.project.comments.length, 1);
      assert.ok(s.items.every((i) => !i.spokenApproval));
      assert.equal(s.project.editorialApproval, undefined);
    },
  );
  await check(
    'measured local tone fixtures produce 81s audio / 83.5s timeline but never LIVE/FINAL approval',
    async () => {
      const injected = await api('/data05-fixture-audio/' + projectId, {});
      assert.equal(injected.fixture, true);
      assert.equal(injected.narration, false);
      assert.equal(injected.totalFrames, 2505);
      const r = await api(
        '/api/studio/data/editorial/sessions/' + projectId + '/duration',
      );
      assert.equal(r.measured.source, 'FIXTURE');
      assert.equal(r.measured.status, 'FIXTURE_CONTRACT_PASS');
      assert.equal(r.measured.narrationSeconds, 81);
      assert.equal(r.measured.timelineSeconds, 83.5);
      assert.equal(r.measured.releaseReady, false);
      const s = await api('/api/studio/sessions/' + projectId);
      assert.ok(
        s.voiceAssets.every(
          (a) =>
            a.status === 'GENERATED' &&
            a.durationEvidence === 'SYNTHETIC_FIXTURE',
        ),
      );
    },
  );
  await check(
    'Voice workspace opens and fixture playback advances without preflight or TTS',
    async () => {
      await page.goto(base+'/studio?session='+projectId+'&area=Discovery&step=Voice',{waitUntil:'domcontentloaded'});
      await page.waitForFunction(()=>document.body.innerText.includes('03 / Voice Studio'));
      await page.waitForSelector('audio');
      const evidence = await page.$eval('audio',async a => {
        await a.play();
        const start = Date.now();
        while (a.currentTime < 0.05 && Date.now() - start < 4000)
          await new Promise((r) => setTimeout(r, 100));
        const result = {
          time: a.currentTime,
          paused: a.paused,
          duration: a.duration,
          readyState: a.readyState,
          error: a.error?.code,
        };
        a.pause();
        return result;
      });
      assert.ok(evidence.time > 0, JSON.stringify(evidence));
      assert.equal(evidence.paused, false);
      assert.equal((await api('/data05-proof')).fixtureAudioInjections, 1);
    },
  );
  await check(
    'Remotion Editor seeks all five scenes and distinguishes original commentary',
    async () => {
      await page.goto(
        base +
          '/studio?session=' +
          projectId +
          '&area=' +
          encodeURIComponent('Video Studio') +
          '&step=' +
          encodeURIComponent('Video Editor'),
        { waitUntil: 'domcontentloaded' },
      );
      await page.waitForSelector('[data-testid="professional-editor"]');
      await page.waitForSelector('[data-testid="editor-frame"]');
      assert.equal(
        await page.$eval(
          '[data-testid="editor-provenance"]',
          (e) => e.textContent,
        ),
        'SYNTHETIC',
      );
      const s = await api('/api/studio/sessions/' + projectId);
      for (const item of s.items) {
        await page.$eval(
          '[data-item-id="' + item.id + '"] button.scene-select',
          (e) => e.click(),
        );
        await new Promise((r) => setTimeout(r, 120));
        const text = await page.$eval(
          '[data-testid="editor-frame"]',
          (e) => e.textContent,
        );
        const expected = s.project.timeline.scenes.find(
          (x) => x.scene.id === item.id,
        ).startFrame;
        assert.equal(Number(text.match(/Frame (\d+)/)[1]), expected);
      }
      await page.$eval('[data-item-id="commentary"] button.scene-select', (e) =>
        e.click(),
      );
      await page.waitForFunction(() =>
        document.body.innerText.includes(
          'Bình luận biên tập · không phải trích dẫn',
        ),
      );
    },
  );
  await check(
    'real PNG upload, global background assignment, Editor save/reopen preserve media and timings',
    async () => {
      function crc(b) {
        let c = 0xffffffff;
        for (const x of b) {
          c ^= x;
          for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (c & 1 ? 0xedb88320 : 0);
        }
        return (c ^ 0xffffffff) >>> 0;
      }
      function chunk(t, d) {
        const type = Buffer.from(t),
          b = Buffer.alloc(d.length + 12);
        b.writeUInt32BE(d.length);
        type.copy(b, 4);
        d.copy(b, 8);
        b.writeUInt32BE(crc(Buffer.concat([type, d])), 8 + d.length);
        return b;
      }
      const width = 320,
        height = 240,
        ihdr = Buffer.alloc(13);
      ihdr.writeUInt32BE(width);
      ihdr.writeUInt32BE(height, 4);
      ihdr[8] = 8;
      ihdr[9] = 2;
      const raw = Buffer.alloc((width * 3 + 1) * height);
      for (let y = 0; y < height; y++)
        for (let x = 0; x < width; x++) {
          const pos = y * (width * 3 + 1) + 1 + x * 3;
          raw[pos] = 20;
          raw[pos + 1] = 60;
          raw[pos + 2] = 90;
        }
      const png = Buffer.concat([
          Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
          chunk('IHDR', ihdr),
          chunk('IDAT', require('node:zlib').deflateSync(raw)),
          chunk('IEND', Buffer.alloc(0)),
        ]),
        file = p.join(out, 'SYNTHETIC_background.png');
      fs.writeFileSync(file, png);
      await page.$eval('.editor-left .panel-tabs', (e) =>
        [...e.querySelectorAll('button')]
          .find((b) => b.textContent.trim() === 'Assets')
          .click(),
      );
      const input = await page.waitForSelector(
        'input[aria-label="Upload category media"]',
      );
      await input.uploadFile(file);
      await page.waitForSelector('[data-action="assign-asset"]', {
        timeout: 20000,
      });
      await page.waitForFunction(
        () => !document.querySelector('[data-action="assign-asset"]')?.disabled,
      );
      await page.click('[data-action="assign-asset"]');
      await page.waitForFunction(
        () =>
          document.querySelector('[data-testid="save-state"]')?.textContent ===
          'Unsaved changes',
      );
      await page.$eval('.editor-toolbar', (e) =>
        [...e.querySelectorAll('button')]
          .find((b) => b.textContent.trim() === 'Save project')
          .click(),
      );
      await page.waitForFunction(
        () =>
          document.querySelector('[data-testid="save-state"]')?.textContent ===
          'Saved locally',
        { timeout: 20000 },
      );
      await page.waitForFunction(
        () =>
          document.body.innerText.includes('Saved locally · preview validated'),
        { timeout: 20000 },
      );
      const saved = await api('/api/studio/sessions/' + projectId);
      assert.equal(saved.studioMedia.length, 1);
      assert.equal(saved.studioMedia[0].category, 'BACKGROUND');
      assert.equal(saved.editor.backgroundTracks.length, 1);
      assert.equal(saved.project.timeline.totalFrames, 2505);
      const assetId = saved.studioMedia[0].id;
      await page.reload({ waitUntil: 'domcontentloaded' });
      await page.waitForSelector('[data-testid="professional-editor"]');
      assert.equal(
        (await api('/api/studio/sessions/' + projectId)).editor
          .backgroundTracks[0].assetId,
        assetId,
      );
    },
  );
  await page.screenshot({ path: p.join(out, 'editorial-preview.png') });
  sample('preview-active');
  await check(
    'save/reopen retains bundle and audio; script edit invalidates measured duration and approval',
    async () => {
      let s = await api('/api/studio/sessions/' + projectId),
        bundle = s.project.editorialPlan.bundleHash;
      const approved = await api(
        '/api/studio/data/editorial/sessions/' + projectId + '/approve-script',
        {
          revision: s.revision,
          confirmUserReview: true,
          reason: 'SYNTHETIC explicit script review only',
        },
      );
      assert.equal(approved.project.editorialApproval.status, 'APPROVED');
      s = await api(
        '/api/studio/sessions/' + projectId,
        {
          revision: approved.revision,
          title: approved.title,
          items: approved.items.map((i) => ({
            id: i.id,
            selected: i.selected,
            displayText: i.displayText,
            spokenText:
              i.spokenText +
              (i.id === 'root' ? ' Cần biên tập lời diễn giải này.' : ''),
          })),
        },
        'PUT',
      );
      assert.equal(s.project.editorialApproval.status, 'STALE');
      assert.equal(s.project.editorialPlan.bundleHash, bundle);
      assert.equal(
        s.voiceAssets.find((a) => a.itemId === 'root').status,
        'STALE',
      );
      assert.equal(
        (
          await api(
            '/api/studio/data/editorial/sessions/' + projectId + '/duration',
          )
        ).measured.status,
        'NOT_MEASURED',
      );
      assert.equal((await api('/api/studio/data/production/jobs')).length, 1);
    },
  );
  await check('voice setting changes stale only matching audio without rewriting script/source',async()=>{
    let s=await api('/api/studio/sessions/'+projectId);s=await api('/api/studio/data/editorial/sessions/'+projectId+'/approve-script',{revision:s.revision,confirmUserReview:true,reason:'SYNTHETIC script approval independent of voice settings'});
    const text=s.items.find(i=>i.id==='reply-REPLY').spokenText;const hash=s.project.editorialApproval.scriptHash;
    s=await api('/api/studio/sessions/'+projectId+'/voice/reply-REPLY',{revision:s.revision,action:'SETTINGS',voice:'my_yen',speed:1.5});assert.equal(s.voiceAssets.find(a=>a.itemId==='reply-REPLY').status,'STALE');assert.equal(s.items.find(i=>i.id==='reply-REPLY').spokenText,text);assert.equal(s.project.editorialApproval.scriptHash,hash);assert.equal(s.project.editorialApproval.status,'APPROVED');
  });
  await check(
    'restore only synthetic fixture preview after stale-contract test; approvals remain unapproved',
    async () => {
      let s = await api('/api/studio/sessions/' + projectId);s=await api('/api/studio/sessions/'+projectId+'/voice/reply-REPLY',{revision:s.revision,action:'SETTINGS',voice:'my_yen',speed:1.2});const
        plan = s.project.editorialPlan;
      await api(
        '/api/studio/sessions/' + projectId,
        {
          revision: s.revision,
          title: s.title,
          items: s.items.map((i) => ({
            id: i.id,
            selected: i.selected,
            displayText: i.displayText,
            spokenText: plan.sections.find((section) => section.id === i.id)
              .narrationText, voiceSettings:{voice:'my_yen',speed:1.2},
          })),
        },
        'PUT',
      );
      await api('/data05-fixture-audio/' + projectId, {});
      const report = await api(
        '/api/studio/data/editorial/sessions/' + projectId + '/duration',
      );
      assert.equal(report.measured.source, 'FIXTURE');
      assert.equal(report.measured.timelineSeconds, 83.5);
      assert.equal(report.scriptStatus, 'DRAFT');
    },
  );
  await check(
    'no runtime exception, outbound request, live auth, render or publishing',
    async () => {
      assert.deepEqual(errors, []);
      const proof = await api('/data05-proof');
      assert.equal(proof.outboundBlocked, 0);
      assert.equal(proof.credentialsPresent, false);
      assert.ok(
        !proof.mutations.some((x) =>
          /render|publish|tts|voice-generate|oauth/.test(x.path),
        ),
      );
    },
  );
  await browser.close();
  browser = null;
  sample('after-browser');
  fs.writeFileSync(
    p.join(out, 'report.json'),
    JSON.stringify(
      {
        checks,
        ram,
        projectId,
        verifiedRealCollection: 'NOT_RUN',
        liveTts: 'NOT_RUN',
        audioEvidence: 'FFPROBE_MEASURED_SYNTHETIC_TONES',
        realNarrationDuration: 'NOT_MEASURED',
      },
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
  console.error('DATA05_BROWSER_FAILED', String(e.message).slice(0, 200));
  fs.writeFileSync(
    p.join(out, 'failure.json'),
    JSON.stringify({ error: String(e.message), checks, ram }, null, 2),
  );
  if (browser) await browser.close();
  process.exitCode = 1;
});
