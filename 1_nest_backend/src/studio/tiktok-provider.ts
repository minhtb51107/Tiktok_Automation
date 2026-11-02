import type { CreatorInfo } from './publishing.types';
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
}
