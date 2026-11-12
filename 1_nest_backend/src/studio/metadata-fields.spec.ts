import { describe, expect, test } from '@jest/globals';
import {
  contextLabelledCounts,
  labelledCounts,
  parseInteractionValue,
} from './metadata-fields';
describe('Threads interaction metadata', () => {
  test.each([
    ['1,2K', 1200, true],
    ['16,8K', 16800, true],
    ['1M', 1000000, true],
    ['1.234', 1234, false],
    ['0', 0, false],
  ])('%s normalizes without inventing precision', (raw, value, approximate) =>
    expect(parseInteractionValue(raw)).toEqual({
      raw,
      normalized: value,
      approximate,
    }),
  );
  test('reads count from svg-title/text or count-bearing aria label and records observation provenance', () => {
    const at = '2026-11-12T00:00:00.000Z',
      f = labelledCounts(
        [
          { label: 'Thích', text: '1,2K' },
          { label: '16,8K lượt bình luận', text: '' },
          { label: 'Đăng lại', text: '1M' },
          { label: 'Chia sẻ', text: '' },
        ],
        at,
      );
    expect(f.likeCount).toMatchObject({
      status: 'AVAILABLE',
      value: 1200,
      normalized: 1200,
      raw: '1,2K',
      approximate: true,
      observedAt: at,
    });
    expect(f.replyCount.value).toBe(16800);
    expect(f.repostCount.value).toBe(1000000);
    expect(f.shareCount.status).toBe('NOT_PRESENT');
  });
  test('never assigns controls when a container contains multiple permalink identities', () => {
    const f = contextLabelledCounts(
      [{ label: 'Thích', text: '99K' }],
      2,
      '2026-11-12T00:00:00Z',
    );
    expect(f.likeCount.value).toBeNull();
    expect(f.likeCount.status).toBe('UNAVAILABLE');
  });
});
