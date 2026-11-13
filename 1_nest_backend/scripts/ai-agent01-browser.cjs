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
    const panel = await page.$('[data-testid="ai-content-panel"]');
    await panel.screenshot({ path: path.join(output, 'ai-content-panel.png') });
    const result = { ...state, aiRequests, automaticLivePost: false, url: page.url() };
    fs.writeFileSync(path.join(output, 'browser-verification.json'), JSON.stringify(result, null, 2));
    process.stdout.write(JSON.stringify(result));
  } finally {
    if (browser) await browser.close();
  }
}
main().catch((error) => { console.error(error.stack || error.message); process.exitCode = 1; });
