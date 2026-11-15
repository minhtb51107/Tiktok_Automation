import { canonicalPost } from './conversation-evidence';
import {
  PARSEFORGE_ACTOR,
  type ParseforgeReplyRow,
} from './conversation-provider-parseforge';

export const PARSEFORGE_LISTED_USD_PER_1000 = 3.4;
export interface ParseforgeRunInput {
  postUrl: string;
  maxItems: number;
  maxRepliesPerPost: number;
  sortOrder: 'TOP' | 'RECENT';
  includeNestedReplies: boolean;
  maxReplyDepth: number;
}
export interface ProviderAuthorization {
  provider: typeof PARSEFORGE_ACTOR;
  approved: true;
  maxCostUsd: number;
  approvalId: string;
}

export function estimateParseforge(input: ParseforgeRunInput) {
  const root = canonicalPost(input.postUrl);
  if (
    !root ||
    !Number.isInteger(input.maxItems) ||
    input.maxItems < 1 ||
    input.maxItems > 40 ||
    !Number.isInteger(input.maxRepliesPerPost) ||
    input.maxRepliesPerPost < 1 ||
    input.maxRepliesPerPost > 40 ||
    !Number.isInteger(input.maxReplyDepth) ||
    input.maxReplyDepth < 2 ||
    input.maxReplyDepth > 10
  )
    throw Error('PARSEFORGE_INVALID_BOUNDED_INPUT');
  return {
    provider: PARSEFORGE_ACTOR,
    rootUrl: root.url,
    maximumResultItems: input.maxItems,
    listedUsdPer1000: PARSEFORGE_LISTED_USD_PER_1000,
    estimatedMaximumUsd: Number(
      ((input.maxItems / 1000) * PARSEFORGE_LISTED_USD_PER_1000).toFixed(6),
    ),
    basis: 'PUBLIC_LISTING_ESTIMATE_NOT_A_BILLING_QUOTE' as const,
  };
}

export function parseforgeProviderStatus(env: NodeJS.ProcessEnv = process.env) {
  return {
    provider: PARSEFORGE_ACTOR,
    configured: !!env.APIFY_API_TOKEN?.trim(),
    enabled: false,
    authorization: 'EXPLICIT_PAID_RUN_APPROVAL_REQUIRED' as const,
    listedUsdPer1000: PARSEFORGE_LISTED_USD_PER_1000,
  };
}

/** Thin optional client. It is unreachable without an explicit per-run authorization object. */
export class ParseforgeProviderClient {
  constructor(
    private readonly token = process.env.APIFY_API_TOKEN?.trim() || '',
    private readonly request: typeof fetch = fetch,
  ) {}
  async run(input: ParseforgeRunInput, authorization: ProviderAuthorization) {
    const estimate = estimateParseforge(input);
    if (
      authorization?.provider !== PARSEFORGE_ACTOR ||
      authorization.approved !== true ||
      !/^[a-z0-9][a-z0-9-]{7,127}$/i.test(authorization.approvalId || '') ||
      !Number.isFinite(authorization.maxCostUsd) ||
      authorization.maxCostUsd < estimate.estimatedMaximumUsd
    )
      throw Error('PARSEFORGE_EXPLICIT_AUTHORIZATION_REQUIRED');
    if (!this.token) throw Error('PARSEFORGE_TOKEN_NOT_CONFIGURED');
    const headers = {
        authorization: `Bearer ${this.token}`,
        'content-type': 'application/json',
      },
      body = {
        postUrls: [{ url: estimate.rootUrl }],
        maxItems: input.maxItems,
        maxRepliesPerPost: input.maxRepliesPerPost,
        sortOrder: input.sortOrder,
        includeNestedReplies: input.includeNestedReplies,
        maxReplyDepth: input.maxReplyDepth,
        proxyConfiguration: { useApifyProxy: false },
      },
      runResponse = await this.request(
        'https://api.apify.com/v2/acts/parseforge~threads-replies-scraper/runs?waitForFinish=180',
        { method: 'POST', headers, body: JSON.stringify(body) },
      );
    if (!runResponse.ok) throw Error(`PARSEFORGE_RUN_HTTP_${runResponse.status}`);
    const run = (await runResponse.json()) as {
      data?: { id?: unknown; defaultDatasetId?: unknown; status?: unknown };
    };
    const runId = typeof run.data?.id === 'string' ? run.data.id : null,
      datasetId =
        typeof run.data?.defaultDatasetId === 'string'
          ? run.data.defaultDatasetId
          : null;
    if (!runId || !datasetId || run.data?.status !== 'SUCCEEDED')
      throw Error('PARSEFORGE_RUN_NOT_COMPLETED');
    const datasetResponse = await this.request(
      `https://api.apify.com/v2/datasets/${encodeURIComponent(datasetId)}/items?clean=false&format=json&limit=${input.maxItems}`,
      { headers: { authorization: `Bearer ${this.token}` } },
    );
    if (!datasetResponse.ok)
      throw Error(`PARSEFORGE_DATASET_HTTP_${datasetResponse.status}`);
    const rows = (await datasetResponse.json()) as unknown;
    if (!Array.isArray(rows) || rows.length > input.maxItems)
      throw Error('PARSEFORGE_DATASET_INVALID');
    return {
      provider: PARSEFORGE_ACTOR,
      approvalId: authorization.approvalId,
      runId,
      datasetId,
      observedAt: new Date().toISOString(),
      estimate,
      rows: rows as ParseforgeReplyRow[],
    };
  }
}
