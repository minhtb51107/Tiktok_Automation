import { afterEach, describe, expect, it } from '@jest/globals';
import { promises as fs } from 'fs';
import { createServer, type Server } from 'http';
import * as os from 'os';
import * as path from 'path';
import { existingPublicBrowser } from '../scraper/public-discovery';
import { PuppeteerBrowserUploadDriver } from './browser-upload-driver';

describe('headed browser upload driver — local mock site', () => {
  let server: Server | null = null;
  let root = '';

  afterEach(async () => {
    await new Promise<void>((resolve) => server?.close(() => resolve()) || resolve());
    if (root) {
      await new Promise((resolve) => setTimeout(resolve, 100));
      await fs.rm(root, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
    }
  });

  it('uses Chromium to select the exact test MP4 and type caption without clicking Post', async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'browser-upload-site-'));
    const videoPath = path.join(root, 'exact-render-job.mp4');
    await fs.writeFile(videoPath, Buffer.from('synthetic-browser-fixture-video'));
    let observedFile = '';
    let observedCaption = '';
    let postClicks = 0;
    server = createServer((request, response) => {
      const url = new URL(request.url || '/', 'http://127.0.0.1');
      if (url.pathname === '/event') {
        if (url.searchParams.has('file'))
          observedFile = url.searchParams.get('file') || '';
        if (url.searchParams.has('caption'))
          observedCaption = url.searchParams.get('caption') || '';
        if (url.searchParams.has('post')) postClicks += 1;
        response.writeHead(204).end();
        return;
      }
      response.writeHead(200, { 'Content-Type': 'text/html' });
      response.end(`<!doctype html><html><body>
        <input type="file" accept="video/*" />
        <div contenteditable="true" role="textbox"></div>
        <button type="button">Post</button>
        <script>
          const file = document.querySelector('input');
          const caption = document.querySelector('[role=textbox]');
          file.addEventListener('change', () => fetch('/event?file=' + encodeURIComponent(file.files[0].name)));
          caption.addEventListener('input', () => fetch('/event?caption=' + encodeURIComponent(caption.textContent)));
          document.querySelector('button').addEventListener('click', () => fetch('/event?post=1'));
        </script>
      </body></html>`);
    });
    await new Promise<void>((resolve) =>
      server!.listen(0, '127.0.0.1', () => resolve()),
    );
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('mock server');
    const driver = new PuppeteerBrowserUploadDriver({
      uploadUrl: `http://127.0.0.1:${address.port}/upload`,
      executablePath: existingPublicBrowser()!,
      profileRoot: path.join(root, 'profiles'),
      headlessForTest: true,
    });
    let result;
    try {
      result = await driver.prepare({
        jobId: 'mock-job',
        videoPath,
        formattedCaption: 'Caption fixture #threads',
        profileDirName: 'fixture-profile',
      });
      await new Promise((resolve) => setTimeout(resolve, 300));
    } finally {
      await driver.close('mock-job');
    }
    expect(result.status).toBe('READY');
    expect(observedFile).toBe('exact-render-job.mp4');
    expect(observedCaption).toBe('Caption fixture #threads');
    expect(postClicks).toBe(0);
    expect(await fs.stat(videoPath)).toBeTruthy();
  }, 30_000);
});
