import { createHash } from 'crypto';
import {
  AMBIGUOUS_REASONS,
  PRONOUN_LETTERS,
  PRESERVED_STYLE_TERMS,
  SPEECH_DICTIONARY_VERSION,
  SPEECH_NORMALIZER_VERSION,
  SPEECH_PHRASES,
  SPEECH_POLICY_VERSION,
  SPEECH_RULES,
  type RuleContext,
  type RuleToken,
  type SpeechRule,
} from './speech-rules';
import {
  NUMBER_READING_VERSION,
  applyEdits,
  numberEdits,
  type TextEdit,
} from './spoken-numbers';

/**
 * Offline Vietnamese speech normalization engine (V3). One pipeline for Studio and
 * Auto Generate Videos:
 *   protection → tokenization → overrides → phrases → context/dictionary rules →
 *   number/unit normalization → symbols → conflict resolution → single-pass apply →
 *   validation (protected tokens + idempotency).
 * All edits are positioned over the input text, so no rule can transform the output
 * of another rule, and re-running the engine on its own output changes nothing.
 * No network, no inference, no cost.
 */
export type SpeechMode = 'SCRIPT' | 'TTS';
export type SpeechStage =
  | 'OVERRIDE'
  | 'PHRASE'
  | 'NUMBER'
  | 'CONTEXT'
  | 'DICTIONARY'
  | 'SYMBOL';
export interface SpeechChange {
  start: number;
  end: number;
  before: string;
  after: string;
  ruleId: string;
  stage: SpeechStage;
  category: string;
}
export interface AmbiguousTerm {
  term: string;
  start: number;
  end: number;
  reason: string;
}
export interface SpeechNormalization {
  normalizationVersion: string;
  dictionaryVersion: string;
  policyVersion: string;
  numberVersion: string;
  mode: SpeechMode;
  /** Exactly what was supplied (never modified). */
  originalText: string;
  /** NFC form that positions refer to. Equals originalText when already NFC. */
  inputText: string;
  spokenText: string;
  changes: SpeechChange[];
  ambiguousTerms: AmbiguousTerm[];
  warnings: string[];
  valid: boolean;
  ttsInputHash: string;
  cacheHit: boolean;
}
export interface NormalizeOptions {
  mode?: SpeechMode;
  overrides?: Record<string, string>;
}
const PRIORITY: Record<SpeechStage, number> = {
  OVERRIDE: 100,
  PHRASE: 80,
  NUMBER: 70,
  CONTEXT: 60,
  DICTIONARY: 50,
  SYMBOL: 40,
};
const sha = (text: string) => createHash('sha256').update(text).digest('hex');
const escapeRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const upperFirst = (s: string) =>
  s ? s[0].toLocaleUpperCase('vi') + s.slice(1) : s;
const PRONOUN_PREV = new Set([
  'giống',
  'như',
  'với',
  'của',
  'cho',
  'bảo',
  'hỏi',
  'nói',
  'nhắn',
  'gọi',
]);

interface Edit {
  start: number;
  end: number;
  after: string;
  ruleId: string;
  stage: SpeechStage;
  category: string;
}
const rulesByTerm = new Map<string, SpeechRule[]>();
for (const rule of SPEECH_RULES)
  for (const term of rule.terms) {
    const key = rule.caseMode === 'exact' ? term : term.toLocaleLowerCase('vi');
    rulesByTerm.set(key, [...(rulesByTerm.get(key) || []), rule]);
  }
export const SPEECH_RULE_COUNT = {
  tokenRules: SPEECH_RULES.length,
  tokenTerms: SPEECH_RULES.reduce((sum, r) => sum + r.terms.length, 0),
  contextRules: SPEECH_RULES.filter((r) => r.when).length,
  phraseRules: SPEECH_PHRASES.length,
  numberRuleFamilies: 34,
  preservedStyleTerms: PRESERVED_STYLE_TERMS.size,
  ambiguousTermsTracked: Object.keys(AMBIGUOUS_REASONS).length,
};

function protectedSpans(text: string): [number, number][] {
  const spans: [number, number][] = [];
  const add = (re: RegExp) => {
    for (const m of text.matchAll(re)) {
      const s = m.index,
        e = s + m[0].length;
      if (!spans.some(([a, b]) => s < b && e > a)) spans.push([s, e]);
    }
  };
  add(/(?:https?:\/\/|www\.)[^\s]+/giu);
  add(/[\p{L}\p{N}._%+-]+@[\p{L}\p{N}-]+(?:\.[\p{L}\p{N}-]+)+/gu);
  add(/(?<![\p{L}\p{N}_])@[\p{L}\p{N}._]+/gu);
  add(/(?<![\p{L}\p{N}_])#[\p{L}\p{N}_]+/gu);
  add(/(?<![\p{L}\p{N}])\/post\/[A-Za-z0-9_-]+/gu);
  add(/(?<![\p{L}\p{N}_])source:[A-Za-z0-9:_-]+/gu);
  return spans.sort((a, b) => a[0] - b[0]);
}
const inside = (spans: [number, number][], s: number, e: number) =>
  spans.some(([a, b]) => s < b && e > a);

interface Structure {
  tokens: RuleToken[];
  sentenceOf: number[];
  clauseOf: number[];
  sentenceWords: Set<string>[];
  clauseWords: Set<string>[];
  clauseTokens: number[][];
  sentenceQuestion: boolean[];
}
function analyse(text: string): Structure {
  const tokens: RuleToken[] = [];
  for (const m of text.matchAll(/[\p{L}\p{M}\p{N}_]+(?:['’][\p{L}]+)?/gu))
    tokens.push({
      start: m.index,
      end: m.index + m[0].length,
      text: m[0],
      lower: m[0].toLocaleLowerCase('vi'),
    });
  const sentenceOf: number[] = [],
    clauseOf: number[] = [];
  let sentence = 0,
    clause = 0;
  tokens.forEach((t, i) => {
    if (i > 0) {
      const gap = text.slice(tokens[i - 1].end, t.start);
      if (/[.!?…\n]/.test(gap)) {
        sentence++;
        clause++;
      } else if (/[,;:()"“”]|(?:^|\s)[-–—](?:\s|$)/.test(gap)) clause++;
    }
    sentenceOf.push(sentence);
    clauseOf.push(clause);
  });
  const sentenceWords: Set<string>[] = [],
    clauseWords: Set<string>[] = [],
    clauseTokens: number[][] = [],
    lastOfSentence: number[] = [];
  tokens.forEach((t, i) => {
    (sentenceWords[sentenceOf[i]] ||= new Set()).add(t.lower);
    (clauseWords[clauseOf[i]] ||= new Set()).add(t.lower);
    (clauseTokens[clauseOf[i]] ||= []).push(i);
    lastOfSentence[sentenceOf[i]] = i;
  });
  const sentenceQuestion = lastOfSentence.map((last, s) => {
    const nextFirst = tokens.findIndex((_, i) => sentenceOf[i] === s + 1);
    const gap = text.slice(
      tokens[last].end,
      nextFirst >= 0 ? tokens[nextFirst].start : text.length,
    );
    return gap.includes('?');
  });
  return {
    tokens,
    sentenceOf,
    clauseOf,
    sentenceWords,
    clauseWords,
    clauseTokens,
    sentenceQuestion,
  };
}
function contextFor(text: string, st: Structure, i: number): RuleContext {
  const token = st.tokens[i],
    prev = st.tokens[i - 1],
    next = st.tokens[i + 1],
    clause = st.clauseOf[i],
    sentence = st.sentenceOf[i];
  const before = new Set<string>();
  for (const j of st.clauseTokens[clause])
    if (j < i) before.add(st.tokens[j].lower);
  return {
    token,
    text,
    prev,
    next,
    prevSameClause: prev && st.clauseOf[i - 1] === clause ? prev : undefined,
    nextSameClause: next && st.clauseOf[i + 1] === clause ? next : undefined,
    sentenceStart: !prev || st.sentenceOf[i - 1] !== sentence,
    clauseStart: !prev || st.clauseOf[i - 1] !== clause,
    clauseEnd: !next || st.clauseOf[i + 1] !== clause,
    endsWithQuestion: st.sentenceQuestion[sentence],
    sentenceWords: st.sentenceWords[sentence],
    clauseWords: st.clauseWords[clause],
    clauseWordsBefore: before,
  };
}
function caseAllowed(rule: SpeechRule, c: RuleContext) {
  const t = c.token.text;
  if (rule.caseMode === 'any') return true;
  if (rule.caseMode === 'exact') return rule.terms.includes(t);
  return (
    t === c.token.lower || (c.sentenceStart && t === upperFirst(c.token.lower))
  );
}
function shapeCase(c: RuleContext, replacement: string, category: string) {
  if (category === 'ACRONYM' || category === 'TTS_PHONETIC') return replacement;
  const t = c.token.text,
    first = t[0];
  const allCaps =
    t.length > 1 && t === t.toLocaleUpperCase('vi') && /\p{L}/u.test(t);
  const startsUpper = first !== first.toLocaleLowerCase('vi');
  if (startsUpper && !allCaps) return upperFirst(replacement);
  if (allCaps && c.sentenceStart) return upperFirst(replacement);
  return replacement;
}
function symbolEdits(
  text: string,
  spans: [number, number][],
  mode: SpeechMode,
): Edit[] {
  const raw: { start: number; end: number; id: string }[] = [];
  const collect = (re: RegExp, id: string) => {
    for (const m of text.matchAll(re)) {
      const s = m.index,
        e = s + m[0].length;
      if (!inside(spans, s, e)) raw.push({ start: s, end: e, id });
    }
  };
  collect(
    /\s*(?<![\p{L}\p{N}])[:;=][-^']?[)(]+(?![\p{L}\p{N}])\s*/gu,
    'SYM-EMOTICON',
  );
  collect(/\s*(?:→|←|↔|⇒|⇐|⟶|->|=>|<--?)\s*/gu, 'SYM-ARROW');
  raw.sort((a, b) => a.start - b.start);
  const merged: typeof raw = [];
  for (const r of raw) {
    const last = merged[merged.length - 1];
    if (last && r.start <= last.end) last.end = Math.max(last.end, r.end);
    else merged.push({ ...r });
  }
  const edits: Edit[] = merged.map((r) => {
    const hasNewline = text.slice(r.start, r.end).includes('\n');
    return {
      start: r.start,
      end: r.end,
      after:
        r.start > 0 && r.end < text.length ? (hasNewline ? '\n' : ' ') : '',
      ruleId: r.id,
      stage: 'SYMBOL' as const,
      category: 'OMIT_SPOKEN',
    };
  });
  if (mode === 'TTS') {
    for (const m of text.matchAll(
      /(?<=[\p{L}\p{N}])\s+\+\s+(?=[\p{L}\p{N}])/gu,
    )) {
      const s = m.index,
        e = s + m[0].length;
      if (!inside(spans, s, e))
        edits.push({
          start: s,
          end: e,
          after: ' cộng ',
          ruleId: 'SYM-PLUS-CONJ',
          stage: 'SYMBOL' as const,
          category: 'SYMBOL',
        });
    }
  }
  return edits;
}
function core(
  src: string,
  mode: SpeechMode,
  overrides: Record<string, string>,
): {
  spoken: string;
  changes: SpeechChange[];
  ambiguous: AmbiguousTerm[];
  warnings: string[];
  protectedStrings: string[];
} {
  const warnings: string[] = [];
  const spans = protectedSpans(src);
  const st = analyse(src);
  const candidates: Edit[] = [];
  // 1. User pronunciation overrides (highest priority, exact whole-term match).
  for (const [term, replacement] of Object.entries(overrides)) {
    const re = new RegExp(
      `(?<![\\p{L}\\p{N}_])${escapeRegex(term)}(?![\\p{L}\\p{N}_])`,
      'gu',
    );
    for (const m of src.matchAll(re))
      candidates.push({
        start: m.index,
        end: m.index + m[0].length,
        after: replacement,
        ruleId: 'OVERRIDE-USER',
        stage: 'OVERRIDE',
        category: 'USER_PRONUNCIATION',
      });
  }
  // 2. Phrases (longest first), then context and dictionary token rules.
  const phrases = [...SPEECH_PHRASES].sort(
    (a, b) => b.words.length - a.words.length,
  );
  st.tokens.forEach((token, i) => {
    if (inside(spans, token.start, token.end)) return;
    const phrase = phrases.find((ph) =>
      ph.words.every(
        (w, k) =>
          st.tokens[i + k]?.lower === w &&
          (k === 0 ||
            /^[\s.]{1,2}$/.test(
              src.slice(st.tokens[i + k - 1].end, st.tokens[i + k].start),
            )),
      ),
    );
    if (phrase) {
      const last = st.tokens[i + phrase.words.length - 1];
      candidates.push({
        start: token.start,
        end: last.end,
        after: phrase.spoken,
        ruleId: phrase.id,
        stage: 'PHRASE',
        category: phrase.category,
      });
      return;
    }
    const rules = [
      ...(rulesByTerm.get(token.text) || []),
      ...(token.text === token.lower ? [] : rulesByTerm.get(token.lower) || []),
    ].filter((r, idx, all) => all.indexOf(r) === idx);
    if (!rules.length) return;
    const ctx = contextFor(src, st, i);
    for (const rule of rules) {
      if (rule.ttsOnly && mode !== 'TTS') continue;
      if (!caseAllowed(rule, ctx)) continue;
      if (rule.when && !rule.when(ctx)) continue;
      const spoken =
        typeof rule.spoken === 'function' ? rule.spoken(ctx) : rule.spoken;
      candidates.push({
        start: token.start,
        end: token.end,
        after: shapeCase(ctx, spoken, rule.category),
        ruleId: rule.id,
        stage: rule.id.startsWith('CTX-') ? 'CONTEXT' : 'DICTIONARY',
        category: rule.category,
      });
      break;
    }
  });
  // 3. Numbers, money, dates, units (TTS only). Claim protected spans plus any
  //    alphanumeric tokens already handled by overrides or dictionary (e.g. in4).
  if (mode === 'TTS') {
    const claimedForNumbers: [number, number][] = [
      ...spans,
      ...candidates
        .filter(
          (c) =>
            c.stage === 'OVERRIDE' ||
            /\d/.test(src.slice(c.start, c.end)),
        )
        .map((c): [number, number] => [c.start, c.end]),
    ];
    const numbers = numberEdits(src, claimedForNumbers);
    warnings.push(...numbers.warnings);
    for (const e of numbers.edits as TextEdit[])
      candidates.push({
        start: e.start,
        end: e.end,
        after: e.after,
        ruleId: 'NUM-' + e.rule,
        stage: 'NUMBER',
        category: 'NUMBER',
      });
  }
  // 4. Visual-only symbols that must not be voiced (plus spoken '+' in TTS mode).
  candidates.push(...symbolEdits(src, spans, mode));
  // 5. Conflict resolution: priority, then longer span, then position.
  const accepted: Edit[] = [];
  for (const c of [...candidates].sort(
    (a, b) =>
      PRIORITY[b.stage] - PRIORITY[a.stage] ||
      b.end - b.start - (a.end - a.start) ||
      a.start - b.start,
  ))
    if (c.stage === 'OVERRIDE' || !inside(spans, c.start, c.end))
      if (!accepted.some((x) => c.start < x.end && c.end > x.start))
        accepted.push(c);
  accepted.sort((a, b) => a.start - b.start);
  const changes: SpeechChange[] = accepted
    .filter((e) => e.after !== src.slice(e.start, e.end))
    .map((e) => ({
      start: e.start,
      end: e.end,
      before: src.slice(e.start, e.end),
      after: e.after,
      ruleId: e.ruleId,
      stage: e.stage,
      category: e.category,
    }));
  const spoken = applyEdits(
    src,
    accepted.map((e) => ({
      start: e.start,
      end: e.end,
      after: e.after,
      rule: e.ruleId,
    })),
  ).trim();
  // 6. Unresolved ambiguous tokens are kept verbatim and reported.
  const ambiguous: AmbiguousTerm[] = [];
  st.tokens.forEach((token, i) => {
    if (
      inside(spans, token.start, token.end) ||
      accepted.some((e) => token.start < e.end && token.end > e.start)
    )
      return;
    const key = token.lower;
    const reason = AMBIGUOUS_REASONS[key];
    if (!reason) return;
    const ctx = contextFor(src, st, i);
    if (key === 'vs' && (token.text === 'VS' || ctx.nextSameClause?.lower === 'code' ||
      (/^\p{Lu}/u.test(ctx.prevSameClause?.text ?? '') && /^\p{Lu}/u.test(ctx.nextSameClause?.text ?? ''))))
      return; // Keep a product name or explicit comparison as written.
    if (token.text.length === 1) {
      const nextWord = ctx.nextSameClause?.text ?? '';
      const pronounLike =
        /^\p{Ll}/u.test(nextWord) ||
        (!!ctx.prevSameClause && PRONOUN_PREV.has(ctx.prevSameClause.lower));
      if (
        PRONOUN_LETTERS.has(key)
          ? !pronounLike
          : token.text !== key || !(ctx.prev || ctx.next)
      )
        return;
    }
    ambiguous.push({
      term: token.text,
      start: token.start,
      end: token.end,
      reason,
    });
  });
  return {
    spoken,
    changes,
    ambiguous,
    warnings,
    protectedStrings: spans.map(([a, b]) => src.slice(a, b)),
  };
}
const cache = new Map<string, SpeechNormalization>();
export function clearSpeechNormalizerCache() {
  cache.clear();
}
export function normalizeSpeech(
  input: string,
  options: NormalizeOptions = {},
): SpeechNormalization {
  const mode = options.mode ?? 'TTS',
    overrides = options.overrides ?? {};
  const key = JSON.stringify([
    SPEECH_NORMALIZER_VERSION,
    SPEECH_DICTIONARY_VERSION,
    SPEECH_POLICY_VERSION,
    NUMBER_READING_VERSION,
    mode,
    input,
    overrides,
  ]);
  const hit = cache.get(key);
  if (hit) return { ...structuredClone(hit), cacheHit: true };
  const src = input.normalize('NFC');
  const first = core(src, mode, overrides);
  const failures: string[] = [];
  // Validation: protected tokens survive verbatim, output is usable, and the
  // result is a fixed point (idempotent) for the same mode and overrides.
  let cursor = 0;
  for (const p of first.protectedStrings) {
    const at = first.spoken.indexOf(p, cursor);
    if (
      at < 0 &&
      !Object.values(overrides).some((v) => v.includes(p)) &&
      !Object.keys(overrides).some((k) => p.includes(k))
    )
      failures.push('PROTECTED_TOKEN_LOST');
    else if (at >= 0) cursor = at + p.length;
  }
  if (/[\uE000-\uF8FF]/u.test(first.spoken)) failures.push('PLACEHOLDER_LEAK');
  if (/[\p{L}\p{N}]/u.test(src) && !/[\p{L}\p{N}]/u.test(first.spoken))
    failures.push('EMPTY_SPOKEN_TEXT');
  if (first.spoken.length > src.length * 4 + 128) failures.push('LENGTH_BOUND');
  if (first.changes.length && !failures.length) {
    const again = core(first.spoken, mode, overrides);
    if (again.spoken !== first.spoken) failures.push('NOT_IDEMPOTENT');
  }
  const valid = failures.length === 0;
  const spokenText = valid ? first.spoken : src.trim();
  const warnings = [...first.warnings];
  if (mode === 'TTS') {
    const withoutProtected = applyEdits(
      spokenText,
      protectedSpans(spokenText).map(([start, end]) => ({
        start,
        end,
        after: ' '.repeat(end - start),
        rule: 'MASK',
      })),
    );
    if (
      /\d/.test(withoutProtected) &&
      !warnings.some((w) => w.startsWith('REVIEW_'))
    )
      warnings.push('REVIEW_UNSUPPORTED_NUMBER');
  }
  if (!valid) warnings.push('VALIDATION_FALLBACK: ' + failures.join(','));
  const result: SpeechNormalization = {
    normalizationVersion: [
      SPEECH_NORMALIZER_VERSION,
      SPEECH_DICTIONARY_VERSION,
      SPEECH_POLICY_VERSION,
      NUMBER_READING_VERSION,
    ].join(' / '),
    dictionaryVersion: SPEECH_DICTIONARY_VERSION,
    policyVersion: SPEECH_POLICY_VERSION,
    numberVersion: NUMBER_READING_VERSION,
    mode,
    originalText: input,
    inputText: src,
    spokenText,
    changes: valid ? first.changes : [],
    ambiguousTerms: first.ambiguous,
    warnings,
    valid,
    ttsInputHash: sha(spokenText),
    cacheHit: false,
  };
  if (cache.size >= 1000) cache.delete(cache.keys().next().value!);
  cache.set(key, structuredClone(result));
  return result;
}
/** The exact string handed to Kokoro, plus everything needed to audit it. */
export function prepareTtsInput(
  text: string,
  overrides: Record<string, string> = {},
) {
  return normalizeSpeech(text, { mode: 'TTS', overrides });
}
export interface NormalizationRecord {
  originalText: string;
  displayText: string;
  /** Narration/script text the editor holds (teencode already expanded). */
  spokenText: string;
  /** Exactly what Kokoro receives (script text + number/unit reading). */
  ttsInputText: string;
  normalizationVersion: string;
  /** Positions refer to `spokenText`. */
  normalizationChanges: SpeechChange[];
  ambiguousTerms: AmbiguousTerm[];
  warnings: string[];
  ttsInputHash: string;
}
export function buildNormalizationRecord(item: {
  originalText: string;
  displayText: string;
  spokenText: string;
  pronunciationOverrides?: Record<string, string>;
}): NormalizationRecord {
  const tts = prepareTtsInput(item.spokenText, item.pronunciationOverrides);
  return {
    originalText: item.originalText,
    displayText: item.displayText,
    spokenText: item.spokenText,
    ttsInputText: tts.spokenText,
    normalizationVersion: tts.normalizationVersion,
    normalizationChanges: tts.changes,
    ambiguousTerms: tts.ambiguousTerms,
    warnings: tts.warnings,
    ttsInputHash: tts.ttsInputHash,
  };
}
