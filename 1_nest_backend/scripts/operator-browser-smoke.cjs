// Offline browser acceptance. Pass the path to one saved Studio session JSON.
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const { randomBytes } = require('node:crypto');
const fs = require('node:fs/promises');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');
const puppeteer = require('puppeteer');
const { existingPublicBrowser } = require('../dist/modules/core/scraper/public-discovery');

async function main() {
  const source = path.resolve(process.argv[2]);
  const session = JSON.parse(await fs.readFile(source, 'utf8'));
  assert.match(session.id, /^[a-f0-9-]{36}$/);
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'operator-browser-smoke-'));
  await fs.copyFile(source, path.join(root, session.id + '.json'));
  const reservation = net.createServer();
  await new Promise((resolve) => reservation.listen(0, '127.0.0.1', resolve));
  const port = reservation.address().port;
  await new Promise((resolve) => reservation.close(resolve));
  const origin = 'http://127.0.0.1:' + port;
  const token = randomBytes(32).toString('hex');
  const base = '/api/studio/operator';
  const env = { ...process.env, PORT: String(port), STUDIO_DATA_ROOT: root,
    STUDIO_OPERATOR_ONLY: '1', STUDIO_OPERATOR_TOKEN: token,
    STUDIO_OPERATOR_COLLECTION: '0', STUDIO_OPERATOR_AI: '0',
    STUDIO_OPERATOR_TTS: '0', STUDIO_OPERATOR_RENDER: '0' };
  let backend, browser;
  async function stop() {
    if (!backend || backend.exitCode !== null || backend.signalCode !== null) return;
    const child = backend;
    const exited = new Promise(resolve => child.once('exit', resolve));
    child.kill();
    await exited;
  }
  async function start() {
    backend = spawn(process.execPath, ['dist/main.js'], { env, stdio: ['ignore', 'ignore', 'pipe'], windowsHide: true });
    let startupError = '', status;
    backend.stderr.on('data', chunk => {
      const line = String(chunk).match(/(?:Error|Exception):[^\r\n]*/)?.[0];
      if (line) startupError = line.replace(/(?:Bearer\s+|hf_|sk-)[\w.-]+/gi, '[redacted]').slice(0, 200);
    });
    for (let i = 0; i < 120; i++) {
      if (backend.exitCode !== null) break;
      try {
        const r = await fetch(origin + base + '/tools', { headers: { Authorization: 'Bearer ' + token } });
        status = r.status;
        if (r.ok) return;
      } catch {}
      await new Promise(resolve => setTimeout(resolve, 250));
    }
    throw Error('Operator sandbox failed to start (' + (status || backend.exitCode || 'startup timeout') + ') ' + startupError);
  }
  try {
    await start();
    browser = await puppeteer.launch({ executablePath: existingPublicBrowser(), headless: true });
    const page = await browser.newPage();
    await page.setRequestInterception(true);
    page.on('request', request => {
      void (new URL(request.url()).origin === origin ? request.continue() : request.abort());
    });
    assert.equal((await page.goto(origin + base + '/tools')).status(), 403);
    const call = (route, body) => page.evaluate(async ({ route, body, token }) => {
      const r = await fetch(route, {
        method: body ? 'POST' : 'GET',
        headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
      const parsed = await r.json();
      return { status: r.status, data: parsed.data ?? parsed };
    }, { route, body, token });
    const tools = await call(base + '/tools');
    assert.equal(tools.status, 200);
    assert.equal(tools.data.role, 'OPERATOR');
    assert.equal((await call('/api/studio/tiktok/oauth/start', {})).status, 403);
    assert.equal((await call(base + '/call/executeCommand', {})).status, 403);
    assert.equal((await call(base + '/projects/' + session.id)).data.sessionId, session.id);
    const payload = { requestId: 'browser-check-out-of-order', sessionId: session.id, revision: session.revision + 1 };
    const queued = await call(base + '/call/prepare', payload);
    assert.equal(queued.status, 201);
    const jobUrl = base + '/jobs/' + queued.data.jobId;
    let result;
    for (let i = 0; i < 50; i++) {
      result = (await call(jobUrl)).data;
      if (result.status === 'FAILED') break;
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    assert.equal(result.status, 'FAILED');
    assert.equal(result.errorCode, 'STALE_REVISION');
    assert.equal(typeof result.observedExecutionMs, 'number');
    assert.equal((await call(base + '/call/prepare', payload)).data.jobId, queued.data.jobId);
    await stop();
    await start();
    assert.equal((await call(jobUrl)).data.status, 'FAILED');
    assert.equal((await call(base + '/projects/' + session.id + '/report')).data.jobs.length, 1);
    assert.equal(await fs.readFile(source, 'utf8'), await fs.readFile(path.join(root, session.id + '.json'), 'utf8'));
    console.log(JSON.stringify({ result: 'PASS_BROWSER_OFFLINE', port, sandbox: root, jobId: queued.data.jobId }));
  } finally {
    await browser?.close();
    await stop();
  }
}

main().catch(error => {
  console.error(error.message);
  process.exitCode = 1;
});
