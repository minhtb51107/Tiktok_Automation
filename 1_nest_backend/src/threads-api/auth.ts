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
import { OAuthDiagnostics, OAuthValidationError } from './oauth-diagnostics';
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
  appBindingMethod?: 'DEBUG_APP_ID' | 'OAUTH_EXCHANGE_RECEIPT';
  tokenSource: string;
  reason: string;
  retryAfterMs?: number;
  verificationChecks?: Record<string, boolean>;
  apiFailure?: {
    kind: ThreadsApiError['kind'];
    httpStatus: number;
    apiCode: number | null;
    apiSubcode: number | null;
    detail: string;
  };
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
      return { value: c.accessToken, source: 'ENV', exchangeBound: false };
    }
    try {
      const v = await this.vault().read(accountId);
      if (v.appHash !== digest(c.appId)) throw Error('App mismatch');
      return {
        value: String(v.accessToken),
        source: 'OAUTH_VAULT',
        exchangeBound:
          v.appBindingEvidence === 'AUTHORIZATION_CODE_AND_SECRET_EXCHANGE',
      };
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
      config: {
        ...this.config(),
        ...(valid && r!.status === 'READY' && (r!.expiresAt || 0) > this.now()
          ? { oauthStatus: 'AUTHORIZED' }
          : {}),
      },
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
      // Threads introspection can omit app_id. An explicit mismatch never passes.
      // Only our encrypted OAuth exchange receipt establishes the missing binding;
      // arbitrary ENV tokens cannot use this fallback.
      const appMatches =
        d?.app_id !== undefined
          ? String(d.app_id) === c.appId
          : t.source === 'OAUTH_VAULT' && t.exchangeBound === true;
      r.verificationChecks = {
        tokenValid: d?.is_valid === true,
        appMatches,
        expiryValid:
          Number.isFinite(d?.expires_at) && d.expires_at * 1000 > this.now(),
        scopesArray: Array.isArray(d?.scopes),
        identityPresent: !!d?.user_id,
        appIdReturned: d?.app_id !== undefined,
      };
      if (
        !d ||
        d.is_valid !== true ||
        !appMatches ||
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
      r.appBindingMethod =
        d.app_id !== undefined ? 'DEBUG_APP_ID' : 'OAUTH_EXCHANGE_RECEIPT';
      if (r.missingScopes.length) {
        r.status = 'BLOCKED_PERMISSION';
        r.reason = 'Missing granted read/search scopes';
      } else {
        const p = await this.provider.profile(t.value, hooks);
        r.verificationChecks.identityMatches =
          String(p.id) === String(d.user_id);
        if (String(p.id) !== String(d.user_id))
          throw new ThreadsApiError('BLOCKED_AUTH');
        r.status = 'READY';
        r.reason =
          'App binding, token validity/expiry/scopes and /me identity verified; App Review search coverage still requires checking';
      }
    } catch (e) {
      if (e instanceof ThreadsApiError) {
        r.apiFailure = {
          kind: e.kind,
          httpStatus: e.httpStatus,
          apiCode: e.apiCode,
          apiSubcode: e.apiSubcode,
          detail: e.detail,
        };
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
    const diagnostic = new OAuthDiagnostics(this.store);
    return this.completeStages(code, state, binding, diagnostic);
  }
  private async completeStages(
    code: string,
    state: string,
    binding: string,
    diagnostic: OAuthDiagnostics,
  ) {
    const c = this.cfg();
    await diagnostic.step('STATE_VALIDATION', async () => {
      if (c.accessToken) throw new OAuthValidationError('ENV_TOKEN_CHANGED');
      if (
        !/^[a-f0-9]{64}$/.test(state || '') ||
        !/^[a-f0-9]{64}$/.test(binding || '')
      )
        throw new OAuthValidationError('STATE_OR_COOKIE_MISSING');
      const file = 'auth/' + digest(state) + '.json',
        p = await this.store.read<any>(file);
      if (!p) throw new OAuthValidationError('STATE_NOT_FOUND_OR_REPLAYED');
      if (p.expires <= this.now())
        throw new OAuthValidationError('STATE_EXPIRED');
      if (
        p.appHash !== digest(c.appId) ||
        p.redirectHash !== digest(c.redirectUri)
      )
        throw new OAuthValidationError('APP_OR_CALLBACK_CHANGED');
      if (
        typeof p.browserHash !== 'string' ||
        p.browserHash.length !== 64 ||
        !timingSafeEqual(
          Buffer.from(p.browserHash),
          Buffer.from(digest(binding)),
        )
      )
        throw new OAuthValidationError('COOKIE_BINDING_MISMATCH');
      if (typeof code !== 'string' || !code || code.length > 8192)
        throw new OAuthValidationError('CODE_MISSING_OR_INVALID');
      await this.store.consume(file); // Atomic one-use claim before code exchange; codes are never retried.
    });
    const short = await diagnostic.step('SHORT_TOKEN_EXCHANGE', () =>
      this.provider.exchange(code, c),
    );
    await diagnostic.step('SHORT_TOKEN_VALIDATION', async () => {
      if (typeof short?.access_token !== 'string' || !short.access_token)
        throw new OAuthValidationError('SHORT_TOKEN_MISSING');
      // Identity is established by debug_token and /me, never by lossy Number conversion.
      if (
        short.user_id !== undefined &&
        short.user_id !== null &&
        typeof short.user_id !== 'string' &&
        typeof short.user_id !== 'number'
      )
        throw new OAuthValidationError('USER_ID_TYPE_INVALID');
    });
    await diagnostic.step('CHECKPOINT_STORAGE', () =>
      this.vault().write('00000000-0000-4000-8000-000000000003', {
        accessToken: short.access_token,
        appHash: digest(c.appId),
        expiresAt: this.now() + 3600000,
        phase: 'SHORT',
      }),
    );
    return this.finishToken(short.access_token, c, diagnostic);
  }
  private async finishToken(
    token: string,
    c: ThreadsConfig,
    diagnostic: OAuthDiagnostics,
  ) {
    const long = await diagnostic.step('LONG_TOKEN_EXCHANGE', () =>
      this.provider.longLived(token, c.appSecret),
    );
    await diagnostic.step('LONG_TOKEN_VALIDATION', async () => {
      if (
        typeof long?.access_token !== 'string' ||
        !long.access_token ||
        !Number.isFinite(long.expires_in) ||
        long.expires_in <= 0
      )
        throw new OAuthValidationError('LONG_TOKEN_RESPONSE_INVALID');
    });
    await diagnostic.step('TOKEN_STORAGE', () =>
      this.vault().write(accountId, {
        accessToken: long.access_token,
        appHash: digest(c.appId),
        appBindingEvidence: 'AUTHORIZATION_CODE_AND_SECRET_EXCHANGE',
        expiresAt: this.now() + long.expires_in * 1000,
      }),
    );
    return diagnostic.step('TOKEN_VERIFICATION', async () => {
      const verified = await this.verify();
      const failure = (await this.store.read<AuthRecord>('auth/status.json'))
        ?.apiFailure;
      if (verified.status !== 'READY')
        throw new ThreadsApiError(
          verified.status === 'BLOCKED_PERMISSION'
            ? 'BLOCKED_PERMISSION'
            : 'BLOCKED_AUTH',
          failure?.httpStatus || 0,
          failure?.apiCode ?? null,
          0,
          failure?.detail || 'API_ERROR',
          failure?.apiSubcode ?? null,
        );
      return verified;
    });
  }
  async recover() {
    if (this.completing) throw Error('OAuth busy');
    this.completing = true;
    try {
      const current = await this.token();
      if (current && (current.source === 'ENV' || current.exchangeBound))
        return this.verify();
      const pending = await this.vault().read(
        '00000000-0000-4000-8000-000000000003',
      );
      if (
        pending.appHash !== digest(this.cfg().appId) ||
        pending.expiresAt <= this.now() ||
        pending.phase !== 'SHORT'
      )
        throw Error('BLOCKED_AUTH: no valid encrypted recovery checkpoint');
      return await this.finishToken(
        pending.accessToken,
        this.cfg(),
        new OAuthDiagnostics(this.store),
      );
    } finally {
      this.completing = false;
    }
  }
}
