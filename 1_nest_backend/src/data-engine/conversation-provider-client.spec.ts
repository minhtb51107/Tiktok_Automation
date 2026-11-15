import { describe, expect, jest, test } from '@jest/globals';
import {
  estimateParseforge,
  ParseforgeProviderClient,
  parseforgeProviderStatus,
} from './conversation-provider-client';
import { PARSEFORGE_ACTOR } from './conversation-provider-parseforge';

const input = {
  postUrl: 'https://www.threads.com/@gnrtth/post/DeI-TuzEc_9',
  maxItems: 20,
  maxRepliesPerPost: 20,
  sortOrder: 'TOP' as const,
  includeNestedReplies: true,
  maxReplyDepth: 5,
};

describe('optional Parseforge client', () => {
  test('provides a bounded public-listing estimate without a token or request', () => {
    expect(estimateParseforge(input)).toMatchObject({
      rootUrl: input.postUrl,
      maximumResultItems: 20,
      estimatedMaximumUsd: 0.068,
      basis: 'PUBLIC_LISTING_ESTIMATE_NOT_A_BILLING_QUOTE',
    });
    expect(parseforgeProviderStatus({})).toMatchObject({
      configured: false,
      enabled: false,
    });
  });

  test('cannot make a request without explicit cost authorization', async () => {
    const request = jest.fn<typeof fetch>();
    const client = new ParseforgeProviderClient('secret-not-observed', request);
    await expect(
      client.run(input, {
        provider: PARSEFORGE_ACTOR,
        approved: true,
        approvalId: 'benchmark-approval',
        maxCostUsd: 0.01,
      }),
    ).rejects.toThrow('PARSEFORGE_EXPLICIT_AUTHORIZATION_REQUIRED');
    expect(request).not.toHaveBeenCalled();
  });

  test('uses two bounded calls and returns provider run identity', async () => {
    const request = jest
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            data: { id: 'run-1', defaultDatasetId: 'dataset-1', status: 'SUCCEEDED' },
          }),
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify([{ postUrl: input.postUrl, text: 'row' }]), {
          status: 200,
        }),
      );
    const client = new ParseforgeProviderClient('secret-not-observed', request);
    const result = await client.run(input, {
      provider: PARSEFORGE_ACTOR,
      approved: true,
      approvalId: 'benchmark-approval',
      maxCostUsd: 0.068,
    });
    expect(result).toMatchObject({ runId: 'run-1', datasetId: 'dataset-1' });
    expect(request).toHaveBeenCalledTimes(2);
    expect(String(request.mock.calls[0][0])).not.toContain('secret-not-observed');
    expect(request.mock.calls[0][1]).toMatchObject({ method: 'POST' });
  });
});
