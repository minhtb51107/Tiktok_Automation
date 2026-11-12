import { hash } from './rules';
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
    minInteractions = options.minInteractions ?? 0;
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
    if (priority === 'HOT' || sufficient) {
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
    })),
    selected: eligible.slice(0, limit).map((x) => x.candidate.url),
  };
}
