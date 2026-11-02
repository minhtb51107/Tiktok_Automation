import { describe, it, expect, jest, afterEach } from '@jest/globals';
import { promises as fs } from 'fs';
import * as os from 'os';
import * as path from 'path';
import { ThreadsAuth } from './auth';
import { ThreadsProvider, ThreadsApiError } from './provider';
import { ThreadsStore } from './local-store';
import { redirectUrl, pilotInput, DEFAULT_PILOT } from './config';
const roots: string[] = [];
const secret = 'synthetic-test-app-secret',
  token = 'synthetic-test-user-token',
  now = Date.parse('2026-11-03T00:00:00Z');
const config = () => ({
  appId: '123456789',
  appSecret: secret,
  accessToken: token,
  redirectUri:
    'https://threads-studio.test:3443/api/studio/threads/oauth/callback',
});
async function fixture(http?: any) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'threads-auth-test-'));
  roots.push(root);
  const cfg = config(),
    calls: any[] = [];
  const fetcher =
    http ||
    (async (url: string, init: any) => {
      calls.push({ url, init });
      const route = new URL(url).pathname;
      if (route.endsWith('/debug_token'))
        return Response.json({
          data: {
            is_valid: true,
            app_id: cfg.appId,
            user_id: 'test-user',
            expires_at: now / 1000 + 3600,
            scopes: ['threads_basic', 'threads_keyword_search'],
          },
        });
      if (route.endsWith('/me'))
        return Response.json({
          id: 'test-user',
          username: 'SYNTHETIC_TEST_DATA',
        });
      if (route.endsWith('/oauth/access_token'))
        return Response.json({
          access_token: 'synthetic-short-token',
          user_id: 'test-user',
        });
      if (route.endsWith('/access_token'))
        return Response.json({ access_token: token, expires_in: 5184000 });
      throw Error('Unexpected request');
    });
  return {
    root,
    cfg,
    calls,
    auth: new ThreadsAuth(
      new ThreadsStore(root),
      new ThreadsProvider(fetcher as any),
      () => cfg,
      () => now,
    ),
  };
}
afterEach(async () => {
  jest.restoreAllMocks();
  for (const r of roots.splice(0)) {
    if (
      !path.resolve(r).startsWith(path.resolve(os.tmpdir()) + path.sep) ||
      !path.basename(r).startsWith('threads-auth-test-')
    )
      throw Error('Unsafe test cleanup');
    await fs.rm(r, { recursive: true, force: true });
  }
});
describe('Threads OAuth / provider — MOCK ONLY, SYNTHETIC TEST DATA', () => {
  it('requires an encrypted exchange receipt when actual Threads introspection omits app_id', async () => {
    const f = await fixture();
    const debug = {
      data: {
        is_valid: true,
        user_id: 'test-user',
        expires_at: now / 1000 + 3600,
        scopes: ['threads_basic', 'threads_keyword_search'],
      },
    };
    jest.spyOn(f.auth.provider, 'debug').mockResolvedValue(debug);
    expect((await f.auth.verify()).status).toBe('BLOCKED_AUTH'); // arbitrary ENV token: no proof
    f.cfg.accessToken = '';
    const b = await f.auth.begin('threads-studio.test:3443'),
      state = new URL(b.url).searchParams.get('state')!;
    expect(
      (await f.auth.callback('synthetic-code', state, b.binding)).status,
    ).toBe('READY');
    expect(await f.auth.status()).toMatchObject({
      appBindingVerified: true,
      appBindingMethod: 'OAUTH_EXCHANGE_RECEIPT',
      config: { oauthStatus: 'AUTHORIZED' },
    });
    jest
      .spyOn(f.auth.provider, 'debug')
      .mockResolvedValue({ data: { ...debug.data, app_id: 'different-app' } });
    expect((await f.auth.verify()).status).toBe('BLOCKED_AUTH'); // explicit mismatch never falls back
  });
  it.each(['numeric', 'string', 'absent', 'null'])(
    'handles %s user_id without treating it as the verification authority',
    async (kind) => {
      const f = await fixture();
      f.cfg.accessToken = '';
      jest.spyOn(f.auth.provider, 'exchange').mockResolvedValue({
        access_token: 'synthetic-short-token',
        ...(kind === 'absent'
          ? {}
          : {
              user_id:
                kind === 'null'
                  ? null
                  : kind === 'numeric'
                    ? 1234567890123456
                    : '1234567890123456',
            }),
      });
      const begin = await f.auth.begin('threads-studio.test:3443'),
        state = new URL(begin.url).searchParams.get('state')!;
      expect(
        (await f.auth.callback('synthetic-code', state, begin.binding)).status,
      ).toBe('READY');
      const diag = JSON.stringify(
        await f.auth.store.read('auth/last-attempt.json'),
      );
      for (const forbidden of [
        secret,
        token,
        'synthetic-code',
        state,
        begin.binding,
      ])
        expect(diag).not.toContain(forbidden);
      expect(diag).toContain('TOKEN_VERIFICATION');
    },
  );
  it('identifies a failed short exchange without retaining raw Meta error text', async () => {
    const f = await fixture();
    f.cfg.accessToken = '';
    jest
      .spyOn(f.auth.provider, 'exchange')
      .mockRejectedValue(
        new ThreadsApiError(
          'INVALID_REQUEST',
          400,
          100,
          0,
          'AUTHORIZATION_CODE_REJECTED',
          36008,
        ),
      );
    const begin = await f.auth.begin('threads-studio.test:3443'),
      state = new URL(begin.url).searchParams.get('state')!;
    await expect(
      f.auth.callback('synthetic-code', state, begin.binding),
    ).rejects.toThrow('OAUTH_SHORT_TOKEN_EXCHANGE_FAILED');
    const diag: any = await f.auth.store.read('auth/last-attempt.json');
    expect(diag.events.at(-1)).toMatchObject({
      stage: 'SHORT_TOKEN_EXCHANGE',
      httpStatus: 400,
      apiCode: 100,
      apiSubcode: 36008,
      detail: 'AUTHORIZATION_CODE_REJECTED',
    });
  });
  it('recovers long exchange using encrypted checkpoint, without another code exchange', async () => {
    const f = await fixture();
    f.cfg.accessToken = '';
    const exchange = jest.spyOn(f.auth.provider, 'exchange');
    const long = jest
      .spyOn(f.auth.provider, 'longLived')
      .mockRejectedValueOnce(new ThreadsApiError('TRANSIENT', 503));
    const begin = await f.auth.begin('threads-studio.test:3443'),
      state = new URL(begin.url).searchParams.get('state')!;
    await expect(
      f.auth.callback('synthetic-code', state, begin.binding),
    ).rejects.toThrow('OAUTH_LONG_TOKEN_EXCHANGE_FAILED');
    expect((await f.auth.recover()).status).toBe('READY');
    expect(exchange).toHaveBeenCalledTimes(1);
    expect(long).toHaveBeenCalledTimes(2);
  });
  it('reports storage failures at their actual stage without echoing filesystem diagnostics', async () => {
    const f = await fixture();
    f.cfg.accessToken = '';
    const { TokenVault } = require('../studio/token-vault');
    jest
      .spyOn(TokenVault.prototype, 'write')
      .mockRejectedValue(Error('private-path-' + secret));
    const begin = await f.auth.begin('threads-studio.test:3443'),
      state = new URL(begin.url).searchParams.get('state')!;
    await expect(
      f.auth.callback('synthetic-code', state, begin.binding),
    ).rejects.toThrow('OAUTH_CHECKPOINT_STORAGE_FAILED');
    expect(
      JSON.stringify(await f.auth.store.read('auth/last-attempt.json')),
    ).not.toContain(secret);
  });
  it('matches official fixed request shapes and exposes only allowlisted transport causes', async () => {
    const calls: any[] = [];
    const p = new ThreadsProvider((async (u: any, i: any) => {
      calls.push({ u: new URL(u), i });
      return Response.json({ access_token: 'synthetic' });
    }) as any);
    await p.exchange('synthetic-code', config());
    await p.longLived(token, secret);
    expect(calls[0].u.origin).toBe('https://graph.threads.com');
    expect(calls[0].u.pathname).toBe('/v1.0/oauth/access_token');
    expect(calls[0].i.method).toBe('POST');
    expect(new URLSearchParams(calls[0].i.body).get('grant_type')).toBe(
      'authorization_code',
    );
    expect(calls[1].u.pathname).toBe('/v1.0/access_token');
    expect(calls[1].u.searchParams.get('grant_type')).toBe('th_exchange_token');
    expect(calls[1].u.searchParams.get('access_token')).toBe(token);
    expect(calls[1].i.headers.Authorization).toBeUndefined();
    const bad = new ThreadsProvider((async () => {
      throw Object.assign(Error(secret), {
        cause: { code: 'UNABLE_TO_VERIFY_LEAF_SIGNATURE' },
      });
    }) as any);
    try {
      await bad.debug(token);
    } catch (e) {
      expect((e as ThreadsApiError).detail).toBe(
        'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
      );
      expect((e as Error).message).not.toContain(secret);
    }
  });
  it('rejects localhost/IP/insecure callback and excludes unknown pilot fields', () => {
    for (const u of [
      'http://threads-studio.test/callback',
      'https://localhost/api/studio/threads/oauth/callback',
      'https://127.0.0.1/api/studio/threads/oauth/callback',
      'https://threads-studio.test:3443/api/studio/threads/oauth/callback?code=x',
    ])
      expect(() => redirectUrl(u)).toThrow();
    expect(redirectUrl(config().redirectUri).hostname).toBe(
      'threads-studio.test',
    );
    expect(
      pilotInput({ ...DEFAULT_PILOT, requestId: 'test', access_token: token }),
    ).not.toHaveProperty('access_token');
  });
  it('keeps missing credentials/token/callback BLOCKED without a network request; secret is not user token', async () => {
    const f = await fixture(),
      spy = jest.spyOn(f.auth.provider, 'debug');
    f.cfg.accessToken = f.cfg.appSecret;
    expect((await f.auth.verify()).status).toBe('BLOCKED_AUTH');
    expect(spy).not.toHaveBeenCalled();
    f.cfg.accessToken = token;
    f.cfg.redirectUri = '';
    expect((await f.auth.verify()).status).toBe('BLOCKED_AUTH');
    expect(spy).not.toHaveBeenCalled();
  });
  it('validates granted scopes, app binding, identity and expiry without returning credentials', async () => {
    const f = await fixture(),
      status = await f.auth.verify();
    expect(status.status).toBe('READY');
    expect(status).toMatchObject({
      appBindingVerified: true,
      expiresAt: now + 3600000,
    });
    expect(JSON.stringify(status)).not.toContain(token);
    expect(JSON.stringify(status)).not.toContain(secret);
    expect(f.calls).toHaveLength(2);
  });
  it.each(['expired', 'wrong-app', 'missing-scope', 'wrong-user'])(
    'blocks %s',
    async (kind) => {
      const f = await fixture();
      jest.spyOn(f.auth.provider, 'debug').mockResolvedValue({
        data: {
          is_valid: true,
          app_id: kind === 'wrong-app' ? 'different' : f.cfg.appId,
          user_id: 'test-user',
          expires_at: now / 1000 + (kind === 'expired' ? -1 : 3600),
          scopes:
            kind === 'missing-scope'
              ? ['threads_basic']
              : ['threads_basic', 'threads_keyword_search'],
        },
      });
      if (kind === 'wrong-user')
        jest
          .spyOn(f.auth.provider, 'profile')
          .mockResolvedValue({ id: 'other-user' });
      expect((await f.auth.verify()).status).toBe(
        kind === 'missing-scope' ? 'BLOCKED_PERMISSION' : 'BLOCKED_AUTH',
      );
    },
  );
  it('binds expiring state to secure browser cookie and encrypts one-use OAuth token', async () => {
    const f = await fixture();
    f.cfg.accessToken = '';
    await expect(f.auth.begin('127.0.0.1:3000')).rejects.toThrow(
      'registered HTTPS',
    );
    const out = await f.auth.begin('threads-studio.test:3443'),
      state = new URL(out.url).searchParams.get('state')!;
    expect(new URL(out.url).origin).toBe('https://www.threads.com');
    await expect(
      f.auth.callback('synthetic-code', state, '0'.repeat(64)),
    ).rejects.toThrow('OAUTH_STATE_VALIDATION_FAILED');
    expect(
      (await f.auth.callback('synthetic-code', state, out.binding)).status,
    ).toBe('READY');
    await expect(
      f.auth.callback('synthetic-code', state, out.binding),
    ).rejects.toThrow('OAUTH_STATE_VALIDATION_FAILED');
    const vault = await fs.readdir(path.join(f.root, 'vault'));
    const bytes = await fs.readFile(
      path.join(f.root, 'vault', vault[0]),
      'utf8',
    );
    expect(bytes).not.toContain(token);
    expect(bytes).not.toContain(secret);
  });
  it('rejects expired state without code exchange and prevents concurrent replay', async () => {
    const f = await fixture();
    f.cfg.accessToken = '';
    const out = await f.auth.begin('threads-studio.test:3443'),
      state = new URL(out.url).searchParams.get('state')!;
    const a = await f.auth.store.rows<any>('audit');
    expect(a).toHaveLength(0);
    const files = (await fs.readdir(path.join(f.root, 'auth'))).filter(
        (n) => n !== 'status.json',
      ),
      p = path.join(f.root, 'auth', files[0]),
      pending = JSON.parse(await fs.readFile(p, 'utf8'));
    pending.expires = 0;
    await fs.writeFile(p, JSON.stringify(pending));
    const exchange = jest.spyOn(f.auth.provider, 'exchange');
    await expect(
      f.auth.callback('synthetic-code', state, out.binding),
    ).rejects.toThrow('OAUTH_STATE_VALIDATION_FAILED');
    expect(exchange).not.toHaveBeenCalled();
    const second = await f.auth.begin('threads-studio.test:3443'),
      s = new URL(second.url).searchParams.get('state')!;
    const results = await Promise.allSettled([
      f.auth.callback('synthetic-code', s, second.binding),
      f.auth.callback('synthetic-code', s, second.binding),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
  });
  it.each([
    [401, 190, 'BLOCKED_AUTH'],
    [403, 10, 'BLOCKED_PERMISSION'],
    [429, 4, 'RATE_LIMITED'],
    [500, 1, 'TRANSIENT'],
  ])('classifies HTTP %i safely', async (status, code, kind) => {
    const p = new ThreadsProvider((async () =>
      Response.json(
        { error: { code, message: token + ' ' + secret } },
        { status: status as number, headers: { 'Retry-After': '2' } },
      )) as any);
    try {
      await p.debug(token);
      throw Error('Should fail');
    } catch (e) {
      expect(e).toBeInstanceOf(ThreadsApiError);
      expect((e as ThreadsApiError).kind).toBe(kind);
      expect((e as Error).message).not.toContain(token);
      expect((e as Error).message).not.toContain(secret);
    }
  });
  it('uses only official read/auth routes and rejects network/invalid JSON safely', async () => {
    const http = jest.fn(async () => {
        throw Error('synthetic-network-' + token);
      }),
      p = new ThreadsProvider(http as any);
    await expect(p.request('me/threads', {}, token, {}, true)).rejects.toThrow(
      'INVALID_REQUEST',
    );
    expect(http).not.toHaveBeenCalled();
    await expect(p.debug(token)).rejects.toThrow('TRANSIENT');
    const invalid = new ThreadsProvider(
      (async () => new Response('not-json', { status: 200 })) as any,
    );
    await expect(invalid.debug(token)).rejects.toThrow('INVALID_RESPONSE');
  });
  it('proxy route policy exposes only login/callback, never Studio or data APIs', () => {
    const { allowed } = require('../../scripts/threads-oauth-proxy.cjs');
    expect(
      allowed(
        {
          method: 'GET',
          url: '/api/studio/threads/oauth/callback?code=synthetic',
          headers: { host: 'threads-studio.test:3443' },
        },
        'threads-studio.test:3443',
      ),
    ).toBe(true);
    for (const url of [
      '/studio',
      '/api/studio/sessions',
      '/api/studio/data',
      '/api/studio/threads/auth/status',
      '/api/studio/threads/oauth%2f../data',
    ])
      expect(
        allowed(
          { method: 'GET', url, headers: { host: 'threads-studio.test:3443' } },
          'threads-studio.test:3443',
        ),
      ).toBe(false);
  });
});
