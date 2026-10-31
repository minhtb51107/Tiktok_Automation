// Explicit offline UI check. Requires the local Studio server; never calls Threads.
const puppeteer = require('puppeteer');
const assert = require('node:assert/strict');
(async () => {
  const browser = await puppeteer.launch({
    executablePath:
      process.env.STUDIO_BROWSER ||
      'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
    headless: true,
    args: ['--disable-background-networking'],
  });
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1440, height: 1100 });
    await page.setRequestInterception(true);
    page.on('request', (r) => {
      void (r.url().startsWith('http://127.0.0.1:3000/')
        ? r.continue()
        : r.abort());
    });
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto('http://127.0.0.1:3000/studio', {
      waitUntil: 'networkidle0',
    });
    const click = async (text) => {
      await page.evaluate((t) => {
        const b = [...document.querySelectorAll('button')].find((b) =>
          b.textContent.includes(t),
        );
        if (!b) throw Error(t);
        b.click();
      }, text);
    };
    await click('Create SERIOUS');
    await page.waitForSelector('.title-field input');
    await click('Paste content');
    await page.waitForSelector('.manual textarea');
    await page.type('.manual label:nth-of-type(2) input', 'Người kể chuyện');
    await page.type(
      '.manual textarea',
      'Dữ liệu nhập thủ công để kiểm tra Studio. Mỗi lựa chọn đều cần được cân nhắc.',
    );
    await page.type(
      '.manual label:last-of-type textarea',
      'Một góc nhìn cần được lắng nghe.\nHãy dành thời gian cho điều quan trọng.',
    );
    await click('Import source');
    await page.waitForSelector('.content-card');
    await page.waitForFunction(
      () => document.querySelectorAll('.content-card').length === 3,
    );
    await page
      .click('.content-card:nth-of-type(1) input[type=checkbox]')
      .catch(() => {});
    const field = await page.$('.content-card textarea');
    await field.click({ clickCount: 3 });
    await field.type('Phiên bản hiển thị đã chỉnh sửa.');
    await click('Save changes');
    await page.waitForFunction(() =>
      document.body.textContent.includes('Project saved locally.'),
    );
    const selectedId = await page.evaluate(
      () => document.querySelector('.sessions .chosen')?.textContent,
    );
    await page.reload({ waitUntil: 'networkidle0' });
    await page.evaluate((t) => {
      [...document.querySelectorAll('.sessions button')]
        .find((b) => b.textContent === t)
        .click();
    }, selectedId);
    await page.waitForSelector('.content-card');
    assert.equal(
      await page.$eval('.content-card textarea', (e) => e.value),
      'Phiên bản hiển thị đã chỉnh sửa.',
    );
    await page.screenshot({ path: process.argv[2], fullPage: true });
    await click('Restore original text');
    assert.match(
      await page.$eval('.content-card textarea', (e) => e.value),
      /Dữ liệu nhập thủ công/,
    );
    assert.deepEqual(errors, []);
    console.log(
      'PASS: create, manual import, edit, save, reopen, restore; no runtime exceptions.',
    );
  } finally {
    await browser.close();
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
