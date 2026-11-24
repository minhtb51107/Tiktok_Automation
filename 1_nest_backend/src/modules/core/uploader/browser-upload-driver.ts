import { BadRequestException } from '@nestjs/common';
import * as path from 'path';
import puppeteer from 'puppeteer';
import { existingPublicBrowser } from '../scraper/public-discovery';

export type BrowserPrepareResult =
  | { status: 'READY'; detail: string; pagePath: string }
  | { status: 'USER_ACTION_REQUIRED'; detail: string; pagePath: string }
  | { status: 'BLOCKED'; detail: string; pagePath: string };

export type BrowserConfirmResult =
  | { status: 'PUBLISHED'; detail: string; pagePath: string }
  | { status: 'UNKNOWN'; detail: string; pagePath: string };

export interface BrowserUploadDriver {
  prepare(input: {
    jobId: string;
    videoPath: string;
    formattedCaption: string;
    profileDirName: string;
  }): Promise<BrowserPrepareResult>;
  confirm(jobId: string): Promise<BrowserConfirmResult>;
  close(jobId: string): Promise<void>;
  has(jobId?: string): boolean;
}

type Browser = Awaited<ReturnType<typeof puppeteer.launch>>;
type Page = Awaited<ReturnType<Browser['newPage']>>;

const pagePath = (raw: string) => {
  try {
    const url = new URL(raw);
    return `${url.origin}${url.pathname}`;
  } catch {
    return 'UNKNOWN_PAGE';
  }
};

const profilePath = (name: string, rootOverride?: string) => {
  const rootValue = rootOverride || process.env.STUDIO_TIKTOK_PROFILE_ROOT;
  if (!rootValue)
    throw new BadRequestException(
      'BROWSER_PROFILE_ROOT_MISSING: configure a user-managed STUDIO_TIKTOK_PROFILE_ROOT',
    );
  if (!/^[a-zA-Z0-9_-]{1,64}$/.test(name))
    throw new BadRequestException(
      'BROWSER_PROFILE_INVALID: profile name must be a simple directory name',
    );
  const root = path.resolve(rootValue);
  const resolved = path.resolve(root, name);
  if (path.dirname(resolved) !== root)
    throw new BadRequestException('BROWSER_PROFILE_OUTSIDE_ROOT');
  return resolved;
};

/**
 * Headed, user-assisted TikTok Studio driver. It deliberately has no stealth,
 * cookie import, private API replay, or automatic challenge handling.
 */
export class PuppeteerBrowserUploadDriver implements BrowserUploadDriver {
  private sessions = new Map<string, { browser: Browser; page: Page }>();

  constructor(
    private readonly options: {
      uploadUrl?: string;
      executablePath?: string;
      profileRoot?: string;
      headlessForTest?: boolean;
    } = {},
  ) {}

  has(jobId?: string) {
    return jobId ? this.sessions.has(jobId) : this.sessions.size > 0;
  }

  private async session(jobId: string, dirName: string) {
    const current = this.sessions.get(jobId);
    if (current) return current;
    const executablePath =
      this.options.executablePath || existingPublicBrowser();
    if (!executablePath)
      throw new BadRequestException(
        'BROWSER_MISSING: no existing local Chrome/Edge executable found',
      );
    const browser = await puppeteer.launch({
      executablePath,
      headless: this.options.headlessForTest === true ? true : false,
      userDataDir: profilePath(dirName, this.options.profileRoot),
      defaultViewport: { width: 1280, height: 960 },
      args: ['--disable-notifications', '--window-size=1280,960'],
    });
    const page = (await browser.pages())[0] || (await browser.newPage());
    const value = { browser, page };
    this.sessions.set(jobId, value);
    browser.on('disconnected', () => this.sessions.delete(jobId));
    return value;
  }

  private async gate(page: Page) {
    const url = page.url();
    const domGate = await page
      .evaluate(
        () =>
          !!document.querySelector(
            'input[type="password"], iframe[src*="captcha"], [data-testid*="captcha"], [id*="captcha"], [class*="captcha"]',
          ),
      )
      .catch(() => false);
    return /\/(?:login|challenge|checkpoint|verify)(?:\/|\?|$)/i.test(url) || domGate;
  }

  async prepare(input: {
    jobId: string;
    videoPath: string;
    formattedCaption: string;
    profileDirName: string;
  }): Promise<BrowserPrepareResult> {
    const { page } = await this.session(input.jobId, input.profileDirName);
    const uploadUrl =
      this.options.uploadUrl ||
      'https://www.tiktok.com/creator-center/upload';
    const target = new URL(uploadUrl);
    let currentOrigin = '';
    try {
      currentOrigin = new URL(page.url()).origin;
    } catch {}
    if (currentOrigin !== target.origin) {
      const response = await page.goto(uploadUrl, {
        waitUntil: 'domcontentloaded',
        timeout: 45_000,
      });
      if (response && response.status() >= 400)
        return {
          status: 'BLOCKED',
          detail: `CREATOR_CENTER_HTTP_${response.status()}`,
          pagePath: pagePath(page.url()),
        };
    }
    if (await this.gate(page))
      return {
        status: 'USER_ACTION_REQUIRED',
        detail:
          'LOGIN_OR_CHALLENGE: complete the visible TikTok login/challenge manually, then press Resume preparation',
        pagePath: pagePath(page.url()),
      };

    const fileInput = await page
      .waitForSelector('input[type="file"][accept*="video"]', {
        timeout: 20_000,
      })
      .catch(() => null);
    if (!fileInput)
      return {
        status: 'BLOCKED',
        detail:
          'UPLOAD_FORM_UNRECOGNIZED: the public upload form was not found; no selector guessing or Post action was attempted',
        pagePath: pagePath(page.url()),
      };
    await fileInput.uploadFile(input.videoPath);

    const editor = await page
      .waitForSelector(
        '.public-DraftEditor-content[contenteditable="true"], [contenteditable="true"][role="textbox"], textarea[placeholder*="caption" i]',
        { timeout: 60_000 },
      )
      .catch(() => null);
    if (!editor)
      return {
        status: 'USER_ACTION_REQUIRED',
        detail:
          'CAPTION_EDITOR_UNRECOGNIZED: MP4 selected, but caption editor requires visible user review',
        pagePath: pagePath(page.url()),
      };
    await editor.click();
    await page.keyboard.down('Control');
    await page.keyboard.press('A');
    await page.keyboard.up('Control');
    await page.keyboard.press('Backspace');
    await page.keyboard.type(input.formattedCaption, { delay: 8 });
    return {
      status: 'READY',
      detail:
        'Exact MP4 and caption were prepared in the visible TikTok window; Post was not clicked',
      pagePath: pagePath(page.url()),
    };
  }

  async confirm(jobId: string): Promise<BrowserConfirmResult> {
    const session = this.sessions.get(jobId);
    if (!session)
      throw new BadRequestException(
        'BROWSER_SESSION_MISSING: reopen and prepare the browser upload before confirming',
      );
    const { page } = session;
    if (await this.gate(page))
      return {
        status: 'UNKNOWN',
        detail:
          'ACCESS_GATE_BEFORE_POST: login/challenge appeared; Post was not clicked',
        pagePath: pagePath(page.url()),
      };
    const clicked = await page.evaluate(() => {
      const candidates = Array.from(
        document.querySelectorAll<HTMLElement>('button, [role="button"]'),
      );
      const button = candidates.find((node) => {
        const text = (node.textContent || '').trim().toLowerCase();
        const rect = node.getBoundingClientRect();
        const disabled =
          node.getAttribute('aria-disabled') === 'true' ||
          (node as HTMLButtonElement).disabled;
        return (
          (text === 'post' || text === 'đăng' || text === 'đăng video') &&
          rect.width > 0 &&
          rect.height > 0 &&
          !disabled
        );
      });
      if (!button) return false;
      button.click();
      return true;
    });
    if (!clicked)
      return {
        status: 'UNKNOWN',
        detail:
          'POST_CONTROL_UNRECOGNIZED: no unique enabled Post control was clicked',
        pagePath: pagePath(page.url()),
      };
    const verified = await page
      .waitForFunction(
        () => {
          const text = document.body.innerText.toLowerCase();
          return (
            !location.pathname.includes('upload') ||
            text.includes('manage posts') ||
            text.includes('quản lý bài đăng') ||
            text.includes('upload another video') ||
            text.includes('tải video khác lên')
          );
        },
        { timeout: 120_000 },
      )
      .then(() => true)
      .catch(() => false);
    return verified
      ? {
          status: 'PUBLISHED',
          detail: 'TikTok displayed a post-completion signal after Post click',
          pagePath: pagePath(page.url()),
        }
      : {
          status: 'UNKNOWN',
          detail:
            'POST_OUTCOME_AMBIGUOUS: Post was clicked but no completion signal was observed; retry is locked',
          pagePath: pagePath(page.url()),
        };
  }

  async close(jobId: string) {
    const session = this.sessions.get(jobId);
    this.sessions.delete(jobId);
    await session?.browser.close().catch(() => undefined);
  }
}
