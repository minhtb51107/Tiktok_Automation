import { describe, it, expect, jest } from '@jest/globals';
import { promises as fs } from 'fs';
import * as os from 'os';
import * as path from 'path';
import { StudioService } from './studio.service';
import { ScraperService } from '../modules/core/scraper/scraper.service';
import { normalizeText } from './normalization';
import { offlineNormalize, qualityCases, realQualityCases } from './offline-normalization';
import { HuggingFaceContentProvider } from '../data-engine/ai-provider';
describe('offline normalization and Voice gates (MOCK runtime, no inference)', () => {
  it('matches curated expected results for nine rules and all five real targets', () => {
    const cases = [...qualityCases(), ...realQualityCases()];
    expect(cases).toHaveLength(14);
    for (const c of cases)
      expect({ input: c.input, actual: c.actual, pass: c.pass }).toEqual({
        input: c.input,
        actual: c.actual,
        pass: true,
      });
  });
  it('classifies/redacts HTTP 402 and never treats payment denial as successful output', async () => {
    let calls = 0;
    const provider = new HuggingFaceContentProvider(
      {
        HUGGINGFACE_API_KEY: 'offline-test',
        HUGGINGFACE_MODEL: 'Qwen/Qwen3-14B',
        HUGGINGFACE_PROVIDER: 'hf-inference',
      },
      (() => ({
        chatCompletion: async () => {
          calls++;
          throw {
            httpResponse: {
              status: 402,
              clone: () => ({
                text: async () =>
                  JSON.stringify({
                    error:
                      'Insufficient credits; Bearer ' +
                      ['hf_', 'secret_for_test'].join('') +
                      ' person@example.com',
                  }),
              }),
            },
            message: 'Payment required',
          };
        },
      })) as any,
      { append() {}, events: () => [], summary: () => ({}) } as any,
    );
    const result = await normalizeText(
      {
        id: 'x',
        revision: 0,
        spokenText: 'ko đi',
        originalText: 'ko đi',
      },
      provider,
    );
    expect(result.executionStatus).toBe('BLOCKED_BILLING');
    expect(result.approval).toBe('ERROR');
    expect(result.proposedSpokenText).toBeNull();
    expect(result.diagnostic?.redactedBody).not.toContain('secret_for_test');
    expect(result.diagnostic?.redactedBody).not.toContain('person@');
    expect(calls).toBe(1);
    expect(offlineNormalize({ id: 'x', revision: 0, spokenText: 'ko đi', originalText: 'ko đi' }).estimatedCost).toBe(0);
  });
  it('requires spoken approval, persists measured manifest, invalidates affected audio and retains files', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'voice-contract-'));
    const service = new StudioService({} as ScraperService);
    let calls = 0;
    const ready = {
      status: 'READY',
      python: 'MOCK',
      packageVersion: 'MOCK',
      imports: {},
      voices: [{ id: 'fixture', label: 'MOCK voice' }],
      declaredVoices: [{ id: 'fixture', label: 'MOCK voice' }],
      model: 'MOCK',
      modelVersion: 'MOCK',
      device: 'MOCK',
      gpuAvailable: null,
      ffmpeg: true,
      ffprobe: true,
      blockers: [],
      checkedAt: new Date().toISOString(),
    };
    Object.assign(service, {
      root,
      voice: {
        preflight: async () => ready,
        generate: async (sessionId: string) => {
          calls++;
          const dir = path.join(root, 'audio', sessionId, 'assets');
          await fs.mkdir(dir, { recursive: true });
          await fs.writeFile(
            path.join(dir, calls + '.wav'),
            'MOCK bytes; not synthesized audio',
          );
          return {
            filePath: 'audio/' + sessionId + '/assets/' + calls + '.wav',
            durationMs: 2048,
            cacheKey: 'MOCK-hash',
            cacheHit: calls > 1,
          };
        },
        close: () => {},
      },
    });
    try {
      let s = await service.create();
      s = await service.mutate(s.id, {
        revision: s.revision,
        manual: {
          text: 'Người dùng duyệt câu này.',
          author: 'MOCK',
          comments: '',
        },
      });
      const itemId = s.items[0].id;
      await expect(
        service.voiceAction(s.id, itemId, {
          revision: s.revision,
          action: 'GENERATE',
        }),
      ).rejects.toThrow('Approve current spoken');
      expect(calls).toBe(0);
      s = await service.runtime(s.id);
      s = await service.voiceAction(s.id, itemId, {
        revision: s.revision,
        action: 'SETTINGS',
        voice: 'fixture',
        speed: 1,
      });
      s = await service.voiceAction(s.id, itemId, {
        revision: s.revision,
        action: 'APPROVE_SPOKEN',
      });
      s = await service.voiceAction(s.id, itemId, {
        revision: s.revision,
        action: 'GENERATE',
      });
      expect(s.voiceAssets?.[0].durationMs).toBe(2048);
      expect(s.voiceAssets?.[0].status).toBe('GENERATED');
      s = await service.voiceAction(s.id, itemId, {
        revision: s.revision,
        action: 'APPROVE_AUDIO',
        assetId: s.voiceAssets![0].id,
      });
      expect(s.voiceAssets?.[0].status).toBe('APPROVED');
      expect(s.project.audioAssets[0].durationSource).toBe('MEASURED');
      const pathBefore = s.voiceAssets![0].filePath;
      s = await service.voiceAction(s.id, itemId, {
        revision: s.revision,
        action: 'SETTINGS',
        voice: 'fixture',
        speed: 1.1,
      });
      expect(s.voiceAssets?.[0].status).toBe('STALE');
      expect(s.voiceAssets?.[0].filePath).toBe(pathBefore);
      expect(s.project.audioAssets).toHaveLength(0);
      s = await service.voiceAction(s.id, itemId, {
        revision: s.revision,
        action: 'GENERATE',
        regenerate: true,
      });
      expect(calls).toBe(2);
      expect(s.voiceAssets).toHaveLength(2);
      await fs.unlink(path.join(root, s.voiceAssets![1].filePath));
      s = await service.voiceAction(s.id, itemId, {
        revision: s.revision,
        action: 'APPROVE_AUDIO',
        assetId: s.voiceAssets![1].id,
      });
      expect(s.voiceAssets?.[1].status).toBe('STALE');
      expect(s.voiceJobs?.slice(-1)[0].error).toContain('missing or empty');
      s = await service.mutate(s.id, {
        revision: s.revision,
        title: s.title,
        items: s.items.map((i) => ({
          ...i,
          spokenText: 'Người dùng đổi câu.',
        })),
      });
      expect(s.items[0].spokenApproval?.valid).toBe(false);
      expect(s.voiceAssets?.every((a) => a.status === 'STALE')).toBe(true);
      expect(s.items[0].originalText).toBe('Người dùng duyệt câu này.');
      expect((await service.gcPreview(s.id)).deleted).toBe(0);
      Object.assign(service, {
        voice: {
          preflight: async () => ({
            ...ready,
            status: 'BLOCKED_RUNTIME',
            blockers: ['Missing model'],
          }),
          close: () => {},
        },
      });
      s = await service.voiceAction(s.id, itemId, {
        revision: s.revision,
        action: 'APPROVE_SPOKEN',
      });
      s = await service.voiceAction(s.id, itemId, {
        revision: s.revision,
        action: 'GENERATE',
      });
      expect(s.voiceJobs?.slice(-1)[0]?.status).toBe('ERROR');
      expect((await service.report(s.id, 'VOICE')).report.status).toBe(
        'BLOCKED_RUNTIME',
      );
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });
});
