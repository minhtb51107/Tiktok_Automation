import { InferenceClient } from '@huggingface/inference';
import type { AiCompletion, AiProviderConfig, AiUsage } from './ai-contracts';

export interface AiJsonRequest {
  system: string;
  input: unknown;
  maxTokens?: number;
  temperature?: number;
  signal?: AbortSignal;
}
export interface ContentAiProvider {
  readonly name: 'HUGGING_FACE';
  config(): AiProviderConfig;
  completeJson(request: AiJsonRequest): Promise<AiCompletion>;
}

const integer = (
  value: string | undefined,
  fallback: number,
  min: number,
  max: number,
) => {
  const n = value === undefined ? fallback : Number(value);
  if (!Number.isSafeInteger(n) || n < min || n > max)
    throw Error('AI_INVALID_PROVIDER_CONFIG');
  return n;
};
const decimal = (value: string | undefined) => {
  if (value === undefined || value.trim() === '') return null;
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) throw Error('AI_INVALID_COST_CONFIG');
  return n;
};
export function huggingFaceConfig(
  env: NodeJS.ProcessEnv = process.env,
): AiProviderConfig & {
  inputUsdPerMillion: number | null;
  outputUsdPerMillion: number | null;
} {
  const model = env.HUGGINGFACE_MODEL?.trim() || 'openai/gpt-oss-20b',
    provider = env.HUGGINGFACE_PROVIDER?.trim() || 'auto',
    reasoningMode = env.HUGGINGFACE_REASONING_MODE?.trim() || 'DISABLED';
  if (
    !/^[\w.-]+\/[\w.-]+(?::(?:cheapest|preferred))?$/.test(model) ||
    ![
      'auto',
      'baseten',
      'cerebras',
      'cohere',
      'deepinfra',
      'fal-ai',
      'featherless-ai',
      'fireworks-ai',
      'groq',
      'hf-inference',
      'novita',
      'nscale',
      'openai',
      'ovhcloud',
      'publicai',
      'replicate',
      'scaleway',
      'together',
      'wavespeed',
      'zai-org',
    ].includes(provider) ||
    !['DISABLED', 'MODEL_DEFAULT'].includes(reasoningMode)
  )
    throw Error('AI_INVALID_PROVIDER_CONFIG');
  return {
    model,
    provider,
    timeoutMs: integer(env.HUGGINGFACE_TIMEOUT_MS, 60000, 5000, 120000),
    maxTokens: integer(env.HUGGINGFACE_MAX_TOKENS, 1800, 16, 4096),
    requestBudget: integer(env.HUGGINGFACE_REQUEST_BUDGET, 4, 1, 12),
    tokenBudget: integer(env.HUGGINGFACE_TOKEN_BUDGET, 12000, 100, 100000),
    credential: env.HUGGINGFACE_API_KEY?.trim() ? 'present' : 'absent',
    reasoningMode: reasoningMode as 'DISABLED' | 'MODEL_DEFAULT',
    inputUsdPerMillion: decimal(env.HUGGINGFACE_INPUT_USD_PER_MILLION),
    outputUsdPerMillion: decimal(env.HUGGINGFACE_OUTPUT_USD_PER_MILLION),
  };
}
const token = (value: unknown) =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
    ? value
    : null;
function usage(
  raw: any,
  cfg: ReturnType<typeof huggingFaceConfig>,
  responseCost?: unknown,
): AiUsage {
  const input = token(raw?.prompt_tokens),
    output = token(raw?.completion_tokens),
    total = token(raw?.total_tokens),
    reportedCost =
      typeof (raw?.estimated_cost ?? responseCost) === 'number' &&
      Number.isFinite(raw?.estimated_cost ?? responseCost) &&
      (raw?.estimated_cost ?? responseCost) >= 0
        ? Number(raw?.estimated_cost ?? responseCost)
        : null,
    rated =
      cfg.inputUsdPerMillion !== null &&
      cfg.outputUsdPerMillion !== null &&
      input !== null &&
      output !== null;
  return {
    inputTokens: input,
    outputTokens: output,
    totalTokens: total,
    estimatedCostUsd:
      reportedCost !== null
        ? reportedCost
        : rated
          ? Number(
              (
                (input! * cfg.inputUsdPerMillion! +
                  output! * cfg.outputUsdPerMillion!) /
                1_000_000
              ).toFixed(8),
            )
          : null,
    costSource:
      reportedCost !== null
        ? 'PROVIDER_REPORTED'
        : rated
          ? 'CONFIGURED_RATES'
          : 'UNAVAILABLE',
  };
}
function classify(error: any) {
  const status = Number(
    error?.httpResponse?.status ?? error?.response?.status ?? error?.status,
  );
  if (status === 402) return 'AI_BLOCKED_BILLING';
  if (status === 401 || status === 403) return 'AI_BLOCKED_AUTH';
  if (status === 429) return 'AI_RATE_LIMITED';
  if (error?.name === 'AbortError' || error?.name === 'TimeoutError')
    return 'AI_TIMEOUT';
  return 'AI_PROVIDER_ERROR';
}

const redactDiagnostic = (value: string) =>
  value
    .replace(/Bearer\s+[^\s"']+/gi, 'Bearer [REDACTED]')
    .replace(/hf_[A-Za-z0-9_-]{8,}/g, '[REDACTED_HF_TOKEN]')
    .replace(/(https?:\/\/[^\s?"']+)\?[^\s"']+/gi, '$1?[REDACTED_QUERY]')
    .replace(
      /("?(?:access[_-]?token|authorization|api[_-]?key|secret)"?\s*[:=]\s*)"?[^,}\s"]+"?/gi,
      '$1[REDACTED]',
    )
    .replace(/[\r\n\t]+/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim()
    .slice(0, 800);

export async function safeProviderDiagnostic(error: any) {
  const response = error?.httpResponse ?? error?.response;
  let body = '';
  try {
    if (response && typeof response.clone === 'function')
      body = await response.clone().text();
    else if (response && typeof response.text === 'function')
      body = await response.text();
    else if (typeof error?.body === 'string') body = error.body;
  } catch {
    body = '';
  }
  const parts: string[] = [];
  if (body) {
    try {
      const parsed = JSON.parse(body);
      for (const key of ['error', 'message', 'detail', 'code', 'type']) {
        const value = parsed?.[key];
        if (typeof value === 'string' || typeof value === 'number')
          parts.push(`${key}: ${String(value)}`);
      }
    } catch {
      parts.push(body);
    }
  }
  if (!parts.length && typeof error?.message === 'string')
    parts.push(error.message);
  const diagnostic = redactDiagnostic(parts.join('; '));
  return diagnostic || null;
}

export class HuggingFaceContentProvider implements ContentAiProvider {
  readonly name = 'HUGGING_FACE' as const;
  private requests = 0;
  private tokens = 0;
  constructor(
    private env: NodeJS.ProcessEnv = process.env,
    private clientFactory = (token: string) => new InferenceClient(token),
  ) {}
  config() {
    const {
      inputUsdPerMillion: _i,
      outputUsdPerMillion: _o,
      ...safe
    } = huggingFaceConfig(this.env);
    return safe;
  }
  async completeJson(request: AiJsonRequest): Promise<AiCompletion> {
    const cfg = huggingFaceConfig(this.env),
      key = this.env.HUGGINGFACE_API_KEY?.trim();
    if (!key) throw Error('AI_BLOCKED_AUTH');
    if (this.requests >= cfg.requestBudget)
      throw Error('AI_REQUEST_BUDGET_EXCEEDED');
    const max = Math.min(request.maxTokens ?? cfg.maxTokens, cfg.maxTokens);
    if (this.tokens + max > cfg.tokenBudget)
      throw Error('AI_TOKEN_BUDGET_EXCEEDED');
    this.requests++;
    this.tokens += max;
    const timeout = AbortSignal.timeout(cfg.timeoutMs),
      signal = request.signal
        ? AbortSignal.any([request.signal, timeout])
        : timeout,
      start = Date.now();
    try {
      const response = await this.clientFactory(key).chatCompletion(
        {
          model: cfg.model,
          provider: cfg.provider as any,
          messages: [
            {
              role: 'system',
              content:
                cfg.reasoningMode === 'DISABLED' &&
                /^Qwen\/Qwen3-/i.test(cfg.model)
                  ? `${request.system}\n/no_think`
                  : request.system,
            },
            { role: 'user', content: JSON.stringify(request.input) },
          ],
          temperature: request.temperature ?? 0.1,
          max_tokens: max,
          response_format: { type: 'json_object' } as any,
        },
        { signal, retry_on_error: false },
      );
      const message = response.choices?.[0]?.message as any,
        content = message?.content,
        reasoningPresent =
          typeof message?.reasoning_content === 'string' &&
          Boolean(message.reasoning_content.trim());
      if (typeof content !== 'string' || !content.trim()) {
        if (reasoningPresent)
          throw Object.assign(Error('AI_REASONING_OUTPUT_INCOMPLETE'), {
            providerDiagnostic:
              'Reasoning output was returned but final content was empty; output budget may have been consumed before the final answer.',
          });
        throw Error('AI_EMPTY_RESPONSE');
      }
      return {
        provider: 'HUGGING_FACE',
        model: response.model || cfg.model,
        providerRoute: cfg.provider,
        content,
        usage: usage(response.usage, cfg, (response as any).estimated_cost),
        latencyMs: Date.now() - start,
        requestId: typeof response.id === 'string' ? response.id : null,
        finishReason: response.choices?.[0]?.finish_reason ?? null,
      };
    } catch (error: any) {
      const code = /^AI_/.test(error?.message || '')
          ? error.message
          : classify(error),
        providerDiagnostic =
          typeof error?.providerDiagnostic === 'string'
            ? error.providerDiagnostic
            : await safeProviderDiagnostic(error);
      throw Object.assign(Error(code), {
        category: code,
        httpStatus:
          Number(
            error?.httpResponse?.status ??
              error?.response?.status ??
              error?.status,
          ) || null,
        redactedMessage: code,
        providerDiagnostic,
      });
    }
  }
}
