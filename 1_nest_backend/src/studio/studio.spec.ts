import { StudioService, threadsUrl } from './studio.service';
import { ScraperService } from '../modules/core/scraper/scraper.service';
import { promises as fs } from 'fs';
import * as os from 'os';
import * as path from 'path';
import { describe, it, expect } from '@jest/globals';

describe('Studio source persistence', () => {
  it('retains the first source when the second URL fails', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'studio-batch-'));
    const service = new StudioService({} as ScraperService);
    Object.assign(service, {
      root,
      extract: async (originalUrl: string) => ({
        originalUrl,
        resolvedUrl: originalUrl,
        canonicalUrl: originalUrl,
        matchedTargetId: originalUrl.includes('/@first/') ? 'a' : null,
        matchMethod: 'DOM_PERMALINK',
        contextCandidates: [],
        browserNavigations: 1,
        domCandidates: 1,
        status: originalUrl.includes('/@first/') ? 'PARTIAL' : 'ERROR',
        elapsedMs: 1,
        retrievedAt: new Date().toISOString(),
        redirects: [],
        diagnostics: [
          {
            stage: 'parser',
            code: 'PARTIAL',
            message: 'Public content incomplete',
          },
        ],
        records: originalUrl.includes('/@first/')
          ? [
              {
                text: 'Preserve me',
                author: 'Author',
                handle: null,
                avatar: null,
                createdAt: null,
                type: 'UNKNOWN',
                parentReference: null,
                media: [],
                likeCount: null,
                replyCount: null,
                repostCount: null,
                provenance: { text: 'offline mock' },
              },
            ]
          : [],
      }),
    });
    try {
      let s = await service.create();
      s = await service.mutate(
        s.id,
        {
          revision: s.revision,
          urls: [
            'https://www.threads.com/@first/post/a',
            'https://www.threads.com/@second/post/b',
          ],
        },
        true,
      );
      expect(s.items).toHaveLength(1);
      expect(s.items[0].originalText).toBe('Preserve me');
      expect(s.attempts).toHaveLength(2);
      const result = await service.report(s.id);
      expect(result.report.counts.resolvedTargets).toBe(1);
      expect(result.report.counts.unresolvedTargets).toBe(1);
      expect(result.report.sources[0].matchedTargetId).toBe('a');
      expect(result.report.revision).toBe(s.revision);
      expect(JSON.parse(JSON.stringify(result.report))).toEqual(result.report);
      expect(result.markdown).toContain('Preserve me');
      expect(result.markdown).not.toContain(root);
      s = await service.mutate(s.id, {
        revision: s.revision,
        title: s.title,
        items: s.items.map((i) => ({
          ...i,
          spokenText: 'User locked narration',
        })),
      });
      const before = await fs.readFile(path.join(root, s.id + '.json'), 'utf8');
      const copy = await service.exactCopy(s.id);
      expect(copy.items[0].spokenText).toBe('User locked narration');
      expect(copy.items[0].manualLocks).toContain('NARRATION_TEXT');
      expect(await fs.readFile(path.join(root, s.id + '.json'), 'utf8')).toBe(
        before,
      );
      expect(
        (await service.load(s.id)).items[0].metadata?.likeCount,
      ).toBeNull();
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });
  it('preserves originals, edits and order across reload and reports extraction failure', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'studio-test-'));
    const scraper = {
      scrapeThreadsUrl: async () => {
        throw new Error('offline');
      },
    };
    const service = new StudioService(scraper as unknown as ScraperService);
    Object.assign(service, {
      root,
      extract: async (originalUrl: string) => ({
        originalUrl,
        resolvedUrl: null,
        canonicalUrl: null,
        status: 'ERROR',
        elapsedMs: 1,
        retrievedAt: new Date().toISOString(),
        redirects: [],
        records: [],
        diagnostics: [
          {
            stage: 'browser',
            code: 'BROWSER_MISSING',
            message: 'No browser; preserve existing data',
          },
        ],
      }),
    });
    try {
      let s = await service.create();
      s = await service.mutate(s.id, {
        revision: s.revision,
        manual: {
          text: 'Original post',
          author: 'Author',
          comments: 'First comment\nSecond comment',
        },
      });
      const patches = [...s.items].reverse().map((i) => ({
        ...i,
        selected: true,
        spokenText: 'Edited ' + i.originalText,
        displayText: 'New display',
        originalText: 'ATTACK',
      }));
      s = await service.mutate(s.id, {
        revision: s.revision,
        title: 'Real project',
        items: patches,
      });
      const loaded = await service.load(s.id);
      expect(loaded.items.map((i) => i.originalText)).toEqual([
        'Second comment',
        'First comment',
        'Original post',
      ]);
      expect(
        loaded.items.every(
          (i) =>
            i.selected &&
            i.revision === 1 &&
            i.manualLocks.includes('NARRATION_TEXT'),
        ),
      ).toBe(true);
      expect(loaded.project.posts[0].text).toBe('Original post');
      const edited = loaded.items.map((i) => ({
        ...i,
        metadata: {
          ...i.metadata!,
          author: 'Corrected author',
          handle: 'real_handle',
          avatar: 'https://example.com/avatar.png',
          createdAt: '2026-10-31',
          media: [{ kind: 'IMAGE', url: 'https://example.com/photo.png' }],
        },
      }));
      s = await service.mutate(s.id, {
        revision: s.revision,
        title: s.title,
        items: edited,
      });
      const reopened = await service.load(s.id);
      expect(reopened.items[0].metadata?.author).toBe('Corrected author');
      expect(reopened.items[0].rawExtraction?.author).toBe('Imported comment');
      expect(reopened.items[0].metadata?.media[0].url).toBe(
        'https://example.com/photo.png',
      );
      await expect(
        service.mutate(s.id, { revision: 0, title: 'stale', items: patches }),
      ).rejects.toThrow('Session changed');
      s = await service.mutate(
        s.id,
        {
          revision: s.revision,
          urls: ['https://www.threads.com/@author/post/abc'],
        },
        true,
      );
      expect(s.status).toBe('ERROR');
      expect(s.errors[0]).toContain('preserve existing data');
      expect((await service.list())[0].title).toBe('Real project');
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });
  it('rejects unsafe URL targets', () => {
    expect(
      threadsUrl('https://www.threads.com/share/BmdO69W7tN/?x=1'),
    ).toContain('/share/BmdO69W7tN/');
    for (const url of [
      'http://localhost/x',
      'https://127.0.0.1/x',
      'https://threads.com.evil.test/@a/post/b',
      'https://user@threads.com/@a/post/b',
      'https://threads.com:4430/@a/post/b',
    ])
      expect(() => threadsUrl(url)).toThrow();
  });
});
