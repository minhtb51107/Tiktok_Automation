import { randomUUID } from 'crypto';
import type { TextProposal } from './normalization.types';
import { realNormalizationCases } from './real-normalization-cases';
export function offlineNormalize(item: {
  id: string;
  revision: number;
  originalText: string;
  spokenText: string;
}): TextProposal {
  const started = Date.now();
  const input = item.spokenText;
  const labels: NonNullable<TextProposal['labels']> = [];
  let text = input;
  const expand = (term: string, replacement: string, allow = true) => {
    const re = new RegExp(
      `(?<![\\p{L}\\p{N}_])${term}(?![\\p{L}\\p{N}_])`,
      'giu',
    );
    text = text.replace(re, (match) => {
      labels.push({
        term: match,
        replacement: allow ? replacement : match,
        category: allow ? 'EXPAND' : 'REVIEW_AMBIGUOUS',
        reason: allow
          ? 'Conservative whole-word mapping in supplied context'
          : 'Insufficient context to expand safely',
      });
      return allow ? replacement : match;
    });
  };
  expand('tphcm', 'Thành phố Hồ Chí Minh');
  expand('ko', 'không');
  expand('cty', 'công ty');
  expand(
    'vp',
    'văn phòng',
    /việc|job|làm|công|tuyển|ứng tuyển|văn phòng/iu.test(input),
  );
  expand('ĐH', 'đại học', /bằng|học|trường|tốt nghiệp|sinh viên/iu.test(input));
  text = text.replace(
    /(?:[:;=8xX][-^']?[)(]+|→|←|↔|⇒|⇐|⟶|->|=>|<--?)/g,
    (term) => {
      labels.push({
        term,
        replacement: '',
        category: 'OMIT_SPOKEN',
        reason: 'Visual emoticon/arrow omitted only from spoken proposal',
      });
      return '';
    },
  );
  for (const m of input.matchAll(
    /(?<![\p{L}\p{N}_])(t|đcđ|clm|cmn)(?![\p{L}\p{N}_])/giu,
  ))
    labels.push({
      term: m[1],
      replacement: m[1],
      category: 'REVIEW_AMBIGUOUS',
      reason: 'Keep expressive/ambiguous slang unchanged for user review',
    });
  for (const m of input.matchAll(/\b(?:TOEIC\s*\d+|N[124]|Fresher)\b/gi))
    labels.push({
      term: m[0],
      replacement: m[0],
      category: 'KEEP',
      reason: 'Preserve qualification or job terminology',
    });
  for (const m of input.matchAll(/\b\d+,\d+\s+quán\b/giu))
    labels.push({
      term: m[0],
      replacement: m[0],
      category: 'REVIEW_AMBIGUOUS',
      reason:
        'Likely enumeration/range; not automatically interpreted as decimal',
    });
  text = text.replace(/[ \t]{2,}/g, ' ').trim();
  const ambiguous = labels
    .filter((l) => l.category === 'REVIEW_AMBIGUOUS')
    .map((l) => ({ term: l.term, reason: l.reason }));
  return {
    runId: randomUUID(),
    itemId: item.id,
    baseRevision: item.revision,
    inputText: input,
    originalText: item.originalText,
    proposedSpokenText: text,
    changes: labels
      .filter((l) => l.replacement !== l.term)
      .map((l) => ({ before: l.term, after: l.replacement, reason: l.reason })),
    labels,
    ambiguousTerms: ambiguous,
    warnings: [
      'OFFLINE deterministic mappings, not AI output. Review context and omitted symbols before accepting.',
    ],
    error: null,
    approval: 'PENDING',
    decidedAt: null,
    provider: 'OFFLINE rules',
    model: 'conservative-vi-v1',
    mode: 'OFFLINE',
    executionStatus: 'SUCCESS',
    startedAt: new Date(started).toISOString(),
    completedAt: new Date().toISOString(),
    latencyMs: Date.now() - started,
    tokenUsage: { input: null, output: null, total: null },
    estimatedCost: 0,
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
