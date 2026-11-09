import { describe, it, expect } from '@jest/globals';
import {
  cardPages,
  defaultSceneVisual,
  normalizeVisual,
  textWidth,
} from '../video-pipeline/scene-visual';
import { validateVisual } from './editor-visual';
import { buildStudioPreview } from '../video-pipeline/studio-preview';
import { prepareEditor } from './editor-adapter';
import { editorSettings } from '../video-pipeline/editor-state';
import { StudioService } from './studio.service';
import { ScraperService } from '../modules/core/scraper/scraper.service';
import { promises as fs } from 'fs';
import * as path from 'path';
import * as os from 'os';

describe('Editor UX shared contracts (OFFLINE)', () => {
  it('wraps Vietnamese by glyph width, preserves paragraphs and fills useful card width', () => {
    const v = defaultSceneVisual();
    const text =
      'Mọi người có thấy thị trường lao động ở Việt Nam đang bị điên không?';
    const out = cardPages(text, v);
    const lines = out.pages.join('\n').split('\n');
    expect(lines.join(' ')).toBe(text);
    expect(lines.length).toBe(2);
    expect(textWidth(lines[0], out.font)).toBeGreaterThan(700);
    expect(lines.every((line) => textWidth(line, out.font) <= 816)).toBe(true);
    expect(cardPages('Một dòng.\n\nMột đoạn khác.', v).pages[0]).toContain(
      '\n\n',
    );
  });
  it('paginates long text without clipping or losing words and merges older saved layouts', () => {
    const v = normalizeVisual({
      card: { ...defaultSceneVisual().card, lineHeight: 1.8 },
    });
    v.meme.enabled = true;
    const text = Array(400)
      .fill('Công việc ở Thành phố Hồ Chí Minh.')
      .join(' ');
    const out = cardPages(text, v);
    expect(out.pages.length).toBeGreaterThan(1);
    expect(out.pages.join(' ').replace(/\s+/g, ' ')).toBe(text);
    expect(
      v.card.y + out.height + v.meme.height + v.meme.gap,
    ).toBeLessThanOrEqual(1920);
    expect(normalizeVisual().card.appearance).toBe('LIGHT');
  });
  it('validates and roundtrips independent card appearance/line height; rejects hidden overflow', () => {
    const v = defaultSceneVisual();
    v.card.appearance = 'DARK';
    v.card.lineHeight = 1.7;
    expect(validateVisual(JSON.parse(JSON.stringify(v)), () => true)).toEqual(
      v,
    );
    expect(() =>
      validateVisual(
        { ...v, card: { ...v.card, lineHeight: 0.4 } },
        () => true,
      ),
    ).toThrow();
    expect(() =>
      validateVisual({ ...v, card: { ...v.card, x: 900 } }, () => true),
    ).toThrow();
  });
  it('shares one mapping/timeline between browser drafts and backend; disables scenes without changing source', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'editor-ux-'));
    const service = new StudioService({} as ScraperService);
    Object.assign(service, { root });
    try {
      let s = await service.create();
      for (const text of ['Nội dung một.', 'Nội dung hai.'])
        s = await service.mutate(s.id, {
          revision: s.revision,
          manual: { text, author: 'Author', comments: '' },
        });
      const before = JSON.stringify(s);
      expect(buildStudioPreview(s)).toEqual(prepareEditor(s));
      expect(JSON.stringify(s)).toBe(before);
      s.editor = editorSettings(s);
      s.editor.scenes[0].enabled = false;
      s.editor.scenes[1].visual!.card.appearance = 'DARK';
      const out = buildStudioPreview(s);
      expect(out.project.timeline!.scenes.map((t) => t.scene.id)).toEqual([
        s.items[1].id,
      ]);
      expect(
        out.project.timeline!.scenes[0].scene.visual!.card.appearance,
      ).toBe('DARK');
      expect(out.preview.missingAudioItemIds).toEqual([s.items[1].id]);
      expect(s.items.map((i) => i.originalText)).toEqual([
        'Nội dung một.',
        'Nội dung hai.',
      ]);
    } finally {
      await fs.rm(root, { recursive: true });
    }
  });
});
