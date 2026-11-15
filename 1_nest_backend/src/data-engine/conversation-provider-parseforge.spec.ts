import { describe, expect, test } from '@jest/globals';
import type { PublicPost } from './conversation-contracts';
import { adaptParseforgeCollection } from './conversation-extraction-v2';
import { projectParseforgeRows } from './conversation-provider-parseforge';
import { selectedReplies } from './editorial-feasibility';

const at = '2026-11-15T00:00:00.000Z';
const url = (handle: string, id: string) =>
  `https://www.threads.com/@${handle}/post/${id}`;
const root: PublicPost = {
  id: 'ROOT',
  url: url('root_author', 'ROOT'),
  author: { handle: 'root_author', name: 'TEST DATA' },
  originalText: 'SYNTHETIC TEST DATA root.',
  publishedAt: at,
  engagement: { likes: null, replies: null, reposts: null, shares: null },
  provenance: {
    documentUrl: url('root_author', 'ROOT'),
    observedAt: at,
    method: 'SYNTHETIC TEST DATA',
    synthetic: false,
  },
};
const row = (
  id: string,
  parentUrl: string,
  depth: number,
  overrides: Record<string, unknown> = {},
) => ({
  postUrl: url('reply_author', id),
  postCode: id,
  text: `SYNTHETIC reply ${id}`,
  postedAt: at,
  depth,
  parentPostUrl: parentUrl,
  parentPostCode: parentUrl.split('/').slice(-1)[0],
  rootPostUrl: root.url,
  rootPostCode: root.id,
  username: 'reply_author',
  profileUrl: 'https://www.threads.com/@reply_author',
  likeCount: 3,
  replyCount: 1,
  imageUrls: ['https://example.invalid/SYNTHETIC.png'],
  scrapedAt: at,
  error: null,
  ...overrides,
});

describe('optional Parseforge provider adapter — TEST DATA', () => {
  test('maps rows but delegates parent-chain acceptance to collectEvidence', () => {
    const collection = adaptParseforgeCollection(
      root,
      [
        row('R2', url('reply_author', 'R1'), 2),
        row('R1', root.url, 1),
      ],
      at,
    );
    expect(collection.replies.map((reply) => reply.id)).toEqual(['R1', 'R2']);
    expect(collection.replies[1].parentId).toBe('R1');
    expect(collection.replies[1]).toMatchObject({
      rootId: root.id,
      extractionStatus: 'VERIFIED',
      provenance: { synthetic: root.provenance.synthetic },
      evidence: {
        kind: 'EXTERNAL_PROVIDER_PARENT',
        documentUrl: 'https://apify.com/parseforge/threads-replies-scraper',
        subjectUrl: url('reply_author', 'R2'),
        parentUrl: url('reply_author', 'R1'),
      },
    });
    expect(selectedReplies(collection, ['R2'])[0].id).toBe('R2');
    expect(collection.observedCards).toHaveLength(2);
    expect(collection.externalEvidence?.rows).toHaveLength(2);
    expect(collection.externalEvidence?.rows.every((entry) => entry.raw)).toBe(
      true,
    );
    expect(collection.warnings).toContain(
      'EXTERNAL_PROVIDER_EVIDENCE_REQUIRES_EXPLICIT_AUTHORIZATION_AND_INDEPENDENT_GRAPH_VALIDATION',
    );
  });

  test('preserves wrong-root evidence but excludes it from the graph', () => {
    const projection = projectParseforgeRows(
      root,
      [row('R1', root.url, 1, { rootPostUrl: url('other', 'OTHER') })],
      at,
    );
    expect(projection.cards).toHaveLength(0);
    expect(projection.candidates).toHaveLength(0);
    expect(projection.externalEvidence.rows[0]).toMatchObject({
      acceptedForGraph: false,
      reasons: expect.arrayContaining(['PROVIDER_ROOT_URL_MISMATCH']),
    });
  });

  test('conflicting duplicate identity invalidates every provider row for it', () => {
    const projection = projectParseforgeRows(
      root,
      [
        row('R1', root.url, 1),
        row('R1', url('reply_author', 'OTHER'), 2, {
          text: 'SYNTHETIC conflicting duplicate.',
        }),
      ],
      at,
    );
    expect(projection.cards).toHaveLength(0);
    expect(projection.candidates).toHaveLength(0);
    expect(
      projection.externalEvidence.rows.every(
        (entry) =>
          !entry.acceptedForGraph &&
          entry.reasons.includes('PROVIDER_DUPLICATE_CONFLICT'),
      ),
    ).toBe(true);
  });
});
