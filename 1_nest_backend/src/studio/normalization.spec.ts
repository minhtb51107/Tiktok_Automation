import { describe, it, expect } from '@jest/globals';
import { promises as fs } from 'fs';
import * as os from 'os';
import * as path from 'path';
import { labelledCounts } from './metadata-fields';
import { validateNormalization, NORMALIZATION_RULES } from './normalization';
import { StudioService } from './studio.service';
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
});
