import { describe, expect, test } from '@jest/globals';
import type { PublicPost } from './conversation-contracts';
import { collectEvidence } from './conversation-evidence';
import {
  extractStructuredEvidence,
  parseSsrRelayScripts,
  PassiveStructuredResponseObserver,
  type StructuredPayloadInput,
} from './conversation-structured';

const rootUrl = 'https://www.threads.com/@root/post/ROOT';
const root: PublicPost = {
  id: 'ROOT',
  url: rootUrl,
  author: { handle: 'root', name: null },
  originalText: 'TEST DATA root post',
  publishedAt: null,
  engagement: { likes: null, replies: null, reposts: null, shares: null },
  provenance: {
    documentUrl: rootUrl,
    observedAt: '2026-11-16T00:00:00.000Z',
    method: 'SYNTHETIC TEST DATA',
    synthetic: true,
  },
};
const post = (
  pk: string,
  code: string,
  username: string,
  text: string,
  extra: Record<string, unknown> = {},
) => ({ pk, code, user: { username }, caption: { text }, ...extra });
const input = (payload: unknown): StructuredPayloadInput => ({
  source: 'SSR',
  endpointPath: '/@root/post/ROOT',
  responseType: 'SSR_RELAY',
  queryName: 'BarcelonaPostPageDownwardQuery',
  observedAt: root.provenance.observedAt,
  payload,
});

describe('passive Threads structured response extraction', () => {
  test('parses actual Relay preloader shape and validates a singleton direct reply through the existing graph validator', () => {
    const data = {
      media: {
        ...post('100', 'ROOT', 'root', 'TEST DATA root post'),
        text_post_app_info: {
          direct_replies: {
            edges: [
              {
                node: {
                  thread_items: [
                    {
                      post: post(
                        '200',
                        'REPLY1',
                        'reply',
                        'TEST DATA useful reply',
                      ),
                    },
                  ],
                },
              },
            ],
          },
        },
      },
    };
    const script = JSON.stringify({
      require: [
        [
          'RelayPrefetchedStreamCache',
          'next',
          [],
          [
            'adp_BarcelonaPostPageDownwardQueryRelayPreloader_hash',
            { __bbox: { result: { data } } },
          ],
        ],
      ],
    });
    const parsed = parseSsrRelayScripts(
        [{ index: 0, text: script }],
        '/@root/post/ROOT',
        root.provenance.observedAt,
      ),
      extracted = extractStructuredEvidence(parsed, rootUrl, [
        'https://www.threads.com/@reply/post/REPLY1',
      ]);
    expect(parsed).toHaveLength(1);
    expect(parsed[0].queryName).toBe('BarcelonaPostPageDownwardQuery');
    expect(extracted.diagnostics[0]).toMatchObject({
      source: 'SSR',
      responseType: 'SSR_RELAY',
      postNodes: 2,
    });
    expect(extracted.diagnostics[0].observedFieldNames).toEqual(
      expect.arrayContaining(['pk', 'code', 'direct_replies', 'thread_items']),
    );
    expect(extracted.relationshipCandidates).toEqual([
      expect.objectContaining({
        kind: 'STRUCTURED_PUBLIC_PARENT',
        subjectUrl: 'https://www.threads.com/@reply/post/REPLY1',
        parentUrl: rootUrl,
        label: 'STRUCTURED_SINGLETON_DIRECT_REPLY_CONTAINER',
      }),
    ]);
    const collection = collectEvidence(root, {
      url: rootUrl,
      observedAt: root.provenance.observedAt,
      synthetic: true,
      visibleUrls: [],
      structuredVisibleUrls: extracted.structuredVisibleUrls,
      jsonLd: [],
      relationshipCandidates: extracted.relationshipCandidates,
    });
    expect(collection.replies).toEqual([
      expect.objectContaining({
        id: 'REPLY1',
        parentId: 'ROOT',
        rootId: 'ROOT',
        evidence: expect.objectContaining({
          kind: 'STRUCTURED_PUBLIC_PARENT',
        }),
      }),
    ]);
  });

  test('does not infer parent from thread_items array order, while retaining explicit root membership', () => {
    const extracted = extractStructuredEvidence(
      [
        input({
          media: post('100', 'ROOT', 'root', 'root'),
          reply_threads: [
            {
              thread_items: [
                {
                  post: post('201', 'R1', 'one', 'first', {
                    root_post_id: '100',
                  }),
                },
                {
                  post: post('202', 'R2', 'two', 'second', {
                    root_post_id: '100',
                  }),
                },
              ],
            },
          ],
        }),
      ],
      rootUrl,
    );
    expect(extracted.relationshipCandidates).toEqual([]);
    expect(
      extracted.membershipEvidence.filter(
        (row) => row.status === 'THREAD_UI_CONFIRMED',
      ),
    ).toHaveLength(2);
    expect(
      extracted.posts.find((row) => row.code === 'R1')?.parentPostId,
    ).toBeNull();
  });

  test('does not accept a direct-replies container when its root identity belongs to another author', () => {
    const extracted = extractStructuredEvidence(
      [
        input({
          media: post('999', 'ROOT', 'wrong_author', 'wrong root'),
          direct_replies: {
            edges: [
              {
                node: {
                  thread_items: [
                    {
                      post: post('201', 'R1', 'one', 'unrelated reply'),
                    },
                  ],
                },
              },
            ],
          },
        }),
      ],
      rootUrl,
    );
    expect(extracted.relationshipCandidates).toEqual([]);
    expect(
      extracted.membershipEvidence.find((row) => row.subjectId === 'R1'),
    ).toMatchObject({ status: 'UNKNOWN' });
  });

  test('uses only explicit parent IDs in a multi-item chain and separates related posts', () => {
    const extracted = extractStructuredEvidence(
      [
        input({
          media: post('100', 'ROOT', 'root', 'root'),
          reply_threads: [
            {
              thread_items: [
                {
                  post: post('201', 'R1', 'one', 'first', {
                    reply_to_post_id: '100',
                  }),
                },
                {
                  post: post('202', 'R2', 'two', 'second', {
                    reply_to_post_id: '201',
                  }),
                },
              ],
            },
          ],
          relatedPosts: {
            threads: [
              {
                thread_items: [
                  {
                    post: post('300', 'RELATED', 'other', 'independent', {
                      reply_to_post_id: '100',
                    }),
                  },
                ],
              },
            ],
          },
        }),
      ],
      rootUrl,
    );
    expect(
      extracted.relationshipCandidates.map((row) => row.subjectUrl),
    ).toEqual([
      'https://www.threads.com/@one/post/R1',
      'https://www.threads.com/@two/post/R2',
    ]);
    expect(
      extracted.membershipEvidence.find((row) => row.subjectId === 'RELATED'),
    ).toMatchObject({ status: 'RECOMMENDED_POST' });
  });

  test('rejects malformed SSR and passively sanitizes a network endpoint path', async () => {
    expect(
      parseSsrRelayScripts(
        [{ index: 0, text: '{bad json' }],
        '/root',
        root.provenance.observedAt,
      ),
    ).toEqual([]);
    const observer = new PassiveStructuredResponseObserver();
    observer.observe({
      status: () => 200,
      url: () =>
        'https://www.threads.com/graphql/query/?doc_id=SECRET&access_token=SECRET',
      headers: () => ({ 'content-type': 'application/json; charset=utf-8' }),
      text: async () =>
        JSON.stringify({
          data: { media: post('100', 'ROOT', 'root', 'root') },
        }),
    } as any);
    const captured = await observer.settle();
    expect(captured).toHaveLength(1);
    expect(captured[0].endpointPath).toBe('/graphql/query/');
    expect(JSON.stringify(captured)).not.toContain('access_token');
    expect(JSON.stringify(captured)).not.toContain('doc_id');
  });
});
