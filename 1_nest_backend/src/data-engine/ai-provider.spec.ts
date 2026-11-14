import { describe, expect, jest, test } from '@jest/globals';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { HuggingFaceContentProvider, huggingFaceConfig } from './ai-provider';

const memoryLedger = () =>
  ({ append: jest.fn(), events: () => [], file: 'MEMORY' }) as any;

const response = {
  id: 'request-test',
  model: 'test/model',
  choices: [{ message: { content: '{"ok":true}' }, finish_reason: 'stop' }],
  usage: { prompt_tokens: 8, completion_tokens: 4, total_tokens: 12 },
  estimated_cost: 0.0002,
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
    const dir = await mkdtemp(path.join(tmpdir(), 'ai-ledger-success-'));
    const ledger = path.join(dir, 'ledger.jsonl');
    const provider = new HuggingFaceContentProvider(
      {
        HUGGINGFACE_API_KEY: 'SECRET_TEST_VALUE',
        HUGGINGFACE_MODEL: 'test/model',
        HUGGINGFACE_PROVIDER: 'auto',
        HUGGINGFACE_REQUEST_BUDGET: '1',
        HUGGINGFACE_TOKEN_BUDGET: '100',
        HUGGINGFACE_MAX_TOKENS: '50',
        HUGGINGFACE_LEDGER_PATH: ledger,
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
      undefined,
    );
    const result = await provider.completeJson({
      system: 'test',
      input: { test: true },
      maxTokens: 20,
    });
    expect(result.usage.totalTokens).toBe(12);
    expect(result.usage.estimatedCostUsd).toBe(0.0002);
    expect(result.usage.costSource).toBe('PROVIDER_REPORTED');
    provider.recordValidationOutcome(
      result.ledgerId,
      'VALIDATION_FAILED',
      'AI_SCRIPT_SCHEMA_INVALID',
      '{"api_key":"secret-test","bad":true}',
    );
    await expect(
      provider.completeJson({ system: 'test', input: {} }),
    ).rejects.toThrow('AI_REQUEST_BUDGET_EXCEEDED');
    expect(calls).toBe(1);
    const events = (await readFile(ledger, 'utf8'))
      .trim()
      .split(/\r?\n/)
      .map((line) => JSON.parse(line));
    expect(events.map((event) => event.status)).toEqual([
      'PENDING',
      'PROVIDER_SUCCEEDED',
      'VALIDATION_FAILED',
    ]);
    expect(events[0]).toMatchObject({
      model: 'test/model',
      requestedMaxTokens: 20,
    });
    expect(events[0].inputHash).toMatch(/^[a-f0-9]{64}$/);
    expect(events[1].usage.totalTokens).toBe(12);
    expect(events[2].failureCategory).toBe('AI_SCRIPT_SCHEMA_INVALID');
    expect(events[2].sanitizedModelOutput).not.toContain('secret-test');
    expect(JSON.stringify(events)).not.toContain('SECRET_TEST_VALUE');
    expect(provider.ledgerMetrics()).toEqual({
      requests: 1,
      pending: 0,
      providerSucceeded: 1,
      providerFailed: 0,
      validated: 0,
      validationFailed: 1,
      reportedCostUsd: 0.0002,
      costTrackingAvailable: true,
    });
    await rm(dir, { recursive: true, force: true });
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
                      'account balance check failed; token=' +
                      ['hf_', 'x'.repeat(24)].join(''),
                  }),
              }),
            },
            message: 'sensitive response body',
          };
        },
      })) as any,
      memoryLedger(),
    );
    try {
      await provider.completeJson({ system: 'test', input: {} });
      throw Error('EXPECTED_PROVIDER_ERROR');
    } catch (error: any) {
      expect(error.message).toBe('AI_BLOCKED_BILLING');
      expect(error.providerDiagnostic).toContain('Payment required');
      expect(error.providerDiagnostic).toContain('[REDACTED_HF_TOKEN]');
      expect(error.providerDiagnostic).not.toContain(
        ['hf_', 'x'.repeat(24)].join(''),
      );
    }
  });

  test('uses Qwen non-thinking switch and accepts only final content', async () => {
    let system = '';
    const provider = new HuggingFaceContentProvider(
      {
        HUGGINGFACE_API_KEY: 'SECRET_TEST_VALUE',
        HUGGINGFACE_MODEL: 'Qwen/Qwen3-14B',
        HUGGINGFACE_REASONING_MODE: 'DISABLED',
      },
      (() => ({
        chatCompletion: async (input: any) => {
          system = input.messages[0].content;
          return {
            ...response,
            model: 'Qwen/Qwen3-14B',
            choices: [
              {
                message: {
                  reasoning_content: 'internal reasoning is not persisted',
                  content: '{"ok":true}',
                },
                finish_reason: 'stop',
              },
            ],
          };
        },
      })) as any,
      memoryLedger(),
    );
    expect(
      (await provider.completeJson({ system: 'Return JSON.', input: {} }))
        .content,
    ).toBe('{"ok":true}');
    expect(system).toContain('/no_think');
  });

  test('reasoning without final content is an incomplete response, not success', async () => {
    const provider = new HuggingFaceContentProvider(
      {
        HUGGINGFACE_API_KEY: 'SECRET_TEST_VALUE',
        HUGGINGFACE_MODEL: 'Qwen/Qwen3-14B',
      },
      (() => ({
        chatCompletion: async () => ({
          ...response,
          choices: [
            {
              message: {
                reasoning_content: 'budget consumed by reasoning',
                content: '',
              },
              finish_reason: 'length',
            },
          ],
        }),
      })) as any,
      memoryLedger(),
    );
    try {
      await provider.completeJson({ system: 'Return JSON.', input: {} });
      throw Error('EXPECTED_INCOMPLETE_RESPONSE');
    } catch (error: any) {
      expect(error.message).toBe('AI_REASONING_OUTPUT_INCOMPLETE');
      expect(error.providerDiagnostic).toContain('final content was empty');
      expect(error.providerDiagnostic).not.toContain('budget consumed');
    }
  });
});
