import { describe, expect, test } from '@jest/globals';
import { HuggingFaceContentProvider, huggingFaceConfig } from './ai-provider';

const response = {
  id: 'request-test',
  model: 'test/model',
  choices: [{ message: { content: '{"ok":true}' }, finish_reason: 'stop' }],
  usage: { prompt_tokens: 8, completion_tokens: 4, total_tokens: 12 },
};

describe('Hugging Face bounded provider', () => {
  test('safe config reports credential presence without exposing its value', () => {
    const env = {
      HUGGINGFACE_API_KEY: 'SECRET_TEST_VALUE',
    } as NodeJS.ProcessEnv;
    const config = huggingFaceConfig(env);
    expect(config.credential).toBe('present');
    expect(JSON.stringify(config)).not.toContain('SECRET_TEST_VALUE');
  });

  test('uses configured model/provider, captures usage and never retries', async () => {
    let calls = 0;
    const provider = new HuggingFaceContentProvider(
      {
        HUGGINGFACE_API_KEY: 'SECRET_TEST_VALUE',
        HUGGINGFACE_MODEL: 'test/model',
        HUGGINGFACE_PROVIDER: 'auto',
        HUGGINGFACE_REQUEST_BUDGET: '1',
        HUGGINGFACE_TOKEN_BUDGET: '100',
        HUGGINGFACE_MAX_TOKENS: '50',
      },
      (() => ({
        chatCompletion: async (input: any, options: any) => {
          calls++;
          expect(input.model).toBe('test/model');
          expect(input.provider).toBe('auto');
          expect(options.retry_on_error).toBe(false);
          return response;
        },
      })) as any,
    );
    const result = await provider.completeJson({
      system: 'test',
      input: { test: true },
      maxTokens: 20,
    });
    expect(result.usage.totalTokens).toBe(12);
    expect(result.usage.estimatedCostUsd).toBeNull();
    await expect(
      provider.completeJson({ system: 'test', input: {} }),
    ).rejects.toThrow('AI_REQUEST_BUDGET_EXCEEDED');
    expect(calls).toBe(1);
  });

  test('classifies HTTP 402 and does not leak provider response', async () => {
    const provider = new HuggingFaceContentProvider(
      { HUGGINGFACE_API_KEY: 'SECRET_TEST_VALUE' },
      (() => ({
        chatCompletion: async () => {
          throw {
            httpResponse: {
              status: 402,
              clone: () => ({
                text: async () =>
                  JSON.stringify({
                    error: 'Payment required for routed request',
                    detail:
                      'account balance check failed; token=hf_secret_should_not_escape',
                  }),
              }),
            },
            message: 'sensitive response body',
          };
        },
      })) as any,
    );
    try {
      await provider.completeJson({ system: 'test', input: {} });
      throw Error('EXPECTED_PROVIDER_ERROR');
    } catch (error: any) {
      expect(error.message).toBe('AI_BLOCKED_BILLING');
      expect(error.providerDiagnostic).toContain('Payment required');
      expect(error.providerDiagnostic).toContain('[REDACTED_HF_TOKEN]');
      expect(error.providerDiagnostic).not.toContain(
        'hf_secret_should_not_escape',
      );
    }
  });
});
