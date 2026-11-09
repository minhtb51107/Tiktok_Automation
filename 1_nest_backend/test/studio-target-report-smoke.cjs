const puppeteer = require('puppeteer');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
(async () => {
  const id = 'a6e7cbe3-f086-4039-9ef3-d16a03a79b12',
    base = 'http://127.0.0.1:3000';
  const session = (
    await (await fetch(base + '/api/studio/sessions/' + id)).json()
  ).data;
  const result = (
    await (await fetch(base + '/api/studio/sessions/' + id + '/report')).json()
  ).data;
  assert.equal(session.items.length, 5);
  assert.equal(result.report.counts.resolvedTargets, 5);
  assert.equal(result.report.counts.unresolvedTargets, 0);
  for (const a of session.attempts) {
    assert.equal(a.matchMethod, 'DOM_PERMALINK');
    assert(a.canonicalUrl.includes('/post/' + a.matchedTargetId));
    assert(
      session.items.some(
        (i) =>
          i.sourceUrl === a.canonicalUrl &&
          i.originalText === a.records[0].text,
      ),
    );
  }
  await fs.mkdir('.studio-data/reports', { recursive: true });
  await fs.writeFile(
    '.studio-data/reports/ui012-source-report.json',
    JSON.stringify(result.report, null, 2),
  );
  await fs.writeFile(
    '.studio-data/reports/ui012-source-report.md',
    result.markdown,
  );
  const b = await puppeteer.launch({
    headless: true,
    executablePath:
      'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  });
  try {
    const p = await b.newPage();
    await p.setViewport({ width: 1440, height: 1100 });
    await p.setRequestInterception(true);
    p.on('request', (r) => {
      void (r.url().startsWith(base + '/') ? r.continue() : r.abort());
    });
    const errors = [];
    p.on('pageerror', (e) => errors.push(e.message));
    await p.goto(base + '/studio', { waitUntil: 'networkidle0' });
    await p.waitForSelector('.sessions button');
    await p.evaluate(() =>
      [...document.querySelectorAll('.sessions button')]
        .find((b) => b.textContent.includes('exact targets'))
        .click(),
    );
    await p.waitForSelector('.content-card');
    await p.waitForFunction(() =>
      [...document.querySelectorAll('button')].some(
        (b) => b.textContent === 'Copy Report' && !b.disabled,
      ),
    );
    assert.equal(await p.$$eval('.content-card', (n) => n.length), 5);
    assert.equal(
      await p.$$eval(
        '.content-card input[type=checkbox]:checked',
        (n) => n.length,
      ),
      5,
    );
    assert.equal(
      await p.$$eval('.content-card details[open]', (n) => n.length),
      0,
    );
    const cdp = await p.createCDPSession();
    await cdp.send('Browser.grantPermissions', {
      origin: base,
      permissions: ['clipboardReadWrite', 'clipboardSanitizedWrite'],
    });
    await p.evaluate(() =>
      [...document.querySelectorAll('button')]
        .find((b) => b.textContent === 'Copy Report')
        .click(),
    );
    await p.waitForFunction(() =>
      document.body.textContent.includes('Report copied.'),
    );
    assert.equal(
      (await p.evaluate(() => navigator.clipboard.readText())).replace(/\r\n/g,'\n'),
      result.markdown,
    );
    await p.evaluate(() => {
      const original = URL.createObjectURL;
      URL.createObjectURL = function (blob) {
        window.reportBlob = blob;
        return original(blob);
      };
    });
    await p.evaluate(() =>
      [...document.querySelectorAll('button')]
        .find((b) => b.textContent === 'Export JSON')
        .click(),
    );
    assert.deepEqual(
      JSON.parse(await p.evaluate(() => window.reportBlob.text())),
      result.report,
    );
    await p.$eval('.content-heading', (e) => e.scrollIntoView());
    await p.screenshot({ path: process.argv[2] });
    assert.deepEqual(errors, []);
    console.log(
      JSON.stringify({
        PASS: true,
        counts: result.report.counts,
        clipboardExact: true,
        jsonExact: true,
        revision: result.report.revision,
      }),
    );
  } finally {
    await b.close();
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
