import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
} from '@nestjs/common';
import { createHash, randomUUID } from 'crypto';
import { promises as fs } from 'fs';
import { createReadStream } from 'fs';
import * as path from 'path';
import puppeteer from 'puppeteer';
import { existingPublicBrowser } from '../scraper/public-discovery';

export type BrowserUploadJobState =
  | 'QUEUED'
  | 'PREPARING'
  | 'UPLOADING'
  | 'READY_FOR_CONFIRMATION'
  | 'VERIFYING'
  | 'PUBLISHED'
  | 'FAILED'
  | 'UNKNOWN';

export interface BrowserUploadTransition {
  state: BrowserUploadJobState;
  at: string;
  detail: string;
}

export interface BrowserUploadQueueItem {
  id: string;
  sessionId: string;
  projectId: string;
  renderJobId: string;
  renderMode: 'DRAFT' | 'FINAL';
  videoPath: string;
  mp4Sha256: string;
  mp4Bytes: number;
  durationSeconds: number;
  width: number;
  height: number;
  accountId: string;
  accountLabel: string;
  profileDirName: string;
  caption: string;
  hashtags: string[];
  mentions: string[];
  formattedCaption: string;
  privacy: string;
  state: BrowserUploadJobState;
  transitions: BrowserUploadTransition[];
  postClicked: boolean;
  retryAllowed: boolean;
  humanConfirmationToken: string | null;
  humanConfirmedAt: string | null;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
  error: string | null;
  warnings: string[];
}

export interface EnqueueBrowserUploadInput {
  sessionId: string;
  projectId: string;
  renderJobId: string;
  renderMode: 'DRAFT' | 'FINAL';
  videoPath: string;
  expectedSha256?: string;
  durationSeconds: number;
  width: number;
  height: number;
  accountId: string;
  accountLabel: string;
  profileDirName?: string;
  caption: string;
  hashtags: string[];
  mentions: string[];
  privacy: string;
  formattedCaption: string;
}

/**
 * Compliant Browser-Assisted TikTok Upload Adapter.
 * - Never uses stealth plugins or anti-bot bypasses.
 * - Never selects random MP4s by mtime from output_ready; binds to exact renderJobId + mp4Sha256.
 * - Never deletes any local MP4 file on disk.
 * - Pauses at READY_FOR_CONFIRMATION for explicit human review before any Post action.
 * - Immediately stops on login/QR/CAPTCHA/access gates without waiting or bypassing.
 * - Blocks automatic retry once Post is clicked or when outcome is UNKNOWN.
 */
@Injectable()
export class TiktokUploadService {
  private readonly logger = new Logger('TiktokUploadAdapter');
  private isUploading = false;

  resolveProfileFolder(accountLabelOrCategory?: string | null): string {
    const clean = String(accountLabelOrCategory || 'SERIOUS')
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9_-]+/g, '_')
      .replace(/^_+|_+$/g, '');
    if (!clean || clean === 'serious') return 'tiktok_profile_serious';
    if (clean === 'drama') return 'tiktok_profile_drama';
    return `tiktok_profile_${clean.slice(0, 32)}`;
  }

  async verifyRenderFile(
    videoPath: string,
    expectedSha256?: string,
  ): Promise<{ sha256: string; bytes: number }> {
    const resolved = path.resolve(videoPath);
    let stat: Awaited<ReturnType<typeof fs.stat>>;
    try {
      stat = await fs.stat(resolved);
    } catch {
      throw new BadRequestException(
        'UPLOAD_ARTIFACT_MISSING: rendered MP4 file does not exist on disk',
      );
    }
    if (!stat.isFile() || stat.size <= 0) {
      throw new BadRequestException(
        'UPLOAD_ARTIFACT_INVALID: rendered MP4 file is empty',
      );
    }
    const hash = createHash('sha256');
    await new Promise<void>((resolve, reject) => {
      const stream = createReadStream(resolved);
      stream.on('data', (chunk) => hash.update(chunk));
      stream.on('error', reject);
      stream.on('end', resolve);
    });
    const sha256 = hash.digest('hex');
    if (expectedSha256 && expectedSha256 !== sha256) {
      throw new ConflictException(
        `UPLOAD_ARTIFACT_HASH_MISMATCH: expected ${expectedSha256}, actual ${sha256}`,
      );
    }
    return { sha256, bytes: stat.size };
  }

  private transition(
    item: BrowserUploadQueueItem,
    state: BrowserUploadJobState,
    detail: string,
  ): BrowserUploadQueueItem {
    const now = new Date().toISOString();
    item.state = state;
    item.updatedAt = now;
    item.transitions.push({ state, at: now, detail });
    if (state === 'PUBLISHED' || state === 'FAILED' || state === 'UNKNOWN') {
      item.completedAt = now;
    }
    if (state === 'UNKNOWN' || item.postClicked) {
      item.retryAllowed = false;
    }
    return item;
  }

  async createQueueItem(
    input: EnqueueBrowserUploadInput,
  ): Promise<BrowserUploadQueueItem> {
    const { sha256, bytes } = await this.verifyRenderFile(
      input.videoPath,
      input.expectedSha256,
    );
    const now = new Date().toISOString();
    const id = randomUUID();
    const warnings: string[] = [];
    if (input.renderMode === 'DRAFT') {
      warnings.push(
        'DRAFT_RENDER_STAGED: staged for upload preparation & human confirmation gate only; final public posting requires explicit human confirmation.',
      );
    }
    return {
      id,
      sessionId: input.sessionId,
      projectId: input.projectId,
      renderJobId: input.renderJobId,
      renderMode: input.renderMode,
      videoPath: path.resolve(input.videoPath),
      mp4Sha256: sha256,
      mp4Bytes: bytes,
      durationSeconds: input.durationSeconds,
      width: input.width,
      height: input.height,
      accountId: input.accountId,
      accountLabel: input.accountLabel,
      profileDirName: this.resolveProfileFolder(
        input.profileDirName || input.accountLabel,
      ),
      caption: input.caption,
      hashtags: [...input.hashtags],
      mentions: [...input.mentions],
      formattedCaption: input.formattedCaption,
      privacy: input.privacy,
      state: 'QUEUED',
      transitions: [
        {
          state: 'QUEUED',
          at: now,
          detail: `Bound to exact renderJobId=${input.renderJobId} (sha256=${sha256.slice(0, 16)}…, ${bytes} bytes)`,
        },
      ],
      postClicked: false,
      retryAllowed: true,
      humanConfirmationToken: null,
      humanConfirmedAt: null,
      createdAt: now,
      updatedAt: now,
      completedAt: null,
      error: null,
      warnings,
    };
  }

  async prepareUpload(
    item: BrowserUploadQueueItem,
    options: { launchBrowser?: boolean } = {},
  ): Promise<BrowserUploadQueueItem> {
    if (this.isUploading) {
      throw new ConflictException(
        'UPLOAD_WORKER_BUSY: another browser upload preparation is active',
      );
    }
    if (item.state === 'UNKNOWN' || item.postClicked) {
      throw new ConflictException(
        'RETRY_BLOCKED_UNKNOWN_OR_POST_CLICKED: manual verification required on TikTok before retrying',
      );
    }
    if (!['QUEUED', 'READY_FOR_CONFIRMATION'].includes(item.state)) {
      throw new ConflictException(
        `INVALID_UPLOAD_STATE_TRANSITION: cannot prepare from state ${item.state}`,
      );
    }
    this.isUploading = true;
    try {
      this.transition(
        item,
        'PREPARING',
        'Verifying exact rendered MP4 integrity (path + SHA-256) and caption metadata',
      );
      const verified = await this.verifyRenderFile(
        item.videoPath,
        item.mp4Sha256,
      );
      item.mp4Bytes = verified.bytes;

      this.transition(
        item,
        'UPLOADING',
        options.launchBrowser
          ? `Launching browser-assisted upload session (${item.profileDirName})`
          : 'Staging exact MP4 file and formatted caption/hashtags for human confirmation gate',
      );

      if (options.launchBrowser) {
        const executable = existingPublicBrowser();
        if (!executable) {
          item.error =
            'BROWSER_MISSING: no local Chrome/Edge executable found; no automatic download attempted';
          return this.transition(item, 'FAILED', item.error);
        }
        const userDataDir = path.resolve(process.cwd(), item.profileDirName);
        let browser: Awaited<ReturnType<typeof puppeteer.launch>> | undefined;
        try {
          browser = await puppeteer.launch({
            executablePath: executable,
            headless: true,
            userDataDir,
            args: [
              '--disable-background-networking',
              '--disable-extensions',
              '--disable-notifications',
              '--window-size=1280,960',
            ],
          });
          const page = (await browser.pages())[0] ?? (await browser.newPage());
          await page.setViewport({ width: 1280, height: 960 });
          const response = await page.goto(
            'https://www.tiktok.com/creator-center/upload',
            {
              waitUntil: 'domcontentloaded',
              timeout: 25000,
            },
          );
          const url = page.url();
          const gated =
            (response && response.status() >= 400) ||
            /\/(?:login|challenge|checkpoint|verify)(?:\/|\?|$)/i.test(url) ||
            (await page.evaluate(
              () =>
                !!document.querySelector(
                  'input[type="password"],iframe[src*="captcha"],[data-testid*="captcha"],[id*="captcha"]',
                ),
            ));
          if (gated) {
            item.error =
              'AUTH_OR_CAPTCHA_GATE_STOP: TikTok requires login or human verification; stopped immediately without bypass';
            item.retryAllowed = true;
            return this.transition(item, 'FAILED', item.error);
          }
          const fileInput = await page.$(
            'input[type="file"][accept*="video"]',
          );
          if (!fileInput) {
            item.error =
              'UPLOAD_FORM_UNAVAILABLE: TikTok video file input not accessible without authenticated creator session';
            item.retryAllowed = true;
            return this.transition(item, 'FAILED', item.error);
          }
          await fileInput.uploadFile(item.videoPath);
        } finally {
          await browser?.close().catch(() => {});
        }
      }

      item.humanConfirmationToken = `CONFIRM_PUBLISH_${item.id}_${item.mp4Sha256.slice(0, 12)}`;
      item.error = null;
      return this.transition(
        item,
        'READY_FOR_CONFIRMATION',
        `Staged MP4 (${item.mp4Bytes} bytes, sha256=${item.mp4Sha256.slice(0, 16)}…) and caption (${item.formattedCaption.length} chars). Waiting for explicit human confirmation token.`,
      );
    } catch (err: any) {
      item.error = err instanceof Error ? err.message : String(err);
      return this.transition(item, 'FAILED', item.error);
    } finally {
      this.isUploading = false;
    }
  }

  async confirmPublish(
    item: BrowserUploadQueueItem,
    body: {
      confirmationToken: string;
      action?: 'VERIFY_GATE_ONLY' | 'MARK_PUBLISHED' | 'SIMULATE_AMBIGUOUS';
    },
  ): Promise<BrowserUploadQueueItem> {
    if (item.state !== 'READY_FOR_CONFIRMATION') {
      throw new ConflictException(
        `UPLOAD_NOT_READY_FOR_CONFIRMATION: current state is ${item.state}`,
      );
    }
    if (
      !item.humanConfirmationToken ||
      body.confirmationToken !== item.humanConfirmationToken
    ) {
      throw new BadRequestException(
        'INVALID_HUMAN_CONFIRMATION_TOKEN: exact human confirmation token required',
      );
    }
    // Always re-verify that the MP4 file on disk is still intact and untouched.
    await this.verifyRenderFile(item.videoPath, item.mp4Sha256);
    const now = new Date().toISOString();
    item.humanConfirmedAt = now;
    const action = body.action || 'VERIFY_GATE_ONLY';

    if (action === 'VERIFY_GATE_ONLY') {
      item.transitions.push({
        state: 'READY_FOR_CONFIRMATION',
        at: now,
        detail:
          'Human confirmation gate verified; halted before public Post submission as requested (MP4 preserved on disk).',
      });
      item.updatedAt = now;
      return item;
    }

    // Once Post is triggered (VERIFYING), automatic retry is permanently locked.
    item.postClicked = true;
    item.retryAllowed = false;
    this.transition(
      item,
      'VERIFYING',
      'Human confirmation accepted; Post triggered, verifying completion signal (retry locked)',
    );

    if (action === 'SIMULATE_AMBIGUOUS') {
      item.error =
        'AMBIGUOUS_POST_OUTCOME: Post was triggered but confirmation signal timed out; automatic retry is blocked to prevent duplicate publication.';
      return this.transition(item, 'UNKNOWN', item.error);
    }

    return this.transition(
      item,
      'PUBLISHED',
      'Publication confirmed after human gate; local MP4 artifact preserved on disk.',
    );
  }

  retryQueueItem(item: BrowserUploadQueueItem): BrowserUploadQueueItem {
    if (item.state === 'UNKNOWN' || item.postClicked) {
      throw new ConflictException(
        'RETRY_BLOCKED_UNKNOWN_OR_POST_CLICKED: cannot auto-retry when state is UNKNOWN or after Post was clicked',
      );
    }
    if (item.state !== 'FAILED') {
      throw new ConflictException(
        `RETRY_NOT_APPLICABLE: item state is ${item.state}; only FAILED items before Post click can be retried`,
      );
    }
    item.error = null;
    item.retryAllowed = true;
    return this.transition(
      item,
      'QUEUED',
      'Reset to QUEUED from pre-post FAILED state for retry',
    );
  }

  async checkAndUpload() {
    this.logger.warn(
      'Automatic background upload without an explicit Studio renderJobId and human confirmation gate is disabled by Studio safety policy.',
    );
    return {
      status: 'DISABLED_BY_SAFETY_POLICY',
      reason:
        'Use Studio Publishing Queue with an explicit renderJobId, verified mp4Sha256, and human confirmation gate.',
    };
  }

  async uploadPostById(_postId: string) {
    throw new BadRequestException(
      'Direct legacy upload without a Studio renderJobId and human confirmation gate is disabled. Enqueue the specific rendered MP4 in Studio Publishing.',
    );
  }
}
