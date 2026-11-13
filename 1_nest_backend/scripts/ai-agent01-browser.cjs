/* Browser smoke for the AI UI against an isolated runtime. Never clicks a live AI action. */
const fs = require('fs');
const path = require('path');
const assert = require('assert/strict');
const puppeteer = require('puppeteer');

async function main() {
  const base = process.argv[2] || 'http://127.0.0.1:3113';
  const output = path.resolve(process.argv[3] || '.studio-data/reports/ai-agent01/ui');
  fs.mkdirSync(output, { recursive: true });
  let browser;
  try {
    const executablePath = [
      'C:/Program Files/Google/Chrome/Application/chrome.exe',
      'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
      'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
    ].find(fs.existsSync);
    if (!executablePath) throw Error('NO_INSTALLED_BROWSER');
    browser = await puppeteer.launch({ executablePath, headless: true, defaultViewport: { width: 1366, height: 900 }, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
    const page = await browser.newPage();
    const aiRequests = [];
    page.on('request', (request) => {
      if (request.url().includes('/api/studio/data/ai/')) aiRequests.push({ method: request.method(), url: new URL(request.url()).pathname });
    });
    await page.goto(base + '/studio?area=Discovery', { waitUntil: 'networkidle0', timeout: 30_000 });
    await page.waitForSelector('[data-testid="ai-content-panel"]', { timeout: 20_000 });
    await page.$eval('[data-testid="conversation-panel"]', (element) => { element.open = true; });
    await new Promise((resolve) => setTimeout(resolve, 200));
    const state = await page.evaluate(() => ({
      provider: document.querySelector('[data-testid="ai-provider-status"]')?.textContent,
      evaluateDisabled: document.querySelector('[data-testid="ai-evaluate"]')?.disabled,
      agentDisabled: document.querySelector('[data-testid="ai-research-run"]')?.disabled,
      panelText: document.querySelector('[data-testid="ai-content-panel"]')?.textContent,
    }));
    assert.match(state.provider || '', /HUGGING_FACE/);
    assert.match(state.panelText || '', /Human review required/);
    assert.equal(aiRequests.some((request) => request.method === 'POST'), false, 'opening Studio must not call AI');
    let persistence = null;
    if (process.argv.includes('--exercise-save')) {
      await page.click('[data-testid="ai-assessment"] input[type="checkbox"]');
      const feedbackArea = '[data-testid="ai-assessment"] textarea';
      await page.click(feedbackArea);
      await page.type(feedbackArea, 'Browser acceptance: giữ NEEDS_REVIEW, chưa production approval.');
      const feedbackResponse = page.waitForResponse((response) =>
        response.url().includes('/feedback') && response.request().method() === 'POST');
      await page.evaluate(() => [...document.querySelectorAll('button')]
        .find((button) => button.textContent?.includes('Lưu AI feedback'))?.click());
      assert.equal((await feedbackResponse).status(), 201);

      const draft = '[data-testid="ai-script-draft-editor"]';
      const textareas = await page.$$(draft + ' textarea');
      assert.ok(textareas.length >= 3, 'editable hook, section and feedback must exist');
      await textareas[0].click({ clickCount: 3 });
      await textareas[0].type('Hook DRAFT đã chỉnh trong browser acceptance');
      await textareas[textareas.length - 1].type('Giữ bản nháp để người dùng duyệt.');
      const reviewResponse = page.waitForResponse((response) =>
        response.url().includes('/review') && response.request().method() === 'POST');
      await page.evaluate(() => [...document.querySelectorAll('button')]
        .find((button) => button.textContent?.includes('Lưu Script DRAFT'))?.click());
      assert.equal((await reviewResponse).status(), 201);
      await page.reload({ waitUntil: 'networkidle0' });
      await page.waitForSelector('[data-testid="ai-script-draft-editor"]');
      persistence = await page.evaluate(() => ({
        feedbackRevision: [...document.querySelectorAll('button')]
          .find((button) => button.textContent?.includes('Lưu AI feedback'))?.textContent,
        scriptRevision: [...document.querySelectorAll('button')]
          .find((button) => button.textContent?.includes('Lưu Script DRAFT'))?.textContent,
        hook: document.querySelector('[data-testid="ai-script-draft-editor"] textarea')?.value,
      }));
      assert.match(persistence.feedbackRevision || '', /revision 1/);
      assert.match(persistence.scriptRevision || '', /revision 1/);
      assert.equal(persistence.hook, 'Hook DRAFT đã chỉnh trong browser acceptance');
    }
    const panel = await page.$('[data-testid="ai-content-panel"]');
    await panel.screenshot({ path: path.join(output, 'ai-content-panel.png') });
    const result = { ...state, persistence, aiRequests, automaticLivePost: false, url: page.url() };
    fs.writeFileSync(path.join(output, 'browser-verification.json'), JSON.stringify(result, null, 2));
    process.stdout.write(JSON.stringify(result));
  } finally {
    if (browser) await browser.close();
  }
}
main().catch((error) => { console.error(error.stack || error.message); process.exitCode = 1; });
