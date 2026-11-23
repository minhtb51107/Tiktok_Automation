import {
  Injectable,
  BadRequestException,
  ConflictException,
} from '@nestjs/common';
import { promises as fs } from 'fs';
import * as path from 'path';
import { randomUUID, randomBytes, createHash, timingSafeEqual } from 'crypto';
import { StudioService } from './studio.service';
import { TokenVault } from './token-vault';
import { TikTokProvider } from './tiktok-provider';
import { replaceFile } from './atomic-file';
import {
  TiktokUploadService,
  type BrowserUploadQueueItem,
} from '../modules/core/uploader/tiktok-upload.service';
import {
  renderBackground,
  snapshotHash,
  renderValidation,
} from './render-policy';
import type {
  CreatorInfo,
  PublishingDraft,
  PublicationJob,
  TikTokAccount,
  PostingMode,
  ManualPublishingHandoff,
} from './publishing.types';
const digest = (v: string) => createHash('sha256').update(v).digest('hex');
const uuid = (id: string) => {
  if (!/^[a-f0-9-]{36}$/.test(id)) throw new BadRequestException('Invalid ID');
  return id;
};
function validateDraft(d: PublishingDraft) {
  if (
    !d ||
    !Number.isInteger(d.revision) ||
    !['LIVE', 'MOCK'].includes(d.execution) ||
    !['DIRECT_POST', 'INBOX_UPLOAD'].includes(d.mode) ||
    typeof d.accountId !== 'string' ||
    typeof d.renderJobId !== 'string' ||
    typeof d.privacy !== 'string' ||
    !['UNSET', 'YES', 'NO'].includes(d.aiDisclosure) ||
    !Number.isInteger(d.coverMs) ||
    d.coverMs < 0 ||
    [
      'allowComment',
      'allowDuet',
      'allowStitch',
      'ownBrand',
      'paidPartnership',
      'musicConsent',
      'contentConsent',
    ].some((k) => typeof d[k] !== 'boolean')
  )
    throw new BadRequestException('Invalid publishing draft');
}
export function requiredRights(
  s: any,
  p: any,
): { id: string; label: string }[] {
  const ids = new Map<string, string>();
  for (const i of s.items.filter((i) => i.selected))
    ids.set('source:' + i.id, i.author.handle || i.author.displayName);
  ids.set('model:KOKORO', 'Kokoro model / voice licensing');
  const add = (id?: string) => {
    if (id)
      ids.set(
        id,
        p?.mediaAssets
          ?.find((a) => a.id === id)
          ?.uri?.split('/')
          .pop() || id,
      );
  };
  for (const t of p?.timeline?.scenes || []) {
    for (const id of t.scene.mediaAssetIds) add(id);
    add(t.scene.visual?.backgroundId);
    add(t.scene.sfxLayer?.assetId);
    for (const id of t.scene.sfxAssetIds || []) add(id);
  }
  for (const b of p?.backgroundTracks || []) if (b.enabled) add(b.assetId);
  if (p?.backgroundMusic?.enabled) add(p.backgroundMusic.assetId);
  return [...ids].map(([id, label]) => ({ id, label }));
}
export function postingText(d: PublishingDraft) {
  if (
    typeof d.caption !== 'string' ||
    !Array.isArray(d.hashtags) ||
    !Array.isArray(d.mentions)
  )
    throw new BadRequestException('Invalid caption');
  if (
    d.hashtags.some(
      (s) => typeof s !== 'string' || !/^#?[\p{L}\p{N}_]+$/u.test(s),
    ) ||
    d.mentions.some((s) => typeof s !== 'string' || !/^@?[\w.]+$/.test(s))
  )
    throw new BadRequestException('Invalid hashtag/mention');
  const text = [
    d.caption.trim(),
    ...d.hashtags.map((s) => '#' + s.replace(/^#/, '')),
    ...d.mentions.map((s) => '@' + s.replace(/^@/, '')),
  ]
    .filter(Boolean)
    .join(' ');
  if (text.length > 2200)
    throw new BadRequestException('Caption exceeds 2200 UTF-16 units');
  return text;
}
export function creatorPostInfo(
  d: PublishingDraft,
  c: CreatorInfo,
  durationMs: number,
) {
  if (!c.privacy_level_options.includes(d.privacy))
    throw new BadRequestException('Choose privacy from current Creator Info');
  if (d.paidPartnership && d.privacy === 'SELF_ONLY')
    throw new BadRequestException('Branded content cannot be private');
  if (
    (c.comment_disabled && d.allowComment) ||
    (c.duet_disabled && d.allowDuet) ||
    (c.stitch_disabled && d.allowStitch)
  )
    throw new BadRequestException('Creator has disabled this interaction');
  if (!Number.isInteger(d.coverMs) || d.coverMs < 0 || d.coverMs >= durationMs)
    throw new BadRequestException('Cover timestamp is outside video');
  if (durationMs > c.max_video_post_duration_sec * 1000)
    throw new BadRequestException(
      'Video exceeds current Creator Info duration limit',
    );
  if (d.aiDisclosure === 'UNSET' || !d.musicConsent || !d.contentConsent)
    throw new BadRequestException(
      'Explicit disclosure and content/music consent required',
    );
  return {
    title: postingText(d),
    privacy_level: d.privacy,
    disable_comment: !d.allowComment,
    disable_duet: !d.allowDuet,
    disable_stitch: !d.allowStitch,
    video_cover_timestamp_ms: d.coverMs,
    brand_organic_toggle: d.ownBrand,
    brand_content_toggle: d.paidPartnership,
    is_aigc: d.aiDisclosure === 'YES',
  };
}
@Injectable()
export class PublishingService {
  private root = path.resolve(
    process.env.STUDIO_DATA_ROOT || '.studio-data',
    'publishing',
  );
  private liveAccounts =
    process.env.STUDIO_TIKTOK_LIVE_ENABLED === '1' &&
    process.env.STUDIO_TIKTOK_APP_APPROVED === '1';
  private provider = new TikTokProvider();
  private vault = new TokenVault(path.join(this.root, 'vault'));
  private uploader = new TiktokUploadService();
  private creators = new Map<string, CreatorInfo>();
  private lock: Promise<unknown> = Promise.resolve();
  constructor(private studio: StudioService) {}
  private async serial<T>(fn: () => Promise<T>): Promise<T> {
    const next = this.lock.catch(() => {}).then(fn);
    this.lock = next;
    return next;
  }
  private async read<T>(file: string, fallback: T): Promise<T> {
    try {
      return JSON.parse(await fs.readFile(path.join(this.root, file), 'utf8'));
    } catch (e: any) {
      if (e.code === 'ENOENT') return fallback;
      throw e;
    }
  }
  private async write(file: string, data: unknown) {
    const f = path.join(this.root, file);
    await fs.mkdir(path.dirname(f), { recursive: true });
    await fs.writeFile(f + '.tmp', JSON.stringify(data, null, 2), {
      mode: 0o600,
    });
    await replaceFile(f + '.tmp', f);
  }
  config() {
    const fields = [
      'TIKTOK_CLIENT_KEY',
      'TIKTOK_CLIENT_SECRET',
      'TIKTOK_REDIRECT_URI',
      'STUDIO_TOKEN_KEY',
    ];
    const configuration = Object.fromEntries(
      fields.map((k) => [k, !!process.env[k]]),
    );
    let redirectValid = false;
    try {
      const u = new URL(process.env.TIKTOK_REDIRECT_URI || '');
      redirectValid =
        u.protocol === 'https:' &&
        !u.search &&
        !u.hash &&
        !u.username &&
        !u.password &&
        u.pathname === '/api/studio/tiktok/oauth/callback';
    } catch {}
    return {
      configuration,
      redirectValid,
      vaultKeyValid:
        Buffer.from(process.env.STUDIO_TOKEN_KEY || '', 'base64').length === 32,
      oauthStatus:
        this.liveAccounts &&
        fields.every((k) => !!process.env[k]) &&
        Buffer.from(process.env.STUDIO_TOKEN_KEY || '', 'base64').length ===
          32 &&
        redirectValid
          ? 'CONFIGURED_NOT_LIVE_VERIFIED'
          : 'BLOCKED_AUTH',
      postingStatus: this.liveAccounts
        ? 'CONFIGURED_REQUIRES_PER_POST_CONFIRMATION'
        : 'BLOCKED_APP_APPROVAL',
      eligibility: this.liveAccounts
        ? 'OPERATOR_DECLARED_APPROVED_CONFIGURATION'
        : 'UNVERIFIED_INTENDED_USE',
      reasons: this.liveAccounts
        ? [
            'Backend operator enabled the separately reviewed LIVE/app-approval gates; every post still requires explicit Studio confirmation and platform status verification.',
          ]
        : [
            'No verified TikTok app/audit approval is recorded.',
            'Current internal utility/third-party Threads reuse requires intended-use eligibility review.',
          ],
      liveTransferEnabled: this.liveAccounts,
    };
  }
  async accounts() {
    return this.read<TikTokAccount[]>('accounts.json', []);
  }
  async createMock(body: any) {
    return this.serial(async () => {
      if (
        typeof body.nickname !== 'string' ||
        !body.nickname.trim() ||
        body.nickname.length > 80
      )
        throw new BadRequestException('Enter a test account name');
      const rows = await this.accounts(),
        now = new Date().toISOString();
      const a: TikTokAccount = {
        id: randomUUID(),
        mode: 'MOCK',
        nickname: body.nickname,
        username:
          typeof body.username === 'string' ? body.username.slice(0, 30) : null,
        avatarUrl: null,
        scopes: ['user.info.basic', 'video.upload', 'video.publish'],
        status: 'MOCK_CONNECTED',
        expiresAt: Date.now() + 86400000,
        updatedAt: now,
      };
      rows.push(a);
      await this.write('accounts.json', rows);
      return a;
    });
  }
  private async account(id: string) {
    const a = (await this.accounts()).find((a) => a.id === uuid(id));
    if (!a || a.status === 'DISCONNECTED')
      throw new BadRequestException('Account unavailable');
    return a;
  }
  async beginOAuth(body: any, browserOrigin: string) {
    if (!this.liveAccounts)
      throw new BadRequestException(
        'BLOCKED_AUTH: TikTok account connections are disabled in recovery mode',
      );
    if (this.config().oauthStatus === 'BLOCKED_AUTH')
      throw new BadRequestException(
        'BLOCKED_AUTH: client credentials, vault key and registered HTTPS callback required',
      );
    if (new URL(process.env.TIKTOK_REDIRECT_URI!).origin !== browserOrigin)
      throw new BadRequestException(
        'BLOCKED_AUTH: serve Studio on its registered HTTPS origin; no automatic tunnel/localhost redirect fallback',
      );
    await this.studio.load(uuid(body.sessionId));
    if (!['INBOX_UPLOAD', 'DIRECT_POST'].includes(body.mode))
      throw new BadRequestException('Choose posting mode');
    const state = randomBytes(32).toString('hex'),
      binding = randomBytes(32).toString('hex'),
      scope =
        'user.info.basic,' +
        (body.mode === 'DIRECT_POST' ? 'video.publish' : 'video.upload');
    await this.write('oauth/' + digest(state) + '.json', {
      sessionId: body.sessionId,
      browserHash: digest(binding),
      expires: Date.now() + 600000,
      scope,
    });
    const u = new URL('https://www.tiktok.com/v2/auth/authorize/');
    u.search = new URLSearchParams({
      client_key: process.env.TIKTOK_CLIENT_KEY!,
      scope,
      response_type: 'code',
      redirect_uri: process.env.TIKTOK_REDIRECT_URI!,
      state,
    }).toString();
    return { url: u.href, binding };
  }
  async callback(code: string, state: string, binding: string) {
    return this.serial(async () => {
      if (!this.liveAccounts)
        throw new BadRequestException('BLOCKED_AUTH: OAuth is disabled in recovery mode');
      if (
        !/^[a-f0-9]{64}$/.test(state || '') ||
        !/^[a-f0-9]{64}$/.test(binding || '')
      )
        throw new BadRequestException('Invalid OAuth state');
      const relative = 'oauth/' + digest(state) + '.json',
        pending: any = await this.read(relative, null);
      if (
        !pending ||
        pending.expires < Date.now() ||
        !timingSafeEqual(
          Buffer.from(pending.browserHash),
          Buffer.from(digest(binding)),
        )
      )
        throw new BadRequestException('Expired/mismatched OAuth state');
      await fs.unlink(path.join(this.root, relative)); // one-use even if the code exchange fails
      const token = await this.provider.token(
          code,
          process.env.TIKTOK_REDIRECT_URI!,
        ),
        profile = await this.provider.profile(token.access_token);
      if (
        !token.access_token ||
        !token.refresh_token ||
        !token.open_id ||
        profile.open_id !== token.open_id
      )
        throw Error('Invalid OAuth identity response');
      const rows = await this.accounts(),
        subjectHash = digest(
          (process.env.TIKTOK_CLIENT_KEY || '') + ':' + token.open_id,
        ),
        old = rows.find(
          (a) => a.mode === 'LIVE' && a.subjectHash === subjectHash,
        ),
        id = old?.id || randomUUID();
      const a: TikTokAccount = {
        id,
        mode: 'LIVE',
        subjectHash,
        nickname: profile.display_name || '',
        username: null,
        avatarUrl: profile.avatar_url || null,
        scopes: String(token.scope || '')
          .split(',')
          .filter(Boolean),
        status: 'CONNECTED',
        expiresAt: Date.now() + Number(token.expires_in) * 1000,
        updatedAt: new Date().toISOString(),
      };
      await this.vault.write(id, token);
      await this.write('accounts.json', [
        ...rows.filter((x) => x.id !== id),
        a,
      ]);
      return { accountId: id, sessionId: pending.sessionId };
    });
  }
  async accountAction(id: string, action: string) {
    return this.serial(async () => {
      const a = await this.account(id),
        rows = await this.accounts();
      if (!['refresh', 'disconnect'].includes(action))
        throw new BadRequestException('Unknown account action');
      if (a.mode === 'LIVE') {
        if (!this.liveAccounts)
          throw new BadRequestException(
            'BLOCKED_AUTH: account network access is disabled in recovery mode',
          );
        const old = await this.vault.read(id);
        if (action === 'disconnect') {
          await this.provider.revoke(old.access_token);
          await this.vault.remove(id);
        } else {
          const next = await this.provider.refresh(old.refresh_token);
          if (next.open_id && next.open_id !== old.open_id)
            throw Error('Refresh identity mismatch');
          await this.vault.write(id, {
            ...old,
            ...next,
            refresh_token: next.refresh_token || old.refresh_token,
          });
          a.expiresAt = Date.now() + Number(next.expires_in) * 1000;
          if (next.scope)
            a.scopes = String(next.scope).split(',').filter(Boolean);
        }
      }
      if (action === 'disconnect') a.status = 'DISCONNECTED';
      a.updatedAt = new Date().toISOString();
      await this.write(
        'accounts.json',
        rows.map((x) => (x.id === id ? a : x)),
      );
      this.creators.delete(id);
      return a;
    });
  }
  async creator(id: string) {
    const a = await this.account(id);
    let c: CreatorInfo;
    if (a.mode === 'MOCK')
      c = {
        source: 'MOCK',
        checkedAt: new Date().toISOString(),
        creator_username: a.username || 'MOCK',
        creator_nickname: a.nickname,
        creator_avatar_url: null,
        privacy_level_options: ['SELF_ONLY', 'PUBLIC_TO_EVERYONE'],
        comment_disabled: false,
        duet_disabled: true,
        stitch_disabled: true,
        max_video_post_duration_sec: 180,
      };
    else {
      if (!this.liveAccounts)
        throw new BadRequestException(
          'BLOCKED_AUTH: Creator Info LIVE is disabled in recovery mode',
        );
      if (!a.scopes.includes('video.publish'))
        throw new BadRequestException(
          'BLOCKED_SCOPE: Creator Info requires video.publish; inbox-only settings are completed in TikTok',
        );
      const t = await this.vault.read(id);
      if (a.expiresAt <= Date.now())
        throw new BadRequestException('BLOCKED_AUTH: refresh expired token');
      c = await this.provider.creator(t.access_token);
    }
    this.creators.set(id, c);
    return c;
  }
  async overview(sessionId: string) {
    const s = await this.studio.load(uuid(sessionId));
    let p: any = null;
    try {
      p = (await this.studio.preview(sessionId)).request.inputProps;
    } catch {}
    return {
      config: this.config(),
      accounts: await this.accounts(),
      draft: await this.read<PublishingDraft | null>(
        'drafts/' + sessionId + '.json',
        null,
      ),
      jobs: await this.read<PublicationJob[]>(
        'jobs/' + sessionId + '.json',
        [],
      ),
      uploadQueue: await this.read<BrowserUploadQueueItem[]>(
        'upload-queue/' + sessionId + '.json',
        [],
      ),
      manualHandoffs: (
        await this.read<(ManualPublishingHandoff & { videoPath?: string })[]>(
          'handoffs/' + sessionId + '.json',
          [],
        )
      ).map(({ videoPath: _legacyPath, ...row }) => ({
        ...row,
        downloadUrl:
          row.downloadUrl ||
          `/api/studio/sessions/${sessionId}/renders/${row.renderJobId}/video?download=1`,
      })),
      rights: s.mediaRights || {},
      requiredRights: requiredRights(s, p),
    };
  }
  async listUploadQueue(sessionId: string) {
    await this.studio.load(uuid(sessionId));
    return this.read<BrowserUploadQueueItem[]>(
      'upload-queue/' + sessionId + '.json',
      [],
    );
  }
  async enqueueBrowserUpload(
    sessionId: string,
    body: {
      renderJobId: string;
      accountId?: string;
      accountLabel?: string;
      profileDirName?: string;
      caption?: string;
      hashtags?: string[];
      mentions?: string[];
      privacy?: string;
      expectedSha256?: string;
    },
  ) {
    return this.serial(async () => {
      const s = await this.studio.load(uuid(sessionId));
      const renderJobId = uuid(body?.renderJobId || '');
      const manifest = await this.studio.renders.load(sessionId, renderJobId);
      if (manifest.status !== 'COMPLETED')
        throw new BadRequestException(
          'UPLOAD_REQUIRES_COMPLETED_RENDER: selected render job is not COMPLETED',
        );
      const videoPath = await this.studio.renders.output(
        sessionId,
        renderJobId,
      );
      const caption =
        typeof body.caption === 'string'
          ? body.caption.trim()
          : s.project.publishing?.caption || s.title;
      const hashtags = Array.isArray(body.hashtags)
        ? body.hashtags.map((h) => String(h).replace(/^#/, '').trim()).filter(Boolean)
        : s.project.publishing?.hashtags || [];
      const mentions = Array.isArray(body.mentions)
        ? body.mentions.map((m) => String(m).replace(/^@/, '').trim()).filter(Boolean)
        : [];
      const formattedCaption = postingText({
        revision: s.revision,
        accountId: body.accountId || 'browser-profile-serious',
        execution: 'MOCK',
        mode: 'DIRECT_POST',
        renderJobId,
        caption,
        hashtags,
        mentions,
        coverMs: 0,
        privacy: body.privacy || 'SELF_ONLY',
        allowComment: true,
        allowDuet: false,
        allowStitch: false,
        ownBrand: false,
        paidPartnership: false,
        aiDisclosure: 'YES',
        musicConsent: true,
        contentConsent: true,
      });
      const accounts = await this.accounts();
      const matchedAccount = accounts.find((a) => a.id === body.accountId);
      const accountId =
        matchedAccount?.id || body.accountId || 'browser-profile-serious';
      const accountLabel =
        matchedAccount?.nickname ||
        body.accountLabel ||
        'SERIOUS_CREATOR_PROFILE';
      const queue = await this.read<BrowserUploadQueueItem[]>(
        'upload-queue/' + sessionId + '.json',
        [],
      );
      const item = await this.uploader.createQueueItem({
        sessionId,
        projectId: s.project.id,
        renderJobId,
        renderMode: manifest.mode,
        videoPath,
        expectedSha256: body.expectedSha256,
        durationSeconds: manifest.expectedDurationSeconds,
        width: manifest.width,
        height: manifest.height,
        accountId,
        accountLabel,
        profileDirName: body.profileDirName,
        caption,
        hashtags,
        mentions,
        privacy: body.privacy || 'SELF_ONLY',
        formattedCaption,
      });
      queue.unshift(item);
      await this.write('upload-queue/' + sessionId + '.json', queue);
      return item;
    });
  }
  async prepareBrowserUpload(
    sessionId: string,
    uploadId: string,
    body: { launchBrowser?: boolean } = {},
  ) {
    return this.serial(async () => {
      await this.studio.load(uuid(sessionId));
      const queue = await this.read<BrowserUploadQueueItem[]>(
        'upload-queue/' + sessionId + '.json',
        [],
      );
      if (body?.launchBrowser === true)
        throw new BadRequestException(
          'BROWSER_AUTOMATION_DISABLED: use the official Content Posting API or prepare a manual handoff',
        );
      const item = queue.find((q) => q.id === uuid(uploadId));
      if (!item) throw new BadRequestException('Unknown browser upload job');
      await this.uploader.prepareUpload(item, {
        launchBrowser: false,
      });
      await this.write('upload-queue/' + sessionId + '.json', queue);
      return item;
    });
  }
  async confirmBrowserUpload(
    sessionId: string,
    uploadId: string,
    body: {
      confirmationToken: string;
      action?: 'VERIFY_GATE_ONLY' | 'MARK_PUBLISHED' | 'SIMULATE_AMBIGUOUS';
    },
  ) {
    return this.serial(async () => {
      await this.studio.load(uuid(sessionId));
      const queue = await this.read<BrowserUploadQueueItem[]>(
        'upload-queue/' + sessionId + '.json',
        [],
      );
      const item = queue.find((q) => q.id === uuid(uploadId));
      if (!item) throw new BadRequestException('Unknown browser upload job');
      if (body.action && body.action !== 'VERIFY_GATE_ONLY')
        throw new BadRequestException(
          'BROWSER_POST_DISABLED: Studio cannot mark a browser-assisted handoff as published',
        );
      await this.uploader.confirmPublish(item, {
        ...body,
        action: 'VERIFY_GATE_ONLY',
      });
      await this.write('upload-queue/' + sessionId + '.json', queue);
      return item;
    });
  }
  async retryBrowserUpload(sessionId: string, uploadId: string) {
    return this.serial(async () => {
      await this.studio.load(uuid(sessionId));
      const queue = await this.read<BrowserUploadQueueItem[]>(
        'upload-queue/' + sessionId + '.json',
        [],
      );
      const item = queue.find((q) => q.id === uuid(uploadId));
      if (!item) throw new BadRequestException('Unknown browser upload job');
      this.uploader.retryQueueItem(item);
      await this.write('upload-queue/' + sessionId + '.json', queue);
      return item;
    });
  }

  async prepareManualHandoff(sessionId: string, d: PublishingDraft) {
    return this.serial(async () => {
      const validation = await this.validate(sessionId, d);
      if (!validation.ready)
        return { ...validation, status: 'BLOCKED' as const };
      const s = await this.studio.load(uuid(sessionId));
      const account = await this.account(d.accountId);
      const videoPath = await this.studio.renders.output(
        sessionId,
        uuid(d.renderJobId),
      );
      const artifact = await this.uploader.verifyRenderFile(videoPath);
      const requestHash = snapshotHash({
        sessionId,
        draft: d,
        sha256: artifact.sha256,
      });
      const rows = await this.read<ManualPublishingHandoff[]>(
        'handoffs/' + sessionId + '.json',
        [],
      );
      const existing = rows.find((row) => row.requestHash === requestHash);
      if (existing) return existing;
      const handoff: ManualPublishingHandoff = {
        id: randomUUID(),
        sessionId,
        renderJobId: d.renderJobId,
        accountId: d.accountId,
        accountLabel: account.nickname,
        createdAt: new Date().toISOString(),
        requestHash,
        downloadUrl: `/api/studio/sessions/${sessionId}/renders/${d.renderJobId}/video?download=1`,
        artifactSha256: artifact.sha256,
        artifactBytes: artifact.bytes,
        formattedCaption: postingText(d),
        coverMs: d.coverMs,
        status: 'READY_FOR_MANUAL_HANDOFF',
        warnings: [
          'Manual handoff only: no TikTok request was sent.',
          'Complete account selection, rights checks and platform confirmation manually; Studio does not infer PUBLISHED.',
          `Source session ${s.id} and retained render ${d.renderJobId} remain unchanged.`,
        ],
      };
      rows.unshift(handoff);
      await this.write('handoffs/' + sessionId + '.json', rows);
      return handoff;
    });
  }
  async saveDraft(sessionId: string, d: PublishingDraft) {
    validateDraft(d);
    const s = await this.studio.load(uuid(sessionId));
    if (s.revision !== d.revision)
      throw new ConflictException('Session changed');
    postingText(d);
    return this.serial(async () => {
      await this.write('drafts/' + sessionId + '.json', d);
      return d;
    });
  }
  async rights(sessionId: string, body: any) {
    return this.studio.saveRights(sessionId, body);
  }
  async validate(sessionId: string, d: PublishingDraft) {
    validateDraft(d);
    const s = await this.studio.load(uuid(sessionId)),
      errors: string[] = [],
      warnings: string[] = [];
    postingText(d);
    const a = (await this.accounts()).find(
      (a) =>
        a.id === d.accountId &&
        a.status !== 'DISCONNECTED' &&
        a.mode === d.execution,
    );
    if (!a)
      errors.push(
        'BLOCKED_AUTH: select a connected account in the matching LIVE/MOCK mode',
      );
    if (d.execution === 'LIVE' && !this.liveAccounts)
      errors.push(
        'BLOCKED_APP_APPROVAL: live transfer is disabled pending verified app eligibility/approval',
      );
    if (s.revision !== d.revision) errors.push('STALE_REVISION');
    let m: any = null;
    try {
      m = await this.studio.renders.load(sessionId, uuid(d.renderJobId));
    } catch {
      errors.push('BLOCKED_FINAL: choose a retained render');
    }
    if (m) {
      if (m.status !== 'COMPLETED' || m.mode !== 'FINAL')
        errors.push('BLOCKED_FINAL: DRAFT/failed outputs cannot be submitted');
      const p = renderBackground(
        (await this.studio.preview(sessionId)).request.inputProps,
        m.backgroundMode,
      );
      if (m.previewHash !== snapshotHash(p))
        errors.push('STALE_RENDER: timeline/assets/settings changed');
      if (renderValidation(s, p).finalBlockers.length)
        errors.push('BLOCKED_APPROVAL: current spoken/audio review required');
      for (const { id } of requiredRights(s, p))
        if (
          !s.mediaRights?.[id] ||
          s.mediaRights[id].status === 'UNKNOWN' ||
          !s.mediaRights[id].evidence.trim()
        )
          errors.push('BLOCKED_RIGHTS: ' + id);
      if (d.mode === 'DIRECT_POST') {
        const c = a ? this.creators.get(a.id) : null;
        if (!c || Date.now() - Date.parse(c.checkedAt) > 120000)
          errors.push('BLOCKED_CREATOR_INFO: load latest creator info');
        else
          try {
            creatorPostInfo(d, c, m.expectedDurationSeconds * 1000);
          } catch (e) {
            errors.push((e as Error).message);
          }
      } else
        warnings.push(
          'INBOX_UPLOAD sends only the video. Caption/cover/privacy/disclosures must be completed in TikTok; no post settings are claimed as applied.',
        );
    }
    if (
      a &&
      !a.scopes.includes(
        d.mode === 'DIRECT_POST' ? 'video.publish' : 'video.upload',
      )
    )
      errors.push('BLOCKED_SCOPE');
    if (d.aiDisclosure === 'UNSET' || !d.musicConsent || !d.contentConsent)
      errors.push(
        'BLOCKED_CONSENT: explicitly review disclosures/content/music',
      );
    return {
      ready: errors.length === 0,
      errors,
      warnings,
      execution: d.execution,
      mode: d.mode,
      render: m
        ? {
            jobId: m.jobId,
            mode: m.mode,
            width: m.width,
            height: m.height,
            duration: m.expectedDurationSeconds,
            hash: m.previewHash,
          }
        : null,
    };
  }
  async consent(sessionId: string, d: PublishingDraft) {
    const validation = await this.validate(sessionId, d);
    if (!validation.ready)
      return { ...validation, receipt: null, confirmation: null };
    const receipt = randomBytes(32).toString('hex');
    await this.write('consent/' + digest(receipt) + '.json', {
      sessionId,
      hash: snapshotHash(d),
      expires: Date.now() + 30000,
    });
    return {
      ...validation,
      receipt,
      confirmation: `SEND ${d.mode} TO ${d.accountId}`,
    };
  }
  async submit(sessionId: string, body: any) {
    return this.serial(async () => {
      const d = body.draft as PublishingDraft,
        validation = await this.validate(sessionId, d);
      if (!validation.ready)
        return {
          ...validation,
          status: validation.errors[0]?.split(':')[0] || 'BLOCKED',
        };
      const rows = await this.read<PublicationJob[]>(
          'jobs/' + sessionId + '.json',
          [],
        ),
        requestHash = snapshotHash({ ...d, revision: undefined }),
        old = rows.find((j) => j.requestHash === requestHash);
      if (old) return old;
      const receipt = String(body.receipt || '');
      if (!/^[a-f0-9]{64}$/.test(receipt))
        throw new BadRequestException('Explicit per-attempt consent required');
      const file = 'consent/' + digest(receipt) + '.json',
        c: any = await this.read(file, null);
      if (
        !c ||
        c.sessionId !== sessionId ||
        c.hash !== snapshotHash(d) ||
        c.expires < Date.now() ||
        body.confirmation !== `SEND ${d.mode} TO ${d.accountId}`
      )
        throw new BadRequestException('Consent expired or changed');
      await fs.unlink(path.join(this.root, file));
      if (d.execution === 'LIVE') {
        const renderPath = await this.studio.renders.output(
          sessionId,
          uuid(d.renderJobId),
        );
        const artifact = await this.uploader.verifyRenderFile(renderPath);
        const account = await this.account(d.accountId);
        const token = await this.vault.read(account.id);
        const job: PublicationJob = {
          id: randomUUID(), sessionId, accountId: d.accountId, mode: d.mode,
          execution: 'LIVE', renderJobId: d.renderJobId, status: 'UPLOADING',
          stage: 'INITIALIZING', createdAt: new Date().toISOString(),
          completedAt: null, errors: [], warnings: [], publishId: null,
          uploadedBytes: 0, totalBytes: artifact.bytes, requestHash, draft: d,
          artifactSha256: artifact.sha256, artifactBytes: artifact.bytes,
          lastCheckedAt: null, platformStatus: null, platformPostIds: [],
        };
        rows.unshift(job);
        await this.write('jobs/' + sessionId + '.json', rows);
        try {
          const creator = this.creators.get(account.id);
          const postInfo = d.mode === 'DIRECT_POST' && creator
            ? creatorPostInfo(d, creator, validation.render!.duration * 1000)
            : undefined;
          const init = await this.provider.initVideo(
            token.access_token,
            d.mode,
            {
              source: 'FILE_UPLOAD',
              video_size: artifact.bytes,
              chunk_size: artifact.bytes,
              total_chunk_count: 1,
            },
            postInfo,
          );
          job.publishId = init.publish_id;
          job.stage = 'TRANSFERRING';
          await this.write('jobs/' + sessionId + '.json', rows);
          await this.provider.uploadFile(init.upload_url, renderPath, artifact.bytes);
          job.uploadedBytes = artifact.bytes;
          job.stage = 'VERIFYING_PLATFORM_STATUS';
          job.status = 'UPLOADING';
          await this.write('jobs/' + sessionId + '.json', rows);
          return job;
        } catch (error) {
          job.errors.push(error instanceof Error ? error.message : String(error));
          job.completedAt = new Date().toISOString();
          job.status = job.publishId ? 'UNKNOWN' : 'FAILED';
          job.stage = job.publishId
            ? 'VERIFY_PLATFORM_BEFORE_RETRY'
            : 'INITIALIZATION_FAILED';
          await this.write('jobs/' + sessionId + '.json', rows);
          return job;
        }
      }
      const j: PublicationJob = {
        id: randomUUID(),
        sessionId,
        accountId: d.accountId,
        mode: d.mode,
        execution: 'MOCK',
        renderJobId: d.renderJobId,
        status: 'MOCK_COMPLETED',
        stage:
          d.mode === 'INBOX_UPLOAD'
            ? 'SIMULATED_SEND_TO_USER_INBOX'
            : 'SIMULATED_PUBLISH_COMPLETE',
        createdAt: new Date().toISOString(),
        completedAt: new Date().toISOString(),
        errors: [],
        warnings: ['MOCK ONLY: zero bytes sent to TikTok'],
        publishId: 'mock-' + randomUUID(),
        uploadedBytes: null,
        totalBytes: null,
        requestHash,
        draft: d,
      };
      rows.unshift(j);
      await this.write('jobs/' + sessionId + '.json', rows);
      return j;
    });
  }
  async status(sessionId: string, id: string) {
    return this.serial(async () => {
      const rows = await this.read<PublicationJob[]>(
        'jobs/' + uuid(sessionId) + '.json',
        [],
      ),
        j = rows.find((j) => j.id === uuid(id));
      if (!j) throw new BadRequestException('Unknown publication job');
      if (j.execution === 'MOCK') return j;
      if (!this.liveAccounts)
        throw new BadRequestException(
          'BLOCKED_AUTH: LIVE status access is disabled in recovery mode',
        );
      if (!j.publishId) return j;
      try {
        const a = await this.account(j.accountId),
          t = await this.vault.read(a.id),
          response = await this.provider.status(t.access_token, j.publishId),
          data = response.data || {};
        j.lastCheckedAt = new Date().toISOString();
        j.platformStatus = String(data.status || 'UNKNOWN');
        j.uploadedBytes = Number.isFinite(Number(data.uploaded_bytes))
          ? Number(data.uploaded_bytes)
          : j.uploadedBytes;
        j.platformPostIds = Array.isArray(data.publicaly_available_post_id)
          ? data.publicaly_available_post_id.map(String)
          : j.platformPostIds || [];
        if (j.platformStatus === 'PUBLISH_COMPLETE') {
          j.status = 'PUBLISHED';
          j.stage = 'PLATFORM_CONFIRMED';
          j.completedAt = j.lastCheckedAt;
        } else if (j.platformStatus === 'FAILED') {
          j.status = 'FAILED';
          j.stage = 'PLATFORM_REJECTED';
          j.completedAt = j.lastCheckedAt;
          if (data.fail_reason) j.errors.push(String(data.fail_reason));
        } else {
          j.status = 'UPLOADING';
          j.stage =
            j.platformStatus === 'SEND_TO_USER_INBOX'
              ? 'WAITING_FOR_USER_IN_TIKTOK'
              : 'PLATFORM_PROCESSING';
        }
      } catch (error) {
        j.status = 'UNKNOWN';
        j.stage = 'STATUS_CHECK_FAILED_VERIFY_BEFORE_RETRY';
        j.lastCheckedAt = new Date().toISOString();
        j.errors.push(error instanceof Error ? error.message : String(error));
      }
      await this.write('jobs/' + sessionId + '.json', rows);
      return j;
    });
  }
}
