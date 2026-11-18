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
const QUERY_STOPWORDS = new Set(['mot','nhung','cua','cho','voi','trong','tren','la','va','co','khong','ve']);
export function observedQueryRelevance(post: PublicPost, queryTerms: string[]) {
  const corpus = normalize(`${post.author.handle} ${post.originalText} ${post.topic ?? ''}`),
    requested = [...new Set(queryTerms.map(normalize).filter(Boolean))],
    queryTokens = [...new Set(requested.flatMap(tokens).filter((token) => token.length > 1 && !QUERY_STOPWORDS.has(token)))];
  if (!corpus || !queryTokens.length) return null;
  const corpusTokens = new Set(tokens(corpus)),
    matched = queryTokens.filter((token) => corpusTokens.has(token)),
    exactPhrase = requested.some((term) => term.length >= 4 && corpus.includes(term));
  return {
    score: Math.round(100 * Math.min(1, (matched.length / queryTokens.length) * 0.75 + (exactPhrase ? 0.25 : 0))),
    matched,
    method: 'OBSERVED_TEXT_LEXICAL_RELEVANCE' as const,
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
  const scored = candidates.map((x) => ({
    candidate: x,
    metric: x.post ? popularity(x.post, asOf) : null,
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
    relevance: x.post ? observedQueryRelevance(x.post, queryTerms) : null,
  }));
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
        const relevance = row.relevance?.score ?? -1,
          popularityScore = row.metric?.score ?? -1,
          freshness = row.metric?.breakdown.freshness.value;
        return priority === 'RECENT'
          ? relevance * 0.7 + (freshness === null || freshness === undefined ? -1 : freshness * 100) * 0.3
          : priority === 'HOT'
            ? relevance * 0.6 + popularityScore * 0.4
            : relevance * 0.8 + popularityScore * 0.2;
      };
      const delta = combined(b) - combined(a);
      if (delta) return delta;
    } else if (priority === 'HOT' || sufficient) {
      const as = a.metric?.score,
        bs = b.metric?.score;
      if (
        (as !== null && as !== undefined) ||
        (bs !== null && bs !== undefined)
      )
        return (
          (bs ?? -1) - (as ?? -1) ||
          a.candidate.observedOrder - b.candidate.observedOrder
        );
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
    const nextIndex = remaining.findIndex((row) =>
      row.candidate.post && !diverseSelected.some((selected) => selected.candidate.post?.author.handle === row.candidate.post!.author.handle),
    );
    diverseSelected.push(...remaining.splice(nextIndex < 0 ? 0 : nextIndex, 1));
  }
  return {
    status,
    priority,
    minInteractions,
    reasons: [
      sufficient
        ? 'Comparable observed metrics; ranked by popularity/1'
        : priority === 'HOT'
          ? 'Sparse observed metrics ranked flexibly; HOT status remains unproven'
          : priority === 'RECENT'
            ? 'Observed publication times prioritized; missing dates remain UNKNOWN'
            : 'Insufficient comparable metadata; preserving observed order. HOT status unproven',
      minInteractions
        ? 'Known totals below the configured threshold are excluded; UNKNOWN totals are retained for review'
        : 'No interaction threshold applied',
      queryTerms.length
        ? 'Ranking blends observed lexical relevance with available engagement/freshness; it is not semantic proof'
        : 'No query relevance terms supplied',
      'Selection prefers distinct authors before filling remaining slots',
    ],
    ranked: eligible.map((x) => ({
      url: x.candidate.url,
      score: x.metric?.score ?? null,
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
