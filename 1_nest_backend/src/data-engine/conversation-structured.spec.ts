import { describe, expect, test } from '@jest/globals';
import type { PublicPost } from './conversation-contracts';
import { collectEvidence } from './conversation-evidence';
import { selectedReplies } from './editorial-feasibility';
import {
  diagnoseStructuredAcquisition,
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
    expect(selectedReplies(collection, ['REPLY1'])).toHaveLength(1);
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
    const request = {
      url: () =>
        'https://www.threads.com/graphql/query/?doc_id=SECRET&access_token=SECRET',
      method: () => 'POST',
      resourceType: () => 'fetch',
      failure: () => null,
    } as any;
    observer.recordRequest(request, { admitted: true, reason: 'ADMITTED' });
    observer.observe({
      status: () => 200,
      url: request.url,
      request: () => request,
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
    expect(observer.telemetry().responses).toEqual([
      expect.objectContaining({
        endpointPath: '/graphql/query/',
        method: 'POST',
        resourceType: 'fetch',
        parserDecision: 'ACCEPTED_JSON',
      }),
    ]);
  });

  test('diagnoses parseable JSON missed by content type without feeding it to the parser', async () => {
    const observer = new PassiveStructuredResponseObserver(),
      request = {
        url: () => 'https://www.threads.com/api/graphql/?secret=REDACTED',
        method: () => 'POST',
        resourceType: () => 'xhr',
        failure: () => null,
      } as any;
    observer.recordRequest(request, { admitted: true, reason: 'ADMITTED' });
    observer.observe({
      status: () => 200,
      url: request.url,
      request: () => request,
      headers: () => ({ 'content-type': 'text/plain', 'content-length': '80' }),
      text: async () =>
        JSON.stringify({ data: { direct_replies: [], thread_items: [] } }),
    } as any);
    expect(await observer.settle()).toEqual([]);
    expect(observer.telemetry().responses).toEqual([
      expect.objectContaining({
        endpointPath: '/api/graphql/',
        parserDecision: 'SKIPPED_CONTENT_TYPE_JSON_PARSEABLE',
        conversationMarkers: ['thread_items', 'direct_replies'],
        bodyHash: expect.stringMatching(/^[a-f0-9]{64}$/u),
      }),
    ]);
    expect(JSON.stringify(observer.telemetry())).not.toContain('secret');
  });

  test('accepts parseable JSON returned as JavaScript for an admitted public XHR', async () => {
    const observer = new PassiveStructuredResponseObserver(),
      request = {
        url: () => 'https://www.threads.com/api/graphql/?secret=REDACTED',
        method: () => 'POST',
        resourceType: () => 'xhr',
        failure: () => null,
      } as any;
    observer.recordRequest(request, { admitted: true, reason: 'ADMITTED' });
    observer.observe({
      status: () => 200,
      url: request.url,
      request: () => request,
      headers: () => ({ 'content-type': 'text/javascript; charset=utf-8' }),
      text: async () =>
        JSON.stringify({
          data: {
            media: {
              text_post_app_info: {
                direct_replies: {
                  edges: [
                    {
                      node: {
                        posts: {
                          edges: [
                            {
                              node: post('101', 'R1', 'reply', 'reply text'),
                            },
                          ],
                        },
                      },
                    },
                    {
                      node: {
                        posts: {
                          edges: [
                            {
                              node: post(
                                '102',
                                'R2',
                                'reply2',
                                'second reply text',
                              ),
                            },
                          ],
                        },
                      },
                    },
                  ],
                },
              },
            },
          },
        }),
    } as any);
    const captured = await observer.settle();
    expect(captured).toHaveLength(1);
    expect(captured[0]).toMatchObject({
      source: 'NETWORK',
      endpointPath: '/api/graphql/',
    });
    expect(observer.telemetry().responses).toEqual([
      expect.objectContaining({
        endpointPath: '/api/graphql/',
        parserDecision: 'ACCEPTED_JSON',
        conversationMarkers: ['direct_replies'],
      }),
    ]);
    const extraction = extractStructuredEvidence(captured, rootUrl),
      graph = collectEvidence(root, {
        url: rootUrl,
        observedAt: root.provenance.observedAt,
        synthetic: true,
        visibleUrls: [],
        structuredVisibleUrls: extraction.structuredVisibleUrls,
        jsonLd: [],
        relationshipCandidates: extraction.relationshipCandidates,
      });
    expect(extraction.relationshipCandidates).toHaveLength(2);
    expect(extraction.relationshipCandidates).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          subjectUrl: 'https://www.threads.com/@reply/post/R1',
          parentUrl: rootUrl,
          label: 'STRUCTURED_TARGET_DIRECT_REPLIES_CONTAINER',
        }),
        expect.objectContaining({
          subjectUrl: 'https://www.threads.com/@reply2/post/R2',
          parentUrl: rootUrl,
          label: 'STRUCTURED_TARGET_DIRECT_REPLIES_CONTAINER',
        }),
      ]),
    );
    expect(graph.replies.map((row) => row.id)).toEqual(['R1', 'R2']);
    expect(JSON.stringify(observer.telemetry())).not.toContain('secret');
  });

  test('redacts non-HTTP data URLs from telemetry paths', async () => {
    const observer = new PassiveStructuredResponseObserver(),
      request = {
        url: () => 'data:text/javascript;base64,U0VDUkVU',
        method: () => 'GET',
        resourceType: () => 'script',
        failure: () => null,
      } as any;
    observer.recordRequest(request, {
      admitted: false,
      reason: 'BLOCKED_UNSUPPORTED_ORIGIN',
    });
    expect(observer.telemetry().requests).toEqual([
      expect.objectContaining({ endpointPath: 'DATA_URL' }),
    ]);
    expect(JSON.stringify(observer.telemetry())).not.toContain('U0VDUkVU');
  });

  test('tracks SSR query names at independent milestones without retaining script text', () => {
    const observer = new PassiveStructuredResponseObserver(),
      script = JSON.stringify({
        require: [
          [
            'RelayPrefetchedStreamCache',
            'next',
            [],
            [
              'adp_BarcelonaPostPageDownwardQueryRelayPreloader_hash',
              { __bbox: { result: { data: { direct_replies: [] } } } },
            ],
          ],
        ],
      });
    observer.observeSsr(
      'DOM_CONTENT_LOADED',
      [{ index: 0, text: script }],
      '/@root/post/ROOT',
    );
    expect(observer.telemetry().ssrMilestones).toEqual([
      expect.objectContaining({
        milestone: 'DOM_CONTENT_LOADED',
        scriptCount: 1,
        postNodes: 0,
        queryNames: ['BarcelonaPostPageDownwardQuery'],
        scriptHashes: [expect.stringMatching(/^[a-f0-9]{64}$/u)],
      }),
    ]);
    expect(JSON.stringify(observer.telemetry())).not.toContain(
      'direct_replies',
    );
  });

  test('classifies acquisition causes without inventing relationship evidence', () => {
    const base = extractStructuredEvidence([], rootUrl),
      request = {
        id: 'request-1',
        endpointPath: '/data/manifest.json',
        method: 'GET',
        resourceType: 'fetch',
        admitted: true,
        admissionReason: 'ADMITTED',
        completion: 'FINISHED' as const,
        failureCategory: null,
        observedAt: root.provenance.observedAt,
      },
      response = {
        requestId: 'request-1',
        endpointPath: '/data/manifest.json',
        method: 'GET',
        status: 200,
        contentType: 'application/json',
        resourceType: 'fetch',
        contentLength: null,
        admitted: true,
        admissionReason: 'ADMITTED',
        parserDecision: 'ACCEPTED_JSON' as const,
        bodyHash: 'a'.repeat(64),
        conversationMarkers: [],
        observedAt: root.provenance.observedAt,
      },
      milestone = {
        milestone: 'DOM_CONTENT_LOADED',
        scriptCount: 1,
        totalBytes: 10,
        postNodes: 0,
        scriptHashes: ['b'.repeat(64)],
        queryNames: ['BarcelonaPostPageTargetQuery'],
        observedAt: root.provenance.observedAt,
      };
    expect(
      diagnoseStructuredAcquisition({
        ...base,
        requests: [request],
        responses: [response],
        ssrMilestones: [milestone],
      }),
    ).toBe('NO_STRUCTURED_EVIDENCE');
    expect(
      diagnoseStructuredAcquisition({
        ...base,
        requests: [request],
        responses: [
          {
            ...response,
            contentType: 'text/plain',
            parserDecision: 'SKIPPED_CONTENT_TYPE_JSON_PARSEABLE',
            conversationMarkers: ['direct_replies'],
          },
        ],
        ssrMilestones: [milestone],
      }),
    ).toBe('NETWORK_CONTENT_TYPE_MISSED');
    expect(
      diagnoseStructuredAcquisition({
        ...base,
        requests: [request],
        responses: [response],
        ssrMilestones: [
          milestone,
          {
            ...milestone,
            milestone: 'AFTER_ACTION_1',
            queryNames: ['BarcelonaPostPageDownwardQuery'],
          },
        ],
      }),
    ).toBe('SSR_LATE_INSERTION');
    expect(
      diagnoseStructuredAcquisition({
        ...base,
        requests: [
          request,
          {
            ...request,
            id: 'request-2',
            admitted: false,
            admissionReason: 'BLOCKED_EVENT_BUDGET',
            completion: 'FAILED',
          },
        ],
        responses: [response],
        ssrMilestones: [milestone],
      }),
    ).toBe('INCONCLUSIVE');
  });
});
