/** TTS transport normalization only. Never changes source/display or expands slang. */
export const NUMBER_READING_VERSION = 'vi-numbers-1';
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
export function normalizeSpokenNumbers(input: string) {
  const changes: { before: string; after: string; rule: string }[] = [],
    warnings: string[] = [];
  const replace = (
    text: string,
    pattern: RegExp,
    fn: (...args: any[]) => string,
    rule: string,
  ) =>
    text.replace(pattern, (...a: any[]) => {
      const after = fn(...a);
      if (after !== a[0]) changes.push({ before: a[0], after, rule });
      return after;
    });
  let text = input;
  text = replace(
    text,
    /\b(\d{1,2})\/(\d{1,2})\/(\d{4})\b/g,
    (whole, d, m, y) => {
      const date = new Date(Date.UTC(Number(y), Number(m) - 1, Number(d)));
      if (
        date.getUTCFullYear() !== Number(y) ||
        date.getUTCMonth() !== Number(m) - 1 ||
        date.getUTCDate() !== Number(d)
      ) {
        warnings.push('REVIEW_INVALID_DATE: ' + whole);
        return whole;
      }
      return `${readInteger(d)} tháng ${readInteger(m)} năm ${readInteger(y)}`;
    },
    'VI_DATE_DMY',
  );
  text = replace(
    text,
    /\bN([1-5])\b/g,
    (_, n) => 'en ' + readInteger(n),
    'JAPANESE_LEVEL',
  );
  text = replace(
    text,
    /\b(\d{1,3}),\s*(\d{1,3})(?=\s+(?:quán|người|cái|đứa|chỗ|tiệm)\b)/gu,
    (_, a, b) => readInteger(a) + ', ' + readInteger(b),
    'COUNT_ALTERNATIVES',
  );
  text = replace(
    text,
    /\b(\d+)\s*[-–]\s*(\d+)(?=\s+(?:thứ tiếng|ngôn ngữ|năm|tháng|ngày|tuổi|người)\b)/gu,
    (_, a, b) => readInteger(a) + ' đến ' + readInteger(b),
    'CONTEXT_RANGE',
  );
  text = replace(
    text,
    /\b(\d+)[,.](\d+)(?=\s*(?:%|kg\b|km\b|mét\b|triệu\b|tỷ\b))/gu,
    (_, a, b) =>
      readInteger(a) +
      ' phẩy ' +
      [...b].map((n) => digits[Number(n)]).join(' '),
    'DECIMAL_UNIT',
  );
  // Leave uncertain punctuation/alphanumeric strings for review, rather than guess.
  const uncertain = [
    ...text.matchAll(/\d+[,.\/-]\d+|[A-Za-z]\d+|\d+[A-Za-z]/g),
  ].map((m) => m[0]);
  if (uncertain.length)
    warnings.push('REVIEW_NUMBER_CONTEXT: ' + uncertain.join(', '));
  text = replace(text, /\b\d{1,12}\b/g, (n) => readInteger(n), 'CARDINAL');
  if (/\d/.test(text)) warnings.push('REVIEW_UNSUPPORTED_NUMBER');
  return { version: NUMBER_READING_VERSION, text, changes, warnings };
}
