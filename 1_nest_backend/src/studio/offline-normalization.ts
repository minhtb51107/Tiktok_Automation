import { randomUUID } from 'crypto';
import type { TextProposal } from './normalization.types';
import { realNormalizationCases } from './real-normalization-cases';
import { normalizeSpeech } from './speech-normalizer';

/**
 * OFFLINE script normalization. Thin adapter over the single V3 engine in
 * `speech-normalizer.ts` (SCRIPT mode: teencode/abbreviations/pronunciations; digits
 * and units are read later at TTS time so captions keep the numerals).
 */
export function offlineNormalize(item: {
  id: string;
  revision: number;
  originalText: string;
  spokenText: string;
}): TextProposal {
  const started = Date.now();
  const input = item.spokenText;
  const result = normalizeSpeech(input, { mode: 'SCRIPT' });
  const labels: NonNullable<TextProposal['labels']> = result.changes.map(
    (change) => ({
      term: change.before.trim(),
      replacement: change.after,
      category: change.stage === 'SYMBOL' ? 'OMIT_SPOKEN' : 'EXPAND',
      reason:
        change.stage === 'SYMBOL'
          ? `Visual emoticon/arrow omitted only from spoken proposal (${change.ruleId})`
          : `Rule ${change.ruleId} (${change.category})`,
    }),
  );
  for (const term of result.ambiguousTerms)
    labels.push({
      term: term.term,
      replacement: term.term,
      category: 'REVIEW_AMBIGUOUS',
      reason: term.reason,
    });
  for (const m of input.matchAll(/\b(?:TOEIC\s*\d+|N[124]|Fresher)\b/gi))
    labels.push({
      term: m[0],
      replacement: m[0],
      category: 'KEEP',
      reason: 'Preserve qualification or job terminology',
    });
  const ambiguous = result.ambiguousTerms.map((l) => ({
    term: l.term,
    reason: l.reason,
  }));
  for (const m of input.matchAll(/\b\d+,\d+\s+quán\b/giu)) {
    const reason =
      'Likely enumeration/range; not automatically interpreted as decimal';
    labels.push({
      term: m[0],
      replacement: m[0],
      category: 'REVIEW_AMBIGUOUS',
      reason,
    });
  }
  return {
    runId: randomUUID(),
    itemId: item.id,
    baseRevision: item.revision,
    inputText: input,
    originalText: item.originalText,
    proposedSpokenText: result.spokenText,
    changes: result.changes.map((c) => ({
      before: c.before,
      after: c.after,
      reason: `${c.ruleId} @${c.start}-${c.end}`,
    })),
    labels,
    ambiguousTerms: ambiguous,
    warnings: [
      'OFFLINE deterministic mappings, not AI output. Review context and omitted symbols before accepting.',
      ...result.warnings,
    ],
    error: null,
    approval: 'PENDING',
    decidedAt: null,
    provider: 'OFFLINE rules',
    model: 'conservative-vi-v3',
    mode: 'OFFLINE',
    executionStatus: 'SUCCESS',
    startedAt: new Date(started).toISOString(),
    completedAt: new Date().toISOString(),
    latencyMs: Date.now() - started,
    tokenUsage: { input: null, output: null, total: null },
    estimatedCost: 0,
    normalization: {
      normalizationVersion: result.normalizationVersion,
      ttsInputHash: result.ttsInputHash,
      changes: result.changes,
    },
  };
}
export function qualityCases() {
  const cases = [
    {
      input: 'công việc tphcm',
      expected: 'công việc Thành phố Hồ Chí Minh',
      category: 'EXPAND',
    },
    {
      input: 'cty tuyển job vp',
      expected: 'công ty tuyển job văn phòng',
      category: 'EXPAND',
    },
    { input: 'ko đi làm', expected: 'không đi làm', category: 'EXPAND' },
    { input: 'bằng ĐH', expected: 'bằng đại học', category: 'EXPAND' },
    {
      input: 'ĐH quay về',
      expected: 'ĐH quay về',
      category: 'REVIEW_AMBIGUOUS',
    },
    {
      input: 'TOEIC 700 N4 N2 Fresher',
      expected: 'TOEIC 700 N4 N2 Fresher',
      category: 'KEEP',
    },
    {
      input: 't hỏi 5,6 quán =)))) → cay đcđ clm cmn',
      expected: 't hỏi 5,6 quán cay đcđ clm cmn',
      category: 'OMIT_SPOKEN / REVIEW_AMBIGUOUS',
    },
    {
      input: 'Mất lòng trước, được lòng sau. Đời bạc vcl!',
      expected: 'Mất lòng trước, được lòng sau. Đời bạc vcl!',
      category: 'KEEP',
    },
    {
      input: 'công tác phát triển',
      expected: 'công tác phát triển',
      category: 'KEEP',
    },
  ];
  return cases.map((c) => {
    const p = offlineNormalize({
      id: 'quality',
      revision: 0,
      originalText: c.input,
      spokenText: c.input,
    });
    return {
      ...c,
      actual: p.proposedSpokenText,
      mode: 'OFFLINE',
      pass: c.expected === p.proposedSpokenText,
      semanticDrift:
        c.expected === p.proposedSpokenText
          ? 'NONE_AGAINST_EXPECTED'
          : 'REVIEW_REQUIRED',
      ambiguities: p.ambiguousTerms,
    };
  });
}
export function realQualityCases() {
  return realNormalizationCases.map((c) => {
    const p = offlineNormalize({
      id: c.targetId,
      revision: 0,
      originalText: c.input,
      spokenText: c.input,
    });
    const canon = (s: string) => s.replace(/\s+/g, ' ').trim();
    const pass = canon(c.expected) === canon(p.proposedSpokenText || '');
    return {
      ...c,
      actual: p.proposedSpokenText,
      mode: 'OFFLINE',
      pass,
      semanticDrift: pass ? 'NONE_AGAINST_CURATED_EXPECTED' : 'REVIEW_REQUIRED',
      ambiguities: p.ambiguousTerms,
      labels: p.labels,
    };
  });
}
