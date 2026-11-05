import { describe, test, expect } from '@jest/globals';
import { collectEvidence, canonicalPost } from './conversation-evidence';
import type { PublicPost } from './conversation-contracts';
const url = (id: string) => `https://www.threads.com/@tester/post/${id}`;
export const TEST_ROOT: PublicPost = {
  id: 'ROOT',
  url: url('ROOT'),
  author: { handle: 'tester', name: 'TEST DATA' },
  originalText:
    'SYNTHETIC TEST DATA Tôi đi làm công ty và muốn chia sẻ kinh nghiệm.',
  publishedAt: '2026-11-01T00:00:00Z',
  engagement: { likes: 10, replies: 300, reposts: null, shares: null },
  provenance: {
    documentUrl: url('ROOT'),
    observedAt: '2026-11-02T00:00:00Z',
    synthetic: true,
    method: 'TEST DATA',
  },
};
export const TEST_REPLY = (
  id = 'R1',
  parent = 'ROOT',
  body = 'Tôi cũng đi làm công ty, trải nghiệm của tôi là nên nói rõ kỳ vọng.',
): any => ({
  '@type': 'Comment',
  url: url(id),
  parentItem: url(parent),
  author: { url: 'https://www.threads.com/@tester' },
  text: body,
});
describe('DATA04 strict reply evidence — TEST DATA', () => {
  const collect = (jsonLd: any[], visible = ['R1', 'R2']) =>
    collectEvidence(TEST_ROOT, {
      url: url('ROOT'),
      observedAt: TEST_ROOT.provenance.observedAt,
      synthetic: true,
      visibleUrls: visible.map(url),
      jsonLd,
    });
  test('canonical identity rejects internal and credential URLs', () => {
    expect(canonicalPost('https://localhost/@test/post/X')).toBeNull();
    expect(
      canonicalPost('https://secret@www.threads.com/@test/post/X'),
    ).toBeNull();
    expect(canonicalPost(url('R1') + '?x=1')?.id).toBe('R1');
  });
  test('verifies explicit parent and nested chains regardless of order', () => {
    const c = collect([TEST_REPLY('R2', 'R1'), TEST_REPLY()]);
    expect(c.replies.map((r) => r.id)).toEqual(['R1', 'R2']);
    expect(c.replies[1].parentId).toBe('R1');
    expect(c.status).toBe('PARTIAL');
  });
  test('same author is not relationship; wrong parent and missing evidence excluded', () => {
    const a = TEST_REPLY();
    delete a.parentItem;
    const c = collect([a, TEST_REPLY('R2', 'OTHER')]);
    expect(c.replies).toHaveLength(0);
    expect(c.status).toBe('UNKNOWN');
    expect(c.reportedReplyCount).toBe(300);
  });
  test('nested comment list binds only to exact root', () => {
    const reply = TEST_REPLY();
    delete reply.parentItem;
    expect(
      collect([
        {
          '@type': 'DiscussionForumPosting',
          url: url('ROOT'),
          comment: [reply],
        },
      ]).replies,
    ).toHaveLength(1);
    expect(
      collect([
        {
          '@type': 'DiscussionForumPosting',
          url: url('OTHER'),
          comment: [reply],
        },
      ]).replies,
    ).toHaveLength(0);
  });
  test('cycles, conflicting records, missing visible permalink fail closed', () => {
    expect(
      collect([TEST_REPLY('R1', 'R2'), TEST_REPLY('R2', 'R1')]).replies,
    ).toHaveLength(0);
    expect(
      collect([TEST_REPLY(), TEST_REPLY('R1', 'OTHER')]).replies,
    ).toHaveLength(0);
    expect(collect([TEST_REPLY()], []).replies).toHaveLength(0);
  });
  test('raw content immutable; null metadata never becomes zero', () => {
    const input = TEST_REPLY(),
      before = JSON.stringify(input),
      c = collect([input]);
    expect(JSON.stringify(input)).toBe(before);
    expect(c.replies[0].engagement.likes).toBeNull();
    expect(c.replies[0].publishedAt).toBeNull();
  });
  test('same stable reply ID with conflicting handle never verified twice', () => {
    const other = {
      ...TEST_REPLY(),
      url: 'https://www.threads.com/@other/post/R1',
      author: { url: 'https://www.threads.com/@other' },
    };
    const c = collectEvidence(TEST_ROOT, {
      url: TEST_ROOT.url,
      observedAt: TEST_ROOT.provenance.observedAt,
      synthetic: true,
      visibleUrls: [TEST_REPLY().url, other.url],
      jsonLd: [TEST_REPLY(), other],
    });
    expect(c.replies).toHaveLength(0);
    expect(
      c.unverified.every((x) => x.reason === 'CONFLICTING_PERMALINK_IDENTITY'),
    ).toBe(true);
  });
  test('strict root handle and ID match; budget bound', () => {
    expect(() =>
      collectEvidence(
        { ...TEST_ROOT, id: 'OTHER' },
        {
          url: url('ROOT'),
          observedAt: 'x',
          synthetic: true,
          visibleUrls: [],
          jsonLd: [],
        },
      ),
    ).toThrow('IDENTITY');
    const c = collect([TEST_REPLY(), TEST_REPLY('R2')]);
    expect(c.replies).toHaveLength(2);
    expect(c.unverifiedCandidateCount).toBe(0);
  });
});
