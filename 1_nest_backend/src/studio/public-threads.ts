import { BadRequestException } from '@nestjs/common';
import { request } from 'https';
import { lookup } from 'dns/promises';
import { existsSync } from 'fs';
import puppeteer from 'puppeteer';
import { matchExactTarget } from './target-identity';

const hosts = [
  'threads.com',
  'www.threads.com',
  'threads.net',
  'www.threads.net',
];
export function threadsUrl(value: unknown): string {
  try {
    const u = new URL(String(value));
    if (
      u.protocol !== 'https:' ||
      u.port ||
      u.username ||
      u.password ||
      !hosts.includes(u.hostname) ||
      !/^\/(?:@[\w.-]+\/post\/[\w-]+|share\/[\w-]+)\/?$/.test(u.pathname)
    )
      throw Error();
    u.hash = '';
    return u.href;
  } catch {
    throw new BadRequestException(
      'Enter an HTTPS Threads permalink or /share/ link (maximum 5 URLs).',
    );
  }
}
const decode = (s: string) =>
  s
    .replace(/&#(x[0-9a-f]+|\d+);/gi, (_, n) =>
      String.fromCodePoint(
        n[0].toLowerCase() === 'x' ? parseInt(n.slice(1), 16) : Number(n),
      ),
    )
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');
export interface PublicRecord {
  text: string;
  author: string;
  handle: string | null;
  avatar: string | null;
  createdAt: string | null;
  type: 'POST' | 'COMMENT' | 'UNKNOWN';
  parentReference: string | null;
  media: { url: string; kind: 'IMAGE' | 'VIDEO' | 'GIF' }[];
  likeCount: number | null;
  replyCount: number | null;
  repostCount: number | null;
  provenance: Record<string, string>;
  [key: string]: unknown;
}
export interface SourceAttempt {
  scope?: 'TARGET_ONLY' | 'WITH_CONTEXT';
  matchedTargetId?: string | null;
  matchMethod?: 'DOM_PERMALINK' | 'PUBLIC_CANONICAL_METADATA' | 'UNVERIFIED';
  contextCandidates?: PublicRecord[];
  browserNavigations?: number;
  domCandidates?: number;
  originalUrl: string;
  resolvedUrl: string | null;
  canonicalUrl: string | null;
  status: 'SUCCESS' | 'PARTIAL' | 'ERROR';
  elapsedMs: number;
  diagnostics: { stage: string; code: string; message: string }[];
  redirects: { url: string; status: number; location: string | null }[];
  records: PublicRecord[];
  retrievedAt: string;
}
async function publicGet(
  url: string,
): Promise<{ status: number; location: string | null; html: string }> {
  const u = new URL(threadsUrl(url));
  const addresses = await lookup(u.hostname, { all: true });
  // Pin a public IPv4 address so DNS cannot change between validation and connection.
  const a = addresses.find(
    (x) =>
      x.family === 4 &&
      !/^(0\.|10\.|127\.|169\.254\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|224\.|255\.)/.test(
        x.address,
      ),
  );
  if (!a) throw Error('No public IPv4 address available');
  return new Promise((resolve, reject) => {
    const req = request(
      u,
      {
        lookup: (_h, options, cb: any) =>
          options.all
            ? cb(null, [{ address: a.address, family: 4 }])
            : cb(null, a.address, 4),
        headers: {
          'User-Agent': 'Mozilla/5.0',
          'Accept-Language': 'vi,en;q=0.8',
        },
      },
      (res) => {
        let html = '';
        res.setEncoding('utf8');
        res.on('data', (chunk) => {
          html += chunk;
          if (html.length > 8000000)
            req.destroy(Error('Response exceeds 8 MB'));
        });
        res.on('end', () =>
          resolve({
            status: res.statusCode || 0,
            location: res.headers.location || null,
            html,
          }),
        );
        res.on('error', reject);
      },
    );
    req.setTimeout(20000, () =>
      req.destroy(Error('Public response timeout (20s)')),
    );
    req.on('error', reject);
    req.end();
  });
}
export async function extractPublicThreads(
  input: string,
  scope: 'TARGET_ONLY' | 'WITH_CONTEXT' = 'TARGET_ONLY',
): Promise<SourceAttempt> {
  const started = Date.now();
  const out: SourceAttempt = {
    originalUrl: input,
    scope,
    matchedTargetId: null,
    matchMethod: 'UNVERIFIED',
    contextCandidates: [],
    browserNavigations: 0,
    domCandidates: 0,
    resolvedUrl: null,
    canonicalUrl: null,
    status: 'ERROR',
    elapsedMs: 0,
    diagnostics: [],
    redirects: [],
    records: [],
    retrievedAt: new Date().toISOString(),
  };
  const diagnostic = (stage: string, code: string, message: string) =>
    out.diagnostics.push({ stage, code, message });
  try {
    let url = threadsUrl(input),
      html = '';
    for (let n = 0; n <= 5; n++) {
      const response = await publicGet(url);
      out.redirects.push({
        url,
        status: response.status,
        location: response.location,
      });
      if (
        response.status >= 300 &&
        response.status < 400 &&
        response.location
      ) {
        if (n === 5) throw Error('Redirect limit (5) reached');
        url = threadsUrl(new URL(response.location, url).href);
        continue;
      }
      if (response.status !== 200)
        throw Error('Public page HTTP ' + response.status);
      out.resolvedUrl = url;
      html = response.html;
      break;
    }
    const meta = (key: string) => {
      const tags = html.match(/<meta\b[^>]*>/gi) || [];
      for (const tag of tags) {
        if (tag.includes('"' + key + '"')) {
          const m = tag.match(/content="([\s\S]*?)"/i);
          if (m) return decode(m[1]);
        }
      }
      return null;
    };
    const canonical = html.match(
      /<link\b[^>]*rel="canonical"[^>]*href="([^"]+)"/i,
    )?.[1];
    if (canonical) out.canonicalUrl = threadsUrl(decode(canonical));
    const resolvedId = out.resolvedUrl?.match(/\/post\/([\w-]+)/)?.[1];
    const canonicalId = out.canonicalUrl?.match(/\/post\/([\w-]+)/)?.[1];
    if (resolvedId && canonicalId && resolvedId !== canonicalId)
      throw Error(
        'Ambiguous canonical: target ID differs from resolved permalink',
      );
    if (!out.canonicalUrl && out.resolvedUrl?.includes('/post/'))
      out.canonicalUrl = out.resolvedUrl.split('?')[0];
    const handle = out.canonicalUrl?.match(/\/@([^/]+)/)?.[1] || null;
    const text = meta('og:description');
    if (text && canonicalId && resolvedId === canonicalId) {
      out.matchedTargetId = canonicalId;
      out.matchMethod = 'PUBLIC_CANONICAL_METADATA';
    }
    if (text)
      out.records.push({
        text,
        author: handle || 'Unavailable',
        handle,
        avatar: null,
        createdAt: null,
        type: 'UNKNOWN',
        parentReference: null,
        media: [],
        likeCount: null,
        replyCount: null,
        repostCount: null,
        provenance: {
          text: 'public HTML og:description (may be truncated)',
          handle: 'canonical URL',
          type: 'unavailable: permalink alone does not distinguish reply from post',
        },
      });
    diagnostic(
      'resolution',
      'RESOLVED',
      'Public response resolved; canonical URL and public metadata inspected.',
    );
    const executable = [
      process.env.STUDIO_BROWSER,
      puppeteer.executablePath(),
      'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
      'C:/Program Files/Google/Chrome/Application/chrome.exe',
    ].find((p) => p && existsSync(p));
    if (!executable) {
      diagnostic(
        'browser',
        'BROWSER_MISSING',
        'No existing Chrome executable found. Public metadata retained.',
      );
    } else {
      let browser: Awaited<ReturnType<typeof puppeteer.launch>> | undefined;
      let stage = 'browser';
      try {
        browser = await puppeteer.launch({
          executablePath: executable,
          headless: true,
          args: ['--disable-background-networking'],
        });
        const page = await browser.newPage();
        await page.setRequestInterception(true);
        let navCount = 0;
        page.on('request', (r) => {
          try {
            const u = new URL(r.url());
            const allowed =
              u.protocol === 'https:' &&
              !u.port &&
              [
                'threads.com',
                'threads.net',
                'fbcdn.net',
                'cdninstagram.com',
                'instagram.com',
              ].some((d) => u.hostname === d || u.hostname.endsWith('.' + d));
            if (r.isNavigationRequest() && r.frame() === page.mainFrame())
              navCount++;
            out.browserNavigations = navCount;
            void (allowed && navCount <= 6 ? r.continue() : r.abort());
          } catch {
            void r.abort();
          }
        });
        stage = 'navigation';
        const response = await page.goto(out.canonicalUrl || out.resolvedUrl!, {
          waitUntil: 'domcontentloaded',
          timeout: 25000,
        });
        if (response && response.status() >= 400)
          throw Error('Navigation HTTP ' + response.status());
        if (/\/login|\/accounts\//.test(page.url()))
          throw Error('Public access requires login; no login attempted');
        await page
          .waitForSelector('[data-pressable-container="true"], article', {
            timeout: 10000,
          })
          .catch(() => {});
        stage = 'parser';
        const rows = await page.evaluate(() => {
          const nodes = [
            ...document.querySelectorAll('[data-pressable-container="true"]'),
          ];
          return nodes.slice(0, 50).map((node) => {
            const spans = [...node.querySelectorAll('span[dir="auto"]')]
              .map((x) => x.textContent?.trim() || '')
              .filter(Boolean);
            const time = node.querySelector('time');
            const imgs = [...node.querySelectorAll('img')];
            const avatar =
              imgs.find((i) => i.width > 10 && i.width < 100)?.src || null;
            const permalink =
              [...node.querySelectorAll('a[href]')]
                .map((a) => a.getAttribute('href') || '')
                .find((h) => /^\/@[\w.-]+\/post\/[\w-]+\/?$/.test(h)) || null;
            const visibleMetrics = spans.filter((s) =>
              /^[\d.,]+[KkMm]?$/.test(s),
            );
            const content = spans
              .filter(
                (s) =>
                  s !== permalink?.split('/')[1]?.slice(1) &&
                  !/^\d{1,2}\/\d{1,2}\/\d{4}$/.test(s) &&
                  !visibleMetrics.includes(s) &&
                  !['·', 'Tác giả', 'Author', 'Đã ghim', 'Pinned'].includes(s),
              )
              .join('\n');
            return {
              spans,
              content,
              permalink,
              visibleMetrics,
              avatar,
              createdAt: time?.getAttribute('datetime') || null,
              media: [
                ...imgs
                  .filter((i) => i.src !== avatar && i.width >= 100)
                  .map((i) => ({ url: i.src, kind: 'IMAGE' as const })),
                ...[...node.querySelectorAll('video')]
                  .filter((v) => v.currentSrc.startsWith('https:'))
                  .map((v) => ({ url: v.currentSrc, kind: 'VIDEO' as const })),
              ],
            };
          });
        });
        diagnostic(
          'dom',
          rows.length ? 'DOM_FOUND' : 'DOM_UNAVAILABLE',
          rows.length
            ? `${rows.length} public DOM containers found.`
            : 'No public post containers; metadata retained.',
        );
        // Use metadata as source identity anchor; do not attribute unrelated feed cards to this URL.
        out.domCandidates = rows.length;
        const targetId = out.canonicalUrl?.match(/\/post\/([\w-]+)/)?.[1];
        const row = matchExactTarget(out.canonicalUrl, rows);
        if (
          targetId &&
          rows.filter(
            (r) => r.permalink?.match(/\/post\/([\w-]+)/)?.[1] === targetId,
          ).length > 1
        ) {
          out.matchedTargetId = null;
          out.matchMethod = 'UNVERIFIED';
          diagnostic(
            'identity',
            'AMBIGUOUS_TARGET',
            'Multiple DOM candidates share the target ID; no target substituted.',
          );
        }
        let anchor = out.records[0];
        if (row && row.content.trim()) {
          const targetHandle = row.permalink!.split('/')[1].slice(1);
          if (!anchor) {
            anchor = {
              text: row.content,
              author: targetHandle,
              handle: targetHandle,
              avatar: null,
              createdAt: null,
              type: 'UNKNOWN',
              parentReference: null,
              media: [],
              likeCount: null,
              replyCount: null,
              repostCount: null,
              provenance: {},
            };
            out.records = [anchor];
          }
          anchor.text = row.content;
          anchor.author = targetHandle;
          anchor.handle = targetHandle;
          anchor.url = 'https://www.threads.com' + row.permalink;
          out.matchedTargetId = targetId!;
          out.matchMethod = 'DOM_PERMALINK';
          anchor.provenance.identity = 'exact DOM permalink /post/' + targetId;
        }
        if (row) {
          anchor.avatar = row.avatar;
          anchor.createdAt = row.createdAt;
          anchor.media = row.media;
          anchor.visibleMetrics = row.visibleMetrics;
          anchor.provenance.avatar = 'matching public DOM card';
          anchor.provenance.media = 'matching public DOM card';
          anchor.provenance.createdAt = 'DOM time[datetime]';
          if (row.content.includes(anchor.text.slice(0, 50))) {
            anchor.text = row.content;
            anchor.provenance.text = 'matching public DOM card (visible text)';
          }
          const seen = new Set([row.permalink]);
          for (const related of rows) {
            if (
              !related.permalink ||
              seen.has(related.permalink) ||
              !related.content.trim()
            )
              continue;
            seen.add(related.permalink);
            const handle = related.permalink.split('/')[1].slice(1);
            out.contextCandidates!.push({
              text: related.content,
              author: handle,
              handle,
              avatar: related.avatar,
              createdAt: related.createdAt,
              type: 'UNKNOWN',
              parentReference: null,
              url: 'https://www.threads.com' + related.permalink,
              media: related.media,
              visibleMetrics: related.visibleMetrics,
              likeCount: null,
              replyCount: null,
              repostCount: null,
              provenance: {
                text: 'public DOM card below source in thread view; relationship unverified',
                handle: 'DOM permalink',
                avatar: 'DOM image',
                media: 'DOM card',
                createdAt: 'DOM time',
                type: 'unavailable: parent/reply relationship not exposed',
              },
            });
          }
        }
        diagnostic(
          'parser',
          'PUBLIC_PARTIAL',
          `Exact matching: ${out.matchMethod}. ${out.contextCandidates!.length} context candidates kept separately. Reply hierarchy and engagement labels remain unverified.`,
        );
      } catch (e) {
        diagnostic(
          stage,
          stage.toUpperCase() + '_ERROR',
          e instanceof Error ? e.message : 'Browser failed',
        );
      } finally {
        await browser?.close();
      }
    }
    if (!out.matchedTargetId) {
      out.records = [];
      diagnostic(
        'identity',
        'UNRESOLVED_TARGET',
        'No unique target identity verified; related content was not substituted.',
      );
    }
    if (out.records[0]) out.records[0].url = out.canonicalUrl;
    out.status = out.records.length ? 'PARTIAL' : 'ERROR';
    if (!out.records.length)
      diagnostic(
        'parser',
        'CONTENT_UNAVAILABLE',
        'Public page did not expose source text. Add only the missing fields manually.',
      );
  } catch (e) {
    diagnostic(
      'resolution',
      'RESOLUTION_ERROR',
      e instanceof Error ? e.message : 'Resolution failed',
    );
  }
  out.elapsedMs = Date.now() - started;
  return out;
}
