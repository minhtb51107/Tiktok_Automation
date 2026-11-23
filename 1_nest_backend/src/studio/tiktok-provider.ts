import type { CreatorInfo } from './publishing.types';
import { createReadStream } from 'fs';
import { Readable } from 'stream';
/** Fixed official endpoints only; no browser/cookie uploader and no automatic retries. */
export class TikTokProvider {
  constructor(private http: typeof fetch = fetch) {}
  async call(
    route: string,
    body: Record<string, string> | object,
    token?: string,
    form = false,
  ): Promise<any> {
    const allowed = [
      'oauth/token/',
      'oauth/revoke/',
      'user/info/',
      'post/publish/creator_info/query/',
      'post/publish/status/fetch/',
      'post/publish/video/init/',
      'post/publish/inbox/video/init/',
    ];
    const clean = route.split('?')[0];
    if (!allowed.includes(clean))
      throw Error('LIVE publication transfer is blocked in UI-06A');
    const r = await this.http('https://open.tiktokapis.com/v2/' + route, {
      method: clean === 'user/info/' ? 'GET' : 'POST',
      headers: {
        ...(token ? { Authorization: 'Bearer ' + token } : {}),
        'Content-Type': form
          ? 'application/x-www-form-urlencoded'
          : 'application/json',
      },
      body:
        clean === 'user/info/'
          ? undefined
          : form
            ? new URLSearchParams(body as Record<string, string>).toString()
            : JSON.stringify(body),
      signal: AbortSignal.timeout(15000),
      redirect: 'error',
    });
    const data = await r.json();
    if (
      !r.ok ||
      (data.error?.code && data.error.code !== 'ok') ||
      typeof data.error === 'string'
    )
      throw Error(
        'TikTok request failed: HTTP ' +
          r.status +
          '; reconnect/review official app permissions',
      );
    return data;
  }
  async token(code: string, redirect: string, verifier?: string) {
    return this.call(
      'oauth/token/',
      {
        client_key: process.env.TIKTOK_CLIENT_KEY || '',
        client_secret: process.env.TIKTOK_CLIENT_SECRET || '',
        grant_type: 'authorization_code',
        code,
        redirect_uri: redirect,
        ...(verifier ? { code_verifier: verifier } : {}),
      },
      undefined,
      true,
    );
  }
  async refresh(refreshToken: string) {
    return this.call(
      'oauth/token/',
      {
        client_key: process.env.TIKTOK_CLIENT_KEY || '',
        client_secret: process.env.TIKTOK_CLIENT_SECRET || '',
        grant_type: 'refresh_token',
        refresh_token: refreshToken,
      },
      undefined,
      true,
    );
  }
  async revoke(access: string) {
    await this.call(
      'oauth/revoke/',
      {
        client_key: process.env.TIKTOK_CLIENT_KEY || '',
        client_secret: process.env.TIKTOK_CLIENT_SECRET || '',
        token: access,
      },
      undefined,
      true,
    );
  }
  async profile(access: string) {
    const j = await this.call(
      'user/info/?fields=open_id,display_name,avatar_url',
      {},
      access,
    );
    return j.data.user;
  }
  async creator(access: string): Promise<CreatorInfo> {
    const j = await this.call('post/publish/creator_info/query/', {}, access);
    return { ...j.data, source: 'LIVE', checkedAt: new Date().toISOString() };
  }
  async status(access: string, publishId: string) {
    return this.call(
      'post/publish/status/fetch/',
      { publish_id: publishId },
      access,
    );
  }

  async initVideo(
    access: string,
    mode: 'DIRECT_POST' | 'INBOX_UPLOAD',
    sourceInfo: {
      source: 'FILE_UPLOAD';
      video_size: number;
      chunk_size: number;
      total_chunk_count: number;
    },
    postInfo?: Record<string, unknown>,
  ) {
    const route =
      mode === 'DIRECT_POST'
        ? 'post/publish/video/init/'
        : 'post/publish/inbox/video/init/';
    const j = await this.call(
      route,
      mode === 'DIRECT_POST'
        ? { post_info: postInfo, source_info: sourceInfo }
        : { source_info: sourceInfo },
      access,
    );
    if (!j.data?.publish_id || !j.data?.upload_url)
      throw Error('TikTok init response is missing publish/upload identity');
    return j.data as { publish_id: string; upload_url: string };
  }

  async uploadFile(uploadUrl: string, filePath: string, totalBytes: number) {
    const u = new URL(uploadUrl);
    if (
      u.protocol !== 'https:' ||
      !/(^|\.)open-upload\.tiktokapis\.com$/i.test(u.hostname)
    )
      throw Error('TikTok upload URL origin is not trusted');
    const body = Readable.toWeb(createReadStream(filePath));
    const r = await this.http(u.href, {
      method: 'PUT',
      headers: {
        'Content-Type': 'video/mp4',
        'Content-Length': String(totalBytes),
        'Content-Range': `bytes 0-${totalBytes - 1}/${totalBytes}`,
      },
      body,
      duplex: 'half',
      signal: AbortSignal.timeout(120000),
      redirect: 'error',
    } as RequestInit & { duplex: 'half' });
    if (!r.ok)
      throw Error(
        `TikTok media transfer failed: HTTP ${r.status}; verify status before retry`,
      );
  }
}
