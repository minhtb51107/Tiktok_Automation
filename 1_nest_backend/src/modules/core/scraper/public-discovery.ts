import { existsSync } from 'fs';
import puppeteer from 'puppeteer';
export interface PublicDiscovery {
  url: string;
  limit: number;
  timeoutMs: number;
}
export function discoveryUrl(mode: 'SEARCH' | 'FEED', keyword?: string) {
  if (mode === 'FEED') return 'https://www.threads.com/';
  if (
    mode !== 'SEARCH' ||
    typeof keyword !== 'string' ||
    !keyword.trim() ||
    keyword.length > 120
  )
    throw Error('CRAWLER_INVALID_KEYWORD');
  const u = new URL('https://www.threads.com/search');
  u.searchParams.set('q', keyword.trim());
  return u.href;
}
export function checkDiscovery(x: PublicDiscovery) {
  const u = new URL(x.url);
  if (
    u.protocol !== 'https:' ||
    !['www.threads.com', 'www.threads.net'].includes(u.hostname) ||
    u.port ||
    u.username ||
    u.password ||
    u.hash ||
    !['/', '/search'].includes(u.pathname) ||
    [...u.searchParams.keys()].some((k) => k !== 'q') ||
    (u.pathname === '/search' && !u.searchParams.get('q')) ||
    !Number.isInteger(x.limit) ||
    x.limit < 1 ||
    x.limit > 2 ||
    !Number.isInteger(x.timeoutMs) ||
    x.timeoutMs < 1000 ||
    x.timeoutMs > 25000
  )
    throw Error('CRAWLER_INVALID_DISCOVERY');
  return x;
}
export function existingPublicBrowser() {
  return [
    process.env.STUDIO_BROWSER,
    puppeteer.executablePath(),
    'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  ].find((p) => p && existsSync(p));
}
export function publicResource(value: string) {
  try {
    const u = new URL(value);
    return (
      u.protocol === 'https:' &&
      !u.port &&
      !u.username &&
      !u.password &&
      [
        'threads.com',
        'threads.net',
        'fbcdn.net',
        'cdninstagram.com',
        'instagram.com',
      ].some((d) => u.hostname === d || u.hostname.endsWith('.' + d))
    );
  } catch {
    return false;
  }
}
/** Legacy For-You permalink selector, reused without attributing nearby DOM text. */
export function visiblePermalinks() {
  const anchors = [
    ...document.querySelectorAll(
      'div[data-pressable-container="true"] a[href*="/post/"],article a[href*="/post/"]',
    ),
  ];
  const urls = new Set<string>();
  for (const a of anchors) {
    const box = a.getBoundingClientRect();
    if (!box.width || !box.height) continue;
    try {
      const u = new URL(a.getAttribute('href') || '', location.origin);
      if (
        u.protocol === 'https:' &&
        [
          'www.threads.com',
          'www.threads.net',
          'threads.com',
          'threads.net',
        ].includes(u.hostname) &&
        !u.port &&
        !u.username &&
        !u.password &&
        /^\/@[\w.-]+\/post\/[\w-]+\/?$/.test(u.pathname)
      ) {
        u.search = '';
        u.hash = '';
        urls.add(u.href);
      }
    } catch {}
  }
  return [...urls].map((url) => ({ url }));
}
