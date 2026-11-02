import { normalizeSpokenNumbers as n } from './spoken-numbers';
import { describe, it, expect } from '@jest/globals';
describe('Vietnamese TTS number golden cases — OFFLINE', () => {
  it.each([
    ['22 tuổi', 'hai mươi hai tuổi'],
    ['TOEIC 700', 'TOEIC bảy trăm'],
    ['tiếng Nhật N4 và N2', 'tiếng Nhật en bốn và en hai'],
    ['5,6 quán', 'năm, sáu quán'],
    ['3-4 thứ tiếng', 'ba đến bốn thứ tiếng'],
    [
      'Ngày 08/08/2026',
      'Ngày tám tháng tám năm hai nghìn không trăm hai mươi sáu',
    ],
    ['5,6%', 'năm phẩy sáu%'],
    ['5,6 triệu', 'năm phẩy sáu triệu'],
    ['t clm cmn ko', 't clm cmn ko'],
  ])('%s → %s', (input, expected) => expect(n(input).text).toBe(expected));
  it('flags ambiguous/invalid formats and is idempotent', () => {
    expect(n('5,6 và 31/02/2026').warnings.length).toBeGreaterThan(0);
    expect(n('5,6').warnings.join()).toContain('REVIEW_NUMBER_CONTEXT');
    const out = n('22 tuổi, TOEIC 700');
    expect(n(out.text).text).toBe(out.text);
  });
});
