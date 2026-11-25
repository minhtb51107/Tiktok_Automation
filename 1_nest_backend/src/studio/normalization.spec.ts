import { describe, it, expect, jest } from '@jest/globals';
import { promises as fs } from 'fs';
import * as os from 'os';
import * as path from 'path';
import { labelledCounts } from './metadata-fields';
import {
  validateNormalization,
  NORMALIZATION_RULES,
  normalizeText,
} from './normalization';
import type { ContentAiProvider } from '../data-engine/ai-provider';
import { offlineNormalize } from './offline-normalization';
import { StudioService } from './studio.service';
import { prepareEditor } from './editor-adapter';
import { seriousDraftAssets } from './public-assets';
import { ScraperService } from '../modules/core/scraper/scraper.service';
describe('normalization and metadata', () => {
  it('maps labelled counts, preserving rounded evidence and distinct missing states', () => {
    const fields = labelledCounts([
      { label: 'Chia sẻ', text: 'Chia sẻ147' },
      { label: 'Đăng lại', text: 'Đăng lại39' },
      { label: 'Thích', text: 'Thích3,5K' },
      { label: 'Bình luận', text: 'Bình luận49' },
    ]);
    expect(fields.likeCount.value).toBe(3500);
    expect(fields.likeCount.approximate).toBe(true);
    expect(fields.replyCount.value).toBe(49);
    expect(fields.repostCount.value).toBe(39);
    expect(fields.shareCount.value).toBe(147);
    expect(
      labelledCounts([{ label: 'Thích', text: 'Thích' }]).likeCount.status,
    ).toBe('NOT_PRESENT');
    expect(labelledCounts([]).likeCount.status).toBe('UNAVAILABLE');
    expect(
      labelledCounts([{ label: 'Thích', text: 'Thích??' }]).likeCount.status,
    ).toBe('UNVERIFIED');
  });
  it('validates identity and flags ambiguous words without rewriting them', () => {
    const base = {
      itemId: 'x',
      proposedSpokenText: 't không biết clm đcđ',
      changes: [{ before: 'ko', after: 'không', reason: 'abbreviation' }],
      ambiguousTerms: [],
      warnings: [],
    };
    expect(
      validateNormalization(base, 'x', 't ko biết clm đcđ').ambiguousTerms.map(
        (a) => a.term,
      ),
    ).toEqual(['t', 'clm', 'đcđ']);
    expect(() =>
      validateNormalization(
        { ...base, itemId: 'other' },
        'x',
        't ko biết clm đcđ',
      ),
    ).toThrow();
    expect(() =>
      validateNormalization(
        { ...base, proposedSpokenText: 'tôi không biết' },
        'x',
        't ko biết clm đcđ',
      ),
    ).toThrow();
    expect(NORMALIZATION_RULES).toContain('untrusted source data');
    expect(() =>
      validateNormalization(
        {
          itemId: 'x',
          proposedSpokenText: 'công ty trả 20 triệu',
          changes: [{ before: 'cty', after: 'công ty', reason: 'expand' }],
          ambiguousTerms: [],
          warnings: [],
        },
        'x',
        'cty trả 10 triệu',
      ),
    ).toThrow('protected source facts');
  });
  it('uses the shared provider contract, records validation and never persists reasoning', async () => {
    const outcomes: unknown[] = [];
    const provider: ContentAiProvider = {
      name: 'HUGGING_FACE',
      config: () => ({
        model: 'Qwen/Qwen3-14B',
        provider: 'auto',
        timeoutMs: 60000,
        maxTokens: 2048,
        requestBudget: 5,
        tokenBudget: 10000,
        costBudgetUsd: 0.1,
        credential: 'present',
        reasoningMode: 'DISABLED',
      }),
      completeJson: async () => ({
        ledgerId: 'ledger-normalization',
        provider: 'HUGGING_FACE',
        model: 'Qwen/Qwen3-14B',
        providerRoute: 'auto',
        content: JSON.stringify({
          itemId: 'item',
          proposedSpokenText: 'công ty không tuyển',
          changes: [
            { before: 'cty', after: 'công ty', reason: 'abbreviation' },
            { before: 'ko', after: 'không', reason: 'teencode' },
          ],
          ambiguousTerms: [],
          warnings: [],
        }),
        usage: {
          inputTokens: 20,
          outputTokens: 30,
          totalTokens: 50,
          estimatedCostUsd: 0.0001,
          costSource: 'PROVIDER_REPORTED',
        },
        latencyMs: 10,
        requestId: 'provider-request',
        finishReason: 'stop',
      }),
      recordValidationOutcome: (...args) => outcomes.push(args),
    };
    const result = await normalizeText(
      {
        id: 'item',
        revision: 2,
        originalText: 'cty ko tuyển',
        spokenText: 'cty ko tuyển',
      },
      provider,
    );
    expect(result.model).toBe('Qwen/Qwen3-14B');
    expect(result.proposedSpokenText).toBe('công ty không tuyển');
    expect(result.tokenUsage.total).toBe(50);
    expect(result.estimatedCost).toBe(0.0001);
    expect(outcomes).toEqual([['ledger-normalization', 'VALIDATED']]);
    expect(JSON.stringify(result)).not.toContain('reasoning');
  });
  it('normalizes only the spoken projection with the versioned social dictionary', () => {
    const original =
      'Trong kcn, cty fdi tuyển qa, hr, xnk; t chưa làm sx bh nên k biết.';
    const result = offlineNormalize({
      id: 'sample',
      revision: 0,
      originalText: original,
      spokenText: original,
    });
    expect(result.originalText).toBe(original);
    expect(result.proposedSpokenText).toBe(
      'Trong khu công nghiệp, công ty ép đi ai tuyển kiu ây, nhân sự, xuất nhập khẩu; t chưa làm sản xuất bao giờ nên không biết.',
    );
    expect(result.ambiguousTerms.map((row) => row.term)).toEqual(['t']);
  });
  it('persists proposals, isolates accept/reject and honors manual locks without any network', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'studio-normalize-'));
    const service = new StudioService({} as ScraperService);
    let calls = 0;
    Object.assign(service, {
      root,
      normalize: async (item: any) => {
        calls++;
        return {
          runId: 'mock-' + calls,
          itemId: item.id,
          baseRevision: item.revision,
          inputText: item.spokenText,
          originalText: item.originalText,
          proposedSpokenText: item.spokenText.replace('ko', 'không'),
          changes: [{ before: 'ko', after: 'không', reason: 'offline test' }],
          ambiguousTerms: [],
          warnings: ['OFFLINE TEST MOCK'],
          error: null,
          approval: 'PENDING',
          decidedAt: null,
          provider: 'OFFLINE MOCK',
          model: 'test',
          startedAt: '2026-10-31T00:00:00Z',
          completedAt: '2026-10-31T00:00:00Z',
          latencyMs: 0,
          tokenUsage: { input: null, output: null, total: null },
          estimatedCost: null,
        };
      },
    });
    try {
      let s = await service.create();
      s = await service.mutate(s.id, {
        revision: s.revision,
        manual: { text: 'ko đi', author: 'A', comments: 'ko biết' },
      });
      s = await service.mutate(s.id, {
        revision: s.revision,
        title: s.title,
        items: s.items.map((i) => ({ ...i, selected: true })),
      });
      expect(calls).toBe(0);
      const other = JSON.stringify(s.items[1]);
      const original = JSON.stringify(s.items[0].rawExtraction);
      s = await service.propose(s.id, s.items[0].id, s.revision);
      expect(s.items[0].spokenText).toBe('ko đi');
      expect(calls).toBe(1);
      s = await service.decide(s.id, 'mock-1', s.revision, 'ACCEPT');
      expect(s.items[0].spokenText).toBe('không đi');
      expect(JSON.stringify(s.items[1])).toBe(other);
      expect(JSON.stringify(s.items[0].rawExtraction)).toBe(original);
      s = await service.propose(s.id, s.items[0].id, s.revision);
      await expect(
        service.decide(s.id, 'mock-2', s.revision, 'ACCEPT'),
      ).rejects.toThrow('manually locked');
      s = await service.decide(s.id, 'mock-2', s.revision, 'REJECT');
      s = await service.propose(s.id, s.items[0].id, s.revision);
      s = await service.decide(s.id, 'mock-3', s.revision, 'ACCEPT_LOCKED');
      expect(s.items[0].manualLocks).toContain('NARRATION_TEXT');
      expect(s.scriptProposals?.[2].explicitLockedTextApproval).toBe(true);
      expect((await service.load(s.id)).scriptProposals?.[1].approval).toBe(
        'REJECTED',
      );
      expect(
        (await service.report(s.id, 'SCRIPT')).report.script?.[0].approval,
      ).toBe('ACCEPTED');
      expect(JSON.stringify(s.items[1])).toBe(other);
      expect(s.items[0].originalText).toBe('ko đi');
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });
  it('applies deterministic normalization idempotently for an automatic DRAFT without claiming user approval', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'auto-normalize-'));
    const service = new StudioService({} as ScraperService);
    Object.assign(service, { root });
    try {
      let s = await service.create();
      s = await service.mutate(s.id, {
        revision: s.revision,
        manual: {
          text: 'cty tuyển vp nhưng k biết bh',
          author: 'Nguồn thật',
          comments: '',
        },
      });
      const original = s.items[0].originalText;
      s = await service.normalizeAutomaticDraft(s.id, s.revision);
      expect(s.items[0].spokenText).toBe(
        'công ty tuyển văn phòng nhưng không biết bh',
      );
      expect(s.items[0].originalText).toBe(original);
      expect(s.items[0].displayText).toBe(original);
      expect(s.items[0].manualLocks).not.toContain('NARRATION_TEXT');
      expect(s.items[0].automaticNormalization).toMatchObject({
        policyVersion: 'vi-speech-policy/3',
        dictionaryVersion: 'vi-social-speech/3',
        changed: true,
        ambiguousTerms: ['bh'],
      });
      expect(s.items[0].automaticNormalization?.ttsInputHash).toMatch(
        /^[a-f0-9]{64}$/,
      );
      expect(
        s.items[0].automaticNormalization?.normalizationChanges?.length,
      ).toBeGreaterThan(0);
      expect(s.scriptProposals?.[0]).toMatchObject({
        approval: 'ACCEPTED',
        decisionSource: 'AUTOMATIC_POLICY',
      });
      const proposalCount = s.scriptProposals?.length;
      s = await service.normalizeAutomaticDraft(s.id, s.revision);
      expect(s.scriptProposals).toHaveLength(proposalCount!);
      expect(s.items[0].spokenText).toBe(
        'công ty tuyển văn phòng nhưng không biết bh',
      );
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });
  it('attaches existing local gameplay and lofi to an automatic SERIOUS DRAFT without granting rights', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'auto-media-'));
    const service = new StudioService({} as ScraperService);
    Object.assign(service, { root });
    const assets = [
      {
        id: 'pub-gameplay',
        name: 'user_gameplay.mp4',
        relativePath: 'backgrounds/user_gameplay.mp4',
        uri: '/api/studio/public-assets/pub-gameplay',
        category: 'BACKGROUND',
        kind: 'VIDEO',
        usage: 'SERIOUS_GAMEPLAY',
        bytes: 100,
      },
      {
        id: 'pub-lofi',
        name: 'lofi.mp3',
        relativePath: 'bgm/lofi.mp3',
        uri: '/api/studio/public-assets/pub-lofi',
        category: 'BGM',
        kind: 'AUDIO',
        bytes: 100,
      },
    ] as any[];
    service.publicAssets.inventory = jest.fn(async () => assets);
    service.publicAssets.resolve = jest.fn(async (id: string) => ({
      ...assets.find((asset) => asset.id === id),
      durationMs: id === 'pub-gameplay' ? 133867 : 185644,
      width: id === 'pub-gameplay' ? 720 : undefined,
      height: id === 'pub-gameplay' ? 1280 : undefined,
    }));
    try {
      let s = await service.create();
      s = await service.mutate(s.id, {
        revision: s.revision,
        manual: { text: 'Nội dung thật', author: 'Nguồn', comments: '' },
      });
      const original = s.items[0].originalText;
      s = await service.applyAutomaticSeriousAssets(s.id, s.revision);
      expect(s.editor?.backgroundTracks?.[0]).toMatchObject({
        assetId: 'pub-gameplay',
        loop: true,
        durationMs: 133867,
      });
      expect(s.editor?.backgroundMusic).toMatchObject({
        assetId: 'pub-lofi',
        enabled: true,
        volume: 0.06,
        ducking: true,
      });
      expect(s.editor?.scenes[0].visual?.card.appearance).toBe('DARK');
      expect(s.mediaRights?.['pub-gameplay'].status).toBe('UNKNOWN');
      expect(s.mediaRights?.['pub-lofi'].status).toBe('UNKNOWN');
      expect(s.items[0].originalText).toBe(original);
      const revision = s.revision;
      s = await service.applyAutomaticSeriousAssets(s.id, s.revision);
      expect(s.revision).toBe(revision);
      expect(s.editor?.backgroundTracks).toHaveLength(1);
      const library = await Promise.all(assets.map(asset => service.publicAssets.resolve(asset.id)));
      const timed = prepareEditor(s, library);
      const fitted = timed.project.backgroundTracks![0];
      expect(fitted.durationMs).toBe(Math.ceil(timed.project.timeline!.totalFrames * 1000 / 30));
      expect(fitted.loop).toBe(false);
      // A short source loops across the measured timeline without moving scene boundaries.
      const short = structuredClone(s);
      short.editor!.backgroundTracks![0].sourceOutMs = 1000;
      short.editor!.backgroundTracks![0].durationMs = 1000;
      const loop = prepareEditor(short, library);
      expect(loop.project.backgroundTracks![0]).toMatchObject({
        durationMs: fitted.durationMs, loop: true, sourceOutMs: 1000,
      });
      expect(loop.project.timeline).toEqual(timed.project.timeline);
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });
  it('blocks missing gameplay for the preset and preserves an explicit OFF', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'studio-gameplay-off-'));
    const service = new StudioService({} as ScraperService);
    Object.assign(service, {root});
    service.publicAssets.inventory = jest.fn(async () => []);
    try {
      const s = await service.create();
      await expect(service.applyAutomaticSeriousAssets(s.id,s.revision)).rejects.toThrow('GAMEPLAY_ASSET_UNAVAILABLE');
      const off = await service.applyAutomaticSeriousAssets(s.id,s.revision,'OFF');
      expect(off.editor?.automaticGameplay).toBe('OFF');
      expect((await service.applyAutomaticSeriousAssets(s.id,off.revision)).revision).toBe(off.revision);
      await expect(service.applyAutomaticSeriousAssets(s.id,off.revision,'PRESET')).rejects.toThrow('GAMEPLAY_ASSET_UNAVAILABLE');
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });
  it('uses gameplay registry metadata and an explicit list of asset IDs', () => {
    const clip = (id: string, usage?: 'SERIOUS_GAMEPLAY') => ({
      id, name:id + '.mp4', relativePath:'backgrounds/' + id + '.mp4',
      uri:'/api/studio/public-assets/' + id, category:'BACKGROUND' as const,
      kind:'VIDEO' as const, bytes:1234, usage,
    });
    const entries = [clip('source_1'), clip('source_4','SERIOUS_GAMEPLAY'), clip('source_8','SERIOUS_GAMEPLAY')];
    expect(seriousDraftAssets(entries).gameplay.map(row=>row.id)).toEqual(['source_4','source_8']);
    expect(seriousDraftAssets(entries,['source_8','source_4']).gameplay.map(row=>row.id)).toEqual(['source_8','source_4']);
    expect(seriousDraftAssets(entries,['missing']).gameplay).toEqual([]);
  });
});
