import { createHash, hkdfSync, randomBytes, timingSafeEqual } from 'crypto';
import { TokenVault } from '../studio/token-vault';
import { ThreadsStore } from './local-store';
import { ThreadsProvider, type ApiHooks, ThreadsApiError } from './provider';
import {
  threadsConfig,
  redirectUrl,
  THREADS_SCOPES,
  type ThreadsConfig,
} from './config';
import * as path from 'path';
import { safePage } from './adapter';
const digest = (s: string) => createHash('sha256').update(s).digest('hex'),
  accountId = '00000000-0000-4000-8000-000000000002';
interface AuthRecord {
  fingerprint: string;
  status:
    | 'READY'
    | 'BLOCKED_AUTH'
    | 'BLOCKED_PERMISSION'
    | 'RATE_LIMITED'
    | 'FAILED';
  checkedAt: string;
  expiresAt: number | null;
  scopes: string[];
  missingScopes: string[];
  appBindingVerified: boolean;
  tokenSource: string;
  reason: string;
  retryAfterMs?: number;
}
export class ThreadsAuth {
  private completing = false;
  constructor(
    readonly store = new ThreadsStore(),
    readonly provider = new ThreadsProvider(),
    private cfg: () => ThreadsConfig = threadsConfig,
    private now = () => Date.now(),
  ) {}
  private vault() {
    const c = this.cfg();
    if (!c.appId || !c.appSecret)
      throw Error('BLOCKED_AUTH: Threads App ID/Secret required');
    return new TokenVault(
      path.join(this.store.root, 'vault'),
      Buffer.from(
        hkdfSync('sha256', c.appSecret, c.appId, 'studio-threads-v1', 32),
      ).toString('base64'),
    );
  }
  config() {
    const c = this.cfg();
    let valid = false;
    try {
      redirectUrl(c.redirectUri);
      valid = true;
    } catch {}
    return {
      environmentFile:
        '1_nest_backend/.env (backend working directory; process environment takes precedence)',
      present: {
        THREADS_APP_ID: !!c.appId,
        THREADS_APP_SECRET: !!c.appSecret,
        THREADS_ACCESS_TOKEN: !!c.accessToken,
        THREADS_REDIRECT_URI: !!c.redirectUri,
      },
      redirectValid: valid,
      oauthStatus:
        c.appId && c.appSecret && valid
          ? 'CONFIGURED_NOT_AUTHORIZED'
          : 'BLOCKED_AUTH',
      requestedScopes: THREADS_SCOPES,
    };
  }
  preparePage(page: any, token: string) {
    return safePage(page, [token, this.cfg().appSecret]);
  }
  async token() {
    const c = this.cfg();
    if (c.accessToken) {
      if (c.accessToken === c.appSecret || c.accessToken.startsWith('TH|'))
        return null;
      return { value: c.accessToken, source: 'ENV' };
    }
    try {
      const v = await this.vault().read(accountId);
      if (v.appHash !== digest(c.appId)) throw Error('App mismatch');
      return { value: String(v.accessToken), source: 'OAUTH_VAULT' };
    } catch {
      return null;
    }
  }
  async status() {
    const c = this.cfg(),
      t = await this.token(),
      r = await this.store.read<AuthRecord>('auth/status.json');
    const valid = t && r?.fingerprint === digest(c.appId + ':' + t.value);
    const { fingerprint, ...safe } = r || { fingerprint: '' };
    return {
      config: this.config(),
      ...(valid
        ? safe
        : {
            status: 'BLOCKED_AUTH',
            reason: 'User Access Token has not been verified for this app',
            scopes: [],
            expiresAt: null,
          }),
      ...(valid && r!.expiresAt !== null && r!.expiresAt <= this.now()
        ? { status: 'BLOCKED_AUTH', reason: 'User Access Token expired' }
        : {}),
    };
  }
  async verify(hooks?: ApiHooks) {
    const c = this.cfg(),
      t = await this.token();
    if (!c.appId || !c.appSecret || !t || !this.config().redirectValid)
      return {
        ...(await this.status()),
        status: 'BLOCKED_AUTH',
        reason:
          'Configure app credentials and obtain a Threads User Access Token; App Secret is not a User Access Token',
      };
    let r: AuthRecord = {
      fingerprint: digest(c.appId + ':' + t.value),
      status: 'BLOCKED_AUTH',
      checkedAt: new Date(this.now()).toISOString(),
      expiresAt: null,
      scopes: [],
      missingScopes: [...THREADS_SCOPES],
      appBindingVerified: false,
      tokenSource: t.source,
      reason: 'Incomplete token verification',
    };
    try {
      const j = await this.provider.debug(t.value, hooks),
        d = j.data;
      if (
        !d ||
        d.is_valid !== true ||
        String(d.app_id) !== c.appId ||
        !Number.isFinite(d.expires_at) ||
        d.expires_at * 1000 <= this.now() ||
        !Array.isArray(d.scopes) ||
        !d.scopes.every(
          (s) => typeof s === 'string' && /^threads_[a-z_]+$/.test(s),
        ) ||
        !d.user_id
      )
        throw new ThreadsApiError('BLOCKED_AUTH');
      r.expiresAt = d.expires_at * 1000;
      r.scopes = d.scopes;
      r.missingScopes = THREADS_SCOPES.filter((s) => !d.scopes.includes(s));
      r.appBindingVerified = true;
      if (r.missingScopes.length) {
        r.status = 'BLOCKED_PERMISSION';
        r.reason = 'Missing granted read/search scopes';
      } else {
        const p = await this.provider.profile(t.value, hooks);
        if (String(p.id) !== String(d.user_id))
          throw new ThreadsApiError('BLOCKED_AUTH');
        r.status = 'READY';
        r.reason =
          'Debug-token app binding, expiry, scopes and /me identity verified; App Review search coverage still requires checking';
      }
    } catch (e) {
      if (e instanceof ThreadsApiError) {
        r.reason = e.message;
        r.retryAfterMs = e.retryAfterMs;
        r.status =
          e.kind === 'BLOCKED_PERMISSION'
            ? 'BLOCKED_PERMISSION'
            : e.kind === 'RATE_LIMITED'
              ? 'RATE_LIMITED'
              : e.kind === 'TRANSIENT'
                ? 'FAILED'
                : 'BLOCKED_AUTH';
      } else throw e;
    }
    await this.store.write('auth/status.json', r);
    return this.status();
  }
  async context(hooks?: ApiHooks) {
    const s = await this.verify(hooks);
    if (s.status !== 'READY')
      throw new ThreadsApiError(
        s.status === 'BLOCKED_PERMISSION'
          ? 'BLOCKED_PERMISSION'
          : s.status === 'RATE_LIMITED'
            ? 'RATE_LIMITED'
            : s.status === 'FAILED'
              ? 'TRANSIENT'
              : 'BLOCKED_AUTH',
        0,
        null,
        (s as any).retryAfterMs || 0,
      );
    const token = await this.token(),
      saved = await this.store.read<AuthRecord>('auth/status.json');
    if (
      !token ||
      saved?.fingerprint !== digest(this.cfg().appId + ':' + token.value)
    )
      throw new ThreadsApiError('BLOCKED_AUTH');
    return token.value;
  }
  async assertQueries(queries: string[]) {
    const c = this.cfg(),
      t = await this.token();
    if (
      queries.some((q) =>
        [c.appSecret, t?.value].filter(Boolean).some((s) => q.includes(s!)),
      )
    )
      throw Error('INVALID_REQUEST: credential-bearing query rejected');
  }
  async begin(host: string) {
    const c = this.cfg(),
      redirect = redirectUrl(c.redirectUri);
    if (c.accessToken)
      throw Error(
        'BLOCKED_AUTH: clear THREADS_ACCESS_TOKEN when choosing OAuth vault mode',
      );
    if (!c.appId || !c.appSecret || host !== redirect.host)
      throw Error(
        'BLOCKED_AUTH: open login on the registered HTTPS callback domain, with app credentials configured',
      );
    const state = randomBytes(32).toString('hex'),
      binding = randomBytes(32).toString('hex');
    await this.store.write('auth/' + digest(state) + '.json', {
      browserHash: digest(binding),
      expires: this.now() + 600000,
      appHash: digest(c.appId),
      redirectHash: digest(c.redirectUri),
    });
    const u = new URL('https://www.threads.com/oauth/authorize');
    u.search = new URLSearchParams({
      client_id: c.appId,
      redirect_uri: c.redirectUri,
      scope: THREADS_SCOPES.join(','),
      response_type: 'code',
      state,
    }).toString();
    return { url: u.href, binding };
  }
  async callback(code: string, state: string, binding: string) {
    if (this.completing)
      throw Error('BLOCKED_AUTH: another OAuth callback is completing');
    this.completing = true;
    try {
      return await this.completeCallback(code, state, binding);
    } finally {
      this.completing = false;
    }
  }
  private async completeCallback(code: string, state: string, binding: string) {
    const c = this.cfg();
    if (c.accessToken)
      throw Error(
        'BLOCKED_AUTH: environment token changed during OAuth; restart login',
      );
    if (
      !/^[a-f0-9]{64}$/.test(state || '') ||
      !/^[a-f0-9]{64}$/.test(binding || '')
    )
      throw Error('BLOCKED_AUTH: missing/mismatched OAuth state cookie');
    const file = 'auth/' + digest(state) + '.json',
      p = await this.store.read<any>(file);
    if (
      !p ||
      p.expires <= this.now() ||
      p.appHash !== digest(c.appId) ||
      p.redirectHash !== digest(c.redirectUri) ||
      !timingSafeEqual(
        Buffer.from(p.browserHash),
        Buffer.from(digest(binding)),
      ) ||
      typeof code !== 'string' ||
      !code ||
      code.length > 8192
    )
      throw Error('BLOCKED_AUTH: expired/mismatched OAuth callback');
    await this.store.consume(file); // Atomic one-use claim before code exchange; codes are never retried.
    const short = await this.provider.exchange(code, c);
    if (typeof short.access_token !== 'string' || !short.user_id)
      throw Error('BLOCKED_AUTH: incomplete code exchange');
    const long = await this.provider.longLived(short.access_token, c.appSecret);
    if (
      typeof long.access_token !== 'string' ||
      !Number.isFinite(long.expires_in) ||
      long.expires_in <= 0
    )
      throw Error('BLOCKED_AUTH: long-lived token exchange failed');
    await this.vault().write(accountId, {
      accessToken: long.access_token,
      appHash: digest(c.appId),
      expiresAt: this.now() + long.expires_in * 1000,
    });
    return this.verify();
  }
}
