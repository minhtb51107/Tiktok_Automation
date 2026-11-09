export const THREADS_SCOPES = [
  'threads_basic',
  'threads_keyword_search',
] as const;
export const CALLBACK_PATH = '/api/studio/threads/oauth/callback';
export interface ThreadsConfig {
  appId: string;
  appSecret: string;
  accessToken: string;
  redirectUri: string;
}
export function threadsConfig(
  env: NodeJS.ProcessEnv = process.env,
): ThreadsConfig {
  return {
    appId: env.THREADS_APP_ID?.trim() || '',
    appSecret: env.THREADS_APP_SECRET?.trim() || '',
    accessToken: env.THREADS_ACCESS_TOKEN?.trim() || '',
    redirectUri: env.THREADS_REDIRECT_URI?.trim() || '',
  };
}
export function redirectUrl(value: string) {
  const u = new URL(value);
  if (
    u.protocol !== 'https:' ||
    u.username ||
    u.password ||
    u.search ||
    u.hash ||
    u.pathname !== CALLBACK_PATH ||
    u.hostname === 'localhost' ||
    /^[\d.]+$/.test(u.hostname) ||
    u.hostname.includes(':') ||
    !u.hostname.includes('.')
  )
    throw Error(
      'BLOCKED_AUTH: registered HTTPS domain callback required; localhost/IP callbacks are unsupported',
    );
  return u;
}
export interface PilotInput {
  keywords: string[];
  searchType: 'TOP' | 'RECENT';
  perKeyword: number;
  maxRequests: number;
  maxRunMs: number;
  requestId: string;
}
export const DEFAULT_PILOT = {
  keywords: ['công việc', 'tâm sự'],
  searchType: 'RECENT' as const,
  perKeyword: 5,
  maxRequests: 8,
  maxRunMs: 120000,
};
export function pilotInput(b: any): PilotInput {
  if (
    !b ||
    !Array.isArray(b.keywords) ||
    b.keywords.length < 1 ||
    b.keywords.length > 2 ||
    b.keywords.some(
      (q) => typeof q !== 'string' || !q.trim() || q.length > 120,
    ) ||
    new Set(b.keywords.map((q) => q.trim())).size !== b.keywords.length ||
    !['TOP', 'RECENT'].includes(b.searchType) ||
    !Number.isInteger(b.perKeyword) ||
    b.perKeyword < 1 ||
    b.perKeyword > 5 ||
    !Number.isInteger(b.maxRequests) ||
    b.maxRequests < 1 ||
    b.maxRequests > 12 ||
    !Number.isInteger(b.maxRunMs) ||
    b.maxRunMs < 1000 ||
    b.maxRunMs > 180000 ||
    !/^[A-Za-z0-9-]{1,100}$/.test(b.requestId || '')
  )
    throw Error(
      'Invalid pilot: 1–2 keywords, 1–5 results each, <=12 requests, <=180 seconds, unique requestId required',
    );
  return {
    keywords: b.keywords.map((q) => q.trim()),
    searchType: b.searchType,
    perKeyword: b.perKeyword,
    maxRequests: b.maxRequests,
    maxRunMs: b.maxRunMs,
    requestId: b.requestId,
  };
}
