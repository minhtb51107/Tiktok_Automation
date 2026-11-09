export class ThreadsApiError extends Error {
  constructor(
    readonly kind:
      | 'BLOCKED_AUTH'
      | 'BLOCKED_PERMISSION'
      | 'RATE_LIMITED'
      | 'TRANSIENT'
      | 'INVALID_RESPONSE'
      | 'INVALID_REQUEST',
    readonly httpStatus = 0,
    readonly apiCode: number | null = null,
    readonly retryAfterMs = 0,
    readonly detail: string = 'API_ERROR',
    readonly apiSubcode: number | null = null,
  ) {
    super(`${kind}: Meta HTTP ${httpStatus}, code ${apiCode ?? 'unavailable'}`);
  }
}
export interface ApiHooks {
  before?: () => Promise<void>;
  after?: () => Promise<void>;
  timeoutMs?: number;
  remainingMs?: () => number;
}
/** Official fixed read/auth routes. No publication, scraping or arbitrary paging URL. */
export class ThreadsProvider {
  constructor(private http: typeof fetch = fetch) {}
  async request(
    route: string,
    params: Record<string, string>,
    token: string | null,
    hooks: ApiHooks = {},
    post = false,
  ): Promise<any> {
    if (
      ![
        'oauth/access_token',
        'access_token',
        'refresh_access_token',
        'debug_token',
        'me',
        'keyword_search',
      ].includes(route) ||
      (post && route !== 'oauth/access_token')
    )
      throw new ThreadsApiError('INVALID_REQUEST');
    await hooks.before?.();
    const u = new URL('https://graph.threads.com/v1.0/' + route);
    if (!post) u.search = new URLSearchParams(params).toString();
    let r: Response;
    try {
      r = await this.http(u.href, {
        method: post ? 'POST' : 'GET',
        redirect: 'error',
        headers: {
          ...(token ? { Authorization: 'Bearer ' + token } : {}),
          ...(post
            ? { 'Content-Type': 'application/x-www-form-urlencoded' }
            : {}),
        },
        body: post ? new URLSearchParams(params).toString() : undefined,
        signal: AbortSignal.timeout(
          Math.max(
            1,
            Math.min(15000, hooks.remainingMs?.() ?? hooks.timeoutMs ?? 15000),
          ),
        ),
      });
    } catch (e: any) {
      const cause = e?.cause?.code;
      const allowed = [
        'ENOTFOUND',
        'ETIMEDOUT',
        'ECONNRESET',
        'ECONNREFUSED',
        'UND_ERR_CONNECT_TIMEOUT',
        'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
        'CERT_HAS_EXPIRED',
        'DEPTH_ZERO_SELF_SIGNED_CERT',
        'SELF_SIGNED_CERT_IN_CHAIN',
      ];
      throw new ThreadsApiError(
        'TRANSIENT',
        0,
        null,
        0,
        allowed.includes(cause)
          ? cause
          : e?.name === 'TimeoutError'
            ? 'REQUEST_TIMEOUT'
            : 'NETWORK_FAILURE',
      );
    }
    await hooks.after?.();
    let size = 0;
    const chunks: Uint8Array[] = [];
    try {
      if (r.body) {
        for await (const b of r.body as any) {
          size += b.length;
          if (size > 2 * 1024 * 1024)
            throw new ThreadsApiError('INVALID_RESPONSE', r.status);
          chunks.push(b);
        }
      }
    } catch (e) {
      if (e instanceof ThreadsApiError) throw e;
      throw new ThreadsApiError('TRANSIENT', r.status);
    }
    let j: any;
    try {
      j = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    } catch {
      throw new ThreadsApiError(
        r.status >= 500 ? 'TRANSIENT' : 'INVALID_RESPONSE',
        r.status,
      );
    }
    const code =
      typeof j.error?.code === 'number'
        ? j.error.code
        : typeof j.code === 'number'
          ? j.code
          : null;
    if (!r.ok || j.error || j.error_type) {
      const retry = r.headers.get('retry-after'),
        delay = retry
          ? /^\d+$/.test(retry)
            ? Number(retry) * 1000
            : Math.max(0, Date.parse(retry) - Date.now())
          : 0;
      const kind =
        r.status === 401 || code === 190
          ? 'BLOCKED_AUTH'
          : r.status === 403 || code === 10 || code === 200
            ? 'BLOCKED_PERMISSION'
            : r.status === 429 || [4, 17, 613].includes(code || 0)
              ? 'RATE_LIMITED'
              : r.status >= 500
                ? 'TRANSIENT'
                : 'INVALID_REQUEST';
      throw new ThreadsApiError(
        kind,
        r.status,
        code,
        Math.min(86400000, Number.isFinite(delay) ? delay : 0),
        classifyMetaError(j),
        Number.isSafeInteger(j.error?.error_subcode)
          ? j.error.error_subcode
          : null,
      );
    }
    return j;
  }
  exchange(
    code: string,
    c: { appId: string; appSecret: string; redirectUri: string },
  ) {
    return this.request(
      'oauth/access_token',
      {
        client_id: c.appId,
        client_secret: c.appSecret,
        redirect_uri: c.redirectUri,
        grant_type: 'authorization_code',
        code,
      },
      null,
      {},
      true,
    );
  }
  longLived(token: string, secret: string) {
    return this.request(
      'access_token',
      {
        grant_type: 'th_exchange_token',
        client_secret: secret,
        access_token: token,
      },
      null,
    );
  }
  debug(token: string, hooks?: ApiHooks) {
    return this.request('debug_token', { input_token: token }, token, hooks);
  }
  profile(token: string, hooks?: ApiHooks) {
    return this.request('me', { fields: 'id,username' }, token, hooks);
  }
  search(
    token: string,
    q: string,
    type: 'TOP' | 'RECENT',
    limit: number,
    after: string | null,
    hooks?: ApiHooks,
    mode: 'KEYWORD' | 'TAG' = 'KEYWORD',
  ) {
    return this.request(
      'keyword_search',
      {
        q,
        search_type: type,
        search_mode: mode,
        limit: String(limit),
        fields: 'id,text,username,permalink,timestamp,media_type,media_url,is_reply,has_replies',
        ...(after ? { after } : {}),
      },
      token,
      hooks,
    );
  }
}

// Only fixed diagnostic labels leave this boundary; never echo Meta text or URLs.
function classifyMetaError(j: any): string {
  const text = String(j.error?.message || j.error_message || '');
  if (
    /code.*(?:expired|used|invalid)|(?:expired|used|invalid).*code/i.test(text)
  )
    return 'AUTHORIZATION_CODE_REJECTED';
  if (/redirect.*(?:uri|url)/i.test(text)) return 'REDIRECT_URI_REJECTED';
  if (/client.secret|app.secret|invalid.*app.*id/i.test(text))
    return 'APP_CREDENTIALS_REJECTED';
  if (/test.*app|tester|invite/i.test(text)) return 'TESTER_ACCESS_REQUIRED';
  return 'API_ERROR';
}
