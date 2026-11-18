import { describe, test, expect } from '@jest/globals';
import { observedQueryRelevance, popularity, rankCandidates } from './conversation-popularity';
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
  test('HOT uses available partial evidence while RECENT uses timestamps and threshold retains unknown metadata', () => {
    const a = { url: p('A', 10).url, post: p('A', 10), observedOrder: 0 },
      b = { url: p('B', 500).url, post: p('B', 500), observedOrder: 1 },
      unknown = {
        url: 'https://www.threads.com/@test/post/C',
        post: null,
        observedOrder: 2,
      };
    b.post.engagement.reposts = null;
    b.post.engagement.shares = null;
    expect(
      rankCandidates([a, b], 1, '2026-11-01T02:00:00Z', { priority: 'HOT' })
        .selected,
    ).toEqual([b.url]);
    const ranked = rankCandidates([a, unknown], 2, '2026-11-01T02:00:00Z', {
      priority: 'HOT',
      minInteractions: 100,
    });
    expect(ranked.selected).toEqual([unknown.url]);
    expect(ranked.ranked[0].thresholdStatus).toBe('UNKNOWN');
    expect(ranked.status).toBe('PARTIAL');
  });
  test('ranks observed query relevance before unrelated engagement without inventing metadata', () => {
    const relevant=p('A',10),popular=p('B',1000);
    relevant.originalText='Kinh nghiệm ngành IT khi thất nghiệp và tìm việc lại';
    popular.originalText='Một buổi biểu diễn âm nhạc cuối tuần';
    const rows=[{url:popular.url,post:popular,observedOrder:0},{url:relevant.url,post:relevant,observedOrder:1}],
      ranked=rankCandidates(rows,2,'2026-11-01T02:00:00Z',{priority:'BALANCED',queryTerms:['ngành IT thất nghiệp']});
    expect(ranked.selected[0]).toBe(relevant.url);
    expect(ranked.ranked.find(row=>row.url===relevant.url)?.relevanceScore).toBeGreaterThan(0);
    expect(observedQueryRelevance(relevant,['ngành IT thất nghiệp'])?.method).toBe('OBSERVED_TEXT_LEXICAL_RELEVANCE');
  });
  test('prefers substantive discussion roots with high reply density over viral 1-5 word captions', () => {
    const shortViral = p('SHORT', 10200);
    shortViral.author = { handle: 'viral_meme', name: null };
    shortViral.originalText = '19/05/2026\nChủ động trong công việc:))';
    shortViral.engagement = { likes: 10200, replies: 64, reposts: 500, shares: 300 };

    const substantive = p('RICH', 430);
    substantive.author = { handle: 'gnrtth', name: null };
    substantive.originalText =
      '06/10/2026\nCó ai vào khu công nghiệp làm trong khối văn phòng hay việc khác ngoài công nhân sản xuất dây chuyền hong? Công việc là gì và có yêu cầu gì hong?';
    substantive.engagement = { likes: 430, replies: 128, reposts: 26, shares: 26 };

    const dateOnly = p('EMPTY', 6);
    dateOnly.author = { handle: 'empty_post', name: null };
    dateOnly.originalText = '05/11/2026';
    dateOnly.engagement = { likes: 6, replies: null, reposts: null, shares: null };

    const ranked = rankCandidates(
      [
        { url: shortViral.url, post: shortViral, observedOrder: 0 },
        { url: dateOnly.url, post: dateOnly, observedOrder: 1 },
        { url: substantive.url, post: substantive, observedOrder: 2 },
      ],
      2,
      '2026-11-18T00:00:00Z',
      { priority: 'BALANCED', queryTerms: ['công việc', 'khu công nghiệp', 'văn phòng'] },
    );
    expect(ranked.selected[0]).toBe(substantive.url);
    const richRow = ranked.ranked.find((row) => row.url === substantive.url)!;
    const shortRow = ranked.ranked.find((row) => row.url === shortViral.url)!;
    const emptyRow = ranked.ranked.find((row) => row.url === dateOnly.url)!;
    expect(richRow.supplyScore!).toBeGreaterThan(shortRow.supplyScore!);
    expect(shortRow.supplyReasons).toContain('SHORT_CAPTION_ROOT_PENALIZED');
    expect(emptyRow.rootWords).toBe(0);
    expect(emptyRow.reportedReplies).toBeNull();
  });
});
