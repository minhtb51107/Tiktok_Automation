import puppeteer, { type Page } from 'puppeteer';
import { BrowserResourceGuard } from './browser-resource-guard';
import type { BrowserResourceReport } from './browser-resource-policy';
import {
  inspectPublicDiscovery,
  extractionStop,
} from './discovery-diagnostics';
import {
  existingPublicBrowser,
  discoveryUrl,
} from '../modules/core/scraper/public-discovery';
import { extractPublicThreads } from '../studio/public-threads';
import {
  observePermalinkParentEvidence,
  observePublicContext,
  performPublicConversationAction,
} from '../studio/public-context-dom';
import {
  newRequestTelemetry,
  decidePublicRequest,
  type RequestTelemetry,
} from '../studio/public-request-telemetry';
import { crawlerInput } from './crawler-adapter';
import { labelledCounts } from '../studio/metadata-fields';
import { canonicalPost, type PublicDocument } from './conversation-evidence';
import {
  collectPublicCards,
  planPermalinkDetailValidation,
  resolveExactRoot,
  resolveRelationships,
} from './conversation-extraction-v2';
import type {
  PopularityCandidate,
  PublicPost,
  ConversationAcquisitionTrace,
  ThreadCollection,
} from './conversation-contracts';
export interface PublicAccessAudit {
  url: string;
  requests: number | null;
  navigations: number | null;
  scrolls: number | null;
  interactionActions?: number;
  loadMoreActions?: number;
  nestedExpandActions?: number;
  elapsedMs: number;
  minimumAvailableMiB: number | null;
  outcome: string;
  resources?: BrowserResourceReport;
  stage?: 'EXACT_ROOT';
  requestCoverage?: string;
  requestTelemetry?: RequestTelemetry;
}
export interface PublicDomEvidenceSnapshot {
  finalUrl: string;
  observed: ReturnType<typeof observePublicDocument>;
  context: ReturnType<typeof observePublicContext>;
  acquisition?: ConversationAcquisitionTrace;
  snapshots?: PublicConversationSnapshot[];
}
import { cacheConversationImages } from './conversation-media';

/**
 * Removes only timestamp chrome that the DOM observer accidentally surfaced as a
 * body fragment. The unmodified card innerText remains in rawText evidence.
 */
export function stripObservedTimestampChrome(text: string, publishedAt: string | null) {
  if (!text.trim() || !publishedAt || !Number.isFinite(Date.parse(publishedAt)))
    return text;
  const dateOnly = /^\s*\d{1,2}[./-]\d{1,2}[./-]\d{2,4}\s*$/u;
  return text
    .split(/\r?\n/u)
    .filter((line) => !dateOnly.test(line))
    .join('\n')
    .trim();
}

/** Function deliberately self-contained: executed in public DOM, no credential/session access. */
export function observePublicDocument() {
  const capturedAt = new Date().toISOString();
  const nodePath = (element: Element | null) => {
    const segments: string[] = [];
    for (let node = element; node && node !== document.body; node = node.parentElement) {
      const testId = node.getAttribute('data-testid'),
        role = node.getAttribute('role'),
        siblings = node.parentElement
          ? [...node.parentElement.children].filter((x) => x.tagName === node.tagName)
          : [],
        position = siblings.length > 1 ? `:nth-of-type(${siblings.indexOf(node) + 1})` : '';
      segments.unshift(
        `${node.tagName.toLowerCase()}${testId ? `[data-testid="${testId}"]` : ''}${role ? `[role="${role}"]` : ''}${position}`,
      );
      if (segments.length === 8) break;
    }
    return '/' + segments.join('/');
  };
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
  const rows = cards.map((card, cardIndex) => {
    const owns = (element: Element) =>
      element.closest('div[data-pressable-container="true"],article') === card;
    const links = [...card.querySelectorAll('a[href*="/post/"]')]
      .filter(owns)
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
    const controls = [
      ...card.querySelectorAll('[role="button"],button,[aria-label]'),
    ]
      .filter(owns)
      .map((x) => ({
        label:
          x.querySelector('svg title')?.textContent ||
          x.getAttribute('aria-label') ||
          '',
        text: (x.textContent || '').trim(),
      }))
      .slice(0, 40);
    const times = [...card.querySelectorAll('time[datetime]')].filter(owns);
    const timePermalinks = times
      .map((time) => {
        try {
          const anchor = time.closest('a[href*="/post/"]');
          const u = new URL(
            anchor?.getAttribute('href') || '',
            location.origin,
          );
          return /^\/@[\w.-]+\/post\/[\w-]+\/?$/.test(u.pathname)
            ? 'https://www.threads.com' + u.pathname.replace(/\/$/, '')
            : null;
        } catch {
          return null;
        }
      })
      .filter((value): value is string => !!value);
    const uniqueTimePermalinks = [...new Set(timePermalinks)];
    const subjectUrl =
      uniqueTimePermalinks.length === 1 ? uniqueTimePermalinks[0] : null;
    const handle = subjectUrl?.match(/\/(@[\w.-]+)\/post\//)?.[1] ?? null;
    const bodySpans = [...card.querySelectorAll('span[dir="auto"]')]
      .filter(
        (element) =>
          owns(element) &&
          !element.closest(
            'header,time,button,[role="button"],[data-testid="reply-context"],[data-testid="replying-to"]',
          ) &&
          !element.parentElement?.closest('span[dir="auto"]'),
      )
      .filter((element) => {
        const anchor = element.closest('a[href]');
        if (!anchor) return true;
        const href = anchor.getAttribute('href') || '';
        return !(
          href.startsWith('/search?') ||
          /^\/@[\w.-]+\/?$/.test(href) ||
          /\/post\/[\w-]+\/?$/.test(href)
        );
      })
      .map((element) => (element.textContent || '').trim())
      .filter(Boolean);
    const media = [
      ...[...card.querySelectorAll('img[src]')]
        .filter(owns)
        .filter((image) => {
          const element = image as HTMLImageElement;
          return element.width >= 100 && !element.closest('header');
        })
        .map((image) => ({
          url: (image as HTMLImageElement).src,
          kind: 'IMAGE' as const,
        })),
      ...[...card.querySelectorAll('video')]
        .filter(owns)
        .map((video) => (video as HTMLVideoElement).currentSrc)
        .filter((url) => url.startsWith('https:'))
        .map((url) => ({ url, kind: 'VIDEO' as const })),
    ];
    const relationshipSignals = [
      ...card.querySelectorAll(
        'header a[href],[data-testid="reply-context"] a[href],[data-testid="replying-to"] a[href]',
      ),
    ]
      .filter(owns)
      .map((anchor) => ({
        label: (
          anchor.getAttribute('aria-label') ||
          anchor.textContent ||
          ''
        ).trim(),
        href: anchor.getAttribute('href') || '',
        pointer: nodePath(anchor),
      }))
      .filter((signal) => signal.label || signal.href)
      .slice(0, 10);
    let container = card.parentElement;
    while (
      container &&
      container !== document.body &&
      !container.matches('section,[role="region"],[data-testid]')
    )
      container = container.parentElement;
    return {
      urls: [...new Set(links)],
      subjectUrl,
      authorHandle: handle?.slice(1) ?? null,
      controls,
      date: times.length === 1 ? times[0].getAttribute('datetime') : null,
      text: bodySpans.join('\n'),
      rawText: (card as HTMLElement).innerText,
      media,
      pointer: `/dom/card/${cardIndex}`,
      nodeIdentity: nodePath(card),
      parentContainerPath: nodePath(card.parentElement),
      conversationContainer: container
        ? {
            pointer: nodePath(container),
            ariaLabel: container.getAttribute('aria-label'),
            testId: container.getAttribute('data-testid'),
            role: container.getAttribute('role'),
          }
        : null,
      relationshipSignals,
      observedActionId: null as string | null,
      capturedAt,
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
  const explicitNoResults = [
    ...document.querySelectorAll('[role="status"],h1,h2'),
  ].some((x) =>
    /^(no results(?: found)?|không có kết quả(?: tìm kiếm)?)\.?$/iu.test(
      (x.textContent || '').trim(),
    ),
  );
  return {
    rows,
    jsonLd,
    diagnostics: {
      cards: cards.length,
      permalinkAnchors: cards.reduce(
        (n, c) =>
          n +
          [...c.querySelectorAll('a[href*="/post/"]')].filter(
            (a) =>
              a.closest('div[data-pressable-container="true"],article') === c,
          ).length,
        0,
      ),
      materializedCards: rows.filter(
        (row) => row.subjectUrl && row.authorHandle && row.text.trim(),
      ).length,
      subjectPermalinks: rows.filter((row) => row.subjectUrl).length,
      explicitNoResults,
    },
  };
}

export interface PublicConversationSnapshot {
  actionId: string;
  at: string;
  observed: ReturnType<typeof observePublicDocument>;
  context: ReturnType<typeof observePublicContext>;
}

/** Merge bounded snapshots by exact subject identity; never merges unidentified cards. */
export function mergeConversationSnapshots(
  snapshots: PublicConversationSnapshot[],
) {
  const rows = new Map<
    string,
    ReturnType<typeof observePublicDocument>['rows'][number]
  >();
  const jsonLd = new Map<string, unknown>();
  let explicitNoResults = false,
    permalinkAnchors = 0;
  for (const snapshot of snapshots) {
    explicitNoResults ||= snapshot.observed.diagnostics.explicitNoResults;
    permalinkAnchors = Math.max(
      permalinkAnchors,
      snapshot.observed.diagnostics.permalinkAnchors,
    );
    for (const value of snapshot.observed.jsonLd)
      jsonLd.set(JSON.stringify(value), value);
    snapshot.observed.rows.forEach((raw, index) => {
      const row = {
          ...raw,
          text: stripObservedTimestampChrome(raw.text, raw.date),
          observedActionId: snapshot.actionId,
        },
        key = row.subjectUrl
          ? `subject:${row.subjectUrl}`
          : `unidentified:${snapshot.actionId}:${row.nodeIdentity}:${index}`,
        prior = rows.get(key),
        score = (candidate: typeof row) =>
          (candidate.subjectUrl ? 100000 : 0) +
          (candidate.authorHandle ? 10000 : 0) +
          candidate.text.length * 10 +
          candidate.media.length;
      if (!prior || score(row) > score(prior)) rows.set(key, row);
    });
  }
  const mergedRows = [...rows.values()].slice(0, 40);
  return {
    rows: mergedRows,
    jsonLd: [...jsonLd.values()],
    diagnostics: {
      cards: mergedRows.length,
      permalinkAnchors,
      materializedCards: mergedRows.filter(
        (row) => row.subjectUrl && row.authorHandle && row.text.trim(),
      ).length,
      subjectPermalinks: mergedRows.filter((row) => row.subjectUrl).length,
      explicitNoResults,
    },
  };
}

/** Browser-driven bounded exploration. All relationship claims still go through collectEvidence(). */
export async function drivePublicConversation(
  page: Page,
  targetUrl: string,
  maxActions = 4,
) {
  if (!Number.isInteger(maxActions) || maxActions < 0 || maxActions > 4)
    throw Error('CONVERSATION_INVALID_ACTION_BUDGET');
  const transitions: ConversationAcquisitionTrace['transitions'] = [],
    actions: ConversationAcquisitionTrace['actions'] = [],
    snapshots: PublicConversationSnapshot[] = [];
  const transition = (
    state: ConversationAcquisitionTrace['transitions'][number]['state'],
    reason: string,
    actionId: string | null,
    observed?: ReturnType<typeof observePublicDocument>,
  ) =>
    transitions.push({
      state,
      at: new Date().toISOString(),
      reason,
      actionId,
      subjectCards: observed?.diagnostics.subjectPermalinks ?? 0,
      fullBodyCards: observed?.diagnostics.materializedCards ?? 0,
    });
  const capture = async (actionId: string) => {
    const [observed, context] = await Promise.all([
      page.evaluate(observePublicDocument),
      page.evaluate(observePublicContext),
    ]);
    snapshots.push({ actionId, at: new Date().toISOString(), observed, context });
    return { observed, context };
  };

  transition('OPEN_TARGET', 'CANONICAL_TARGET_NAVIGATION_COMPLETED', null);
  if (canonicalPost(page.url())?.url !== canonicalPost(targetUrl)?.url)
    throw Error('CONVERSATION_ROOT_IDENTITY_MISMATCH');
  let latest = await capture('initial');
  transition('ROOT_RESOLVED', 'EXACT_CANONICAL_ROOT_MATCHED', null, latest.observed);
  if (latest.context.regions.some((row) => row.kind === 'DISCUSSION_REGION'))
    transition(
      'CONVERSATION_VISIBLE',
      'EXPLICIT_PUBLIC_CONVERSATION_REGION_OBSERVED',
      null,
      latest.observed,
    );
  transition(
    'COLLECTING',
    'INITIAL_VISIBLE_CARD_SNAPSHOT',
    'initial',
    latest.observed,
  );

  let unchanged = 0;
  for (let index = 0; index < maxActions; index++) {
    const id = `action-${index + 1}`,
      beforeSubjects = new Set(
        latest.observed.rows.map((row) => row.subjectUrl).filter(Boolean),
      ).size,
      beforeCards = latest.observed.diagnostics.cards,
      action = await page.evaluate(performPublicConversationAction, {
        actionId: id,
        allowReplyExpansion: true,
      });
    transition(
      action.kind === 'EXPAND_NESTED' ? 'EXPANDING_NESTED' : 'LOADING_MORE',
      action.kind === 'SCROLL'
        ? 'BOUNDED_SCROLL_FOR_MORE_PUBLIC_CARDS'
        : 'EXPLICIT_PUBLIC_REPLY_CONTROL_ACTIVATED',
      id,
      latest.observed,
    );
    await page
      .waitForFunction(
        (cards: number, height: number) =>
          document.querySelectorAll(
            'div[data-pressable-container="true"],article',
          ).length > cards || document.documentElement.scrollHeight > height,
        { timeout: 3500, polling: 100 },
        beforeCards,
        action.documentHeightBefore,
      )
      .catch(() => {});
    latest = await capture(id);
    const afterSubjects = new Set(
        latest.observed.rows.map((row) => row.subjectUrl).filter(Boolean),
      ).size,
      changed = afterSubjects > beforeSubjects;
    actions.push({
      id,
      kind: action.kind,
      label: action.label,
      containerIdentity: action.containerIdentity,
      beforeSubjects,
      afterSubjects,
      changed,
      at: new Date().toISOString(),
    });
    transition(
      'COLLECTING',
      changed ? 'NEW_SUBJECT_CARD_OBSERVED' : 'NO_NEW_SUBJECT_CARD',
      id,
      latest.observed,
    );
    unchanged = changed ? 0 : unchanged + 1;
    if (unchanged >= 2) break;
  }
  const merged = mergeConversationSnapshots(snapshots),
    contexts = snapshots.flatMap((snapshot) => snapshot.context.regions),
    replies = snapshots.flatMap((snapshot) => snapshot.context.replies),
    context = {
      regions: contexts.filter(
        (row, index) =>
          contexts.findIndex(
            (other) =>
              other.kind === row.kind && other.subjectUrl === row.subjectUrl,
          ) === index,
      ),
      replies: replies.filter(
        (row, index) =>
          replies.findIndex(
            (other) =>
              other.subjectUrl === row.subjectUrl &&
              other.parentUrl === row.parentUrl,
          ) === index,
      ),
    };
  const trace: ConversationAcquisitionTrace = {
    version: 'conversation-browser-acquisition/1',
    transitions,
    actions,
    snapshots: snapshots.map((snapshot) => ({
      actionId: snapshot.actionId,
      at: snapshot.at,
      subjectCards: snapshot.observed.diagnostics.subjectPermalinks,
      fullBodyCards: snapshot.observed.diagnostics.materializedCards,
      explicitReplies: snapshot.context.replies.length,
      discussionCards: snapshot.context.regions.filter(
        (row) => row.kind === 'DISCUSSION_REGION',
      ).length,
      recommendedCards: snapshot.context.regions.filter(
        (row) => row.kind === 'RECOMMENDATION_REGION',
      ).length,
    })),
    stopReason:
      actions.length < maxActions
        ? 'NO_ADDITIONAL_PUBLIC_SUBJECTS_AFTER_TWO_ACTIONS'
        : 'ACTION_BUDGET_REACHED',
  };
  return { observed: merged, context, trace, snapshots };
}
/** A bounded disposable browser, no user profile, no stealth, installed executable only. */
async function visit<T>(
  url: string,
  scrolls: number,
  read: (page: Page) => Promise<T>,
  audit?: (event: PublicAccessAudit) => void,
  timeoutMs = 30000,
): Promise<T> {
  const started = Date.now();
  let requests = 0,
    navigations = 0,
    actualScrolls = 0,
    interactionActions = 0,
    loadMoreActions = 0,
    nestedExpandActions = 0,
    outcome = 'COMPLETED';
  const telemetry = newRequestTelemetry();
  const executablePath = existingPublicBrowser();
  if (!executablePath) throw Error('CONVERSATION_BROWSER_MISSING');
  const guard = new BrowserResourceGuard(timeoutMs);
  try {
    await guard.start();
    const browser = await guard.launch((signal) =>
      puppeteer.launch({
        executablePath,
        signal,
        timeout: 25000,
        headless: true,
        args: [
          '--disable-background-networking',
          '--disable-extensions',
          '--renderer-process-limit=1',
        ],
      }),
    );
    // Reuse Chromium's initial blank tab rather than leaving it beside a new tab.
    const pages = await browser.pages();
    const page = pages[0] ?? (await browser.newPage());
    for (const extra of pages.slice(1)) await extra.close();
    await page.setBypassServiceWorker(true);
    await page.setViewport({ width: 1280, height: 800 });
    await page.setRequestInterception(true);
    page.on('request', (r) => {
      requests++;
      if (r.isNavigationRequest() && r.frame() === page.mainFrame())
        navigations++;
      const admitted = decidePublicRequest(
        telemetry,
        r.url(),
        r.resourceType(),
        navigations,
        { events: 150, navigation: 4, blockHeavy: true },
      );
      void (admitted ? r.continue() : r.abort()).catch(() => {
        telemetry.handlingFailures++;
      });
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
    const result = await read(page);
    const trace = (result as { acquisition?: ConversationAcquisitionTrace })
      ?.acquisition;
    if (trace) {
      interactionActions = trace.actions.length;
      actualScrolls = trace.actions.filter((row) => row.kind === 'SCROLL').length;
      loadMoreActions = trace.actions.filter((row) => row.kind === 'LOAD_MORE').length;
      nestedExpandActions = trace.actions.filter(
        (row) => row.kind === 'EXPAND_NESTED',
      ).length;
    }
    guard.check();
    return result;
  } catch (e: any) {
    outcome =
      guard.report.stopCode ??
      (/^CONVERSATION_[A-Z0-9_]+$/.test(e.message || '')
        ? e.message
        : 'CONVERSATION_NAVIGATION_FAILED');
    if (guard.report.stopCode) throw Error(guard.report.stopCode);
    throw Error(
      /^CONVERSATION_[A-Z0-9_]+$/.test(e.message || '')
        ? e.message
        : 'CONVERSATION_NAVIGATION_FAILED',
    );
  } finally {
    try {
      await guard.close();
    } finally {
      audit?.({
        url,
        requests,
        navigations,
        scrolls: actualScrolls,
        interactionActions,
        loadMoreActions,
        nestedExpandActions,
        elapsedMs: Date.now() - started,
        minimumAvailableMiB: guard.report.minimumAvailableMiB,
        outcome: guard.report.cleanupVerified
          ? outcome
          : (guard.report.stopCode ?? outcome),
        resources: guard.report,
        requestTelemetry: telemetry,
      });
    }
  }
}
export async function discoverConversations(
  keyword: string,
  audit?: (event: PublicAccessAudit) => void,
  limit = 6,
): Promise<PopularityCandidate[]> {
  if (!Number.isInteger(limit) || limit < 1 || limit > 10)
    throw Error('CONVERSATION_INVALID_LIMIT');
  const url = discoveryUrl('SEARCH', keyword);
  return visit(
    url,
    1,
    async (page) => {
      const observed = await page.evaluate(observePublicDocument),
        now = new Date().toISOString(),
        seen = new Set<string>(),
        out: PopularityCandidate[] = [];
      for (const row of observed.rows) {
        const identities = (row.subjectUrl ? [row.subjectUrl] : [])
            .map(canonicalPost)
            .filter((x): x is NonNullable<typeof x> => !!x),
          unique = [...new Set(identities.map((x) => x.url))];
        // Ambiguous container may include context cards: keep URLs but never attribute their counters.
        for (const identity of identities) {
          if (seen.has(identity.id) || out.length >= limit) continue;
          seen.add(identity.id);
          const fields = labelledCounts(row.controls, now),
            value = (k: string) =>
              fields[k]?.status === 'AVAILABLE'
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
                  engagementFields: fields as PublicPost['engagementFields'],
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
        const outcome = inspectPublicDiscovery({
          ...observed.diagnostics,
          candidates: 0,
        });
        throw Error(
          outcome === 'NO_RESULTS'
            ? 'CONVERSATION_NO_RESULTS'
            : outcome === 'PARSER_FAILURE'
              ? 'CONVERSATION_PARSER_FAILURE'
              : 'CONVERSATION_NO_PUBLIC_CANDIDATES',
        );
      }
      return out;
    },
    audit,
  );
}
export async function enrichConversation(
  url: string,
  audit?: (event: PublicAccessAudit) => void,
  evidence?: (page: Page, snapshot: PublicDomEvidenceSnapshot) => Promise<void>,
  totalBudgetMs = 180000,
): Promise<ThreadCollection> {
  if (
    !Number.isInteger(totalBudgetMs) ||
    totalBudgetMs < 30000 ||
    totalBudgetMs > 180000
  )
    throw Error('CONVERSATION_INVALID_TIME_BUDGET');
  const acquisitionStarted = Date.now();
  const target = canonicalPost(url);
  if (!target) throw Error('CONVERSATION_INVALID_URL');
  const attempt = await extractPublicThreads(target.url, 'TARGET_ONLY', true);
  const stopped = extractionStop(attempt.diagnostics);
  audit?.({
    url: target.url,
    stage: 'EXACT_ROOT',
    requests:
      attempt.requestTelemetry?.interceptionEvents ??
      attempt.boundedObservation?.requests ??
      null,
    navigations: attempt.browserNavigations ?? null,
    scrolls: attempt.boundedObservation?.scrolls ?? null,
    elapsedMs: attempt.elapsedMs,
    minimumAvailableMiB: attempt.browserResources?.minimumAvailableMiB ?? null,
    outcome: stopped ?? attempt.status,
    resources: attempt.browserResources,
    requestTelemetry: attempt.requestTelemetry,
    requestCoverage:
      'Interception decisions only when telemetry exists; null is not zero.',
  });
  if (stopped) throw Error(stopped);
  const remainingBudgetMs = totalBudgetMs - (Date.now() - acquisitionStarted);
  if (remainingBudgetMs < 1000) throw Error('CONVERSATION_TIME_BUDGET');
  const source = crawlerInput(attempt, 'DATA04');
  if (attempt.matchMethod !== 'DOM_PERMALINK' || !source)
    throw Error('CONVERSATION_EXACT_ROOT_BODY_UNVERIFIED');
  resolveExactRoot({
    targetUrl: target.url,
    sourcePostId: source.sourcePostId,
    sourceUrl: source.sourceUrl,
    authorHandle: source.author.handle,
    originalBody: source.originalBody,
  });
  return visit(
    target.url,
    0,
    async (page) => {
      const final = canonicalPost(page.url());
      if (final?.url !== target.url)
        throw Error('CONVERSATION_ROOT_IDENTITY_MISMATCH');
      const driven = await drivePublicConversation(page, target.url, 4),
        observed = driven.observed,
        context = driven.context,
        now = new Date().toISOString();
      const fields = attempt.records[0]?.fields;
      const exact = (key: string, value: number | null) =>
        fields?.[key]?.status === 'AVAILABLE' ? value : null;
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
        engagementFields: fields as PublicPost['engagementFields'],
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
        .filter((r) => !!r.subjectUrl)
        .map((r) => {
          const fields = labelledCounts(r.controls, now),
            value = (k: string) =>
              fields[k]?.status === 'AVAILABLE'
                ? Number(fields[k].value)
                : null;
          return {
            url: r.subjectUrl!,
            publishedAt: r.date,
            engagement: {
              likes: value('likeCount'),
              replies: value('replyCount'),
              reposts: value('repostCount'),
              shares: value('shareCount'),
            },
            engagementFields: fields as PublicPost['engagementFields'],
          };
        });
      const observedCards = collectPublicCards(
        observed,
        context,
        target.url,
        now,
      );
      await evidence?.(page, {
        finalUrl: page.url(),
        observed,
        context,
        acquisition: driven.trace,
        snapshots: driven.snapshots,
      });
      const relationshipCandidates: NonNullable<
          PublicDocument['relationshipCandidates']
        > = [],
        relationshipDiagnostics: NonNullable<
          ThreadCollection['relationshipDiagnostics']
        > = [];
      driven.trace.transitions.push({
        state: 'RESOLVING_RELATIONSHIPS',
        at: new Date().toISOString(),
        reason: 'BOUNDED_EVIDENCE_RESOLUTION_STARTED',
        actionId: null,
        subjectCards: observed.diagnostics.subjectPermalinks,
        fullBodyCards: observed.diagnostics.materializedCards,
      });
      for (const detailUrl of planPermalinkDetailValidation(
        target.url,
        observedCards,
        context,
        2,
      )) {
        const checkedAt = new Date().toISOString();
        try {
          const response = await page.goto(detailUrl, {
            waitUntil: 'domcontentloaded',
            timeout: 12000,
          });
          if (response && response.status() >= 400) {
            relationshipDiagnostics.push({
              source: 'PERMALINK_DETAIL',
              url: detailUrl,
              status: `HTTP_${response.status()}`,
              observedAt: checkedAt,
            });
            continue;
          }
          if (
            /\/(?:login|accounts|challenge|checkpoint)(?:\/|\?|$)/i.test(
              page.url(),
            ) ||
            canonicalPost(page.url())?.url !== detailUrl
          )
            throw Error('CONVERSATION_ACCESS_BLOCKED');
          await page
            .waitForSelector(
              'div[data-pressable-container="true"],article,script[type="application/ld+json"]',
              { timeout: 4000 },
            )
            .catch(() => {});
          const detail = await page.evaluate(
            observePermalinkParentEvidence,
            target.url,
          );
          relationshipDiagnostics.push({
            source: 'PERMALINK_DETAIL',
            url: detailUrl,
            status: detail.status,
            observedAt: checkedAt,
          });
          if (detail.candidate) relationshipCandidates.push(detail.candidate);
        } catch (error: any) {
          if (error?.message === 'CONVERSATION_ACCESS_BLOCKED') throw error;
          relationshipDiagnostics.push({
            source: 'PERMALINK_DETAIL',
            url: detailUrl,
            status: 'DETAIL_VALIDATION_FAILED',
            observedAt: checkedAt,
          });
        }
      }
      const doc: PublicDocument = {
        url: target.url,
        observedAt: now,
        synthetic: false,
        visibleUrls: observed.rows
          .map((x) => x.subjectUrl)
          .filter((x): x is string => !!x),
        jsonLd: observed.jsonLd,
        cardObservations,
        domReplies: context.replies,
        relationshipCandidates,
      };
      const collection = resolveRelationships(root, doc, 20);
      driven.trace.transitions.push({
        state: collection.verifiedReplyCount > 0 ? 'COMPLETE' : 'PARTIAL',
        at: new Date().toISOString(),
        reason:
          collection.verifiedReplyCount > 0
            ? 'GRAPH_VALIDATION_COMPLETED_WITH_VERIFIED_RELATIONSHIPS'
            : 'NO_PUBLIC_PARENT_EVIDENCE',
        actionId: null,
        subjectCards: observed.diagnostics.subjectPermalinks,
        fullBodyCards: observed.diagnostics.materializedCards,
      });
      collection.sourceCapture = attempt;
      collection.observedCards = observedCards;
      collection.acquisition = driven.trace;
      collection.relationshipDiagnostics = relationshipDiagnostics;
      collection.observationSummary = {
        subjectPermalinks: new Set(
          observed.rows.map((row) => row.subjectUrl).filter(Boolean),
        ).size,
        materializedCards: observedCards.length,
        missingBody: observed.rows.filter(
          (row) => row.subjectUrl && (!row.authorHandle || !row.text.trim()),
        ).length,
        parentVerified: collection.verifiedReplyCount,
      };
      const regions = context.regions;
      for (const candidate of collection.unverified) {
        const matching = observed.rows.filter(
          (r) =>
            !!r.subjectUrl &&
            canonicalPost(r.subjectUrl)?.url ===
              canonicalPost(candidate.url)?.url,
        );
        const identity = canonicalPost(candidate.url);
        if (identity && matching.length === 1 && matching[0].text.trim())
          candidate.observation = {
            level: 'OBSERVED_ON_TARGET_PAGE',
            targetUrl: target.url,
            observedAt: now,
            author: { handle: identity.handle, name: null },
            originalText: matching[0].text,
            contextEvidence: regions.filter(
              (e) => e.subjectUrl === identity.url,
            ),
          };
      }
      return collection;
    },
    audit,
    Math.min(150000, remainingBudgetMs),
  );
}
