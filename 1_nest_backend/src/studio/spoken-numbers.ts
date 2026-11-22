/**
 * TTS transport normalization of numbers, money, dates, units and phone numbers.
 * Never changes source/display text and never expands slang (see speech-normalizer.ts).
 *
 * Every rule emits positioned edits over the ORIGINAL string, so callers can apply
 * them in a single pass together with word-level edits. Rules never run twice on the
 * same characters, and protected/claimed spans are excluded from both rewriting and
 * uncertain-number warnings.
 */
export const NUMBER_READING_VERSION = 'vi-numbers-2';
export interface TextEdit {
  start: number;
  end: number;
  after: string;
  rule: string;
}
const digits = [
  'không',
  'một',
  'hai',
  'ba',
  'bốn',
  'năm',
  'sáu',
  'bảy',
  'tám',
  'chín',
];
export function readInteger(value: string): string {
  if (!/^\d{1,12}$/.test(value)) throw Error('Unsupported integer');
  const n = Number(value);
  if (n === 0) return digits[0];
  const group = (v: number, full: boolean) => {
    const h = Math.floor(v / 100),
      t = Math.floor((v % 100) / 10),
      u = v % 10,
      words: string[] = [];
    if (h || full) words.push(digits[h], 'trăm');
    if (t > 1) words.push(digits[t], 'mươi');
    else if (t === 1) words.push('mười');
    else if (u && (h || full)) words.push('lẻ');
    if (u)
      words.push(
        u === 1 && t > 1 ? 'mốt' : u === 5 && t > 0 ? 'lăm' : digits[u],
      );
    return words.join(' ');
  };
  const groups: number[] = [];
  let left = n;
  while (left) {
    groups.unshift(left % 1000);
    left = Math.floor(left / 1000);
  }
  const units = ['', 'nghìn', 'triệu', 'tỷ'];
  return groups
    .flatMap((g, i) =>
      g ? [group(g, i > 0 && g < 100), units[groups.length - i - 1]] : [],
    )
    .filter(Boolean)
    .join(' ');
}
const readDigits = (s: string) =>
  [...s].map((d) => digits[Number(d)]).join(' ');
const stripZeros = (s: string) => s.replace(/^0+(?=\d)/, '');
/** Reads "1.500", "12", "2,5" (never guesses between thousands and decimals). */
export function readNumberToken(raw: string): string | null {
  try {
    if (/^\d{1,3}(?:\.\d{3})+$/.test(raw))
      return readInteger(raw.replace(/\./g, ''));
    if (/^\d+$/.test(raw)) return readInteger(stripZeros(raw));
    const m = raw.match(/^(\d+)[.,](\d+)$/);
    if (m) return readInteger(stripZeros(m[1])) + ' phẩy ' + readDigits(m[2]);
  } catch {
    return null;
  }
  return null;
}
const NUM = String.raw`\d+(?:[.,]\d+)*`;
const NOT_ALNUM_BEFORE = String.raw`(?<![\p{L}\p{N}.,/])`;
const NOT_ALNUM_AFTER = String.raw`(?![\p{L}\p{N}])`;
const MONEY_UNIT: Record<string, string> = {
  k: 'nghìn',
  tr: 'triệu',
  tỷ: 'tỷ',
};
const PER_UNIT =
  'tháng|ngày|năm|tuần|giờ|tiếng|đêm|người|ca|bữa|buổi|lần|cái|bạn|vé|suất|ly|cốc|phần|hộp';
const RANGE_UNITS =
  'thứ tiếng|ngôn ngữ|năm|tháng|ngày|tuổi|người|tuần|giờ|tiếng|phút|lần|buổi|cái|bạn|bữa|ca|quán|triệu|nghìn|tỷ|phần trăm|kg|km|lớp|tầng|bước|phần|đứa|chiếc|món|tờ|cuốn|bộ|chỗ|đợt|vòng';
const RANGE_PREV = new Set([
  'vòng',
  'tầm',
  'khoảng',
  'từ',
  'cấp',
  'lớp',
  'hơn',
  'gần',
  'trên',
  'dưới',
  'ca',
  'bậc',
  'tầng',
]);
const DATE_PREV = new Set([
  'ngày',
  'hôm',
  'từ',
  'đến',
  'tới',
  'vào',
  'trước',
  'sau',
  'hạn',
  'lúc',
  'hồi',
  'dịp',
]);
const MINUTE_PREV = new Set([
  'mất',
  'chờ',
  'đợi',
  'tầm',
  'khoảng',
  'trễ',
  'muộn',
  'nghỉ',
  'sau',
  'còn',
  'hơn',
  'gần',
  'đúng',
  'tới',
  'đến',
  'mỗi',
  'chỉ',
  'cỡ',
]);
/** [unit, spoken, spaceAllowed, caseSensitive] */
const UNITS: [string, string, boolean, boolean][] = [
  ['km/h', 'ki lô mét trên giờ', true, false],
  ['km2', 'ki lô mét vuông', false, false],
  ['km²', 'ki lô mét vuông', false, false],
  ['km', 'ki lô mét', true, false],
  ['kg', 'ki lô gam', true, false],
  ['mg', 'mi li gam', true, false],
  ['cm', 'xen ti mét', true, false],
  ['mm', 'mi li mét', true, false],
  ['ml', 'mi li lít', true, false],
  ['m2', 'mét vuông', false, false],
  ['m²', 'mét vuông', false, false],
  ['gb', 'ghi ga bai', true, false],
  ['mb', 'mê ga bai', true, false],
  ['tb', 'tê ra bai', true, false],
  ['kw', 'ki lô oát', true, false],
  ['ha', 'héc ta', false, false],
  ['°c', 'độ xê', false, false],
  // Single-letter g / m are strictly lower-case so 5G, 4G, 10M are never misread.
  ['g', 'gam', false, true],
  ['m', 'mét', false, true],
  ['l', 'lít', false, false],
];
const AGE_PREV = new Set([
  'đến',
  'tới',
  'dưới',
  'trên',
  'ngoài',
  'quá',
  'từ',
  'tầm',
  'khoảng',
  'hơn',
  'gần',
  't',
  'tui',
  'tôi',
  'mình',
  'em',
  'anh',
  'chị',
  'mới',
  'tao',
  'tớ',
]);
const AGE_BLOCK =
  /tấn|(?<![\p{L}])xe(?![\p{L}])|tải|container|hàng|gạo|lúa|than|thép|xi măng|cân|nặng/iu;
export interface NumberResult {
  edits: TextEdit[];
  warnings: string[];
}
/** `claimed` lets the caller reserve spans (protected tokens) from numeric rules. */
export function numberEdits(
  text: string,
  claimed: [number, number][] = [],
): NumberResult {
  const edits: TextEdit[] = [],
    warnings: string[] = [],
    spans: [number, number][] = [...claimed];
  const overlaps = (s: number, e: number) =>
    spans.some(([a, b]) => s < b && e > a);
  const prevWord = (at: number) =>
    (
      text
        .slice(Math.max(0, at - 40), at)
        .match(/([\p{L}\p{N}]+)[\s,;:(]*$/u)?.[1] || ''
    ).toLocaleLowerCase('vi');
  const push = (s: number, e: number, after: string, rule: string) => {
    spans.push([s, e]);
    if (after !== text.slice(s, e))
      edits.push({ start: s, end: e, after, rule });
  };
  const scan = (
    re: RegExp,
    rule: string,
    build: (m: RegExpMatchArray, s: number) => string | null,
  ) => {
    for (const m of text.matchAll(re)) {
      const s = m.index,
        e = s + m[0].length;
      if (overlaps(s, e)) continue;
      const after = build(m, s);
      if (after !== null) push(s, e, after, rule);
    }
  };
  // 1. Full dates dd/mm/yyyy
  scan(
    /(?<![\d/])(\d{1,2})\/(\d{1,2})\/(\d{4})(?![\d/])/gu,
    'VI_DATE_DMY',
    (m, s) => {
      const [whole, d, mo, y] = m;
      const date = new Date(Date.UTC(Number(y), Number(mo) - 1, Number(d)));
      if (
        date.getUTCFullYear() !== Number(y) ||
        date.getUTCMonth() !== Number(mo) - 1 ||
        date.getUTCDate() !== Number(d)
      ) {
        warnings.push('REVIEW_INVALID_DATE: ' + whole);
        spans.push([s, s + whole.length]);
        return null;
      }
      return `${readInteger(d)} tháng ${readInteger(mo)} năm ${readInteger(y)}`;
    },
  );
  // 2. Common 24/7 idiom before generic date/slash handling
  scan(/(?<![\p{L}\p{N}/])24\/7(?![\p{L}\p{N}/])/gu, 'IDIOM_24_7', () =>
    'hai mươi bốn trên bảy',
  );
  // 3. Day/month and month/year only with explicit date wording before them.
  scan(/(?<![\d/])(\d{1,2})\/(\d{1,2})(?![\d/])/gu, 'VI_DATE_DM', (m, s) => {
    const prev = prevWord(s);
    if (!DATE_PREV.has(prev)) return null;
    const d = Number(m[1]),
      mo = Number(m[2]);
    if (d < 1 || d > 31 || mo < 1 || mo > 12) return null;
    const body = `${readInteger(m[1])} tháng ${readInteger(m[2])}`;
    return prev === 'ngày' ? body : 'ngày ' + body;
  });
  scan(/(?<![\d/])(\d{1,2})\/(\d{4})(?![\d/])/gu, 'VI_DATE_MY', (m, s) => {
    if (prevWord(s) !== 'tháng' || Number(m[1]) < 1 || Number(m[1]) > 12)
      return null;
    return `${readInteger(m[1])} năm ${readInteger(m[2])}`;
  });
  // 4. Phone numbers (10-digit mobile + 11-digit 02x landline + 1800/1900 hotlines).
  scan(
    /(?<![\p{L}\p{N}.,/])(\+84|0084|0)[ .-]?(\d(?:[ .-]?\d){8,9})(?![\p{L}\p{N}])/gu,
    'PHONE',
    (m) => {
      const national = m[2].replace(/[ .-]/g, '');
      const validMobile = /^[3-9]\d{8}$/.test(national);
      const validLandline = /^2\d{8,9}$/.test(national);
      if (!validMobile && !validLandline) return null;
      return m[1] === '0'
        ? readDigits('0' + national)
        : 'cộng ' + readDigits('84') + ' ' + readDigits(national);
    },
  );
  scan(
    /(?<![\p{L}\p{N}.,/])(1800|1900)[ .-]?(\d{4,6})(?![\p{L}\p{N}])/gu,
    'HOTLINE',
    (m) => readDigits(m[1]) + ' ' + readDigits(m[2]),
  );
  // 5. Vietnamese birth-year shorthand (2k1..2k9) and mobile network (2G..5G).
  scan(
    new RegExp(`${NOT_ALNUM_BEFORE}2k([0-9])${NOT_ALNUM_AFTER}`, 'giu'),
    'BIRTH_YEAR_2K',
    (m) => 'hai ca ' + digits[Number(m[1])],
  );
  scan(
    new RegExp(`${NOT_ALNUM_BEFORE}([2-5])G${NOT_ALNUM_AFTER}`, 'gu'),
    'MOBILE_GEN',
    (m) => readInteger(m[1]) + ' gờ',
  );
  // 6. Vietnamese height format: 1m65, 1m7
  scan(
    new RegExp(`${NOT_ALNUM_BEFORE}1m(\\d{1,2})${NOT_ALNUM_AFTER}`, 'gu'),
    'HEIGHT_M',
    (m) => {
      const sub = m[1];
      if (sub.length === 1) return 'một mét ' + digits[Number(sub)];
      const n = Number(sub);
      if (n < 30 || n > 99) return null;
      return 'một mét ' + readInteger(sub);
    },
  );
  // 7. Compound money: 2tr500, 2tr500k, 1tr5, 3tỷ2
  scan(
    new RegExp(
      `${NOT_ALNUM_BEFORE}(\\d+)(tr|tỷ)(\\d{1,3})(k)?${NOT_ALNUM_AFTER}`,
      'giu',
    ),
    'MONEY_COMPOUND',
    (m) => {
      const lower = m[2].toLowerCase();
      if (m[4] && lower !== 'tr') return null;
      const big = MONEY_UNIT[lower],
        small = lower === 'tr' ? 'nghìn' : 'triệu',
        rest = Number(m[3].padEnd(3, '0'));
      return `${readInteger(m[1])} ${big} ${readInteger(String(rest))} ${small}`;
    },
  );
  // 8. Money ranges: 8-10tr, 20-30k, 8-10 triệu
  scan(
    new RegExp(
      `${NOT_ALNUM_BEFORE}(${NUM})\\s?[-–]\\s?(${NUM})\\s?(tr|triệu|tỷ|k|nghìn|ngàn)${NOT_ALNUM_AFTER}`,
      'giu',
    ),
    'MONEY_RANGE',
    (m) => {
      const a = readNumberToken(m[1]),
        b = readNumberToken(m[2]);
      if (!a || !b) return null;
      const u = m[3].toLowerCase(),
        unit = u === 'tr' ? 'triệu' : u === 'k' || u === 'ngàn' ? 'nghìn' : u;
      return `${a} đến ${b} ${unit}`;
    },
  );
  // 9. Money suffix (k / tr / tỷ) with optional per-unit: 50k, 50k/tháng, 1,5tr
  scan(
    new RegExp(
      `${NOT_ALNUM_BEFORE}(${NUM})(k|tr|tỷ)(?:\\s?/\\s?(${PER_UNIT}))?${NOT_ALNUM_AFTER}`,
      'giu',
    ),
    'MONEY_SUFFIX',
    (m, s) => {
      if (m[2].toLowerCase() === 'k' && prevWord(s) === 'độ') return null;
      const n = readNumberToken(m[1]);
      if (!n) return null;
      return `${n} ${MONEY_UNIT[m[2].toLowerCase()]}${m[3] ? ' một ' + m[3].toLowerCase() : ''}`;
    },
  );
  // 10. Currency
  scan(
    new RegExp(
      `${NOT_ALNUM_BEFORE}(${NUM})\\s?(?:đ|đồng|vnđ|vnd)${NOT_ALNUM_AFTER}`,
      'giu',
    ),
    'CURRENCY_VND',
    (m) => {
      const n = readNumberToken(m[1]);
      return n ? n + ' đồng' : null;
    },
  );
  scan(
    new RegExp(`\\$\\s?(${NUM})${NOT_ALNUM_AFTER}`, 'gu'),
    'CURRENCY_USD',
    (m) => {
      const n = readNumberToken(m[1]);
      return n ? n + ' đô la Mỹ' : null;
    },
  );
  scan(
    new RegExp(
      `${NOT_ALNUM_BEFORE}(${NUM})\\s?(?:\\$|usd)${NOT_ALNUM_AFTER}`,
      'giu',
    ),
    'CURRENCY_USD',
    (m) => {
      const n = readNumberToken(m[1]);
      return n ? n + ' đô la Mỹ' : null;
    },
  );
  // 11. Percentages, including ranges
  scan(
    new RegExp(`${NOT_ALNUM_BEFORE}(${NUM})\\s?[-–]\\s?(${NUM})\\s?%`, 'gu'),
    'PERCENT_RANGE',
    (m) => {
      const a = readNumberToken(m[1]),
        b = readNumberToken(m[2]);
      return a && b ? `${a} đến ${b} phần trăm` : null;
    },
  );
  scan(
    new RegExp(`${NOT_ALNUM_BEFORE}(${NUM})\\s?%`, 'gu'),
    'PERCENT',
    (m) => {
      const n = readNumberToken(m[1]);
      return n ? n + ' phần trăm' : null;
    },
  );
  // 12. Clock times: 8h-17h, 7h30, 14:30
  const hhmm = (h: string, mi?: string) => {
    const hour = Number(h),
      minute = mi === undefined ? 0 : Number(mi);
    if (hour > 24 || minute > 59) return null;
    const hourWords = readInteger(h);
    if (minute === 0) return hourWords + ' giờ';
    return `${hourWords} giờ ${minute < 10 ? 'lẻ ' : ''}${readInteger(String(minute))}`;
  };
  scan(
    new RegExp(
      `${NOT_ALNUM_BEFORE}(\\d{1,2})h(\\d{2})?\\s?[-–]\\s?(\\d{1,2})h(\\d{2})?${NOT_ALNUM_AFTER}`,
      'giu',
    ),
    'TIME_RANGE',
    (m) => {
      const a = hhmm(m[1], m[2]),
        b = hhmm(m[3], m[4]);
      return a && b ? `${a} đến ${b}` : null;
    },
  );
  scan(
    /(?<![\p{L}\p{N}.,/:])(\d{1,2})[h:](\d{2})(?![\p{L}\p{N}:])/giu,
    'TIME_HM',
    (m, s) => {
      if (m[0].includes(':') && ['lệ', 'số'].includes(prevWord(s))) {
        spans.push([s, s + m[0].length]);
        return null;
      }
      return hhmm(m[1], m[2]);
    },
  );
  scan(
    new RegExp(`${NOT_ALNUM_BEFORE}(\\d{1,2})h${NOT_ALNUM_AFTER}`, 'giu'),
    'TIME_H',
    (m) => hhmm(m[1]),
  );
  // 13. Minutes shorthand (15p, 30p) only with explicit duration context
  scan(
    new RegExp(`${NOT_ALNUM_BEFORE}(\\d{1,3})p${NOT_ALNUM_AFTER}`, 'gu'),
    'TIME_MINUTES',
    (m, s) => {
      const val = Number(m[1]);
      if (val <= 0 || val > 240 || !MINUTE_PREV.has(prevWord(s))) return null;
      return readInteger(m[1]) + ' phút';
    },
  );
  // 14. Units attached to numbers
  for (const [unit, spoken, spaceOk, caseSensitive] of UNITS) {
    const esc = unit.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');
    scan(
      new RegExp(
        `${NOT_ALNUM_BEFORE}(${NUM})${spaceOk ? '\\s?' : ''}${esc}${NOT_ALNUM_AFTER}`,
        caseSensitive ? 'gu' : 'giu',
      ),
      'UNIT_' + unit.toUpperCase().replace(/[^A-Z0-9²]/g, ''),
      (m) => {
        const n = readNumberToken(m[1]);
        return n ? `${n} ${spoken}` : null;
      },
    );
  }
  // 15. Age written as 28t only with explicit age evidence.
  scan(
    new RegExp(`${NOT_ALNUM_BEFORE}(\\d{2})t${NOT_ALNUM_AFTER}`, 'giu'),
    'AGE_T',
    (m, s) => {
      const age = Number(m[1]);
      if (age < 16 || age > 70) return null;
      const around = text.slice(Math.max(0, s - 60), s + 60);
      if (AGE_BLOCK.test(around) || !AGE_PREV.has(prevWord(s))) return null;
      return readInteger(m[1]) + ' tuổi';
    },
  );
  // 16. Per-period counts: 1 ngày/tuần
  scan(
    new RegExp(
      `${NOT_ALNUM_BEFORE}(\\d+)\\s(ngày|buổi|lần|ca|tiếng|giờ)/(tuần|tháng|năm|ngày)${NOT_ALNUM_AFTER}`,
      'giu',
    ),
    'PER_PERIOD',
    (m) =>
      `${readInteger(m[1])} ${m[2].toLowerCase()} một ${m[3].toLowerCase()}`,
  );
  // 17. Japanese level N1-N5
  scan(
    /(?<![\p{L}\p{N}])N([1-5])(?![\p{L}\p{N}])/gu,
    'JAPANESE_LEVEL',
    (m) => 'en ' + readInteger(m[1]),
  );
  // 18. Alternatives "5,6 quán" and ranges "3-4 thứ tiếng" / "vòng 4-5"
  scan(
    /(?<![\p{L}\p{N}.,])(\d{1,3}),\s*(\d{1,3})(?=\s+(?:quán|người|cái|đứa|chỗ|tiệm)(?![\p{L}\p{N}]))/gu,
    'COUNT_ALTERNATIVES',
    (m) => readInteger(m[1]) + ', ' + readInteger(m[2]),
  );
  scan(
    new RegExp(
      `${NOT_ALNUM_BEFORE}(\\d+)\\s?[-–]\\s?(\\d+)(?![\\p{N}/])`,
      'gu',
    ),
    'CONTEXT_RANGE',
    (m, s) => {
      const after = text
        .slice(s + m[0].length, s + m[0].length + 24)
        .trimStart()
        .toLocaleLowerCase('vi');
      const unitNext = new RegExp(
        `^(?:${RANGE_UNITS})(?![\\p{L}\\p{N}])`,
        'u',
      ).test(after);
      if (!unitNext && !RANGE_PREV.has(prevWord(s))) return null;
      return readInteger(m[1]) + ' đến ' + readInteger(m[2]);
    },
  );
  // 19. Decimal with unit word and thousands-separated integers
  scan(
    /(?<![\p{L}\p{N}.,])(\d+)[,.](\d+)(?=\s*(?:triệu|tỷ|nghìn)(?![\p{L}\p{N}]))/gu,
    'DECIMAL_UNIT',
    (m) => readInteger(stripZeros(m[1])) + ' phẩy ' + readDigits(m[2]),
  );
  scan(
    /(?<![\p{L}\p{N}.,])\d{1,3}(?:\.\d{3})+(?![\p{N}]|[.,]\d)/gu,
    'THOUSANDS',
    (m) => readNumberToken(m[0]),
  );
  // 20. A plus sign directly before a number
  scan(/(?<![\p{L}\p{N}])\+(?=\d)/gu, 'PLUS', () => 'cộng ');
  // Uncertain forms are reported rather than guessed. Claimed (protected/dictionary)
  // spans are masked out so URLs, @handles and tokens like `in4` never emit warnings.
  const maskedForCheck = applyEdits(text, [
    ...edits,
    ...claimed
      .filter(([a, b]) => !edits.some((e) => a < e.end && b > e.start))
      .map(([start, end]) => ({
        start,
        end,
        after: ' '.repeat(end - start),
        rule: 'MASK',
      })),
  ]);
  const uncertain = [
    ...maskedForCheck.matchAll(/\d+[,.\/-]\d+|[A-Za-z]\d+|\d+[A-Za-z]/g),
  ].map((m) => m[0]);
  if (uncertain.length)
    warnings.push('REVIEW_NUMBER_CONTEXT: ' + uncertain.join(', '));
  // 21. Remaining plain cardinals
  scan(/(?<![\p{L}\p{N}])\d{1,12}(?![\p{L}\p{N}])/gu, 'CARDINAL', (m) =>
    readInteger(m[0]),
  );
  return { edits: edits.sort((a, b) => a.start - b.start), warnings };
}
export function applyEdits(text: string, edits: TextEdit[]): string {
  let out = '',
    last = 0;
  for (const e of [...edits].sort((a, b) => a.start - b.start)) {
    out += text.slice(last, e.start) + e.after;
    last = e.end;
  }
  return out + text.slice(last);
}
export function normalizeSpokenNumbers(input: string) {
  const { edits, warnings } = numberEdits(input);
  const text = applyEdits(input, edits);
  if (/\d/.test(text)) warnings.push('REVIEW_UNSUPPORTED_NUMBER');
  return {
    version: NUMBER_READING_VERSION,
    text,
    changes: edits.map((e) => ({
      before: input.slice(e.start, e.end),
      after: e.after,
      rule: e.rule,
    })),
    warnings,
  };
}
