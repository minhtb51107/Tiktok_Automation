import { BadRequestException } from '@nestjs/common';
import { request } from 'https';
import { lookup } from 'dns/promises';
import {BrowserResourceGuard} from '../data-engine/browser-resource-guard';
import type {BrowserResourceReport} from '../data-engine/browser-resource-policy';
import puppeteer from 'puppeteer';
import {labelledCounts,contextLabelledCounts} from './metadata-fields';
import { matchExactTarget } from './target-identity';
import {existingPublicBrowser} from '../modules/core/scraper/public-discovery';

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
  topic?:string|null;
  bodyText?:string;
  topicEvidence?:{href:string;label:string};
  shareCount?:number|null;
  fields?:Record<string,import('./metadata-fields').ObservedField>;
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
  browserResources?:BrowserResourceReport;
  boundedObservation?: {requests:number;scrolls:number;stopReason:string;minimumAvailableMiB:number;snapshots:unknown[]};
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
  timeoutMs = 20000,
  absoluteDeadline = false,
): Promise<{ status: number; location: string | null; html: string }> {
  const u = new URL(threadsUrl(url));
  const resolving = lookup(u.hostname, { all: true });
  let dnsDeadline: ReturnType<typeof setTimeout> | undefined;
  const addresses = await (absoluteDeadline ? Promise.race([
    resolving,
    new Promise<never>((_,reject)=>{dnsDeadline=setTimeout(()=>reject(Error('Public DNS deadline exceeded')),timeoutMs);}),
  ]).finally(()=>{if(dnsDeadline)clearTimeout(dnsDeadline);}) : resolving);
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
    req.setTimeout(timeoutMs, () => req.destroy(Error('Public response timeout')));
    // DATA-04 controlled reads also bound total response time, not just idle socket time.
    const deadline = absoluteDeadline ? setTimeout(()=>req.destroy(Error('Public response deadline exceeded')),timeoutMs) : undefined;
    req.on('close',()=>{if(deadline)clearTimeout(deadline);});
    req.on('error', reject);
    req.end();
  });
}
export async function extractPublicThreads(
  input: string,
  scope: 'TARGET_ONLY' | 'WITH_CONTEXT' = 'TARGET_ONLY',
  controlled = false,
  live03 = false,
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
    for (let n = 0; n <= (controlled?2:5); n++) {
      const response = await publicGet(url,controlled?8000:20000,controlled);
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
        if (n === (controlled?2:5)) throw Error('Redirect limit reached');
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
    const executable = existingPublicBrowser();
    if (!executable) {
      diagnostic(
        'browser',
        'BROWSER_MISSING',
        'No existing Chrome executable found. Public metadata retained.',
      );
    } else {
      let browser: Awaited<ReturnType<typeof puppeteer.launch>> | undefined;
      let stage = 'browser';
      const guard=new BrowserResourceGuard(controlled?(live03?Math.max(1,60000-(Date.now()-started)):20000):30000);
      try {
        await guard.start();
        browser = await guard.launch(signal=>puppeteer.launch({
          executablePath: executable,
          signal,
          ...(live03?{timeout:Math.max(1,60000-(Date.now()-started))}:{}),
          headless: true,
          args: ['--disable-background-networking','--disable-extensions','--renderer-process-limit=1'],
        }));
        let stopReason='COMPLETED',minimumAvailableMiB=guard.report.minimumAvailableMiB!,scrollCount=0;
        if(live03)out.boundedObservation={requests:out.redirects.length,scrolls:0,stopReason,minimumAvailableMiB,snapshots:[]};
        const pages=await browser.pages();const page=pages[0]??await browser.newPage();
        for(const extra of pages.slice(1))await extra.close();
        await page.setBypassServiceWorker(true);
        await page.setRequestInterception(true);
        let navCount = 0, requestCount=0;
        page.on('request', (r) => {
          requestCount++;
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
            if(live03&&requestCount>147)stopReason='REQUEST_BUDGET';
            void (allowed && navCount <= (live03?2:controlled?4:6) && (!controlled||(requestCount<=(live03?147:150)&&!['image','media','font'].includes(r.resourceType()))) ? r.continue() : r.abort());
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
        if(/\/(?:challenge|checkpoint)(?:\/|\?|$)/i.test(page.url())||await page.evaluate(()=>!!document.querySelector('input[type="password"],iframe[src*="captcha"],[data-testid*="captcha"]')))throw Error('Public access protection encountered; stopped without bypass');
        await page
          .waitForSelector('[data-pressable-container="true"], article', {
            timeout: 10000,
          })
          .catch(() => {});
        stage = 'parser';
        const snapshots:unknown[]=[];
        const collected=new Map<string,any>();
        for(let step=0;step<=(live03?4:0);step++){
        guard.check();minimumAvailableMiB=guard.report.minimumAvailableMiB!;
        if(live03&&stopReason!=='COMPLETED')break;
        if(/\/(?:login|accounts|challenge|checkpoint)(?:\/|\?|$)/i.test(page.url())||await page.evaluate(()=>!!document.querySelector('input[type="password"],iframe[src*="captcha"],[data-testid*="captcha"]'))){stopReason='ACCESS_BLOCKED';break;}
        const snapshot = await page.evaluate(() => {
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
            const controls=[...node.querySelectorAll('[role="button"],button')].map(c=>({label:c.querySelector('svg title')?.textContent||c.getAttribute('aria-label')||'',text:c.textContent||''}));
            const metricIdentityCount=new Set([...node.querySelectorAll('a[href]')].map(a=>(a.getAttribute('href')||'').match(/^\/@[\w.-]+\/post\/([\w-]+)\/?$/)?.[1]).filter(Boolean)).size;
            const topicLinks=[...node.querySelectorAll('a[href]')].filter(a=>{try{const u=new URL(a.getAttribute('href')||'',location.origin);return u.pathname==='/search'&&u.searchParams.get('serp_type')==='tags'&&!!u.searchParams.get('tag_id');}catch{return false;}});
            const topicEvidence=topicLinks.length===1?{label:topicLinks[0].textContent?.trim()||'',href:topicLinks[0].getAttribute('href')||''}:null;
            const content = spans
              .filter(
                (s) =>
                  s !== permalink?.split('/')[1]?.slice(1) &&
                  !/^\d{1,2}\/\d{1,2}\/\d{4}$/.test(s) &&
                  !visibleMetrics.includes(s) &&
                  !['·', 'Tác giả', 'Author', 'Đã ghim', 'Pinned'].includes(s),
              )
              .join('\n');
            // Body projection excludes structural chrome. Keep `content`/spans
            // intact as the raw observation; never strip arbitrary authored lines.
            const bodySpans=[...node.querySelectorAll('span[dir="auto"]')].filter(x=>{
              if(x.closest('time,button,[role="button"]'))return false;
              const link=x.closest('a[href]');
              if(link){const href=link.getAttribute('href')||'';if(href.startsWith('/search?')||/^\/@[\w.-]+\/?$/.test(href)||href===permalink)return false;}
              return true;
            }).map(x=>x.textContent?.trim()||'').filter(Boolean);
            return {
              topicEvidence,
              bodyText:bodySpans.join('\n'),
              spans,
              rawInnerText:(node as HTMLElement).innerText,
              content,
              permalink,
              visibleMetrics,
              controls,
              metricIdentityCount,
              timestampLabel:time?.textContent||null,
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
        snapshots.push({step,observedAt:new Date().toISOString(),rows:snapshot});
        for(const row of snapshot){if(row.permalink&&!collected.has(row.permalink)&&collected.size<40)collected.set(row.permalink,row);}
        if(live03)out.boundedObservation={requests:requestCount+out.redirects.length,scrolls:scrollCount,stopReason,minimumAvailableMiB,snapshots};
        if(!live03||collected.size>=40){if(live03)stopReason='CARD_BUDGET';break;}
        if(step<4){await page.evaluate(()=>window.scrollBy(0,window.innerHeight));scrollCount++;await new Promise(r=>setTimeout(r,650));}
        }
        const rows: Array<{metricIdentityCount?:number;permalink:string|null;content:string;bodyText:string;topicEvidence:{label:string;href:string}|null;controls:Array<{label:string;text:string}>;createdAt:string|null;timestampLabel:string|null;avatar:string|null;media:PublicRecord['media'];visibleMetrics:string[]}>=live03?[...collected.values()]:(snapshots[0] as any)?.rows||[];
        if(live03)out.boundedObservation={requests:requestCount+out.redirects.length,scrolls:scrollCount,stopReason,minimumAvailableMiB,snapshots};
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
          anchor.topic=row.topicEvidence?.label||null;
          anchor.bodyText=row.bodyText;
          if(row.topicEvidence)anchor.topicEvidence=row.topicEvidence;
          anchor.author = targetHandle;
          anchor.handle = targetHandle;
          anchor.url = 'https://www.threads.com' + row.permalink;
          out.matchedTargetId = targetId!;
          out.matchMethod = 'DOM_PERMALINK';
          anchor.provenance.identity = 'exact DOM permalink /post/' + targetId;
        }
        if (row) {
          anchor.fields={...labelledCounts(row.controls),createdAt:{status:row.createdAt?'AVAILABLE':'UNAVAILABLE',value:row.createdAt,raw:row.timestampLabel,source:'exact target time[datetime]'},avatar:{status:row.avatar?'AVAILABLE':'UNAVAILABLE',value:row.avatar,raw:null,source:'exact target DOM image'},media:{status:row.media.length?'AVAILABLE':'NOT_PRESENT',value:row.media.length,raw:null,source:'exact target visible media elements; hidden media not assessed'}};
          for(const key of ['likeCount','replyCount','repostCount','shareCount'])anchor[key]=anchor.fields[key].value;
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
            const metrics=contextLabelledCounts(related.controls,related.metricIdentityCount);
            out.contextCandidates!.push({
              bodyText:related.bodyText,
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
              fields:metrics,
              likeCount:metrics.likeCount.value as number|null,
              replyCount:metrics.replyCount.value as number|null,
              repostCount:metrics.repostCount.value as number|null,
              shareCount:metrics.shareCount.value as number|null,
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
        if(guard.report.stopCode)diagnostic('resource',guard.report.stopCode,'Browser supervisor stopped this owned operation; see browserResources.');
        diagnostic(
          stage,
          stage.toUpperCase() + '_ERROR',
          e instanceof Error ? e.message : 'Browser failed',
        );
      } finally {
        try{await guard.close()}catch{diagnostic('resource','CONVERSATION_BROWSER_CLEANUP_UNVERIFIED','Owned browser cleanup could not be verified; no subsequent browser may start.');}
        out.browserResources=guard.report;
        if(guard.report.stopCode&&!out.diagnostics.some(d=>d.code===guard.report.stopCode))diagnostic('resource',guard.report.stopCode,'Owned browser stopped; see supervisor evidence.');
        if(out.boundedObservation){out.boundedObservation.minimumAvailableMiB=guard.report.minimumAvailableMiB??out.boundedObservation.minimumAvailableMiB;if(guard.report.stopCode)out.boundedObservation.stopReason=guard.report.stopCode;}
        for(const warning of guard.report.warnings)diagnostic('resource',warning,'Low RAM is advisory; not a benchmarked browser minimum.');
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
