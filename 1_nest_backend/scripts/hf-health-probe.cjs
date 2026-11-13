#!/usr/bin/env node
/* Exactly one explicitly approved inference request. No retries or fallback. */
require('./load-local-env.cjs');
const { HuggingFaceContentProvider } = require('../dist/data-engine/ai-provider');

const args = process.argv.slice(2);
const value = (name) => args[args.indexOf(name) + 1];
const model = value('--model');
const maxTokens = Number(value('--max-tokens'));
if (
  !args.includes('--confirm-inference') ||
  !['Qwen/Qwen3-14B', 'openai/gpt-oss-20b'].includes(model) ||
  !Number.isSafeInteger(maxTokens) ||
  maxTokens < 32 ||
  maxTokens > 256
) {
  throw Error(
    'Usage: --confirm-inference --model <approved-model> --max-tokens <32..256>',
  );
}

async function main() {
  const provider = new HuggingFaceContentProvider({
    ...process.env,
    HUGGINGFACE_MODEL: model,
    HUGGINGFACE_PROVIDER: 'auto',
    HUGGINGFACE_REASONING_MODE: 'DISABLED',
    HUGGINGFACE_REQUEST_BUDGET: '1',
    HUGGINGFACE_TOKEN_BUDGET: String(Math.max(100, maxTokens)),
    HUGGINGFACE_MAX_TOKENS: String(maxTokens),
    HUGGINGFACE_TIMEOUT_MS: '60000',
  });
  const result = await provider.completeJson({
    system: 'Return exactly one JSON object with boolean key ok. No prose.',
    input: { task: 'bounded_health_check' },
    maxTokens,
    temperature: 0.1,
  });
  const parsed = JSON.parse(
    result.content
      .trim()
      .replace(/^```(?:json)?\s*/i, '')
      .replace(/\s*```$/, ''),
  );
  if (parsed?.ok !== true) throw Error('AI_HEALTH_SCHEMA_INVALID');
  process.stdout.write(
    JSON.stringify({
      status: 'READY',
      model: result.model,
      route: result.providerRoute,
      latencyMs: result.latencyMs,
      usage: result.usage,
      finishReason: result.finishReason,
    }),
  );
}
main().catch((error) => {
  process.stderr.write(
    JSON.stringify({
      status: 'FAILED',
      error: /^AI_[A-Z0-9_]+$/.test(error.message)
        ? error.message
        : 'AI_HEALTH_PROBE_FAILED',
      providerDiagnostic:
        typeof error.providerDiagnostic === 'string'
          ? error.providerDiagnostic
          : null,
    }),
  );
  process.exitCode = 1;
});
