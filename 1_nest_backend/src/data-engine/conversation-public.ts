import puppeteer, { type Page } from 'puppeteer';
import { BrowserResourceGuard } from './browser-resource-guard';
import type { BrowserResourceReport } from './browser-resource-policy';
import { inspectPublicDiscovery,extractionStop } from './discovery-diagnostics';
import {
  existingPublicBrowser,
  discoveryUrl,
} from '../modules/core/scraper/public-discovery';
import { extractPublicThreads } from '../studio/public-threads';
import {observePublicContext} from '../studio/public-context-dom';
import {newRequestTelemetry,decidePublicRequest,type RequestTelemetry} from '../studio/public-request-telemetry';
import { crawlerInput } from './crawler-adapter';
import { labelledCounts } from '../studio/metadata-fields';
import {
  canonicalPost,
  collectEvidence,
  type PublicDocument,
} from './conversation-evidence';
import type {
  PopularityCandidate,
  PublicPost,
  ThreadCollection,
} from './conversation-contracts';
export interface PublicAccessAudit {url:string;requests:number|null;navigations:number|null;scrolls:number|null;elapsedMs:number;minimumAvailableMiB:number|null;outcome:string;resources?:BrowserResourceReport;stage?:'EXACT_ROOT';requestCoverage?:string;requestTelemetry?:RequestTelemetry}
import { cacheConversationImages } from './conversation-media';
/** Function deliberately self-contained: executed in public DOM, no credential/session access. */
export function observePublicDocument() {
  const cards = [
    ...document.querySelectorAll(
      'div[data-pressable-container="true"],article',
    ),
  ]
    .filter((card) => {
      const box = card.getBoundingClientRect();
      return box.width > 0 && box.height > 0;
    })
    .slice(0, 80);
  const rows = cards.map((card) => {
    const links = [...card.querySelectorAll('a[href*="/post/"]')]
      .map((a) => {
        try {
          const u = new URL(a.getAttribute('href') || '', location.origin);
          return /^\/@[\w.-]+\/post\/[\w-]+\/?$/.test(u.pathname)
            ? u.origin + u.pathname
            : null;
        } catch {
          return null;
        }
      })
      .filter((x): x is string => !!x);
    const controls = [...card.querySelectorAll('[aria-label]')]
      .map((x) => ({
        label: x.getAttribute('aria-label') || '',
        text: (x.textContent || '').trim(),
      }))
      .slice(0, 40);
    const spans = [...card.querySelectorAll('span[dir="auto"]')].map(
      (x) => x.textContent || '',
    );
    return {
      urls: [...new Set(links)],
      controls,
      date:
        card.querySelector('time[datetime]')?.getAttribute('datetime') || null,
      text: spans.sort((a, b) => b.length - a.length)[0] || '',
    };
  });
  const jsonLd: unknown[] = [];
  for (const script of [
    ...document.querySelectorAll('script[type="application/ld+json"]'),
  ].slice(0, 20)) {
    const value = script.textContent || '';
    if (value.length > 250000) continue;
    try {
      jsonLd.push(JSON.parse(value));
    } catch {}
  }
  const explicitNoResults=[...document.querySelectorAll('[role="status"],h1,h2')].some(x=>/^(no results(?: found)?|không có kết quả(?: tìm kiếm)?)\.?$/iu.test((x.textContent||'').trim()));
  return { rows, jsonLd, diagnostics:{cards:cards.length,permalinkAnchors:cards.reduce((n,c)=>n+c.querySelectorAll('a[href*="/post/"]').length,0),explicitNoResults} };
}
/** A bounded disposable browser, no user profile, no stealth, installed executable only. */
async function visit<T>(
  url: string,
  scrolls: number,
  read: (page: Page) => Promise<T>,
  audit?: (event:PublicAccessAudit)=>void,
): Promise<T> {
  const started=Date.now();let requests=0,navigations=0,actualScrolls=0,outcome='COMPLETED';
  const telemetry=newRequestTelemetry();
  const executablePath = existingPublicBrowser();
  if (!executablePath) throw Error('CONVERSATION_BROWSER_MISSING');
  const guard=new BrowserResourceGuard(30000);
  try{
  await guard.start();
  const browser = await guard.launch(signal=>puppeteer.launch({
    executablePath,
    signal,
    timeout:25000,
    headless: true,
    args: ['--disable-background-networking','--disable-extensions','--renderer-process-limit=1'],
  }));
    // Reuse Chromium's initial blank tab rather than leaving it beside a new tab.
    const pages=await browser.pages();
    const page=pages[0]??await browser.newPage();
    for(const extra of pages.slice(1))await extra.close();
    await page.setBypassServiceWorker(true);
    await page.setViewport({ width: 1280, height: 800 });
    await page.setRequestInterception(true);
    page.on('request', (r) => {
      requests++;
      if (r.isNavigationRequest() && r.frame() === page.mainFrame())
        navigations++;
      const admitted=decidePublicRequest(telemetry,r.url(),r.resourceType(),navigations,{events:150,navigation:4,blockHeavy:true});
      void (admitted?r.continue():r.abort()).catch(() => {telemetry.handlingFailures++});
    });
    const response = await page.goto(url, {
      waitUntil: 'domcontentloaded',
      timeout: 15000,
    });
    if (response && response.status() >= 400)
      throw Error('CONVERSATION_HTTP_' + response.status());
    const gate = async () =>
      /\/(?:login|accounts|challenge|checkpoint)(?:\/|\?|$)/i.test(
        page.url(),
      ) ||
      (await page.evaluate(
        () =>
          !!document.querySelector(
            'input[type="password"],iframe[src*="captcha"],[data-testid*="captcha"]',
          ),
      ));
    if (await gate()) throw Error('CONVERSATION_ACCESS_BLOCKED');
    await page
      .waitForSelector(
        'div[data-pressable-container="true"],article,script[type="application/ld+json"]',
        { timeout: 5000 },
      )
      .catch(() => {});
    for (let i = 0; i < scrolls; i++) {
      actualScrolls++;
      await page.evaluate(() => window.scrollBy(0, window.innerHeight));
      await new Promise((r) => setTimeout(r, 500));
      if (await gate()) throw Error('CONVERSATION_ACCESS_BLOCKED');
    }
    const result=await read(page);guard.check();return result;
  } catch (e: any) {
    outcome=guard.report.stopCode??(/^CONVERSATION_[A-Z0-9_]+$/.test(e.message||'')?e.message:'CONVERSATION_NAVIGATION_FAILED');
    if(guard.report.stopCode)throw Error(guard.report.stopCode);
    throw Error(
      /^CONVERSATION_[A-Z0-9_]+$/.test(e.message || '')
        ? e.message
        : 'CONVERSATION_NAVIGATION_FAILED',
    );
  } finally {
    try{await guard.close()}finally{audit?.({url,requests,navigations,scrolls:actualScrolls,elapsedMs:Date.now()-started,minimumAvailableMiB:guard.report.minimumAvailableMiB,outcome:guard.report.cleanupVerified?outcome:guard.report.stopCode??outcome,resources:guard.report,requestTelemetry:telemetry})}
  }
}
export async function discoverConversations(
  keyword: string,
  audit?: (event:PublicAccessAudit)=>void,
  limit = 6,
): Promise<PopularityCandidate[]> {
  if(!Number.isInteger(limit)||limit<1||limit>6)throw Error('CONVERSATION_INVALID_LIMIT');
  const url = discoveryUrl('SEARCH', keyword);
  return visit(url, 1, async (page) => {
    const observed = await page.evaluate(observePublicDocument),
      now = new Date().toISOString(),
      seen = new Set<string>(),
      out: PopularityCandidate[] = [];
    for (const row of observed.rows) {
      const identities = row.urls
          .map(canonicalPost)
          .filter((x): x is NonNullable<typeof x> => !!x),
        unique = [...new Set(identities.map((x) => x.url))];
      // Ambiguous container may include context cards: keep URLs but never attribute their counters.
      for (const identity of identities) {
        if (seen.has(identity.id) || out.length >= limit) continue;
        seen.add(identity.id);
        const fields = labelledCounts(row.controls),
          value = (k: string) =>
            fields[k]?.status === 'AVAILABLE' && !fields[k]?.approximate
              ? Number(fields[k].value)
              : null;
        const post: PublicPost | null =
          unique.length === 1
            ? {
                id: identity.id,
                url: identity.url,
                author: { handle: identity.handle, name: null },
                originalText: '',
                publishedAt:
                  row.date && Number.isFinite(Date.parse(row.date))
                    ? new Date(row.date).toISOString()
                    : null,
                engagement: {
                  likes: value('likeCount'),
                  replies: value('replyCount'),
                  reposts: value('repostCount'),
                  shares: value('shareCount'),
                },
                provenance: {
                  documentUrl: url,
                  observedAt: now,
                  synthetic: false,
                  method: 'UNIQUE_CARD_PERMALINK_LABELLED_COUNTERS',
                },
              }
            : null;
        out.push({ url: identity.url, observedOrder: out.length, post });
      }
    }
    if (!out.length) {
      const outcome=inspectPublicDiscovery({...observed.diagnostics,candidates:0});
      throw Error(outcome==='NO_RESULTS'?'CONVERSATION_NO_RESULTS':outcome==='PARSER_FAILURE'?'CONVERSATION_PARSER_FAILURE':'CONVERSATION_NO_PUBLIC_CANDIDATES');
    }
    return out;
  },audit);
}
export async function enrichConversation(
  url: string,
  audit?: (event:PublicAccessAudit)=>void,
): Promise<ThreadCollection> {
  const target = canonicalPost(url);
  if (!target) throw Error('CONVERSATION_INVALID_URL');
  const attempt = await extractPublicThreads(target.url, 'TARGET_ONLY', true);
  const stopped=extractionStop(attempt.diagnostics);
  audit?.({url:target.url,stage:'EXACT_ROOT',requests:attempt.requestTelemetry?.interceptionEvents??attempt.boundedObservation?.requests??null,navigations:attempt.browserNavigations??null,scrolls:attempt.boundedObservation?.scrolls??null,elapsedMs:attempt.elapsedMs,minimumAvailableMiB:attempt.browserResources?.minimumAvailableMiB??null,outcome:stopped??attempt.status,resources:attempt.browserResources,requestTelemetry:attempt.requestTelemetry,requestCoverage:'Interception decisions only when telemetry exists; null is not zero.'});
  if(stopped)throw Error(stopped);
  const source = crawlerInput(attempt, 'DATA04');
  if (
    attempt.matchMethod !== 'DOM_PERMALINK' ||
    !source ||
    source.sourcePostId !== target.id ||
    canonicalPost(source.sourceUrl)?.url !== target.url ||
    source.author.handle !== target.handle ||
    !source.originalBody
  )
    throw Error('CONVERSATION_EXACT_ROOT_BODY_UNVERIFIED');
  return visit(target.url, 2, async (page) => {
    const final = canonicalPost(page.url());
    if (final?.url !== target.url)
      throw Error('CONVERSATION_ROOT_IDENTITY_MISMATCH');
    const observed = await page.evaluate(observePublicDocument),
      now = new Date().toISOString();
    const fields = attempt.records[0]?.fields;
    const exact = (key: string, value: number | null) =>
      fields?.[key]?.status === 'AVAILABLE' && !fields[key].approximate
        ? value
        : null;
    const root: PublicPost = {
      id: target.id,
      url: target.url,
      author: { handle: target.handle, name: source.author.name },
      originalText: source.originalBody!,
      topic: source.topic,
      itemType: 'UNKNOWN',
      rawPayload: source.rawPayload,
      publishedAt: source.publishedAt,
      engagement: {
        likes: exact('likeCount', source.engagement.likes),
        replies: exact('replyCount', source.engagement.replies),
        reposts: exact('repostCount', source.engagement.reposts),
        shares: exact('shareCount', source.engagement.shares),
      },
      provenance: {
        documentUrl: target.url,
        observedAt: now,
        synthetic: false,
        method: 'EXISTING_EXACT_TARGET_EXTRACTOR',
      },
    };
    root.attachments = await cacheConversationImages(
      root.id,
      (attempt.records[0]?.media || []).map((x) => ({
        url: x.url,
        kind: x.kind,
      })),
      now,
    );
    const cardObservations = observed.rows
      .filter((r) => r.urls.length === 1)
      .map((r) => {
        const fields = labelledCounts(r.controls),
          value = (k: string) =>
            fields[k]?.status === 'AVAILABLE' && !fields[k].approximate
              ? Number(fields[k].value)
              : null;
        return {
          url: r.urls[0],
          publishedAt: r.date,
          engagement: {
            likes: value('likeCount'),
            replies: value('replyCount'),
            reposts: value('repostCount'),
            shares: value('shareCount'),
          },
        };
      });
    const context=await page.evaluate(observePublicContext);
    const doc: PublicDocument = {
      url: target.url,
      observedAt: now,
      synthetic: false,
      visibleUrls: observed.rows.flatMap((x) => x.urls),
      jsonLd: observed.jsonLd,
      cardObservations,
      domReplies:context.replies,
    };
    const collection = collectEvidence(root, doc, 20);
    collection.sourceCapture=attempt;
    const regions=context.regions;
    for(const candidate of collection.unverified){
      const matching=observed.rows.filter(r=>r.urls.length===1&&canonicalPost(r.urls[0])?.url===canonicalPost(candidate.url)?.url);
      const identity=canonicalPost(candidate.url);
      if(identity&&matching.length===1&&matching[0].text.trim())candidate.observation={level:'OBSERVED_ON_TARGET_PAGE',targetUrl:target.url,observedAt:now,author:{handle:identity.handle,name:null},originalText:matching[0].text,contextEvidence:regions.filter(e=>e.subjectUrl===identity.url)};
    }
    return collection;
  },audit);
}
