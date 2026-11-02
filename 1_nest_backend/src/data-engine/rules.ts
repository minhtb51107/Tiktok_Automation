import { createHash } from 'crypto';
import type {
  Bronze,
  Gold,
  Silver,
  SourceInput,
  DuplicateReference,
} from './contracts';
import { DATA_SCHEMA } from './contracts';
import { DATA_CONFIG, type DataConfig } from './config';
export function canonical(value: unknown): string {
  if (value === null || typeof value !== 'object')
    return JSON.stringify(value) ?? 'undefined';
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  return (
    '{' +
    Object.keys(value)
      .filter((k) => value[k] !== undefined)
      .sort()
      .map((k) => JSON.stringify(k) + ':' + canonical(value[k]))
      .join(',') +
    '}'
  );
}
export const hash = (v: unknown) =>
  createHash('sha256').update(canonical(v)).digest('hex');
export const normalize = (text: string) =>
  text.normalize('NFC').toLocaleLowerCase('vi').replace(/\s+/gu, ' ').trim();
export const tokens = (text: string) =>
  normalize(text).match(/[\p{L}\p{N}]+/gu) || [];
export function permalink(raw: unknown): { id: string; url: string } | null {
  try {
    if (typeof raw !== 'string') return null;
    const u = new URL(raw),
      m = u.pathname.match(/^\/@([\w.]+)\/post\/([A-Za-z0-9_-]{3,128})\/?$/);
    if (
      u.protocol !== 'https:' ||
      u.username ||
      u.password ||
      u.port ||
      ![
        'threads.com',
        'www.threads.com',
        'threads.net',
        'www.threads.net',
      ].includes(u.hostname) ||
      !m
    )
      return null;
    return {
      id: m[2],
      url: 'https://www.threads.com/@' + m[1] + '/post/' + m[2],
    };
  } catch {
    return null;
  }
}
export function validDate(s: unknown) {
  if (
    typeof s !== 'string' ||
    !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,3})?(?:Z|[+-]\d\d:\d\d)$/.test(s)
  )
    return false;
  const date = new Date(s);
  if (!Number.isFinite(date.getTime())) return false;
  const day = s.slice(0, 10),
    [y, m, d] = day.split('-').map(Number),
    v = new Date(Date.UTC(y, m - 1, d));
  return (
    v.getUTCFullYear() === y &&
    v.getUTCMonth() === m - 1 &&
    v.getUTCDate() === d
  );
}
export function language(
  body: string,
  cfg: DataConfig = DATA_CONFIG,
): Silver['language'] {
  const set = new Set(tokens(body)),
    vi = cfg.vietnameseTerms.filter((t) => set.has(t)),
    en = cfg.englishTerms.filter((t) => set.has(t));
  const specific = /[ăâđêôơưĂÂĐÊÔƠƯ]/u.test(body);
  const code =
    vi.length >= 2 || (specific && vi.length >= 1)
      ? 'vi'
      : en.length >= 3 ||
          /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Hangul}]{3}/u.test(body)
        ? 'other'
        : 'unknown';
  return {
    code,
    method: 'heuristic-v1',
    evidence: [
      'Vietnamese lexical hits: ' + vi.length,
      'English lexical hits: ' + en.length,
      'Not an AI language classifier',
    ],
  };
}
export function validate(b: Bronze, cfg: DataConfig = DATA_CONFIG): Silver {
  const errors: string[] = [],
    flags: string[] = [],
    url = permalink(b.sourceUrl);
  if (b.sourcePlatform !== 'THREADS') errors.push('UNSUPPORTED_PLATFORM');
  if (b.provenance?.identityEvidence === 'OFFICIAL_THREADS_API' && !/^\d{6,30}$/.test(b.nativeSourceId || ''))
    errors.push('INVALID_NATIVE_API_ID');
  if (b.provenance?.discoveryReviewRequired) {
    flags.push('DISCOVERY_REQUIRES_MANUAL_REVIEW');
    if (typeof b.originalBody === 'string' && /\d|https?:\/\/|[A-Z]{3,}/u.test(b.originalBody))
      flags.push('VOICE_TEXT_REVIEW_REQUIRED');
  }
  if (!b.sourcePostId || !/^[A-Za-z0-9_-]{3,128}$/.test(b.sourcePostId))
    errors.push('INVALID_SOURCE_ID');
  if (!url) errors.push('MALFORMED_CANONICAL_URL');
  else if (url.id !== b.sourcePostId) errors.push('SOURCE_ID_MISMATCH');
  if (
    !b.author ||
    !['name', 'handle'].some(
      (k) => typeof b.author[k] === 'string' && b.author[k].trim(),
    )
  )
    errors.push('MISSING_AUTHOR');
  if (typeof b.originalBody !== 'string' || !b.originalBody.trim())
    errors.push('EMPTY_CONTENT');
  if(typeof b.originalBody==='string'&&b.originalBody.length>cfg.maxBodyCharacters)errors.push('CONTENT_TOO_LARGE');
  if (!['POST', 'COMMENT', 'UNKNOWN'].includes(b.itemType))
    errors.push('UNSUPPORTED_ITEM_STRUCTURE');
  if (
    !b.rawPayload ||
    typeof b.rawPayload !== 'object' ||
    Array.isArray(b.rawPayload)
  )
    errors.push('UNSUPPORTED_RAW_STRUCTURE');
  if (!validDate(b.fetchedAt)) errors.push('INVALID_FETCHED_AT');
  if (b.publishedAt !== null && !validDate(b.publishedAt))
    errors.push('INVALID_PUBLISHED_AT');
  if (b.publishedAt === null) flags.push('MISSING_PUBLISHED_AT');
  if (
    validDate(b.publishedAt) &&
    validDate(b.fetchedAt) &&
    Date.parse(b.publishedAt!) > Date.parse(b.fetchedAt!) + 86400000
  )
    errors.push('PUBLISHED_AFTER_FETCH');
  for (const k of ['likes', 'replies', 'reposts', 'shares']) {
    const v = b.engagement?.[k];
    if (v !== null && (!Number.isSafeInteger(v) || v < 0))
      errors.push('INVALID_ENGAGEMENT_' + k.toUpperCase());
  }
  const mapping = b.provenance?.bodyMapping,
    verified =
      mapping &&
      mapping.sourceUrl === b.sourceUrl &&
      typeof mapping.body === 'string' &&
      !!mapping.evidence;
  if (mapping && !verified) flags.push('UNVERIFIED_BODY_MAPPING');
  const body =
      typeof b.originalBody === 'string'
        ? normalize(verified ? mapping.body : b.originalBody)
        : '',
    lang = language(body, cfg);
  if (lang.code === 'other') errors.push('UNSUPPORTED_LANGUAGE');
  else if (lang.code === 'unknown') flags.push('LANGUAGE_NEEDS_REVIEW');
  if (b.itemType === 'UNKNOWN') flags.push('UNKNOWN_ENTITY_TYPE');
  if (
    !b.provenance?.synthetic &&
      !['DOM_PERMALINK', 'PUBLIC_CANONICAL_METADATA', 'OFFICIAL_THREADS_API'].includes(
      b.provenance?.identityEvidence || '',
    )
  )
    flags.push('IDENTITY_NEEDS_REVIEW');
  return {
    schemaVersion: DATA_SCHEMA,
    id: hash({ bronzeId: b.id, configHash: hash(cfg), kind: 'SILVER' }),
    bronzeId: b.id,
    processingVersion: cfg.version,
    status: errors.length ? 'QUARANTINED' : 'VALIDATED',
    normalized: {
      body,
      topic: verified ? mapping.topic : b.topic,
      bodySource: verified ? 'VERIFIED_STUDIO_MAPPING' : 'RAW_BODY',
      sourceUrl: url?.url || null,
      itemType: b.itemType,
    },
    language: lang,
    deduplicationKey: hash(body),
    duplicate: null,
    flags,
    quarantineReasons: errors,
  };
}
export function similarity(
  a: string,
  b: string,
  cfg: DataConfig = DATA_CONFIG,
) {
  const ta = tokens(a),
    tb = tokens(b);
  if (Math.min(ta.length, tb.length) < cfg.nearDuplicate.minTokens) return 0;
  const grams = (t: string[]) =>
    new Set(
      t
        .slice(0, Math.max(0, t.length - cfg.nearDuplicate.shingleSize + 1))
        .map((_, i) => t.slice(i, i + cfg.nearDuplicate.shingleSize).join(' ')),
    );
  const x = grams(ta),
    y = grams(tb),
    intersection = [...x].filter((v) => y.has(v)).length;
  return intersection / (x.size + y.size - intersection || 1);
}
const hits = (body: string, terms: readonly string[]) => {
  const flat = ' ' + tokens(body).join(' ') + ' ';
  return terms.filter((t) => flat.includes(' ' + t + ' '));
};
export function evaluate(
  b: Bronze,
  s: Silver,
  asOf: string,
  cfg: DataConfig = DATA_CONFIG,
): Gold {
  const body = s.normalized.body,
    labels: Gold['labels'] = [],
    reasons: string[] = [],
    topicHits = hits(body + ' ' + (s.normalized.topic || ''), cfg.topics),
    sales = hits(body, cfg.salesIntent),
    contact = hits(body, cfg.contact),
    recruit = hits(body, cfg.recruitment),
    offers = hits(body, cfg.offer),
    policy = hits(body, cfg.policyReview),
    words = tokens(body);
  if (s.duplicate) {
    labels.push(s.duplicate.kind === 'EXACT' ? 'DUPLICATE' : 'NEEDS_REVIEW');
    reasons.push(
      `${s.duplicate.kind} duplicate candidate ${s.duplicate.postId}; similarity ${s.duplicate.similarity.toFixed(4)}`,
    );
  }
  if (
    sales.length >= 2 ||
    (sales.length && contact.length) ||
    (recruit.length && contact.length && offers.length)
  ) {
    const narrative=hits(body,cfg.personalNarrative);
    labels.push(narrative.length?'NEEDS_REVIEW':'ADVERTISEMENT');
    reasons.push(
      (narrative.length?'POSSIBLE_QUOTED_AD_IN_PERSONAL_NARRATIVE: ':'COMBINED_COMMERCIAL_SIGNALS: ') +
        [...sales, ...contact, ...recruit, ...offers].join(', '),
    );
  } else if (sales.length || (recruit.length && contact.length)) {
    labels.push('NEEDS_REVIEW');
    reasons.push('AMBIGUOUS_COMMERCIAL_INTENT');
  }
  const frequency = new Map<string, number>();
  for (const w of words.filter((w) => w.length > 2))
    frequency.set(w, (frequency.get(w) || 0) + 1);
  if (
    words.length >= 12 &&
    Math.max(0, ...frequency.values()) / words.length > 0.6
  ) {
    labels.push('SPAM');
    reasons.push('REPEATED_TOKEN_RATIO > 0.6');
  }
  if (!topicHits.length) {
    labels.push('OFF_TOPIC', 'NEEDS_REVIEW');
    reasons.push(
      'NO_CONFIGURED_SERIOUS_TOPIC_MATCH; uncertain relevance, not a permanent rejection',
    );
  }
  if (
    body.length < cfg.minContext.characters ||
    words.length < cfg.minContext.tokens
  ) {
    labels.push('LOW_CONTEXT', 'NEEDS_REVIEW');
    reasons.push('INSUFFICIENT_CONTEXT');
  }
  if (policy.length) {
    labels.push('POLICY_RISK', 'NEEDS_REVIEW');
    reasons.push('HUMAN_POLICY_REVIEW: ' + policy.join(', '));
  }
  if (s.flags.length) {
    labels.push('NEEDS_REVIEW');
    reasons.push(...s.flags);
  }
  const rejected = labels.some((l) =>
      ['DUPLICATE', 'ADVERTISEMENT', 'SPAM'].includes(l),
    ),
    review = labels.includes('NEEDS_REVIEW');
  const age = b.publishedAt
    ? Math.max(0, (Date.parse(asOf) - Date.parse(b.publishedAt)) / 86400000)
    : null;
  const known = Object.entries(b.engagement).filter(([, v]) => v !== null),
    engagement = known.reduce(
      (n, [k, v]) => n + v! * cfg.engagementMultipliers[k],
      0,
    );
  const values = {
    topicRelevance: {
      value: topicHits.length ? 100 : 0,
      reason: topicHits.length
        ? 'Topic terms: ' + topicHits.join(', ')
        : 'No configured topic signal',
    },
    contextCompleteness: {
      value: Math.min(100, (body.length / cfg.completenessCharacters) * 100),
      reason: 'Normalized body characters: ' + body.length,
    },
    discussionPotential: {
      value: /\?/.test(body) ? 100 : words.length >= 20 ? 60 : 30,
      reason: 'Question punctuation / available narrative length',
    },
    videoSuitability: {
      value:
        body.length >= cfg.idealVideoMinChars &&
        body.length <= cfg.idealVideoMaxChars
          ? 100
          : 50,
      reason: 'Explicit text-length suitability band; no duration estimation',
    },
    freshness: {
      value:
        age === null ? 0 : Math.max(0, 100 - (age / cfg.freshnessDays) * 100),
      reason:
        age === null
          ? 'Date unknown; no invented freshness'
          : 'Age at pinned asOf: ' + age.toFixed(2) + ' days',
    },
    engagement: {
      value: known.length
        ? Math.min(
            100,
            (Math.log10(1 + engagement) / cfg.engagementLogCap) * 100,
          )
        : 0,
      reason: known.length
        ? 'Weighted observed engagement (may be approximate): ' + engagement
        : 'Unknown engagement; score has no signal, null values remain null',
    },
  };
  const breakdown = Object.fromEntries(
    Object.entries(values).map(([k, v]) => [
      k,
      {
        ...v,
        value: Math.round(v.value * 100) / 100,
        weight: cfg.weights[k],
        contribution: Math.round(v.value * cfg.weights[k]) / 100,
      },
    ]),
  );
  const score =
    Math.round(
      Object.values(breakdown).reduce((n, v) => n + v.contribution, 0) * 100,
    ) / 100;
  return {
    schemaVersion: DATA_SCHEMA,
    silverId: s.id,
    evaluationVersion: cfg.version,
    asOf,
    eligibility: rejected ? 'REJECTED' : review ? 'NEEDS_REVIEW' : 'ELIGIBLE',
    labels: [...new Set(labels.length ? labels : ['ELIGIBLE' as const])],
    reasons,
    score,
    breakdown,
    selectionReasons: [
      score >= cfg.qualifiedScore
        ? `SCORE_AT_LEAST_${cfg.qualifiedScore}`
        : `SCORE_BELOW_${cfg.qualifiedScore}`,
      'Experimental heuristic, not measured quality accuracy',
    ],
    queueState: 'NOT_QUEUED',
  };
}
export function precisionAt10(
  ranked: string[],
  groundTruth: Record<string, boolean>,
) {
  const top = ranked.slice(0, 10),
    missing = top.filter((id) => typeof groundTruth[id] !== 'boolean');
  if (top.length !== 10 || new Set(top).size !== 10 || missing.length)
    return {
      status: 'NOT_MEASURED' as const,
      value: null,
      reason:
        'Ten distinct ranked items and explicit ground truth for every top-10 item required',
      missing,
    };
  return {
    status: 'MEASURED' as const,
    value: top.filter((id) => groundTruth[id]).length / 10,
    reason: 'Relevant labelled items / 10',
    missing: [],
  };
}
