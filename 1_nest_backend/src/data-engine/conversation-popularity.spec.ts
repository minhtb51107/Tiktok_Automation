import { describe, test, expect } from '@jest/globals';
import { popularity, rankCandidates } from './conversation-popularity';
import type { PublicPost } from './conversation-contracts';
const p = (id: string, n: number | null): PublicPost => ({
  id,
  url: `https://www.threads.com/@test/post/${id}`,
  author: { handle: 'test', name: null },
  originalText: 'SYNTHETIC TEST DATA',
  publishedAt: '2026-11-01T00:00:00Z',
  engagement: { likes: n, replies: n, reposts: null, shares: null },
  provenance: {
    observedAt: '2026-11-01T01:00:00Z',
    documentUrl: 'https://www.threads.com/',
    method: 'TEST DATA',
    synthetic: true,
  },
});
describe('DATA04 popularity — synthetic', () => {
  test('uses multiple signals, retains missing and deterministic time', () => {
    const a = popularity(p('A', 100), '2026-11-01T02:00:00Z');
    expect(a.coverage).toBe('SUFFICIENT');
    expect(a.breakdown.shares.value).toBeNull();
    expect(a).toEqual(popularity(p('A', 100), '2026-11-01T02:00:00Z'));
  });
  test('ranks only comparable evidence, otherwise preserves observed order', () => {
    const a = { url: p('A', 1).url, post: p('A', 1), observedOrder: 0 },
      b = { url: p('B', 100).url, post: p('B', 100), observedOrder: 1 };
    expect(rankCandidates([a, b], 1, '2026-11-01T02:00:00Z').selected).toEqual([
      b.url,
    ]);
    expect(
      rankCandidates([a, { ...b, post: null }], 1, '2026-11-01T02:00:00Z')
        .selected,
    ).toEqual([a.url]);
  });
  test('velocity needs matching identity and nonnegative consistent snapshots', () => {
    const a = p('A', 100),
      b = p('A', 200);
    b.provenance.observedAt = '2026-11-01T02:00:00Z';
    expect(
      popularity(b, '2026-11-01T03:00:00Z', a).breakdown.velocity.value,
    ).not.toBeNull();
    expect(
      popularity(b, '2026-11-01T03:00:00Z', p('B', 100)).breakdown.velocity
        .value,
    ).toBeNull();
  });
});
