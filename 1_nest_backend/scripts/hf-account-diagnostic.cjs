#!/usr/bin/env node
/* Authentication/model metadata only. This script never performs inference. */
const crypto = require('crypto');

const token = process.env.HUGGINGFACE_API_KEY?.trim();
if (!token) throw Error('HF_DIAG_TOKEN_ABSENT');
const fingerprint = crypto.createHash('sha256').update(token).digest('hex').slice(0, 12);
const models = ['Qwen/Qwen3-14B', 'openai/gpt-oss-20b'];

async function json(url, authenticated = false) {
  const response = await fetch(url, {
    headers: authenticated ? { Authorization: `Bearer ${token}` } : {},
    signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok) throw Error(`HF_DIAG_HTTP_${response.status}`);
  return response.json();
}

async function main() {
  const who = await json('https://huggingface.co/api/whoami-v2', true);
  const mappings = [];
  for (const model of models) {
    const metadata = await json(
      `https://huggingface.co/api/models/${model}?expand=inferenceProviderMapping`,
    );
    mappings.push({
      model,
      providers: Object.entries(metadata.inferenceProviderMapping || {}).map(
        ([provider, value]) => ({
          provider,
          status: value.status,
          task: value.task,
          providerId: value.providerId,
        }),
      ),
    });
  }
  const access = who.auth?.accessToken || {};
  process.stdout.write(
    JSON.stringify(
      {
        checkedAt: new Date().toISOString(),
        inferenceRequests: 0,
        credential: {
          fingerprint,
          account: who.name || null,
          accountType: who.type || null,
          isPro: who.isPro === true,
          tokenDisplayName: access.displayName || null,
          tokenRole: access.role || null,
          tokenType: access.type || null,
        },
        routing: {
          mode: 'HUGGING_FACE_ROUTED_REQUEST',
          reason:
            'InferenceClient receives a Hugging Face token and no custom provider key.',
          customProviderKeyDashboardStatus:
            'NOT_EXPOSED_BY_DOCUMENTED_READ_API',
        },
        modelMappings: mappings,
      },
      null,
      2,
    ),
  );
}
main().catch((error) => {
  process.stderr.write(
    /^HF_DIAG_[A-Z0-9_]+$/.test(error.message)
      ? error.message
      : 'HF_DIAG_FAILED',
  );
  process.exitCode = 1;
});
