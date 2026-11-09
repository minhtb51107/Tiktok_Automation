import { describe, it, expect, jest, afterEach } from '@jest/globals';
import { promises as fs } from 'fs';
import * as os from 'os';
import * as path from 'path';
import { randomUUID, randomBytes } from 'crypto';
import { TokenVault } from './token-vault';
import { TikTokProvider } from './tiktok-provider';
import {
  PublishingService,
  postingText,
  creatorPostInfo,
  requiredRights,
} from './publishing.service';
import { snapshotHash } from './render-policy';
import { textHash } from './kokoro-runtime';
import type { PublishingDraft, CreatorInfo } from './publishing.types';
const dirs: string[] = [];
async function temp() {
  const d = await fs.mkdtemp(path.join(os.tmpdir(), 'studio-publish-test-'));
  dirs.push(d);
  return d;
}
afterEach(async () => {
  for (const d of dirs.splice(0))
    await fs.rm(d, { recursive: true, force: true });
  jest.restoreAllMocks();
});
const draft = (revision = 1): PublishingDraft => ({
  revision,
  accountId: '',
  renderJobId: randomUUID(),
  execution: 'MOCK',
  mode: 'DIRECT_POST',
  caption: 'Một câu chuyện',
  hashtags: ['chuyencuocsong'],
  mentions: ['example'],
  coverMs: 0,
  privacy: 'SELF_ONLY',
  allowComment: false,
  allowDuet: false,
  allowStitch: false,
  ownBrand: false,
  paidPartnership: false,
  aiDisclosure: 'YES',
  contentConsent: true,
  musicConsent: true,
});
const creator: CreatorInfo = {
  source: 'MOCK',
  checkedAt: new Date().toISOString(),
  creator_username: 'example',
  creator_nickname: 'Example',
  creator_avatar_url: null,
  privacy_level_options: ['SELF_ONLY', 'PUBLIC_TO_EVERYONE'],
  comment_disabled: false,
  duet_disabled: true,
  stitch_disabled: true,
  max_video_post_duration_sec: 180,
};
async function fixture() {
  const itemId = randomUUID(),
    audioId = randomUUID(),
    sid = randomUUID(),
    text = 'Nội dung đã duyệt trong test offline';
  const p: any = {
    timeline: {
      totalFrames: 90,
      fps: 30,
      scenes: [
        { scene: { id: itemId, mediaAssetIds: [], audioAssetId: audioId } },
      ],
    },
    mediaAssets: [],
    backgroundTracks: [],
  };
  const s: any = {
    id: sid,
    revision: 1,
    items: [
      {
        id: itemId,
        selected: true,
        author: { handle: 'offline' },
        spokenText: text,
        voiceSettings: { voice: 'my_yen', speed: 1.2 },
        spokenApproval: { valid: true, textHash: textHash(text) },
      },
    ],
    voiceAssets: [
      {
        id: audioId,
        itemId,
        spokenText: text,
        textHash: textHash(text),
        voice: 'my_yen',
        speed: 1.2,
        status: 'APPROVED',
        approvedAt: new Date().toISOString(),
      },
    ],
    mediaRights: {},
  };
  for (const { id } of requiredRights(s, p))
    s.mediaRights[id] = {
      status: 'PERMISSION',
      evidence: 'SYNTHETIC TEST DECLARATION — not real permission',
    };
  const manifest: any = {
    mode: 'FINAL',
    status: 'COMPLETED',
    previewHash: snapshotHash(p),
    expectedDurationSeconds: 3,
    jobId: randomUUID(),
    width: 1080,
    height: 1920,
  };
  const studio: any = {
    load: async () => s,
    preview: async () => ({ request: { inputProps: p } }),
    renders: { load: async () => manifest },
  };
  const service = new PublishingService(studio);
  (service as any).root = await temp();
  const a = await service.createMock({ nickname: 'Offline test account' }),
    d = { ...draft(), accountId: a.id, renderJobId: manifest.jobId };
  await service.creator(a.id);
  return { service, s, p, d, sid, manifest, a };
}
describe('Publishing foundation — OFFLINE / MOCK only', () => {
  it('builds official direct-post fields without enabling creator-disabled options', () => {
    expect(postingText(draft())).toBe(
      'Một câu chuyện #chuyencuocsong @example',
    );
    expect(creatorPostInfo(draft(), creator, 3000)).toMatchObject({
      privacy_level: 'SELF_ONLY',
      disable_duet: true,
      is_aigc: true,
      video_cover_timestamp_ms: 0,
    });
    expect(() =>
      creatorPostInfo({ ...draft(), privacy: '' }, creator, 3000),
    ).toThrow();
    expect(() =>
      creatorPostInfo({ ...draft(), paidPartnership: true }, creator, 3000),
    ).toThrow();
    expect(() =>
      creatorPostInfo({ ...draft(), allowDuet: true }, creator, 3000),
    ).toThrow();
    expect(() =>
      creatorPostInfo({ ...draft(), coverMs: 3000 }, creator, 3000),
    ).toThrow();
    expect(() =>
      postingText({ ...draft(), caption: 'x'.repeat(2201) }),
    ).toThrow();
  });
  it('encrypts tokens with account-bound authenticated encryption; key stays external', async () => {
    const dir = await temp(),
      key = randomBytes(32).toString('base64'),
      v = new TokenVault(dir, key),
      a = randomUUID(),
      b = randomUUID();
    const secret = 'synthetic-unit-token';
    await v.write(a, { access_token: secret });
    expect(
      (await fs.readFile(path.join(dir, a + '.json'), 'utf8')).includes(secret),
    ).toBe(false);
    expect(await v.read(a)).toEqual({ access_token: secret });
    await fs.copyFile(path.join(dir, a + '.json'), path.join(dir, b + '.json'));
    await expect(v.read(b)).rejects.toThrow('BLOCKED_AUTH');
    await expect(new TokenVault(dir, '').write(a, {})).rejects.toThrow(
      'BLOCKED_AUTH',
    );
  });
  it('provider has no LIVE upload/init route and redacts error bodies', async () => {
    const http = jest.fn(async () => ({
      ok: false,
      status: 401,
      json: async () => ({
        error: { code: 'invalid_token', message: 'synthetic-secret' },
      }),
    })) as any;
    const p = new TikTokProvider(http);
    await expect(p.call('post/publish/video/init/', {})).rejects.toThrow(
      'blocked',
    );
    expect(http).not.toHaveBeenCalled();
    await expect(p.creator('synthetic')).rejects.toThrow('HTTP 401');
    try {
      await p.creator('synthetic');
    } catch (e) {
      expect((e as Error).message).not.toContain('synthetic-secret');
    }
  });
  it('rechecks FINAL, approvals, rights, revision and timeline hash', async () => {
    const { service, s, p, d, sid, manifest } = await fixture();
    expect((await service.validate(sid, d)).ready).toBe(true);
    manifest.mode = 'DRAFT';
    expect((await service.validate(sid, d)).errors.join()).toContain(
      'BLOCKED_FINAL',
    );
    manifest.mode = 'FINAL';
    delete s.mediaRights['model:KOKORO'];
    expect((await service.validate(sid, d)).errors.join()).toContain(
      'BLOCKED_RIGHTS',
    );
    s.voiceAssets[0].status = 'READY';
    expect((await service.validate(sid, d)).errors.join()).toContain(
      'BLOCKED_APPROVAL',
    );
    p.timeline.totalFrames = 91;
    expect((await service.validate(sid, d)).errors.join()).toContain(
      'STALE_RENDER',
    );
    expect(
      (await service.validate(sid, { ...d, revision: 0 })).errors,
    ).toContain('STALE_REVISION');
  });
  it('MOCK consent is bound to exact payload and stores explicit simulation, never sends bytes', async () => {
    const { service, d, sid } = await fixture(),
      c = await service.consent(sid, d);
    await expect(
      service.submit(sid, {
        draft: { ...d, caption: 'Changed' },
        receipt: c.receipt,
        confirmation: c.confirmation,
      }),
    ).rejects.toThrow('Consent');
    const j = await service.submit(sid, {
      draft: d,
      receipt: c.receipt,
      confirmation: c.confirmation,
    });
    expect(j.status).toBe('MOCK_COMPLETED');
    expect((j as any).uploadedBytes).toBeNull();
    expect(
      await service.submit(sid, {
        draft: d,
        receipt: c.receipt,
        confirmation: c.confirmation,
      }),
    ).toEqual(j);
    expect((await service.overview(sid)).jobs).toHaveLength(1);
    expect(await service.status(sid, (j as any).id)).toEqual(j);
  });
  it('LIVE stays blocked even with a simulated connected account and rights', async () => {
    const { service, d, sid, a } = await fixture();
    await expect(service.beginOAuth({sessionId:sid,mode:'DIRECT_POST'},'http://127.0.0.1:3000')).rejects.toThrow('BLOCKED_AUTH');
    await expect(service.callback('synthetic-code','0'.repeat(64),'1'.repeat(64))).rejects.toThrow('BLOCKED_AUTH');
    (service as any).accounts = async () => [
      { ...a, mode: 'LIVE', status: 'CONNECTED' },
    ];
    const v = await service.validate(sid, { ...d, execution: 'LIVE' });
    expect(v.errors.join()).toContain('BLOCKED_APP_APPROVAL');
    expect(
      (await service.consent(sid, { ...d, execution: 'LIVE' })).receipt,
    ).toBeNull();
  });
  it('requires fresh Creator Info and isolates inbox-only settings', async () => {
    const { service, d, sid, a } = await fixture();
    (service as any).creators.clear();
    expect((await service.validate(sid, d)).errors.join()).toContain(
      'BLOCKED_CREATOR_INFO',
    );
    const v = await service.validate(sid, {
      ...d,
      mode: 'INBOX_UPLOAD',
      privacy: '',
    });
    expect(v.ready).toBe(true);
    expect(v.warnings.join()).toContain('only the video');
    await service.accountAction(a.id, 'disconnect');
    expect((await service.validate(sid, d)).errors.join()).toContain(
      'BLOCKED_AUTH',
    );
  });
  it('rejects missing confirmation, malformed drafts and stale saves', async () => {
    const { service, d, sid } = await fixture();
    await expect(service.submit(sid, { draft: d })).rejects.toThrow('consent');
    await expect(service.saveDraft(sid, { ...d, revision: 0 })).rejects.toThrow(
      'Session changed',
    );
    await expect(
      service.validate(sid, { ...d, musicConsent: undefined } as any),
    ).rejects.toThrow('Invalid publishing');
    await service.saveDraft(sid, d);
    expect((await service.overview(sid)).draft).toEqual(d);
  });
  it('OAuth state is browser-bound, one-use and expires; no real provider is called', async () => {
    const { service, sid } = await fixture(),
      names = [
        'TIKTOK_CLIENT_KEY',
        'TIKTOK_CLIENT_SECRET',
        'STUDIO_TOKEN_KEY',
        'TIKTOK_REDIRECT_URI',
      ],
      old = Object.fromEntries(names.map((k) => [k, process.env[k]]));
    try {
      process.env.TIKTOK_CLIENT_KEY = 'synthetic-client';
      process.env.TIKTOK_CLIENT_SECRET = 'synthetic-client-secret';
      process.env.STUDIO_TOKEN_KEY = randomBytes(32).toString('base64');
      process.env.TIKTOK_REDIRECT_URI =
        'https://studio.example/api/studio/tiktok/oauth/callback';
      (service as any).vault = new TokenVault(
        path.join((service as any).root, 'vault'),
        process.env.STUDIO_TOKEN_KEY,
      );
      (service as any).liveAccounts = true; // synthetic provider only
      const token = {
        access_token: 'synthetic-access',
        refresh_token: 'synthetic-refresh',
        open_id: 'synthetic-openid',
        expires_in: 86400,
        scope: 'user.info.basic,video.publish',
      };
      (service as any).provider = {
        token: async () => token,
        profile: async () => ({
          open_id: token.open_id,
          display_name: 'MOCK OAuth identity',
        }),
      };
      await expect(
        service.beginOAuth(
          { sessionId: sid, mode: 'DIRECT_POST' },
          'http://127.0.0.1:3000',
        ),
      ).rejects.toThrow('registered HTTPS');
      const out = await service.beginOAuth(
          { sessionId: sid, mode: 'DIRECT_POST' },
          'https://studio.example',
        ),
        state = new URL(out.url).searchParams.get('state')!;
      await expect(
        service.callback('synthetic-code', state, '0'.repeat(64)),
      ).rejects.toThrow('mismatched');
      const result = await service.callback(
        'synthetic-code',
        state,
        out.binding,
      );
      expect(result.sessionId).toBe(sid);
      const accounts = await service.accounts();
      expect(JSON.stringify(accounts)).not.toContain('synthetic-access');
      expect(JSON.stringify(accounts)).not.toContain('synthetic-openid');
      await expect(
        service.callback('synthetic-code', state, out.binding),
      ).rejects.toThrow('Expired');
      const next = await service.beginOAuth(
          { sessionId: sid, mode: 'DIRECT_POST' },
          'https://studio.example',
        ),
        files = await fs.readdir(path.join((service as any).root, 'oauth'));
      const pendingFile = path.join((service as any).root, 'oauth', files[0]),
        pending = JSON.parse(await fs.readFile(pendingFile, 'utf8'));
      pending.expires = 0;
      await fs.writeFile(pendingFile, JSON.stringify(pending));
      await expect(
        service.callback(
          'synthetic-code',
          new URL(next.url).searchParams.get('state')!,
          next.binding,
        ),
      ).rejects.toThrow('Expired');
    } finally {
      for (const k of names)
        if (old[k] === undefined) delete process.env[k];
        else process.env[k] = old[k];
    }
  });
});
