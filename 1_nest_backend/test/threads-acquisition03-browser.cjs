/* Read-only/live-result UI acceptance against an isolated store. It never starts collection. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const puppeteer = require('puppeteer');

async function main() {
  const base = process.argv[2] || 'http://127.0.0.1:3115';
  const output = path.resolve(
    process.argv[3] || '.studio-data/reports/threads-acquisition03-live01/studio-smoke',
  );
  fs.mkdirSync(output, { recursive: true });
  const executablePath = [
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
  ].find(fs.existsSync);
  if (!executablePath) throw Error('NO_INSTALLED_BROWSER');
  let browser;
  try {
    browser = await puppeteer.launch({
      executablePath,
      headless: true,
      defaultViewport: { width: 1366, height: 768 },
      args: ['--no-sandbox', '--disable-dev-shm-usage'],
    });
    const page = await browser.newPage();
    await browser.defaultBrowserContext().overridePermissions(base, ['clipboard-read', 'clipboard-write']);
    await page.goto(`${base}/studio?area=Discovery`, {
      waitUntil: 'networkidle0',
      timeout: 30000,
    });
    await page.waitForSelector('[data-testid="conversation-panel"]', { timeout: 20000 });
    await page.$eval('[data-testid="conversation-panel"]', (element) => {
      element.open = true;
    });
    await page.waitForSelector('[data-testid="conversation-result"]', { timeout: 20000 });
    const counts = await page.$eval('[data-testid="conversation-v2-counts"]', (element) =>
      element.textContent.replace(/\s+/g, ' ').trim(),
    );
    assert.match(counts, /V2 subjects 29/);
    assert.match(counts, /full cards 29/);
    assert.match(counts, /unknown 28/);
    const observed = await page.$$('[data-testid="observed-context-card"]');
    const related = await page.$$('[data-testid="related-context-card"]');
    const incomplete = await page.$$('[data-testid="incomplete-context-card"]');
    assert.equal(observed.length, 28);
    assert.equal(related.length, 1);
    assert.equal(incomplete.length, 28);

    await page.click('[data-testid="conversation-copy-report"]');
    await page.waitForFunction(
      () => document.body.textContent.includes('Full persisted run report copied'),
      { timeout: 15000 },
    );
    const clipboard = await page.evaluate(() => navigator.clipboard.readText());
    assert.match(clipboard, /V2 subject permalinks 29; full cards 29/);
    assert.match(clipboard, /Automatic selection: NOT_ENOUGH_EVIDENCE/);

    await page.evaluate(() => {
      window.__downloads = [];
      URL.createObjectURL = (blob) => {
        window.__downloads.push(blob);
        return 'blob:threads-acquisition03';
      };
      HTMLAnchorElement.prototype.click = function () {};
    });
    await page.click('[data-testid="conversation-export-markdown"]');
    await page.click('[data-testid="conversation-export-json"]');
    await page.waitForFunction(() => window.__downloads.length === 2, { timeout: 15000 });
    const exports = await page.evaluate(async () =>
      Promise.all(window.__downloads.map((blob) => blob.text())),
    );
    assert.match(exports[0], /V2 subject permalinks 29; full cards 29/);
    const json = JSON.parse(exports[1]);
    assert.equal(json.collections[0].record.collection.observedCards.length, 29);

    await page.click('[data-testid="observed-context-selected"]');
    await page.click('[data-testid="conversation-reason"]');
    await page.keyboard.type('Isolated UI acceptance; relationship remains unverified');
    await page.click('[data-testid="conversation-feedback-save"]');
    await page.waitForFunction(
      () => document.body.textContent.includes('Feedback saved.'),
      { timeout: 15000 },
    );
    await page.reload({ waitUntil: 'networkidle0', timeout: 30000 });
    await page.waitForSelector('[data-testid="conversation-panel"]', { timeout: 20000 });
    await page.$eval('[data-testid="conversation-panel"]', (element) => {
      element.open = true;
    });
    await page.waitForSelector('[data-testid="observed-context-selected"]', { timeout: 20000 });
    assert.equal(
      await page.$eval('[data-testid="observed-context-selected"]', (element) => element.checked),
      true,
    );
    assert.equal(
      await page.$eval('[data-testid="conversation-decision"]', (element) => element.value),
      'NEEDS_REVIEW',
    );
    await page.screenshot({ path: path.join(output, 'live-collection.png'), fullPage: true });
    await page.click('[data-testid="conversation-create-draft"]');
    await page.waitForFunction(
      () => new URL(location.href).searchParams.get('step') === 'Script',
      { timeout: 20000 },
    );
    const session = await page.evaluate(() => new URL(location.href).searchParams.get('session'));
    assert.match(session, /^[a-f0-9-]{36}$/);
    const result = {
      counts,
      observedCards: observed.length,
      relatedCards: related.length,
      unknownCards: incomplete.length,
      copyReport: true,
      markdownExport: true,
      jsonExport: true,
      selectionSaveReopen: true,
      decision: 'NEEDS_REVIEW',
      scriptDraftSession: session,
    };
    fs.writeFileSync(path.join(output, 'result.json'), JSON.stringify(result, null, 2));
    console.log(JSON.stringify(result));
  } finally {
    if (browser) await browser.close();
  }
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
