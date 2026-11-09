import { DATA_CONFIG, type DataConfig } from './config';
import type { Bronze, Evaluation, Gold } from './contracts';
import { evaluate, hash, precisionAt10, tokens } from './rules';
export const DISCOVERY_TOPICS = {
  WORK: { label: 'Công việc và đi làm', keyword: 'chuyện đi làm', terms: ['đi làm', 'đồng nghiệp', 'sếp', 'thất nghiệp', 'nghỉ việc', 'phỏng vấn', 'áp lực công việc', 'công sở', 'thăng tiến'] },
  LIFE: { label: 'Trải nghiệm cuộc sống', keyword: 'bài học cuộc sống', terms: ['trưởng thành', 'bài học', 'áp lực đồng trang lứa', 'trải nghiệm', 'tâm sự'] },
  FAMILY: { label: 'Gia đình và quan hệ', keyword: 'chuyện gia đình', terms: ['cha mẹ', 'bố mẹ', 'con cái', 'hôn nhân', 'vợ chồng', 'gia đình'] },
} as const;
export type DiscoveryTopic = keyof typeof DISCOVERY_TOPICS | 'ALL';
export const GOLD_V2 = {
  version: 'serious-gold-shadow-v2.1', candidateScore: 65, lowPriorityScore: 40,
  maxVoiceSymbolsRatio: 0.12,
  weights: { ...DATA_CONFIG.weights },
};
export function topic(value: unknown): DiscoveryTopic {
  if (value === undefined || value === 'ALL') return 'ALL';
  if (typeof value !== 'string' || !Object.prototype.hasOwnProperty.call(DISCOVERY_TOPICS, value)) throw Error('CRAWLER_INVALID_TOPIC');
  return value as DiscoveryTopic;
}
export type QualityBucket = 'GOLD_CANDIDATE' | 'NEEDS_REVIEW' | 'LOW_PRIORITY' | 'REJECTED' | 'QUARANTINED';
export function shadowResult(b: Bronze, e: Evaluation, selected: DiscoveryTopic = 'ALL') {
  if (!e.silver) throw Error('CRAWLER_SILVER_REQUIRED');
  const expanded = Object.entries(DISCOVERY_TOPICS).filter(([k]) => selected === 'ALL' || k === selected).flatMap(([, v]) => [...v.terms]);
  const config = { ...DATA_CONFIG, version: GOLD_V2.version, topics: [...DATA_CONFIG.topics, ...expanded], weights: GOLD_V2.weights } as unknown as DataConfig;
  const v2 = e.silver.status === 'QUARANTINED' ? null : evaluate(b, e.silver, e.asOf, config);
  const body = e.silver.normalized.body;
  const symbols = (body.match(/[^\p{L}\p{N}\s.,!?;:'"()\-]/gu) || []).length;
  const voiceWarnings = [
    ...(symbols / Math.max(1, body.length) > GOLD_V2.maxVoiceSymbolsRatio ? ['HIGH_SYMBOL_DENSITY'] : []),
    ...(/\b(?:https?:\/\/|[0-9])/.test(body) ? ['VOICE_NORMALIZATION_REVIEW'] : []),
  ];
  const v1 = e.gold ? { score: e.gold.score, eligibility: e.gold.eligibility, evaluationVersion: e.gold.evaluationVersion, labels: [...e.gold.labels] } : null;
  let bucket: QualityBucket;
  if (!v2) bucket = 'QUARANTINED';
  else if (v2.labels.some(l => ['DUPLICATE', 'ADVERTISEMENT', 'SPAM'].includes(l))) bucket = 'REJECTED';
  else if (v2.labels.some(l => ['POLICY_RISK', 'LOW_CONTEXT'].includes(l)) || e.silver.flags.some(f => f !== 'DISCOVERY_REQUIRES_MANUAL_REVIEW' && f !== 'VOICE_TEXT_REVIEW_REQUIRED') || voiceWarnings.length) bucket = 'NEEDS_REVIEW';
  else if (v2.labels.includes('OFF_TOPIC') || v2.score < GOLD_V2.lowPriorityScore) bucket = 'LOW_PRIORITY';
  else if (v2.labels.includes('NEEDS_REVIEW') && v2.reasons.some(r => /COMMERCIAL|QUOTED_AD|duplicate candidate/.test(r))) bucket = 'NEEDS_REVIEW';
  else bucket = v2.score >= GOLD_V2.candidateScore ? 'GOLD_CANDIDATE' : 'NEEDS_REVIEW';
  return { version: GOLD_V2.version, configHash: hash({ config, policy: GOLD_V2, selected }), topic: selected,
    v1, v2, bucket, voiceWarnings, reasons: [...(v2?.reasons || e.silver.quarantineReasons), ...voiceWarnings],
    tokenCount: tokens(body).length, proposedOnly: true as const, productionAllowed: false as const };
}
/** Complete labels required for confusion counts; unknown labels are not negative labels. */
export function qualityMetrics(rows: { postId: string; score: number; bucket: QualityBucket; decision: string | null }[]) {
  const ranked = [...rows].sort((a,b) => b.score-a.score || a.postId.localeCompare(b.postId));
  const truth = Object.fromEntries(rows.filter(r => ['ACCEPT','REJECT'].includes(r.decision || '')).map(r => [r.postId, r.decision === 'ACCEPT']));
  const missing = rows.filter(r => !Object.prototype.hasOwnProperty.call(truth,r.postId)).map(r => r.postId);
  return { precisionAt10: precisionAt10(ranked.map(r => r.postId), truth),
    confusion: missing.length || !rows.length ? { status: 'NOT_MEASURED', falsePositives: null, falseNegatives: null, missing } : {
      status: 'MEASURED', falsePositives: rows.filter(r => r.bucket === 'GOLD_CANDIDATE' && !truth[r.postId]).map(r => r.postId),
      falseNegatives: rows.filter(r => r.bucket !== 'GOLD_CANDIDATE' && truth[r.postId]).map(r => r.postId), missing: [] },
    labelled: Object.keys(truth).length, total: rows.length, meaning: 'Current labelled sample only; not held-out generalization accuracy' };
}
