/**
 * Compatibility facade over the single V3 normalization engine (speech-normalizer.ts).
 * There is deliberately no second pipeline: Studio, Auto Generate Videos, offline
 * script normalization and TTS preparation all delegate to the same engine and rules.
 */
import { SPEECH_DICTIONARY_VERSION, SPEECH_RULES } from './speech-rules';
import { prepareTtsInput } from './speech-normalizer';

export { SPEECH_DICTIONARY_VERSION };
/** Unconditional mappings only (rules with context are listed in SPEECH_RULES). */
export const SPEECH_DICTIONARY = Object.freeze(
  SPEECH_RULES.filter((rule) => !rule.when).flatMap((rule) =>
    rule.terms.map((term) => ({
      term,
      spoken: rule.spoken as string,
      category: rule.category,
      caseSensitive: rule.caseMode === 'exact' ? true : undefined,
    })),
  ),
);
export function validatePronunciations(x: unknown): Record<string, string> {
  if (
    !x ||
    typeof x !== 'object' ||
    Array.isArray(x) ||
    Object.keys(x).length > 50
  )
    throw Error('Invalid pronunciation overrides');
  for (const [key, value] of Object.entries(x))
    if (
      !key.trim() ||
      key.length > 80 ||
      ['__proto__', 'constructor', 'prototype'].includes(key) ||
      typeof value !== 'string' ||
      !value.trim() ||
      value.length > 200
    )
      throw Error('Invalid pronunciation override');
  return { ...x } as Record<string, string>;
}
/**
 * Full spoken projection used for Kokoro input. Idempotent: applying it to its own
 * output returns the same text. `ambiguous` lists unresolved terms (kept verbatim).
 */
export function speechProjection(
  text: string,
  overrides: Record<string, string> = {},
) {
  validatePronunciations(overrides);
  const result = prepareTtsInput(text, overrides);
  return {
    text: result.spokenText,
    ambiguous: [...new Set(result.ambiguousTerms.map((a) => a.term))],
    version: SPEECH_DICTIONARY_VERSION,
    normalizationVersion: result.normalizationVersion,
    changes: result.changes,
    warnings: result.warnings,
    ttsInputHash: result.ttsInputHash,
    cacheHit: result.cacheHit,
  };
}
