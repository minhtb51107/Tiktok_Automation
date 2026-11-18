import { hash } from './rules';
import { normalize, tokens } from './rules';
import type {
  MetricScore,
  PublicPost,
  PopularityCandidate,
} from './conversation-contracts';
export const POPULARITY_CONFIG = Object.freeze({
  version: 'popularity/1',
  weights: {
    likes: 15,
    replies: 30,
    reposts: 15,
    shares: 15,
    freshness: 15,
    velocity: 10,
  },
  caps: { likes: 10000, replies: 500, reposts: 500, shares: 500 },
  freshnessHours: 168,
});
export interface PopularityRankingOptions {
  priority?: 'BALANCED' | 'HOT' | 'RECENT';
  minInteractions?: number;
  queryTerms?: string[];
}
const QUERY_STOPWORDS = new Set([
  'mot',
  'nhung',
  'cua',
  'cho',
  'voi',
  'trong',
  'tren',
  'la',
  'va',
  'co',
  'khong',
  've',
]);
const DISCUSSION_PROMPT_RE =
  /[?？]|(?:có ai|cho mình hỏi|cho em hỏi|cho tớ hỏi|mọi người|mn ơi|mng ơi|kinh nghiệm|tư vấn|làm sao|như thế nào|nên chọn|chia sẻ|góc nhìn|thảo luận|ý kiến|review|trải nghiệm|what do you|experience|advice|thoughts|opinions|drop your)/iu;
const LEADING_DATE_LINE_RE =
  /^\s*(?:\d{1,2}[./-]\d{1,2}[./-]\d{2,4}|\d+\s*(?:giây|phút|giờ|ngày|tuần|tháng|năm|[smhdw]))\s*$/iu;

export function cleanCandidateText(text: string): string {
  const lines = text.split(/\r?\n/u);
  while (lines.length && LEADING_DATE_LINE_RE.test(lines[0])) lines.shift();
  return lines.join('\n').trim();
}

export function observedQueryRelevance(post: PublicPost, queryTerms: string[]) {
  const cleaned = cleanCandidateText(post.originalText);
  const corpus = normalize(
      `${post.author.handle} ${cleaned} ${post.topic ?? ''}`,
    ),
    requested = [...new Set(queryTerms.map(normalize).filter(Boolean))],
    queryTokens = [
      ...new Set(
        requested
          .flatMap(tokens)
          .filter((token) => token.length > 1 && !QUERY_STOPWORDS.has(token)),
      ),
    ];
  if (!corpus || !queryTokens.length) return null;
  const corpusTokens = new Set(tokens(corpus)),
    matched = queryTokens.filter((token) => corpusTokens.has(token)),
    exactPhrase = requested.some(
      (term) => term.length >= 4 && corpus.includes(term),
    );
  const tokenCoverage = Math.min(1, matched.length / Math.min(queryTokens.length, 4));
  return {
    score: Math.round(
      100 * Math.min(1, tokenCoverage * 0.75 + (exactPhrase ? 0.25 : 0)),
    ),
    matched,
    method: 'OBSERVED_TEXT_LEXICAL_RELEVANCE' as const,
  };
}

export interface SupplyFeasibilitySignal {
  version: 'supply-feasibility/1';
  score: number;
  rootWords: number;
  rootLengthScore: number;
  discussionPromptScore: number;
  replySupplyScore: number | null;
  reportedReplies: number | null;
  discussionRatio: number | null;
  shortRootCapped: boolean;
  reasons: string[];
}

/**
 * Predicts whether a discovered root is likely to supply enough real spoken material
 * before spending browser budget on enrichment. Never invents missing counters.
 */
export function supplyFeasibility(
  post: PublicPost,
  asOf: string,
  queryTerms: string[] = [],
  metric?: MetricScore | null,
  relevanceScore?: number | null,
): SupplyFeasibilitySignal {
  const cleaned = cleanCandidateText(post.originalText),
    words = tokens(cleaned),
    rootWords = words.length,
    clauses = cleaned
      .split(/[.!?;\n]+/u)
      .filter((part) => tokens(part).length >= 4).length;
  const rootLengthScore =
    rootWords === 0
      ? 0
      : rootWords < 8
        ? Math.round((rootWords / 8) * 18)
        : rootWords < 20
          ? Math.round(18 + ((rootWords - 8) / 12) * 32)
          : Math.min(100, Math.round(50 + Math.min(1, (rootWords - 20) / 70) * 50));
  const hasPrompt = DISCUSSION_PROMPT_RE.test(cleaned);
  const discussionPromptScore = hasPrompt
    ? 100
    : rootWords >= 25 && clauses >= 2
      ? 60
      : rootWords >= 12
        ? 30
        : 10;
  const replies =
      typeof post.engagement.replies === 'number' &&
      Number.isFinite(post.engagement.replies) &&
      post.engagement.replies >= 0
        ? post.engagement.replies
        : null,
    likes =
      typeof post.engagement.likes === 'number' &&
      Number.isFinite(post.engagement.likes) &&
      post.engagement.likes >= 0
        ? post.engagement.likes
        : null;
  const discussionRatio =
    replies !== null && likes !== null
      ? Number((replies / Math.max(likes, 10)).toFixed(4))
      : null;
  let replySupplyScore: number | null = null;
  if (replies !== null) {
    const volume = Math.min(1, Math.log1p(replies) / Math.log1p(200)),
      ratioSignal =
        discussionRatio !== null ? Math.min(1, discussionRatio / 0.15) : 0.5;
    replySupplyScore = Math.round(100 * (volume * 0.65 + ratioSignal * 0.35));
  }
  const pop = metric ?? popularity(post, asOf),
    freshnessVal = pop.breakdown.freshness.value,
    freshnessScore =
      freshnessVal === null ? null : Math.round(freshnessVal * 100),
    relScore =
      relevanceScore !== undefined
        ? relevanceScore
        : queryTerms.length
          ? (observedQueryRelevance(post, queryTerms)?.score ?? null)
          : null;
  const components: Array<{ value: number | null; weight: number }> = [
    { value: rootLengthScore, weight: 32 },
    { value: replySupplyScore, weight: 26 },
    { value: relScore, weight: queryTerms.length ? 20 : 0 },
    { value: discussionPromptScore, weight: 12 },
    { value: freshnessScore, weight: 5 },
    { value: pop.score, weight: 5 },
  ];
  const active = components.filter(
      (c): c is { value: number; weight: number } =>
        c.value !== null && c.weight > 0,
    ),
    denom = active.reduce((sum, c) => sum + c.weight, 0);
  let score = denom
    ? Math.round(active.reduce((sum, c) => sum + c.value * c.weight, 0) / denom)
    : 0;
  const shortRootCapped = rootWords < 8;
  if (shortRootCapped) score = Math.min(score, 28);
  const reasons: string[] = [];
  if (rootWords === 0) reasons.push('EMPTY_OR_TIMESTAMP_ONLY_ROOT');
  else if (shortRootCapped) reasons.push('SHORT_CAPTION_ROOT_PENALIZED');
  else if (rootWords >= 25) reasons.push('SUBSTANTIVE_ROOT_LENGTH');
  if (hasPrompt) reasons.push('DISCUSSION_PROMPT_SIGNAL');
  if (replies === null) reasons.push('REPORTED_REPLIES_UNAVAILABLE');
  else if (replies >= 20 && (discussionRatio === null || discussionRatio >= 0.05))
    reasons.push('HIGH_DISCUSSION_REPLY_SUPPLY');
  return {
    version: 'supply-feasibility/1',
    score,
    rootWords,
    rootLengthScore,
    discussionPromptScore,
    replySupplyScore,
    reportedReplies: replies,
    discussionRatio,
    shortRootCapped,
    reasons,
  };
}

/** No follower/view estimates. Velocity requires two observations of exactly the same post. */
export function popularity(
  post: PublicPost,
  asOf: string,
  previous?: PublicPost,
): MetricScore {
  const c = POPULARITY_CONFIG,
    breakdown: MetricScore['breakdown'] = {};
  for (const field of ['likes', 'replies', 'reposts', 'shares'] as const) {
    const n = post.engagement[field],
      valid = typeof n === 'number' && Number.isFinite(n) && n >= 0;
    breakdown[field] = {
      value: valid
        ? Math.min(1, Math.log1p(n) / Math.log1p(c.caps[field]))
        : null,
      weight: c.weights[field],
      reason: valid
        ? 'Observed counter; log-scaled'
        : 'Counter unavailable or invalid',
    };
  }
  const age = (Date.parse(asOf) - Date.parse(post.publishedAt || '')) / 3600000;
  breakdown.freshness = {
    value:
      Number.isFinite(age) && age >= 0
        ? Math.max(0, 1 - age / c.freshnessHours)
        : null,
    weight: c.weights.freshness,
    reason: 'Observed publication time relative to explicit evaluation time',
  };
  const hours = previous
    ? (Date.parse(post.provenance.observedAt) -
        Date.parse(previous.provenance.observedAt)) /
      3600000
    : NaN;
  const delta =
    previous &&
    previous.id === post.id &&
    previous.url === post.url &&
    post.engagement.replies !== null &&
    previous.engagement.replies !== null
      ? post.engagement.replies - previous.engagement.replies
      : NaN;
  breakdown.velocity = {
    value:
      Number.isFinite(hours) &&
      hours > 0 &&
      Number.isFinite(delta) &&
      delta >= 0
        ? Math.min(1, Math.log1p(delta / hours) / Math.log1p(100))
        : null,
    weight: c.weights.velocity,
    reason:
      'Reply growth/hour only from two consistent observations, not an engagement rate',
  };
  const missing = Object.keys(breakdown).filter(
      (k) => breakdown[k].value === null,
    ),
    observed = Object.values(breakdown).filter((x) => x.value !== null),
    denominator = observed.reduce((s, x) => s + x.weight, 0);
  const reliableCounters = ['likes', 'replies', 'reposts', 'shares'].filter(
    (k) => breakdown[k].value !== null,
  ).length;
  return {
    version: c.version,
    configHash: hash(c),
    score: denominator
      ? Math.round(
          (100 * observed.reduce((s, x) => s + x.value! * x.weight, 0)) /
            denominator,
        )
      : null,
    coverage:
      reliableCounters >= 2 && breakdown.freshness.value !== null
        ? 'SUFFICIENT'
        : denominator
          ? 'PARTIAL'
          : 'UNKNOWN',
    breakdown,
    missing,
    reasons: [
      'Observed weighted engagement and freshness; not a HOT/viral prediction',
      'Missing metrics are excluded, never converted to zero',
    ],
  };
}
export function rankCandidates(
  candidates: PopularityCandidate[],
  limit: number,
  asOf: string,
  options: PopularityRankingOptions = {},
) {
  const priority = options.priority ?? 'BALANCED',
    minInteractions = options.minInteractions ?? 0,
    queryTerms = options.queryTerms ?? [];
  const scored = candidates.map((x) => {
    const metric = x.post ? popularity(x.post, asOf) : null,
      relevance = x.post ? observedQueryRelevance(x.post, queryTerms) : null,
      supply = x.post
        ? supplyFeasibility(
            x.post,
            asOf,
            queryTerms,
            metric,
            relevance?.score ?? null,
          )
        : null;
    return {
      candidate: x,
      metric,
      supply,
      interactionTotal: x.post
        ? Object.values(x.post.engagement)
            .filter(
              (v): v is number =>
                typeof v === 'number' && Number.isFinite(v) && v >= 0,
            )
            .reduce((a, b) => a + b, 0)
        : null,
      knownInteractions: x.post
        ? Object.values(x.post.engagement).filter(
            (v) => typeof v === 'number' && Number.isFinite(v) && v >= 0,
          ).length
        : 0,
      relevance,
    };
  });
  // Avoid ranking incomparable sparse observations as if they were popularity evidence.
  const keys = scored.map((x) =>
    x.metric
      ? Object.keys(x.metric.breakdown)
          .filter((k) => x.metric!.breakdown[k].value !== null)
          .sort()
          .join(',')
      : '',
  );
  const sufficient =
    scored.length > 0 &&
    scored.every((x) => x.metric?.coverage === 'SUFFICIENT') &&
    new Set(keys).size === 1;
  const eligible = scored.filter(
    (x) =>
      !minInteractions ||
      !x.knownInteractions ||
      x.interactionTotal! >= minInteractions,
  );
  eligible.sort((a, b) => {
    if (priority === 'RECENT') {
      const aEmpty = a.supply ? a.supply.rootWords === 0 : false,
        bEmpty = b.supply ? b.supply.rootWords === 0 : false;
      if (aEmpty !== bEmpty) return aEmpty ? 1 : -1;
      const at = Date.parse(a.candidate.post?.publishedAt || ''),
        bt = Date.parse(b.candidate.post?.publishedAt || '');
      if (Number.isFinite(at) || Number.isFinite(bt))
        return (
          (Number.isFinite(bt) ? bt : -Infinity) -
            (Number.isFinite(at) ? at : -Infinity) ||
          a.candidate.observedOrder - b.candidate.observedOrder
        );
    }
    if (queryTerms.length) {
      const combined = (row: typeof a) => {
        const relevance = row.relevance?.score ?? 0,
          popularityScore = row.metric?.score ?? 0,
          supplyScore = row.supply?.score ?? 0,
          shortPenalty = row.supply?.shortRootCapped ? 35 : 0;
        return priority === 'HOT'
          ? supplyScore * 0.45 +
              relevance * 0.3 +
              popularityScore * 0.25 -
              shortPenalty
          : supplyScore * 0.55 +
              relevance * 0.35 +
              popularityScore * 0.1 -
              shortPenalty;
      };
      const delta = combined(b) - combined(a);
      if (delta) return delta;
    } else if (priority === 'HOT' || sufficient) {
      const scoreOf = (row: typeof a) => {
        const pop = row.metric?.score;
        if (pop === null || pop === undefined) return -1;
        const supply = row.supply?.score ?? pop;
        return priority === 'HOT'
          ? pop * 0.55 + supply * 0.45
          : supply * 0.6 + pop * 0.4;
      };
      const as = scoreOf(a),
        bs = scoreOf(b);
      if (as >= 0 || bs >= 0)
        return bs - as || a.candidate.observedOrder - b.candidate.observedOrder;
    }
    return a.candidate.observedOrder - b.candidate.observedOrder;
  });
  const status = sufficient
    ? ('SUFFICIENT' as const)
    : eligible.some((x) => x.metric?.score !== null)
      ? ('PARTIAL' as const)
      : ('UNKNOWN' as const);
  const diverseSelected: typeof eligible = [],
    remaining = [...eligible];
  while (diverseSelected.length < limit && remaining.length) {
    const nextIndex = remaining.findIndex(
      (row) =>
        row.candidate.post &&
        !diverseSelected.some(
          (selected) =>
            selected.candidate.post?.author.handle ===
            row.candidate.post!.author.handle,
        ),
    );
    diverseSelected.push(...remaining.splice(nextIndex < 0 ? 0 : nextIndex, 1));
  }
  return {
    status,
    priority,
    minInteractions,
    reasons: [
      sufficient
        ? 'Comparable observed metrics; ranked by supply-feasibility/1 + popularity/1'
        : priority === 'HOT'
          ? 'Sparse observed metrics ranked by supply feasibility and engagement; HOT status remains unproven'
          : priority === 'RECENT'
            ? 'Observed publication times prioritized (empty/date-only roots deprioritized); missing dates remain UNKNOWN'
            : 'Insufficient comparable metadata; preserving observed order. HOT status unproven',
      minInteractions
        ? 'Known totals below the configured threshold are excluded; UNKNOWN totals are retained for review'
        : 'No interaction threshold applied',
      queryTerms.length
        ? 'Ranking blends root substance, reported reply supply/density, discussion prompts, and lexical relevance; not semantic proof'
        : 'No query relevance terms supplied',
      'Selection prefers distinct authors before filling remaining slots',
    ],
    ranked: eligible.map((x) => ({
      url: x.candidate.url,
      score: x.metric?.score ?? null,
      supplyScore: x.supply?.score ?? null,
      rootWords: x.supply?.rootWords ?? null,
      reportedReplies: x.supply?.reportedReplies ?? null,
      discussionRatio: x.supply?.discussionRatio ?? null,
      supplyReasons: x.supply?.reasons ?? [],
      coverage: x.metric?.coverage ?? 'UNKNOWN',
      interactionTotal: x.knownInteractions ? x.interactionTotal : null,
      thresholdStatus: !minInteractions
        ? 'NOT_APPLIED'
        : !x.knownInteractions
          ? 'UNKNOWN'
          : x.interactionTotal! >= minInteractions
            ? 'PASS'
            : 'FAIL',
      relevanceScore: x.relevance?.score ?? null,
      relevanceMatchedTerms: x.relevance?.matched ?? [],
    })),
    selected: diverseSelected.map((x) => x.candidate.url),
  };
}
