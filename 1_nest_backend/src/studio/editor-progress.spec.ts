import { describe, it, expect } from '@jest/globals';
import { promises as fs } from 'fs';
import * as os from 'os';
import * as path from 'path';
import { StudioJobs } from './progress';
import { StudioService } from './studio.service';
import { ScraperService } from '../modules/core/scraper/scraper.service';
import {
  prepareEditor,
  editorSettings,
  validateEditor,
} from './editor-adapter';
import { inspectImage } from './studio-media';
import { textHash } from './kokoro-runtime';
const waitFor = async (jobs: StudioJobs, id: string) => {
  for (let i = 0; i < 100; i++) {
    const j = await jobs.load(id);
    if (!['RUNNING', 'QUEUED'].includes(j.status)) return j;
    await new Promise((r) => setTimeout(r, 10));
  }
  throw Error('Job did not finish');
};
describe('Studio editor and persistent progress (OFFLINE)', () => {
  it('deduplicates double submissions, serializes jobs, persists review, fails safely and cancels queued work', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'studio-jobs-'));
    const jobs = new StudioJobs(root);
    const sessionId = '12345678-1234-1234-1234-123456789012';
    let calls = 0,
      inflight = 0,
      max = 0;
    try {
      let release!: () => void;
      const gate = new Promise<void>((r) => (release = r));
      const run = async (tick: any) => {
        calls++;
        inflight++;
        max = Math.max(max, inflight);
        await tick('Synthesizing');
        await gate;
        inflight--;
        return { revision: 2, review: true };
      };
      const [a, b] = await Promise.all([
        jobs.submit(sessionId, 'voice', { revision: 1 }, run),
        jobs.submit(sessionId, 'voice', { revision: 1 }, run),
      ]);
      expect(a.jobId).toBe(b.jobId);
      const c = await jobs.submit(
        sessionId,
        'preview',
        { revision: 2 },
        async () => {
          throw Error('should not run');
        },
      );
      await jobs.cancel(c.jobId);
      release();
      expect((await waitFor(jobs, a.jobId)).status).toBe('WAITING_REVIEW');
      expect((await waitFor(jobs, c.jobId)).status).toBe('CANCELLED');
      expect(calls).toBe(1);
      expect(max).toBe(1);
      expect((await new StudioJobs(root).load(a.jobId)).status).toBe(
        'WAITING_REVIEW',
      );
      const fail = await jobs.submit(
        sessionId,
        'preview',
        { revision: 3 },
        async () => {
          throw Error('Bad input');
        },
      );
      expect((await waitFor(jobs, fail.jobId)).status).toBe('FAILED');
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });
  it('maps real-style selected items by ID, measured audio and metadata; preserves originals and rejects truncation/foreign assets', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'studio-editor-'));
    const service = new StudioService({} as ScraperService);
    Object.assign(service, { root });
    try {
      let s = await service.create();
      for (const text of ['Nội dung một.', 'Nội dung hai.'])
        s = await service.mutate(s.id, {
          revision: s.revision,
          manual: { text, author: 'Author', comments: '' },
        });
      const i = s.items[0],
        hash = textHash(i.spokenText);
      i.spokenApproval = {
        textHash: hash,
        revision: i.revision,
        valid: true,
        approvedAt: new Date().toISOString(),
      };
      i.voiceSettings = { voice: 'my_yen', speed: 1.2 };
      s.voiceAssets = [
        {
          id: 'audio',
          itemId: i.id,
          itemRevision: i.revision,
          textHash: hash,
          spokenText: i.spokenText,
          voice: 'my_yen',
          speed: 1.2,
          model: 'Kokoro',
          modelVersion: 'test',
          cacheKey: 'test',
          durationMs: 2233,
          filePath: 'unused',
          uri: '/audio',
          createdAt: new Date().toISOString(),
          approvedAt: null,
          status: 'GENERATED',
          cacheHit: false,
        },
      ];
      const original = JSON.stringify(s.items);
      s.editor = editorSettings(s);
      s.editor.scenes.reverse();
      const out = prepareEditor(s);
      expect(out.project.audioAssets[0].approvalStatus).toBe('PENDING');
      expect(out.project.storyboard.filter(scene=>scene.audioAssetId).every(scene=>out.project.audioAssets.some(a=>a.id===scene.audioAssetId))).toBe(true);
      const timeline = out.preview.request.inputProps.timeline;
      expect(timeline.scenes.map((x) => x.scene.id)).toEqual(
        s.items.map((i) => i.id).reverse(),
      );
      expect(out.preview.missingAudioItemIds).toEqual([s.items[1].id]);
      const audioScene = timeline.scenes.find((x) => x.scene.id === i.id)!;
      expect(audioScene.audioEndFrame! - audioScene.audioStartFrame!).toBe(
        Math.ceil((2233 * 30) / 1000),
      );
      expect(audioScene.contentEndFrame).toBeGreaterThanOrEqual(
        audioScene.audioEndFrame!,
      );
      expect(JSON.stringify(s.items)).toBe(original);
      expect(() => validateEditor(s, { scenes: [] })).toThrow();
      s.editor.scenes[0].mediaAssetIds = ['other-session'];
      expect(() => validateEditor(s, s.editor!)).toThrow();
      s.editor.scenes[0].mediaAssetIds = [];
      i.spokenText += ' edited';
      expect(prepareEditor(s).preview.missingAudioItemIds).toContain(i.id);
      const saved = await service.saveEditor(s.id, {
        revision: s.revision,
        settings: editorSettings(s),
        displayEdits: { [i.id]: 'Display only' },
      });
      expect(saved.items[0].originalText).toBe('Nội dung một.');
      expect(saved.items[0].manualLocks).toContain('DISPLAY_TEXT');
      await expect(
        service.saveEditor(s.id, {
          revision: s.revision,
          settings: editorSettings(s),
        }),
      ).rejects.toThrow('Project changed');
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });
  it('validates image signatures, dimensions, format and bounded size', () => {
    const png = Buffer.alloc(24);
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).copy(png);
    png.writeUInt32BE(80, 16);
    png.writeUInt32BE(60, 20);
    expect(inspectImage(png)).toMatchObject({
      extension: 'png',
      width: 80,
      height: 60,
    });
    expect(() => inspectImage(Buffer.from('<svg>unsafe</svg>'))).toThrow();
    png.writeUInt32BE(9000, 16);
    expect(() => inspectImage(png)).toThrow();
  });
});
