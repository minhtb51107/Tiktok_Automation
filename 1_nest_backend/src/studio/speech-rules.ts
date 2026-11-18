/**
 * Vietnamese social-text speech rules (data only). Independently authored for this
 * project: no external dictionary or corpus is copied.
 *
 * Priorities inside the engine: user overrides > phrases > numbers > context rules >
 * safe dictionary. Context rules never fire without evidence; otherwise the token is
 * kept verbatim and recorded as an ambiguous term.
 */
export const SPEECH_DICTIONARY_VERSION = 'vi-social-speech/3';
export const SPEECH_POLICY_VERSION = 'vi-speech-policy/3';
export const SPEECH_NORMALIZER_VERSION = 'vi-speech-norm/3';

export interface RuleToken {
  start: number;
  end: number;
  text: string;
  lower: string;
}
export interface RuleContext {
  token: RuleToken;
  text: string;
  prev: RuleToken | undefined;
  next: RuleToken | undefined;
  /** Previous / next word if no sentence/clause punctuation separates it. */
  prevSameClause: RuleToken | undefined;
  nextSameClause: RuleToken | undefined;
  sentenceStart: boolean;
  clauseStart: boolean;
  clauseEnd: boolean;
  endsWithQuestion: boolean;
  /** Lower-cased words of the sentence/clause containing the token. */
  sentenceWords: ReadonlySet<string>;
  clauseWords: ReadonlySet<string>;
  /** Lower-cased words in the clause strictly before the token. */
  clauseWordsBefore: ReadonlySet<string>;
}
/** How a rule treats letter case of the source token. */
export type CaseMode =
  | 'any' // case-insensitive
  | 'lower' // only exact lower-case (or Title-case at sentence start)
  | 'exact'; // only the literal spelling
export interface SpeechRule {
  id: string;
  terms: string[];
  spoken: string | ((c: RuleContext) => string);
  category: string;
  caseMode: CaseMode;
  when?: (c: RuleContext) => boolean;
  note?: string;
}
export interface PhraseRule {
  id: string;
  words: string[];
  spoken: string;
  category: string;
}
const set = (...xs: string[]) => new Set(xs);
const p = (c: RuleContext) => c.prevSameClause?.lower ?? '';
const n = (c: RuleContext) => c.nextSameClause?.lower ?? '';
const has = (xs: ReadonlySet<string>, ...candidates: string[]) =>
  candidates.some((x) => xs.has(x));
export const NEGATORS = set(
  'k',
  'ko',
  'khum',
  'không',
  'khong',
  'chẳng',
  'chả',
  'chưa',
  'đừng',
);
const SUBJECTS = set(
  'tôi',
  'tui',
  'tao',
  'tớ',
  'mình',
  'em',
  'anh',
  'chị',
  'mày',
  'nó',
  'họ',
  'bạn',
  'cậu',
  'mk',
  't',
  'b',
  'c',
  'e',
  'a',
  'm',
  'ai',
  'mn',
  'mng',
  'ta',
);
const VI_NUM_WORDS = set(
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
  'mười',
  'mươi',
  'mốt',
  'lăm',
  'trăm',
  'nghìn',
  'triệu',
  'tỷ',
);
const isNumeric = (s: string) => /^\d/.test(s);
const isNumericOrSpokenNumber = (s: string) =>
  isNumeric(s) || VI_NUM_WORDS.has(s);
/** True if the token is directly glued to `-`, `/`, or `.` (e.g. K-pop, AC/DC, v/v). */
const gluedPunct = (c: RuleContext) => {
  const before = c.token.start > 0 ? c.text[c.token.start - 1] : '';
  const after = c.token.end < c.text.length ? c.text[c.token.end] : '';
  const gluedBefore = before === '-' || before === '/' || before === '.';
  const gluedAfter = after === '-' || after === '/';
  return gluedBefore || gluedAfter;
};
const OFFICE_CTX = set(
  'khối',
  'làm',
  'nhân',
  'viên',
  'ngồi',
  'việc',
  'công',
  'tuyển',
  'ứng',
  'vị',
  'trí',
  'job',
  'cty',
  'hr',
  'kcn',
  'phòng',
  'ban',
  'nhà',
  'máy',
  'xưởng',
  'lương',
  'lãnh',
  'đạo',
  'sếp',
  'bằng',
  'cấp',
  'yêu',
  'cầu',
  'yc',
  'ngoại',
  'ngữ',
  'chuyền',
  'sản',
  'xuất',
  'part',
  'time',
  'ca',
  'đa',
  'số',
  'nghiệp',
  'khu',
);
const PLACE_PREV = set(
  'ở',
  'tại',
  'ra',
  'về',
  'lên',
  'vào',
  'trên',
  'dưới',
  'đi',
  'tới',
  'đến',
  'từ',
  'ngoài',
  'giữa',
  'quê',
  'tp',
  'xuống',
  'phố',
  'bên',
  'vực',
  'dân',
  'người',
  'lương',
  'tuyển',
  'chợ',
  'đất',
);
const EDU_CTX = set(
  'bằng',
  'học',
  'trường',
  'tốt',
  'nghiệp',
  'sinh',
  'viên',
  'ra',
  'xong',
  'thi',
  'đậu',
  'trượt',
  'cao',
  'đẳng',
  'ngành',
  'khoa',
  'giảng',
);
const HOW_MANY_NEXT = set(
  'tuổi',
  'tiền',
  'người',
  'cái',
  'lần',
  'năm',
  'tháng',
  'ngày',
  'giờ',
  'phút',
  'tiếng',
  'kg',
  'km',
  'lương',
);
const SENTENCE_FINAL_CLITICS = set(
  'ạ',
  'nhỉ',
  'vậy',
  'thế',
  'hả',
  'nè',
  'nhé',
  'nha',
  'hông',
  'hong',
);
const LETTER_BLOCK_PREV = set(
  'vitamin',
  'nhóm',
  'loại',
  'hạng',
  'mr',
  'ms',
  'mrs',
  'lớp',
  'khu',
  'cổng',
  'tòa',
  'chữ',
  'điểm',
  'bảng',
  'ca',
  'mã',
  'size',
  'cỡ',
  'độ',
  'tầng',
  'lô',
  'dãy',
  'bến',
  'nhà',
  'phòng',
  'số',
  'âm',
  'biến',
  'phần',
  'phím',
  'nút',
  'kính',
);
const BH_INSURANCE_PREV = set(
  'đóng',
  'mua',
  'nộp',
  'hưởng',
  'thẻ',
  'sổ',
  'mức',
  'phí',
  'gói',
  'tiền',
  'trợ',
  'rút',
  'cắt',
  'thiếu',
  'đủ',
  'độ',
  'lương',
  'thuế',
  'quyền',
  'gia',
  'chế',
);
const BH_INSURANCE_NEXT = set('xã', 'y', 'thất', 'nhân', 'tai', 'đầy');
const BH_NEVER_BLOCK_PREV = set(
  'có',
  'đóng',
  'mua',
  'nộp',
  'hưởng',
  'thẻ',
  'sổ',
  'làm',
  'biết',
  'bt',
  'nhận',
  'rút',
  'gia',
  'được',
  'đc',
  'cần',
  'thiếu',
  'mất',
  'hết',
);
const WORK_CTX = set(
  'làm',
  'việc',
  'cty',
  'kcn',
  'tuyển',
  'vị',
  'trí',
  'lương',
  'manager',
  'cskh',
  'tiếng',
  'job',
  'hr',
  'qa',
  'qc',
  'phòng',
  'xưởng',
  'nhà',
);

/** Single-token rules, evaluated in this order for each term (first match wins). */
export const SPEECH_RULES: SpeechRule[] = [
  // ---------- Safe mappings (no context needed) ----------
  {
    id: 'TYPO-VIERJC',
    terms: ['vierjc'],
    spoken: 'việc',
    category: 'TYPO',
    caseMode: 'any',
  },
  {
    id: 'ABBR-CMT',
    terms: ['cmt'],
    spoken: 'bình luận',
    category: 'ABBREVIATION',
    caseMode: 'any',
  },
  {
    id: 'TEEN-KO',
    terms: ['ko', 'khum'],
    spoken: 'không',
    category: 'TEENCODE',
    caseMode: 'lower',
  },
  {
    id: 'TEEN-DC-DIACRITIC',
    terms: ['đc'],
    spoken: 'được',
    category: 'TEENCODE',
    caseMode: 'lower',
  },
  {
    id: 'TEEN-DC-ASCII',
    terms: ['dc'],
    spoken: 'được',
    category: 'TEENCODE',
    caseMode: 'lower',
    when: (c) =>
      !!(c.prev || c.next) &&
      !gluedPunct(c) &&
      !isNumeric(p(c)) &&
      !isNumeric(n(c)) &&
      !has(set('washington', 'ac', 'marvel', 'comics', 'nguồn', 'điện'), p(c)),
    note: 'Lower-case dc in Vietnamese clauses; DC/D.C./AC/DC/Washington dc are left alone.',
  },
  {
    id: 'TEEN-NMA',
    terms: ['nma', 'nhma'],
    spoken: 'nhưng mà',
    category: 'TEENCODE',
    caseMode: 'any',
  },
  {
    id: 'TEEN-MN',
    terms: ['mn', 'mng'],
    spoken: 'mọi người',
    category: 'TEENCODE',
    caseMode: 'any',
    when: (c) => !has(set('nguyên', 'tố'), p(c)),
  },
  {
    id: 'TEEN-NGTA',
    terms: ['ngta'],
    spoken: 'người ta',
    category: 'TEENCODE',
    caseMode: 'lower',
  },
  {
    id: 'TEEN-BTHG',
    terms: ['bthg', 'bth'],
    spoken: 'bình thường',
    category: 'TEENCODE',
    caseMode: 'lower',
  },
  {
    id: 'TEEN-NTN',
    terms: ['ntn'],
    spoken: 'như thế nào',
    category: 'TEENCODE',
    caseMode: 'lower',
  },
  {
    id: 'TEEN-CX',
    terms: ['cx'],
    spoken: 'cũng',
    category: 'TEENCODE',
    caseMode: 'lower',
  },
  {
    id: 'TEEN-CHX',
    terms: ['chx'],
    spoken: 'chưa',
    category: 'TEENCODE',
    caseMode: 'lower',
  },
  {
    id: 'TEEN-TRC',
    terms: ['trc'],
    spoken: 'trước',
    category: 'TEENCODE',
    caseMode: 'lower',
  },
  {
    id: 'TEEN-THIK',
    terms: ['thik'],
    spoken: 'thích',
    category: 'TEENCODE',
    caseMode: 'lower',
  },
  {
    id: 'TEEN-HNAY',
    terms: ['hnay'],
    spoken: 'hôm nay',
    category: 'TEENCODE',
    caseMode: 'lower',
  },
  {
    id: 'TEEN-HQUA',
    terms: ['hqua'],
    spoken: 'hôm qua',
    category: 'TEENCODE',
    caseMode: 'lower',
  },
  {
    id: 'TEEN-NCH',
    terms: ['nch'],
    spoken: 'nói chuyện',
    category: 'TEENCODE',
    caseMode: 'lower',
  },
  {
    id: 'TEEN-DAG',
    terms: ['đag'],
    spoken: 'đang',
    category: 'TEENCODE',
    caseMode: 'lower',
  },
  {
    id: 'TEEN-AE',
    terms: ['ae'],
    spoken: 'anh em',
    category: 'TEENCODE',
    caseMode: 'lower',
  },
  {
    id: 'TEEN-INFO',
    terms: ['in4'],
    spoken: 'in phô',
    category: 'TEENCODE',
    caseMode: 'lower',
  },
  {
    id: 'TEEN-J',
    terms: ['j'],
    spoken: 'gì',
    category: 'TEENCODE',
    caseMode: 'lower',
    when: (c) =>
      !!(c.prev || c.next) &&
      !gluedPunct(c) &&
      !isNumeric(p(c)) &&
      !LETTER_BLOCK_PREV.has(p(c)),
  },
  {
    id: 'ABBR-CTY',
    terms: ['cty'],
    spoken: 'công ty',
    category: 'ABBREVIATION',
    caseMode: 'any',
  },
  {
    id: 'ABBR-KCN',
    terms: ['kcn'],
    spoken: 'khu công nghiệp',
    category: 'ABBREVIATION',
    caseMode: 'any',
  },
  {
    id: 'ABBR-NNA',
    terms: ['nna'],
    spoken: 'ngôn ngữ Anh',
    category: 'ABBREVIATION',
    caseMode: 'any',
  },
  {
    id: 'ABBR-YC',
    terms: ['yc'],
    spoken: 'yêu cầu',
    category: 'ABBREVIATION',
    caseMode: 'any',
  },
  {
    id: 'ABBR-SX',
    terms: ['sx'],
    spoken: 'sản xuất',
    category: 'ABBREVIATION',
    caseMode: 'any',
  },
  {
    id: 'ABBR-XNK',
    terms: ['xnk'],
    spoken: 'xuất nhập khẩu',
    category: 'ABBREVIATION',
    caseMode: 'any',
  },
  {
    id: 'ABBR-HR',
    terms: ['hr'],
    spoken: 'nhân sự',
    category: 'ABBREVIATION',
    caseMode: 'any',
    when: (c) => !isNumericOrSpokenNumber(p(c)),
  },
  {
    id: 'ABBR-CSKH',
    terms: ['cskh'],
    spoken: 'chăm sóc khách hàng',
    category: 'ABBREVIATION',
    caseMode: 'any',
  },
  {
    id: 'ABBR-CTV',
    terms: ['ctv'],
    spoken: 'cộng tác viên',
    category: 'ABBREVIATION',
    caseMode: 'lower',
  },
  {
    id: 'ABBR-SDT',
    terms: ['sdt', 'sđt'],
    spoken: 'số điện thoại',
    category: 'ABBREVIATION',
    caseMode: 'any',
  },
  {
    id: 'ABBR-STK',
    terms: ['stk'],
    spoken: 'số tài khoản',
    category: 'ABBREVIATION',
    caseMode: 'any',
  },
  {
    id: 'ABBR-BHXH',
    terms: ['bhxh'],
    spoken: 'bảo hiểm xã hội',
    category: 'ABBREVIATION',
    caseMode: 'any',
  },
  {
    id: 'ABBR-BHYT',
    terms: ['bhyt'],
    spoken: 'bảo hiểm y tế',
    category: 'ABBREVIATION',
    caseMode: 'any',
  },
  {
    id: 'ABBR-BHTN',
    terms: ['bhtn'],
    spoken: 'bảo hiểm thất nghiệp',
    category: 'ABBREVIATION',
    caseMode: 'any',
  },
  {
    id: 'ABBR-THPT',
    terms: ['thpt'],
    spoken: 'trung học phổ thông',
    category: 'ABBREVIATION',
    caseMode: 'any',
  },
  {
    id: 'ABBR-THCS',
    terms: ['thcs'],
    spoken: 'trung học cơ sở',
    category: 'ABBREVIATION',
    caseMode: 'any',
  },
  {
    id: 'ABBR-TPHCM',
    terms: ['tphcm'],
    spoken: 'Thành phố Hồ Chí Minh',
    category: 'PLACE',
    caseMode: 'any',
  },
  {
    id: 'PLACE-HCM',
    terms: ['hcm'],
    spoken: 'Hồ Chí Minh',
    category: 'PLACE',
    caseMode: 'any',
  },
  {
    id: 'PLACE-VN',
    terms: ['vn'],
    spoken: 'Việt Nam',
    category: 'PLACE',
    caseMode: 'any',
  },
  // ---------- Technical pronunciation (acronyms read as letters) ----------
  {
    id: 'PRON-QA',
    terms: ['qa'],
    spoken: 'kiu ây',
    category: 'ACRONYM',
    caseMode: 'any',
  },
  {
    id: 'PRON-QC',
    terms: ['qc'],
    spoken: 'kiu xi',
    category: 'ACRONYM',
    caseMode: 'any',
  },
  {
    id: 'PRON-IQC',
    terms: ['iqc'],
    spoken: 'ai kiu xi',
    category: 'ACRONYM',
    caseMode: 'any',
  },
  {
    id: 'PRON-OQC',
    terms: ['oqc'],
    spoken: 'âu kiu xi',
    category: 'ACRONYM',
    caseMode: 'any',
  },
  {
    id: 'PRON-FDI',
    terms: ['fdi'],
    spoken: 'ép đi ai',
    category: 'ACRONYM',
    caseMode: 'any',
  },
  {
    id: 'PRON-NEU',
    terms: ['NEU'],
    spoken: 'en e u',
    category: 'ACRONYM',
    caseMode: 'exact',
  },
  {
    id: 'PRON-FTU',
    terms: ['FTU'],
    spoken: 'ép tê u',
    category: 'ACRONYM',
    caseMode: 'exact',
  },
  {
    id: 'PRON-PM',
    terms: ['PM'],
    spoken: 'pi em',
    category: 'ACRONYM',
    caseMode: 'exact',
    when: (c) => !isNumericOrSpokenNumber(p(c)),
  },
  {
    id: 'PRON-CEO',
    terms: ['ceo'],
    spoken: 'xi i âu',
    category: 'ACRONYM',
    caseMode: 'any',
  },
  {
    id: 'PRON-KPI',
    terms: ['kpi'],
    spoken: 'ca pi ai',
    category: 'ACRONYM',
    caseMode: 'any',
  },
  // ---------- Context-sensitive: negation `k` ----------
  {
    id: 'CTX-K-NEG-NEXT-WORD',
    terms: ['k'],
    spoken: 'không',
    category: 'TEENCODE',
    caseMode: 'lower',
    when: (c) => {
      const next = c.nextSameClause;
      return (
        !!next &&
        !gluedPunct(c) &&
        /^\p{L}+$/u.test(next.text) &&
        !(next.text.length === 1 && /\p{Lu}/u.test(next.text)) &&
        !isNumeric(p(c)) &&
        !LETTER_BLOCK_PREV.has(p(c))
      );
    },
    note: 'k followed by a word in the same clause (not glued by -/.) is negation "không".',
  },
  {
    id: 'CTX-K-NEG-FINAL',
    terms: ['k'],
    spoken: 'không',
    category: 'TEENCODE',
    caseMode: 'lower',
    when: (c) =>
      !c.nextSameClause &&
      !!c.prevSameClause &&
      !gluedPunct(c) &&
      !isNumeric(p(c)) &&
      !LETTER_BLOCK_PREV.has(p(c)) &&
      (c.endsWithQuestion ||
        has(set('gì', 'nào', 'sao', 'ai', 'đâu', 'chưa'), p(c)) ||
        has(c.clauseWordsBefore, 'có', 'đc', 'dc', 'được', 'phải', 'biết', 'bt') ||
        SENTENCE_FINAL_CLITICS.has(p(c))),
    note: 'Clause-final k is a question particle when the clause has question evidence.',
  },
  // ---------- Context-sensitive: bh ----------
  {
    id: 'CTX-BH-INSURANCE',
    terms: ['bh'],
    spoken: 'bảo hiểm',
    category: 'ABBREVIATION',
    caseMode: 'lower',
    when: (c) => BH_INSURANCE_PREV.has(p(c)) || BH_INSURANCE_NEXT.has(n(c)),
  },
  {
    id: 'CTX-BH-NEVER',
    terms: ['bh'],
    spoken: 'bao giờ',
    category: 'TEENCODE',
    caseMode: 'lower',
    when: (c) =>
      NEGATORS.has(p(c)) ||
      (has(c.clauseWordsBefore, 'chưa', 'chẳng', 'chả') &&
        !BH_NEVER_BLOCK_PREV.has(p(c)) &&
        (!c.nextSameClause ||
          has(
            set('nên', 'mà', 'thì', 'cả', 'hết', 'luôn', 'đâu', 'đó', 'nhé', 'nha', 'ạ'),
            n(c),
          ))),
    note: 'Direct negation (k bh, chưa bh) or "chưa [action] bh" = "bao giờ"; never fires on "k có bh".',
  },
  {
    id: 'CTX-BH-NOW',
    terms: ['bh'],
    spoken: 'bây giờ',
    category: 'TEENCODE',
    caseMode: 'lower',
    when: (c) =>
      (c.clauseStart ||
        has(set('mà', 'nhưng', 'nên', 'còn', 'chứ', 'từ', 'đến', 'tới'), p(c))) &&
      (has(set('đang', 'vẫn', 'đã', 'sắp', 'phải'), n(c)) ||
        (!c.endsWithQuestion && n(c) === 'mới') ||
        (SUBJECTS.has(n(c)) &&
          has(
            set(
              'đang',
              'vẫn',
              'đã',
              'mới',
              'còn',
              'phải',
              'cũng',
              'sẽ',
              'không',
              'ko',
              'k',
              'chán',
              'mệt',
              'làm',
              'ở',
              'sống',
              'học',
              'thấy',
            ),
            c.nextSameClause ? nextAfter(c) : '',
          ))),
  },
  {
    id: 'CTX-BH-WHEN-QUESTION',
    terms: ['bh'],
    spoken: 'bao giờ',
    category: 'TEENCODE',
    caseMode: 'lower',
    when: (c) =>
      (c.clauseStart || has(set('tới', 'đến', 'biết', 'bt', 'hỏi'), p(c))) &&
      c.endsWithQuestion &&
      !!c.nextSameClause &&
      !has(set('đang', 'vẫn', 'đã', 'còn'), n(c)),
  },
  // ---------- Context-sensitive: bt ----------
  {
    id: 'CTX-BT-KNOW-NEG',
    terms: ['bt'],
    spoken: 'biết',
    category: 'TEENCODE',
    caseMode: 'lower',
    when: (c) => NEGATORS.has(p(c)),
  },
  {
    id: 'CTX-BT-KNOW-DONE',
    terms: ['bt'],
    spoken: 'biết',
    category: 'TEENCODE',
    caseMode: 'lower',
    when: (c) =>
      n(c) === 'rồi' && (c.clauseStart || SUBJECTS.has(p(c)) || p(c) === 'đã'),
  },
  {
    id: 'CTX-BT-KNOW-WH',
    terms: ['bt'],
    spoken: 'biết',
    category: 'TEENCODE',
    caseMode: 'lower',
    when: (c) =>
      (c.clauseStart || SUBJECTS.has(p(c))) &&
      has(
        set('gì', 'ai', 'đâu', 'sao', 'cách', 'rõ', 'chắc', 'nên', 'thế', 'đc', 'dc', 'được'),
        n(c),
      ),
  },
  {
    id: 'CTX-BT-NORMAL',
    terms: ['bt'],
    spoken: 'bình thường',
    category: 'TEENCODE',
    caseMode: 'lower',
    when: (c) =>
      n(c) !== 'rồi' &&
      ((has(set('cũng', 'vẫn', 'khá', 'rất', 'hơi', 'cực'), p(c)) &&
        (!c.nextSameClause ||
          has(
            set('thôi', 'mà', 'lắm', 'thế', 'hà', 'ạ', 'à', 'nhé', 'nha', 'nhỉ'),
            n(c),
          ))) ||
        has(set('như', 'ngày', 'lúc', 'người'), p(c))),
  },
  // ---------- Context-sensitive: places, workplace, school ----------
  {
    id: 'CTX-VP-OFFICE',
    terms: ['vp'],
    spoken: 'văn phòng',
    category: 'ABBREVIATION',
    caseMode: 'any',
    when: (c) =>
      has(set('khối', 'làm', 'ngồi', 'đi', 'vào', 'ra', 'nhân', 'viên', 'ở'), p(c)) ||
      has(c.sentenceWords, ...OFFICE_CTX),
  },
  {
    id: 'CTX-HN-PLACE',
    terms: ['hn'],
    spoken: 'Hà Nội',
    category: 'PLACE',
    caseMode: 'any',
    when: (c) =>
      PLACE_PREV.has(p(c)) ||
      (has(set('hay', 'hoặc'), n(c)) && !!c.prevSameClause) ||
      has(set('hcm', 'tphcm', 'sài', 'đà', 'hải'), n(c)),
  },
  {
    id: 'CTX-DH-UNIVERSITY',
    terms: ['đh'],
    spoken: 'đại học',
    category: 'ABBREVIATION',
    caseMode: 'any',
    when: (c) => has(c.sentenceWords, ...EDU_CTX),
  },
  {
    id: 'CTX-CD-COLLEGE',
    terms: ['cđ'],
    spoken: 'cao đẳng',
    category: 'ABBREVIATION',
    caseMode: 'any',
    when: (c) => has(c.sentenceWords, ...EDU_CTX),
  },
  {
    id: 'CTX-SV-STUDENT',
    terms: ['sv'],
    spoken: 'sinh viên',
    category: 'ABBREVIATION',
    caseMode: 'lower',
    when: (c) => n(c) === 'năm' || has(c.sentenceWords, ...EDU_CTX),
  },
  // ---------- Context-sensitive: workplace shorthand ----------
  {
    id: 'CTX-KN-EXPERIENCE',
    terms: ['kn'],
    spoken: 'kinh nghiệm',
    category: 'ABBREVIATION',
    caseMode: 'lower',
    when: (c) =>
      !has(set('giao', 'mềm', 'đàm', 'thuyết', 'lãnh'), n(c)) &&
      (isNumeric(n(c)) ||
        has(c.clauseWordsBefore, 'chưa', 'không', 'ko', 'k', 'ít', 'nhiều', 'thiếu') ||
        (p(c) === 'có' && has(c.sentenceWords, ...WORK_CTX))),
  },
  {
    id: 'CTX-KN-SKILL',
    terms: ['kn'],
    spoken: 'kỹ năng',
    category: 'ABBREVIATION',
    caseMode: 'lower',
    when: (c) => has(set('giao', 'mềm', 'đàm', 'thuyết', 'lãnh'), n(c)),
  },
  {
    id: 'CTX-NV-STAFF',
    terms: ['nv'],
    spoken: 'nhân viên',
    category: 'ABBREVIATION',
    caseMode: 'lower',
    when: (c) =>
      has(
        set('văn', 'kinh', 'bán', 'kế', 'kho', 'sản', 'hành', 'kỹ', 'hỗ', 'giao', 'thu', 'tuyển'),
        n(c),
      ) || has(set('tuyển', 'thiếu', 'cần', 'các', 'những', 'mỗi', 'tìm'), p(c)),
  },
  {
    id: 'CTX-HS-DOCUMENT',
    terms: ['hs'],
    spoken: 'hồ sơ',
    category: 'ABBREVIATION',
    caseMode: 'lower',
    when: (c) => has(set('nộp', 'sung', 'bị', 'thiếu', 'duyệt', 'gửi', 'lập', 'bộ'), p(c)),
  },
  {
    id: 'CTX-CV-WORK',
    terms: ['cv'],
    spoken: 'công việc',
    category: 'ABBREVIATION',
    caseMode: 'lower',
    when: (c) =>
      has(set('phối', 'giao', 'lý', 'thành', 'độ', 'nhiều', 'bận', 'đổi'), p(c)) ||
      has(set('nội', 'tuyển', 'hành'), n(c)),
  },
  {
    id: 'CTX-CV-RESUME',
    terms: ['cv'],
    spoken: 'xi vi',
    category: 'ACRONYM',
    caseMode: 'any',
    when: (c) =>
      has(
        set('nộp', 'gửi', 'viết', 'sửa', 'chỉnh', 'nhật', 'update', 'apply', 'review', 'lọc', 'duyệt'),
        p(c),
      ),
  },
  {
    id: 'CTX-PV-INTERVIEW',
    terms: ['pv'],
    spoken: 'phỏng vấn',
    category: 'ABBREVIATION',
    caseMode: 'lower',
    when: (c) =>
      has(set('đi', 'vòng', 'buổi', 'lịch', 'hẹn', 'qua', 'trượt', 'đậu', 'mời', 'cuộc'), p(c)),
  },
  {
    id: 'CTX-DT-PHONE',
    terms: ['đt'],
    spoken: 'điện thoại',
    category: 'ABBREVIATION',
    caseMode: 'lower',
    when: (c) =>
      has(set('gọi', 'số', 'cầm', 'dùng', 'xài', 'sửa', 'đổi', 'nhắn', 'bằng', 'trên'), p(c)),
  },
  {
    id: 'CTX-BN-HOWMANY',
    terms: ['bn'],
    spoken: 'bao nhiêu',
    category: 'TEENCODE',
    caseMode: 'lower',
    when: (c) =>
      HOW_MANY_NEXT.has(n(c)) ||
      (c.endsWithQuestion &&
        !c.nextSameClause &&
        has(set('là', 'được', 'hết', 'mất', 'tốn', 'lương', 'giá'), p(c))),
  },
  {
    id: 'CTX-NH-BUT',
    terms: ['nh'],
    spoken: 'nhưng',
    category: 'TEENCODE',
    caseMode: 'lower',
    when: (c) =>
      !!c.prevSameClause &&
      !has(set('có', 'rất', 'quá', 'hơi', 'khá', 'bao', 'ít', 'cần', 'thêm'), p(c)) &&
      (has(set('mà', 'sẽ', 'đã', 'đang', 'vẫn', 'không', 'ko', 'k', 'chưa', 'lại'), n(c)) ||
        (!!c.nextSameClause &&
          has(set('sẽ', 'vẫn', 'không', 'ko', 'k', 'chưa'), nextAfter(c)))),
  },
  {
    id: 'CTX-TRG-IN',
    terms: ['trg'],
    spoken: 'trong',
    category: 'TEENCODE',
    caseMode: 'lower',
    when: (c) =>
      has(
        set(
          'kcn',
          'cty',
          'nhà',
          'xưởng',
          'nhóm',
          'đó',
          'này',
          'khi',
          'lúc',
          'thời',
          'vòng',
          'một',
          'những',
          'các',
          'ngày',
          'tuần',
          'tháng',
          'năm',
          'đời',
        ),
        n(c),
      ) || isNumeric(n(c)),
  },
  {
    id: 'CTX-TRG-SCHOOL',
    terms: ['trg'],
    spoken: 'trường',
    category: 'ABBREVIATION',
    caseMode: 'lower',
    when: (c) =>
      has(set('ra', 'vào', 'học', 'nghỉ', 'đến', 'tới', 'cùng', 'ngôi', 'cổng'), p(c)) ||
      has(set('đh', 'đại', 'cao', 'cấp', 'tiểu', 'trung', 'lớp', 'học'), n(c)),
  },
  {
    id: 'CTX-NG-PERSON',
    terms: ['ng'],
    spoken: 'người',
    category: 'TEENCODE',
    caseMode: 'lower',
    when: (c) =>
      has(
        set(
          'toàn',
          'nhiều',
          'ít',
          'mấy',
          'vài',
          'các',
          'những',
          'mọi',
          'một',
          'hai',
          'ba',
          'bao',
          'nhiêu',
          'cả',
        ),
        p(c),
      ) || has(set('ta', 'nhà', 'ngoài', 'khác', 'lạ', 'thân', 'yêu'), n(c)),
  },
  {
    id: 'CTX-MK-PASSWORD',
    terms: ['mk'],
    spoken: 'mật khẩu',
    category: 'ABBREVIATION',
    caseMode: 'lower',
    when: (c) =>
      has(set('nhập', 'đổi', 'quên', 'lấy', 'tạo', 'đặt', 'reset', 'sai', 'lộ', 'mất'), p(c)),
    note: 'mk as pronoun (mình) is never expanded; only the password reading has evidence rules.',
  },
  // ---------- Context-sensitive: single letters ----------
  {
    id: 'CTX-B-VOCATIVE',
    terms: ['b'],
    spoken: 'bạn',
    category: 'TEENCODE',
    caseMode: 'lower',
    when: (c) => !gluedPunct(c) && has(set('ơi', 'oi'), n(c)),
  },
  {
    id: 'CTX-OI-VOCATIVE',
    terms: ['oi'],
    spoken: 'ơi',
    category: 'TEENCODE',
    caseMode: 'lower',
    when: (c) =>
      has(set('b', 'bạn', 'mn', 'mng', 'anh', 'chị', 'em', 'cô', 'chú', 'bác', 'cậu', 'ông', 'bà'), p(c)),
  },
  {
    id: 'CTX-V-VAY',
    terms: ['v'],
    spoken: 'vậy',
    category: 'TEENCODE',
    caseMode: 'lower',
    when: (c) =>
      !gluedPunct(c) &&
      !LETTER_BLOCK_PREV.has(p(c)) &&
      (has(set('á', 'ạ', 'nè', 'nha', 'nhé', 'thì', 'luôn', 'hả', 'chứ', 'trời'), n(c)) ||
        (has(set('sao', 'thế', 'như', 'làm', 'nói'), p(c)) &&
          (!c.nextSameClause || has(set('á', 'nè', 'nha', 'hả'), n(c))))),
  },
  {
    id: 'CTX-R-ROI',
    terms: ['r'],
    spoken: 'rồi',
    category: 'TEENCODE',
    caseMode: 'lower',
    when: (c) =>
      !!c.prevSameClause &&
      !gluedPunct(c) &&
      !LETTER_BLOCK_PREV.has(p(c)) &&
      (!c.nextSameClause ||
        has(set('thì', 'nên', 'mà', 'á', 'ạ', 'nha', 'nhé', 'đó', 'đấy', 'nè'), n(c))),
  },
];
function nextAfter(c: RuleContext): string {
  const m = c.text
    .slice(c.nextSameClause!.end)
    .match(/^[^\p{L}\p{N}]*([\p{L}\p{N}]+)/u);
  return (m?.[1] ?? '').toLocaleLowerCase('vi');
}
/** Multi-word phrases, longest first. Separators may be spaces or dots (TP.HCM). */
export const SPEECH_PHRASES: PhraseRule[] = [
  {
    id: 'PHRASE-TP-HCM',
    words: ['tp', 'hcm'],
    spoken: 'Thành phố Hồ Chí Minh',
    category: 'PLACE',
  },
  {
    id: 'PHRASE-TP-HN',
    words: ['tp', 'hn'],
    spoken: 'thành phố Hà Nội',
    category: 'PLACE',
  },
];
/** Social register kept as written (Kokoro already reads these naturally). */
export const PRESERVED_STYLE_TERMS = new Set([
  'okela',
  'ok',
  'oke',
  'toxic',
  'flex',
  'drama',
  'hông',
  'hong',
  'thui',
  'rùi',
  'iu',
  'huhu',
  'hụ',
  'nha',
  'nè',
  'á',
  'ạ',
  'ơi',
  'ý',
  'sốp',
  'fresher',
  'toeic',
  'part',
  'time',
  'job',
  'project',
  'combat',
  'combo',
  'stress',
  'deadline',
  'anything',
  'vl',
  'vcl',
  'vkl',
  'clm',
  'cmn',
  'đcđ',
  'đéo',
  'đách',
  'vãi',
]);
/** Tokens that are intentionally kept but reported for human review when unresolved. */
export const AMBIGUOUS_REASONS: Record<string, string> = {
  t: 'Pronoun (tôi/tao/tớ) – never replaced without certainty',
  b: 'Pronoun/abbreviation (bạn) without vocative evidence',
  c: 'Pronoun (chị) – never replaced without certainty',
  e: 'Pronoun (em) – never replaced without certainty',
  v: 'Possible "vậy" without sufficient evidence',
  k: 'Possible "không" or a number/unit suffix without sufficient evidence',
  r: 'Possible "rồi" without sufficient evidence',
  bh: 'bảo hiểm / bao giờ / bây giờ – insufficient context',
  bt: 'biết / bình thường / bài tập – insufficient context',
  mk: 'mình / mật khẩu – pronoun kept',
  kh: 'không / khách hàng / kế hoạch – insufficient context',
  neu: 'NEU (university) vs nếu (missing diacritics) – ambiguous lowercase',
  kn: 'kinh nghiệm / kỹ năng – insufficient context',
  cv: 'công việc / CV (resume) – insufficient context',
  hs: 'hồ sơ / học sinh – insufficient context',
  nv: 'nhân viên / nhân vật – insufficient context',
  nh: 'nhưng / nhiều – insufficient context',
  bn: 'bao nhiêu / bạn – insufficient context',
  đt: 'điện thoại / đội tuyển / đầu tư – insufficient context',
  pv: 'phỏng vấn / photovoltaic – insufficient context',
  hn: 'Hà Nội / hôm nay – insufficient place context',
  vp: 'văn phòng – no workplace context',
  đh: 'đại học – no education context',
  cđ: 'cao đẳng – no education context',
  sv: 'sinh viên – no education context',
  trg: 'trong / trường – insufficient context',
  ng: 'người / nguyên – insufficient context',
  đcđ: 'Expressive slang kept unchanged for the narrator',
  clm: 'Expressive slang kept unchanged for the narrator',
  cmn: 'Expressive slang kept unchanged for the narrator',
};
/** Single-letter pronoun-like terms are only reported when they act as pronouns. */
export const PRONOUN_LETTERS = new Set(['t', 'b', 'c', 'e']);
