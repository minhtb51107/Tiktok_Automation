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
  decidePublicRequestDetailed,
  type RequestTelemetry,
} from '../studio/public-request-telemetry';
import { crawlerInput } from './crawler-adapter';
import { labelledCounts } from '../studio/metadata-fields';
import { canonicalPost, type PublicDocument } from './conversation-evidence';
import {
  collectPublicCards,
  planPermalinkDetailValidation,
  resolveExactRoot,
  resolveConversationMembership,
  resolveRelationships,
} from './conversation-extraction-v2';
import type {
  PopularityCandidate,
  PublicPost,
  ConversationAcquisitionTrace,
  ConversationCollectionBudget,
  MembershipEvidence,
  ThreadCollection,
} from './conversation-contracts';
import {
  extractStructuredEvidence,
  diagnoseStructuredAcquisition,
  observeStructuredSsrScripts,
  parseSsrRelayScripts,
  PassiveStructuredResponseObserver,
  type StructuredExtraction,
} from './conversation-structured';
export const DEFAULT_CONVERSATION_BUDGET: ConversationCollectionBudget = {
  maxDurationMs: 180000,
  maxActions: 4,
  maxCards: 40,
  maxRequestEvents: 150,
  maxUnchangedActions: 2,
  maxPermalinkValidations: 2,
};
export const DEEP_CONVERSATION_BUDGET: ConversationCollectionBudget = {
  maxDurationMs: 90000,
  maxActions: 15,
  maxCards: 100,
  maxRequestEvents: 300,
  maxUnchangedActions: 3,
  maxPermalinkValidations: 2,
};
export function conversationBudget(value?: Partial<ConversationCollectionBudget>) {
  const budget = { ...DEFAULT_CONVERSATION_BUDGET, ...value };
  if (
    !Number.isInteger(budget.maxActions) || budget.maxActions < 0 || budget.maxActions > 15 ||
    !Number.isInteger(budget.maxDurationMs) || budget.maxDurationMs < 30000 || budget.maxDurationMs > 180000 ||
    !Number.isInteger(budget.maxCards) || budget.maxCards < 1 || budget.maxCards > 100 ||
    !Number.isInteger(budget.maxRequestEvents) || budget.maxRequestEvents < 50 || budget.maxRequestEvents > 500 ||
    !Number.isInteger(budget.maxUnchangedActions) || budget.maxUnchangedActions < 1 || budget.maxUnchangedActions > 5 ||
    !Number.isInteger(budget.maxPermalinkValidations) || budget.maxPermalinkValidations < 0 || budget.maxPermalinkValidations > 2
  ) throw Error('CONVERSATION_INVALID_COLLECTION_BUDGET');
  return budget;
}
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
  attempt?: number;
  failure?: PublicBrowserFailure | null;
  navigation?: {
    requestedDocument: string;
    finalDocument: string | null;
    httpStatus: number | null;
    redirected: boolean | null;
    responseReceived: boolean;
  };
}
export type PublicBrowserFailureCategory =
  | 'TIMEOUT'
  | 'NETWORK'
  | 'BROWSER'
  | 'ACCESS'
  | 'HTTP'
  | 'PARSER'
  | 'RESOURCE'
  | 'UNKNOWN';
export interface PublicBrowserFailure {
  stage:
    | 'RESOURCE_PREFLIGHT'
    | 'BROWSER_LAUNCH'
    | 'BROWSER_SETUP'
    | 'NAVIGATION'
    | 'ACCESS_GATE'
    | 'DOM_READ'
    | 'CLEANUP';
  category: PublicBrowserFailureCategory;
  code: string;
  httpStatus: number | null;
  timeoutType: 'PUPPETEER_PAGE_GOTO' | 'RESOURCE_DEADLINE' | null;
  causeCode: string | null;
  transient: boolean;
}

const knownCode = (value: unknown) =>
  typeof value === 'string' && /^CONVERSATION_[A-Z0-9_]+$/.test(value)
    ? value
    : null;

/** Fixed labels only: raw Puppeteer messages, URLs and local paths never persist. */
export function classifyPublicBrowserFailure(
  error: unknown,
  stage: PublicBrowserFailure['stage'],
): PublicBrowserFailure {
  const row = error as { name?: unknown; message?: unknown; publicFailure?: unknown },
    name = typeof row?.name === 'string' ? row.name : '',
    message = typeof row?.message === 'string' ? row.message : '',
    existing = knownCode(message),
    http = existing?.match(/^CONVERSATION_HTTP_(\d{3})$/)?.[1];
  const carried = row?.publicFailure as PublicBrowserFailure | undefined;
  if (
    carried &&
    knownCode(carried.code) &&
    ['TIMEOUT', 'NETWORK', 'BROWSER', 'ACCESS', 'HTTP', 'PARSER', 'RESOURCE', 'UNKNOWN'].includes(carried.category)
  ) return structuredClone(carried);
  if (existing) {
    if (existing === 'CONVERSATION_NAVIGATION_TIMEOUT')
      return {
        stage,
        category: 'TIMEOUT',
        code: existing,
        httpStatus: null,
        timeoutType: 'PUPPETEER_PAGE_GOTO',
        causeCode: 'PUPPETEER_TIMEOUT',
        transient: true,
      };
    const resource = /RESOURCE|TIME_BUDGET|CLEANUP/.test(existing),
      access = /ACCESS_BLOCKED|HTTP_(401|403|429)/.test(existing),
      parser = /PARSER|NO_PUBLIC_CANDIDATES|NO_RESULTS/.test(existing);
    return {
      stage,
      category: resource
        ? 'RESOURCE'
        : access
          ? 'ACCESS'
          : http
            ? 'HTTP'
            : parser
              ? 'PARSER'
              : 'UNKNOWN',
      code: existing,
      httpStatus: http ? Number(http) : null,
      timeoutType: existing === 'CONVERSATION_TIME_BUDGET' ? 'RESOURCE_DEADLINE' : null,
      causeCode: null,
      transient: false,
    };
  }
  if (name === 'TimeoutError' || /Navigation timeout|Waiting failed.*timeout/iu.test(message))
    return {
      stage,
      category: 'TIMEOUT',
      code: 'CONVERSATION_NAVIGATION_TIMEOUT',
      httpStatus: null,
      timeoutType: 'PUPPETEER_PAGE_GOTO',
      causeCode: 'PUPPETEER_TIMEOUT',
      transient: true,
    };
  const networkCode = message.match(/net::(ERR_[A-Z0-9_]+)/u)?.[1] ?? null;
  if (networkCode)
    return {
      stage,
      category: 'NETWORK',
      code: 'CONVERSATION_NAVIGATION_NETWORK_ERROR',
      httpStatus: null,
      timeoutType: null,
      causeCode: networkCode,
      transient: [
        'ERR_CONNECTION_CLOSED',
        'ERR_CONNECTION_RESET',
        'ERR_NETWORK_CHANGED',
        'ERR_TIMED_OUT',
      ].includes(networkCode),
    };
  if (/Target closed|Session closed|browser has disconnected|Protocol error/iu.test(message))
    return {
      stage,
      category: 'BROWSER',
      code: 'CONVERSATION_BROWSER_FAILURE',
      httpStatus: null,
      timeoutType: null,
      causeCode: name.replace(/[^A-Za-z0-9_]/g, '').slice(0, 60) || null,
      transient: false,
    };
  return {
    stage,
    category: 'UNKNOWN',
    code: 'CONVERSATION_NAVIGATION_FAILED',
    httpStatus: null,
    timeoutType: null,
    causeCode: name.replace(/[^A-Za-z0-9_]/g, '').slice(0, 60) || null,
    transient: false,
  };
}

export async function withTransientPublicRetry<T>(
  run: (attempt: number) => Promise<T>,
  backoff: (attempt: number) => Promise<void> = (attempt) =>
    new Promise((resolve) => setTimeout(resolve, attempt * 1000)),
) {
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      return await run(attempt);
    } catch (error) {
      const failure = classifyPublicBrowserFailure(error, 'NAVIGATION');
      if (attempt === 2 || !failure.transient) throw error;
      await backoff(attempt);
    }
  }
  throw Error('CONVERSATION_NAVIGATION_FAILED');
}

const sanitizedPublicDocumentUrl = (value: string) => {
  try {
    const url = new URL(value);
    return `${url.origin}${url.pathname}`;
  } catch {
    return 'INVALID_PUBLIC_URL';
  }
};
export interface PublicDomEvidenceSnapshot {
  finalUrl: string;
  observed: ReturnType<typeof observePublicDocument>;
  context: ReturnType<typeof observePublicContext>;
  acquisition?: ConversationAcquisitionTrace;
  snapshots?: PublicConversationSnapshot[];
  structured?: Omit<StructuredExtraction, 'relationshipCandidates' | 'cards'>;
}
import { cacheConversationImages } from './conversation-media';

/**
 * Removes only timestamp chrome that the DOM observer accidentally surfaced as a
 * body fragment. The unmodified card innerText remains in rawText evidence.
 */
export function stripObservedTimestampChrome(
  text: string,
  publishedAt: string | null,
) {
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
    for (
      let node = element;
      node && node !== document.body;
      node = node.parentElement
    ) {
      const testId = node.getAttribute('data-testid'),
        role = node.getAttribute('role'),
        siblings = node.parentElement
          ? [...node.parentElement.children].filter(
              (x) => x.tagName === node.tagName,
            )
          : [],
        position =
          siblings.length > 1
            ? `:nth-of-type(${siblings.indexOf(node) + 1})`
            : '';
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
    const avatarUrl =
      [...card.querySelectorAll('img[src]')]
        .filter(owns)
        .map((image) => image as HTMLImageElement)
        .find(
          (image) =>
            image.width > 10 &&
            image.width < 100 &&
            /^https:/i.test(image.src || '') &&
            !/static\.cdninstagram\.com\/rsrc\.php|\/rsrc\.php\/v\d+\//i.test(
              image.src || '',
            ),
        )?.src ?? null;
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
      avatarUrl,
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
  maxCards = DEFAULT_CONVERSATION_BUDGET.maxCards,
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
  const mergedRows = [...rows.values()].slice(0, maxCards);
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
  structured?: PassiveStructuredResponseObserver,
  requestedBudget?: Partial<ConversationCollectionBudget>,
) {
  const budget = conversationBudget({ ...requestedBudget, maxActions });
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
  const capture = async (actionId: string, captureSsr = true) => {
    const [observed, context] = await Promise.all([
      page.evaluate(observePublicDocument),
      page.evaluate(observePublicContext),
    ]);
    snapshots.push({
      actionId,
      at: new Date().toISOString(),
      observed,
      context,
    });
    if (structured && captureSsr)
      structured.observeSsr(
        actionId === 'initial' ? 'BEFORE_ACTIONS' : `AFTER_${actionId}`,
        await page.evaluate(observeStructuredSsrScripts),
        new URL(page.url()).pathname,
      );
    return { observed, context };
  };

  transition('OPEN_TARGET', 'CANONICAL_TARGET_NAVIGATION_COMPLETED', null);
  if (canonicalPost(page.url())?.url !== canonicalPost(targetUrl)?.url)
    throw Error('CONVERSATION_ROOT_IDENTITY_MISMATCH');
  let latest = await capture('initial');
  transition(
    'ROOT_RESOLVED',
    'EXACT_CANONICAL_ROOT_MATCHED',
    null,
    latest.observed,
  );
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
  const exhaustedControls=new Set<string>();
  let cardBudgetReached = false;
  for (let index = 0; index < budget.maxActions; index++) {
    const id = `action-${index + 1}`,
      beforeIdentities = new Set(
        latest.observed.rows.map((row) => row.subjectUrl).filter(Boolean),
      ),
      beforeSubjects = beforeIdentities.size,
      beforeCards = latest.observed.diagnostics.cards,
      action = await page.evaluate(performPublicConversationAction, {
        actionId: id,
        allowReplyExpansion: true,
        excludedControlSignatures:[...exhaustedControls],
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
    latest = await capture(id, false);
    const afterIdentities = new Set(
        latest.observed.rows.map((row) => row.subjectUrl).filter(Boolean),
      ),
      afterSubjects = afterIdentities.size,
      changed = [...afterIdentities].some(identity=>!beforeIdentities.has(identity));
    if (changed && structured)
      structured.observeSsr(
        `AFTER_${id}`,
        await page.evaluate(observeStructuredSsrScripts),
        new URL(page.url()).pathname,
      );
    actions.push({
      id,
      kind: action.kind,
      label: action.label,
      containerIdentity: action.containerIdentity,
      containerSubjectUrl: action.containerSubjectUrl,
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
    const stillScrollingToBottom =
      action.kind === 'SCROLL' &&
      action.scrollChanged === true &&
      action.reachedBottom === false;
    unchanged = changed ? 0 : stillScrollingToBottom ? unchanged : unchanged + 1;
    if(!changed&&action.controlSignature)exhaustedControls.add(action.controlSignature);
    const uniqueAcrossSnapshots = new Set(
      snapshots.flatMap((snapshot) =>
        snapshot.observed.rows.map((row) => row.subjectUrl).filter(Boolean),
      ),
    ).size;
    if (uniqueAcrossSnapshots >= budget.maxCards) {
      cardBudgetReached = true;
      break;
    }
    if (unchanged >= budget.maxUnchangedActions) break;
  }
  const merged = mergeConversationSnapshots(snapshots, budget.maxCards),
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
      cardBudgetReached
        ? 'CARD_BUDGET_REACHED'
        : unchanged >= budget.maxUnchangedActions
          ? 'NO_NEW_UNIQUE_REPLIES_AFTER_CONSECUTIVE_ACTIONS'
          : actions.length >= budget.maxActions
            ? 'ACTION_BUDGET_REACHED'
            : 'PUBLIC_PAGINATION_EXHAUSTED',
    budget,
  };
  return { observed: merged, context, trace, snapshots };
}
/** A bounded disposable browser, no user profile, no stealth, installed executable only. */
async function visit<T>(
  url: string,
  scrolls: number,
  read: (
    page: Page,
    structured: PassiveStructuredResponseObserver,
  ) => Promise<T>,
  audit?: (event: PublicAccessAudit) => void,
  timeoutMs = 30000,
  attempt = 1,
  maxRequestEvents = DEFAULT_CONVERSATION_BUDGET.maxRequestEvents,
): Promise<T> {
  const started = Date.now();
  let requests = 0,
    navigations = 0,
    actualScrolls = 0,
    interactionActions = 0,
    loadMoreActions = 0,
    nestedExpandActions = 0,
    outcome = 'COMPLETED',
    failure: PublicBrowserFailure | null = null,
    stage: PublicBrowserFailure['stage'] = 'RESOURCE_PREFLIGHT';
  const telemetry = newRequestTelemetry();
  const navigation: NonNullable<PublicAccessAudit['navigation']> = {
    requestedDocument: sanitizedPublicDocumentUrl(url),
    finalDocument: null,
    httpStatus: null,
    redirected: null,
    responseReceived: false,
  };
  const executablePath = existingPublicBrowser();
  if (!executablePath) throw Error('CONVERSATION_BROWSER_MISSING');
  const guard = new BrowserResourceGuard(timeoutMs);
  try {
    await guard.start();
    stage = 'BROWSER_LAUNCH';
    const browser = await guard.launch((signal) =>
      puppeteer.launch({
        executablePath,
        signal,
        timeout: 25000,
        headless: true,
        args: [
          '--disable-background-networking',
          '--disable-dev-shm-usage',
          '--disable-extensions',
          '--disable-gpu',
          '--mute-audio',
          '--no-first-run',
          '--renderer-process-limit=1',
        ],
      }),
    );
    // Reuse Chromium's initial blank tab rather than leaving it beside a new tab.
    const pages = await browser.pages();
    stage = 'BROWSER_SETUP';
    const page = pages[0] ?? (await browser.newPage());
    for (const extra of pages.slice(1)) await extra.close();
    await page.setBypassServiceWorker(true);
    await page.setViewport({ width: 1280, height: 800 });
    await page.setRequestInterception(true);
    const structured = new PassiveStructuredResponseObserver();
    page.on('response', (response) => structured.observe(response));
    page.on('requestfinished', (request) => structured.finishRequest(request));
    page.on('requestfailed', (request) => structured.failRequest(request));
    page.on('request', (r) => {
      requests++;
      if (r.isNavigationRequest() && r.frame() === page.mainFrame())
        navigations++;
      const decision = decidePublicRequestDetailed(
        telemetry,
        r.url(),
        r.resourceType(),
        navigations,
        { events: maxRequestEvents, navigation: 4, blockHeavy: true },
      );
      structured.recordRequest(r, decision);
      void (decision.admitted ? r.continue() : r.abort()).catch(() => {
        telemetry.handlingFailures++;
      });
    });
    stage = 'NAVIGATION';
    const response = await page.goto(url, {
      waitUntil: 'domcontentloaded',
      timeout: 15000,
    });
    navigation.finalDocument = sanitizedPublicDocumentUrl(page.url());
    navigation.httpStatus = response?.status() ?? null;
    navigation.redirected = navigation.finalDocument !== navigation.requestedDocument;
    navigation.responseReceived = response !== null;
    if (response && response.status() >= 400)
      throw Error('CONVERSATION_HTTP_' + response.status());
    structured.observeSsr(
      'DOM_CONTENT_LOADED',
      await page.evaluate(observeStructuredSsrScripts),
      new URL(page.url()).pathname,
    );
    stage = 'ACCESS_GATE';
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
    stage = 'DOM_READ';
    const result = await read(page, structured);
    const trace = (result as { acquisition?: ConversationAcquisitionTrace })
      ?.acquisition;
    if (trace) {
      interactionActions = trace.actions.length;
      actualScrolls = trace.actions.filter(
        (row) => row.kind === 'SCROLL',
      ).length;
      loadMoreActions = trace.actions.filter(
        (row) => row.kind === 'LOAD_MORE',
      ).length;
      nestedExpandActions = trace.actions.filter(
        (row) => row.kind === 'EXPAND_NESTED',
      ).length;
    }
    guard.check();
    return result;
  } catch (e: any) {
    failure = classifyPublicBrowserFailure(
      guard.report.stopCode ? Error(guard.report.stopCode) : e,
      stage,
    );
    outcome = failure.code;
    throw Object.assign(Error(failure.code), { publicFailure: failure });
  } finally {
    try {
      stage = 'CLEANUP';
      await guard.close();
    } catch (error) {
      failure = classifyPublicBrowserFailure(error, 'CLEANUP');
      outcome = failure.code;
      throw Object.assign(Error(failure.code), { publicFailure: failure });
    } finally {
      audit?.({
        url: sanitizedPublicDocumentUrl(url),
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
        attempt,
        failure,
        navigation,
      });
    }
  }
}
export async function discoverConversations(
  keyword: string,
  audit?: (event: PublicAccessAudit) => void,
  limit = 6,
): Promise<PopularityCandidate[]> {
  if (!Number.isInteger(limit) || limit < 1 || limit > 30)
    throw Error('CONVERSATION_INVALID_LIMIT');
  const url = discoveryUrl('SEARCH', keyword);
  return withTransientPublicRetry((attempt) =>
    visit(
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
                  originalText: row.text,
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
      30000,
      attempt,
    ),
  );
}
export async function enrichConversation(
  url: string,
  audit?: (event: PublicAccessAudit) => void,
  evidence?: (page: Page, snapshot: PublicDomEvidenceSnapshot) => Promise<void>,
  totalBudgetMs = 180000,
  requestedBudget?: Partial<ConversationCollectionBudget>,
): Promise<ThreadCollection> {
  if (
    !Number.isInteger(totalBudgetMs) ||
    totalBudgetMs < 30000 ||
    totalBudgetMs > 180000
  )
    throw Error('CONVERSATION_INVALID_TIME_BUDGET');
  const acquisitionStarted = Date.now();
  const collectionBudget = conversationBudget(requestedBudget);
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
    async (page, networkObserver) => {
      const final = canonicalPost(page.url());
      if (final?.url !== target.url)
        throw Error('CONVERSATION_ROOT_IDENTITY_MISMATCH');
      const driven = await drivePublicConversation(
          page,
          target.url,
          collectionBudget.maxActions,
          networkObserver,
          collectionBudget,
        ),
        observed = driven.observed,
        context = driven.context,
        now = new Date().toISOString();
      const ssrScripts = await page.evaluate(observeStructuredSsrScripts);
      networkObserver.observeSsr(
        'FINAL_COLLECTION',
        ssrScripts,
        new URL(page.url()).pathname,
      );
      const networkPayloads = await networkObserver.settle(),
        structuredBase = {
          ...extractStructuredEvidence(
            [
              ...parseSsrRelayScripts(
                ssrScripts,
                new URL(page.url()).pathname,
                now,
              ),
              ...networkPayloads,
            ],
            target.url,
            observed.rows
              .map((row) => row.subjectUrl)
              .filter((value): value is string => !!value),
          ),
          ...networkObserver.telemetry(),
        } satisfies StructuredExtraction,
        structured = {
          ...structuredBase,
          acquisitionDiagnosis: diagnoseStructuredAcquisition(structuredBase),
        } satisfies StructuredExtraction;
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
      const observedIdentities = new Set(
        observedCards.map((card) => canonicalPost(card.url)?.url),
      );
      for (const card of structured.cards)
        if (!observedIdentities.has(canonicalPost(card.url)?.url))
          observedCards.push(card);
      await evidence?.(page, {
        finalUrl: target.url,
        observed,
        context,
        acquisition: driven.trace,
        snapshots: driven.snapshots,
        structured: {
          version: structured.version,
          diagnostics: structured.diagnostics,
          posts: structured.posts,
          membershipEvidence: structured.membershipEvidence,
          structuredVisibleUrls: structured.structuredVisibleUrls,
          domMatches: structured.domMatches,
          conflicts: structured.conflicts,
          requests: structured.requests,
          responses: structured.responses,
          ssrMilestones: structured.ssrMilestones,
          acquisitionDiagnosis: structured.acquisitionDiagnosis,
        },
      });
      const relationshipCandidates: NonNullable<
          PublicDocument['relationshipCandidates']
        > = [...structured.relationshipCandidates],
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
        collectionBudget.maxPermalinkValidations,
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
        structuredVisibleUrls: structured.structuredVisibleUrls,
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
      const domMembership = resolveConversationMembership({
        rootUrl: target.url,
        observed,
        context,
        snapshots: driven.snapshots,
        acquisition: driven.trace,
      });
      const memberships = new Map<string, MembershipEvidence>();
      const membershipPriority: Record<MembershipEvidence['status'], number> = {
        UNKNOWN: 0,
        THREAD_UI_CONFIRMED: 1,
        RECOMMENDED_POST: 2,
      };
      for (const row of [...domMembership, ...structured.membershipEvidence]) {
        const previous = memberships.get(row.subjectId);
        if (
          !previous ||
          membershipPriority[row.status] > membershipPriority[previous.status]
        )
          memberships.set(row.subjectId, row);
      }
      collection.membershipEvidence = [...memberships.values()];
      collection.structuredEvidence = {
        version: structured.version,
        diagnostics: structured.diagnostics,
        posts: structured.posts,
        domMatches: structured.domMatches,
        conflicts: structured.conflicts,
        requests: structured.requests,
        responses: structured.responses,
        ssrMilestones: structured.ssrMilestones,
        acquisitionDiagnosis: structured.acquisitionDiagnosis,
      };
      collection.relationshipDiagnostics = relationshipDiagnostics;
      const allObservedIdentities = new Set([
          ...observed.rows
            .map((row) => canonicalPost(row.subjectUrl ?? '')?.url)
            .filter((url): url is string => !!url),
          ...structured.posts.map((post) => post.url),
        ]),
        allMaterializedIdentities = new Set(
          observedCards
            .map((row) => canonicalPost(row.url)?.url)
            .filter((url): url is string => !!url),
        );
      collection.observationSummary = {
        subjectPermalinks: allObservedIdentities.size,
        materializedCards: allMaterializedIdentities.size,
        missingBody: observed.rows
          .filter(
            (row) => row.subjectUrl && (!row.authorHandle || !row.text.trim()),
          )
          .filter(
            (row) =>
              !structured.posts.some(
                (post) =>
                  post.url === canonicalPost(row.subjectUrl ?? '')?.url &&
                  !!post.originalText,
              ),
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
    1,
    collectionBudget.maxRequestEvents,
  );
}
