import { estimatedDuration } from './editorial-feasibility';
import { normalize, similarity, tokens } from './rules';

export const EVALUATION_VERSION = 'cascade/1';
export type EvaluationDecision =
  | 'ACCEPT'
  | 'REJECT'
  | 'ESCALATE_LLM'
  | 'WAITING_HUMAN';
export interface EvaluationEvidence {
  sourceId: string;
  hardBlockers: string[];
  heuristicScore: number | null;
  signals: Record<string, number | boolean | null>;
  uncertaintyReasons: string[];
  policyVersion: string;
}
export interface RoutingDecision {
  sourceId: string;
  decision: EvaluationDecision;
  reasons: string[];
  evidence: EvaluationEvidence;
  providerRequired: boolean;
}
export interface SemanticScorer {
  readonly version: string;
  score(input: {
    sourceId: string;
    text: string;
    context: string;
    topic?: string;
  }): Promise<{
    similarity: number | null;
    evidence: string[];
    modelVersion: string;
  }>;
}

export function routeEvaluation(
  evidence: EvaluationEvidence,
  options: {
    validated?: 'ACCEPT' | 'REJECT' | 'WAITING_HUMAN';
    cached?: boolean;
    rootTopicCorroborated?: boolean;
    providerAvailable?: boolean;
  } = {},
): RoutingDecision {
  const outcome = (
    decision: EvaluationDecision,
    reasons: string[],
  ): RoutingDecision => ({
    sourceId: evidence.sourceId,
    decision,
    reasons,
    evidence,
    providerRequired: decision === 'ESCALATE_LLM',
  });
  if (evidence.hardBlockers.length)
    return outcome('REJECT', evidence.hardBlockers);
  if (options.validated)
    return outcome(options.validated, [
      options.cached ? 'EXACT_VALIDATED_CACHE' : 'VALIDATED_PROVIDER_RESULT',
    ]);
  if (options.rootTopicCorroborated)
    return outcome('ACCEPT', ['EXACT_TOPIC_AND_CORROBORATING_CONTEXT']);
  return outcome(
    options.providerAvailable === false ? 'WAITING_HUMAN' : 'ESCALATE_LLM',
    [
      ...evidence.uncertaintyReasons,
      ...(evidence.heuristicScore === null
        ? []
        : ['HEURISTIC_POSITIVE_SHADOW_ONLY']),
    ],
  );
}

export interface RootTopicAssessment {
  schemaVersion: 'root-topic/1';
  sourceId: string;
  verdict: 'RELEVANT' | 'IRRELEVANT' | 'UNCERTAIN';
  quotes: string[];
  reason: string;
}
export function validateRootTopic(
  value: any,
  sourceId: string,
  text: string,
): RootTopicAssessment {
  if (
    !value ||
    value.sourceId !== sourceId ||
    !['RELEVANT', 'IRRELEVANT', 'UNCERTAIN'].includes(value.verdict) ||
    typeof value.reason !== 'string' ||
    !value.reason.trim() ||
    value.reason.length > 300 ||
    !Array.isArray(value.quotes) ||
    value.quotes.length > 3 ||
    (value.verdict !== 'UNCERTAIN' && !value.quotes.length) ||
    value.quotes.some(
      (quote: unknown) =>
        typeof quote !== 'string' ||
        quote.trim().length < 8 ||
        quote.length > 200 ||
        !text.includes(quote),
    )
  )
    throw Error('AI_SCHEMA_ROOT_TOPIC');
  return {
    schemaVersion: 'root-topic/1',
    sourceId,
    verdict: value.verdict,
    quotes: value.quotes,
    reason: value.reason,
  };
}

export function corroboratedRootTopic(
  text: string,
  topic: string,
  sourceTopic: string | null | undefined,
) {
  const query: string[] = tokens(topic);
  if (query.length < 2) return false;
  const clauses = text
    .split(/[.!?;\n]+/u)
    .map((part) => tokens(part).join(' '));
  const phrase = query.join(' ');
  const contains = (body: string, segment: string) =>
    (' ' + body + ' ').includes(' ' + segment + ' ');
  const metadata = tokens(sourceTopic ?? '').filter(
    (word) => word.length >= 4 && !query.includes(word),
  );
  if (
    clauses.some((body) => contains(body, phrase)) &&
    clauses.some(
      (body) =>
        !contains(body, phrase) &&
        metadata.some((word) => contains(body, word)),
    )
  )
    return true;
  if (query.length < 4) return false;
  const split = Math.ceil(query.length / 2),
    left = query.slice(0, split).join(' '),
    right = query.slice(split).join(' ');
  return clauses.some(
    (body, i) =>
      !contains(body, phrase) &&
      contains(body, left) &&
      clauses.some(
        (other, j) =>
          i !== j && !contains(other, phrase) && contains(other, right),
      ),
  );
}

export interface DurationSource {
  id: string;
  parentId?: string;
  text: string;
  score: number;
  measuredSeconds?: number;
}
export function durationPlans(
  root: DurationSource,
  replies: DurationSource[],
  speed: number,
) {
  if (
    replies.length > 8 ||
    new Set([root.id, ...replies.map((reply) => reply.id)]).size !==
      replies.length + 1
  )
    throw Error('INVALID_DURATION_POOL');
  const sources = [root, ...replies];
  const features = sources.map((source) => ({
    ...source,
    tokens: estimatedDuration(source.text, speed).tokens,
    key: normalize(source.text),
  }));
  const overlap = features.map((a, i) =>
    features.map((b, j) =>
      j > i ? (a.key === b.key ? 1 : similarity(a.text, b.text)) : 0,
    ),
  );
  const plans: {
    ids: string[];
    minimumSeconds: number;
    maximumSeconds: number;
    expectedSeconds: number;
    utility: number;
  }[] = [];
  const duration = (n: number, rate: number) => (n * 60) / (rate * speed);
  for (let mask = 0; mask < 1 << replies.length; mask++) {
    const indexes = features.flatMap((_, i) =>
      i === 0 || mask & (1 << (i - 1)) ? [i] : [],
    );
    const members = indexes.map((i) => features[i]),
      ids = new Set(members.map((row) => row.id));
    if (
      members.some(
        (row) => !row.tokens || (row.parentId && !ids.has(row.parentId)),
      ) ||
      indexes.some((i) => indexes.some((j) => overlap[i][j] >= 0.85))
    )
      continue;
    const min = members.reduce(
      (sum, row) => sum + (row.measuredSeconds ?? duration(row.tokens, 220)),
      0,
    );
    const max = members.reduce(
      (sum, row) => sum + (row.measuredSeconds ?? duration(row.tokens, 160)),
      0,
    );
    if (min > 90 || max < 60) continue;
    const expectedSeconds = (min + max) / 2;
    const utility =
      members.slice(1).reduce((sum, row) => sum + row.score, 0) /
        Math.max(1, members.length - 1) +
      Math.min(4, members.length - 1) * 3 -
      indexes
        .filter((i) => i > 0)
        .reduce(
          (sum, i) =>
            sum +
            indexes.filter((j) => j > i).reduce((n, j) => n + overlap[i][j], 0),
          0,
        ) *
        6 -
      Math.abs(expectedSeconds - 75) * 1.1 -
      Math.max(0, 60 - min) * 0.6 -
      Math.max(0, max - 90) * 0.6;
    const pending = members.slice(1),
      ordered = [root.id];
    while (pending.length) {
      const next = pending.findIndex(
        (row) => !row.parentId || ordered.includes(row.parentId),
      );
      if (next < 0) break;
      ordered.push(pending.splice(next, 1)[0].id);
    }
    if (pending.length) continue;
    plans.push({
      ids: ordered.slice(1),
      minimumSeconds: Math.round(min),
      maximumSeconds: Math.round(max),
      expectedSeconds,
      utility,
    });
  }
  return plans.sort(
    (a, b) =>
      b.utility - a.utility || a.ids.join(',').localeCompare(b.ids.join(',')),
  );
}
