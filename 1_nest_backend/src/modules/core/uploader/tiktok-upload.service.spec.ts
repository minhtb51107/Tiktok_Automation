import { promises as fs } from 'fs';
import { afterEach, beforeEach, describe, expect, it } from '@jest/globals';
import * as os from 'os';
import * as path from 'path';
import type {
  BrowserConfirmResult,
  BrowserPrepareResult,
  BrowserUploadDriver,
} from './browser-upload-driver';
import { TiktokUploadService } from './tiktok-upload.service';

class FakeBrowserDriver implements BrowserUploadDriver {
  prepared: any[] = [];
  confirmed: string[] = [];
  closed: string[] = [];
  active = new Set<string>();
  prepareResult: BrowserPrepareResult = {
    status: 'READY',
    detail: 'synthetic visible form prepared',
    pagePath: 'https://www.tiktok.com/creator-center/upload',
  };
  confirmResult: BrowserConfirmResult = {
    status: 'PUBLISHED',
    detail: 'synthetic platform completion signal',
    pagePath: 'https://www.tiktok.com/creator-center/content',
  };
  async prepare(input: any) {
    this.prepared.push(input);
    this.active.add(input.jobId);
    return this.prepareResult;
  }
  async confirm(jobId: string) {
    this.confirmed.push(jobId);
    return this.confirmResult;
  }
  async close(jobId: string) {
    this.closed.push(jobId);
    this.active.delete(jobId);
  }
  has(jobId?: string) {
    return jobId ? this.active.has(jobId) : this.active.size > 0;
  }
}

describe('browser-assisted TikTok uploader', () => {
  let root: string;
  const oldPrepare = process.env.STUDIO_TIKTOK_BROWSER_ENABLED;
  const oldLive = process.env.STUDIO_TIKTOK_BROWSER_LIVE_ENABLED;
  const oldProfiles = process.env.STUDIO_TIKTOK_PROFILE_ROOT;

  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'studio-browser-upload-'));
    process.env.STUDIO_TIKTOK_BROWSER_ENABLED = '1';
    process.env.STUDIO_TIKTOK_PROFILE_ROOT = path.join(root, 'profiles');
    delete process.env.STUDIO_TIKTOK_BROWSER_LIVE_ENABLED;
  });

  afterEach(async () => {
    if (oldPrepare === undefined) delete process.env.STUDIO_TIKTOK_BROWSER_ENABLED;
    else process.env.STUDIO_TIKTOK_BROWSER_ENABLED = oldPrepare;
    if (oldLive === undefined) delete process.env.STUDIO_TIKTOK_BROWSER_LIVE_ENABLED;
    else process.env.STUDIO_TIKTOK_BROWSER_LIVE_ENABLED = oldLive;
    if (oldProfiles === undefined) delete process.env.STUDIO_TIKTOK_PROFILE_ROOT;
    else process.env.STUDIO_TIKTOK_PROFILE_ROOT = oldProfiles;
    await fs.rm(root, { recursive: true, force: true });
  });

  const queued = async (service: TiktokUploadService) => {
    const videoPath = path.join(root, 'exact-render.mp4');
    await fs.writeFile(videoPath, Buffer.from('synthetic-test-video'));
    return service.createQueueItem({
      sessionId: 'session',
      projectId: 'project',
      renderJobId: 'render-exact',
      renderMode: 'FINAL',
      videoPath,
      durationSeconds: 60,
      width: 720,
      height: 1280,
      accountId: 'browser:test',
      accountLabel: 'Test account',
      profileDirName: 'user-profile',
      caption: 'Exact caption',
      hashtags: ['threads'],
      mentions: [],
      privacy: 'USER_SELECTED_IN_TIKTOK',
      formattedCaption: 'Exact caption #threads',
    });
  };

  it('prepares the exact render and caption without clicking Post', async () => {
    const driver = new FakeBrowserDriver();
    const service = new TiktokUploadService(driver);
    const item = await queued(service);
    await service.prepareUpload(item, { launchBrowser: true });
    expect(item.state).toBe('READY_FOR_CONFIRMATION');
    expect(driver.prepared).toEqual([
      expect.objectContaining({
        jobId: item.id,
        videoPath: item.videoPath,
        formattedCaption: 'Exact caption #threads',
        profileDirName: 'user-profile',
      }),
    ]);
    expect(driver.confirmed).toEqual([]);
    expect((await fs.stat(item.videoPath)).isFile()).toBe(true);
    await service.closeBrowser(item);
    await service.prepareUpload(item, { launchBrowser: true });
    expect(driver.prepared).toHaveLength(2);
    expect(item.state).toBe('READY_FOR_CONFIRMATION');
  });

  it('pauses for visible login/challenge and resumes without inventing success', async () => {
    const driver = new FakeBrowserDriver();
    driver.prepareResult = {
      status: 'USER_ACTION_REQUIRED',
      detail: 'LOGIN_OR_CHALLENGE',
      pagePath: 'https://www.tiktok.com/login',
    };
    const service = new TiktokUploadService(driver);
    const item = await queued(service);
    await service.prepareUpload(item, { launchBrowser: true });
    expect(item.state).toBe('AWAITING_USER_ACTION');
    expect(item.postClicked).toBe(false);
    driver.prepareResult = {
      status: 'READY',
      detail: 'ready after user action',
      pagePath: 'https://www.tiktok.com/creator-center/upload',
    };
    await service.prepareUpload(item, { launchBrowser: true });
    expect(item.state).toBe('READY_FOR_CONFIRMATION');
  });

  it('persists a recognized upload-form failure without clicking Post', async () => {
    const driver = new FakeBrowserDriver();
    driver.prepareResult = {
      status: 'BLOCKED',
      detail: 'UPLOAD_FORM_UNRECOGNIZED',
      pagePath: 'https://www.tiktok.com/creator-center/upload',
    };
    const service = new TiktokUploadService(driver);
    const item = await queued(service);
    await service.prepareUpload(item, { launchBrowser: true });
    expect(item.state).toBe('FAILED');
    expect(item.error).toBe('UPLOAD_FORM_UNRECOGNIZED');
    expect(item.postClicked).toBe(false);
    expect(driver.confirmed).toEqual([]);
  });

  it('requires a separate LIVE gate and only publishes from a platform completion result', async () => {
    const driver = new FakeBrowserDriver();
    const service = new TiktokUploadService(driver);
    const item = await queued(service);
    await service.prepareUpload(item, { launchBrowser: true });
    await expect(
      service.confirmPublish(item, {
        confirmationToken: item.humanConfirmationToken!,
        action: 'POST_AND_VERIFY',
      }),
    ).rejects.toThrow('BROWSER_LIVE_POST_DISABLED');
    expect(driver.confirmed).toEqual([]);

    process.env.STUDIO_TIKTOK_BROWSER_LIVE_ENABLED = '1';
    await service.confirmPublish(item, {
      confirmationToken: item.humanConfirmationToken!,
      action: 'POST_AND_VERIFY',
    });
    expect(item.state).toBe('PUBLISHED');
    expect(driver.confirmed).toEqual([item.id]);
    expect(driver.closed).toEqual([item.id]);
    expect((await fs.stat(item.videoPath)).isFile()).toBe(true);
  });

  it('records UNKNOWN and blocks retry after an ambiguous platform outcome', async () => {
    const driver = new FakeBrowserDriver();
    driver.confirmResult = {
      status: 'UNKNOWN',
      detail: 'POST_OUTCOME_AMBIGUOUS',
      pagePath: 'https://www.tiktok.com/creator-center/upload',
    };
    const service = new TiktokUploadService(driver);
    const item = await queued(service);
    await service.prepareUpload(item, { launchBrowser: true });
    process.env.STUDIO_TIKTOK_BROWSER_LIVE_ENABLED = '1';
    await service.confirmPublish(item, {
      confirmationToken: item.humanConfirmationToken!,
      action: 'POST_AND_VERIFY',
    });
    expect(item.state).toBe('UNKNOWN');
    expect(item.retryAllowed).toBe(false);
    expect(() => service.retryQueueItem(item)).toThrow('RETRY_BLOCKED');
  });
});
