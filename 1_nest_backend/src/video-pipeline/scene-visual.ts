import { ARIAL_METRICS } from './arial-metrics';
export interface SceneVisual {
  card: {
    enabled?:boolean;
    startMs?:number;
    durationMs?:number;
    x: number;
    y: number;
    width: number;
    scale: number;
    padding: number;
    fontSize: number;
    gap: number;
    lineHeight?: number;
    appearance?: 'LIGHT' | 'DARK';
  };
  meme: {
    lockAspect?:boolean;
    enabled: boolean;
    assetId: string | null;
    width: number;
    height: number;
    gap: number;
    x: number | null;
    y: number | null;
    startMs: number;
    durationMs: number;
  };
  backgroundOverride?:boolean;
  voiceStartMs?:number;
  voiceSourceInMs?:number;
  voiceDurationMs?:number;
  backgroundId: string | null;
  voiceEnabled: boolean;
  voiceVolume: number;
  sfx: {
    enabled: boolean;
    assetId: string | null;
    volume: number;
    startMs: number;
    durationMs?:number;
    sourceInMs?:number;
  };
  bgmEnabled: boolean;
}
export interface BackgroundMusic {
  sourceInMs?:number;
  durationMs?:number;
  enabled: boolean;
  assetId: string | null;
  volume: number;
  startMs: number;
}
export function defaultSceneVisual(): SceneVisual {
  return {
    card: {
      x: 90,
      y: 288,
      width: 900,
      scale: 1,
      padding: 40,
      fontSize: 40,
      gap: 22,
      lineHeight: 1.45,
      appearance: 'LIGHT',
    },
    meme: {
      enabled: false,
      assetId: null,
      width: 520,
      height: 300,
      gap: 32,
      x: null,
      y: null,
      startMs: 0,
      durationMs: 3000,
    },
    backgroundId: null,
    voiceEnabled: true,
    voiceVolume: 1,
    sfx: { enabled: false, assetId: null, volume: 0.25, startMs: 0 },
    bgmEnabled: true,
  };
}
export const defaultBgm = (): BackgroundMusic => ({
  enabled: false,
  assetId: null,
  volume: 0.08,
  startMs: 0,
});
export function dateLabel(value: string | null | undefined): string | null {
  if (!value) return null;
  if (/^\d{2}\/\d{2}\/\d{4}$/.test(value)) return value;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Ho_Chi_Minh',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  }).format(d);
}
export function normalizeVisual(value?: Partial<SceneVisual>): SceneVisual {
  const d = defaultSceneVisual();
  return {
    ...d,
    ...value,
    card: { ...d.card, ...value?.card },
    meme: { ...d.meme, ...value?.meme },
    sfx: { ...d.sfx, ...value?.sfx },
  };
}
export function textWidth(text: string, font: number): number {
  return (
    Array.from(text.normalize('NFC')).reduce(
      (sum, c) =>
        sum + (/[\u0300-\u036f]/.test(c) ? 0 : (ARIAL_METRICS[c] ?? 1)),
      0,
    ) * font
  );
}
// Shared measured glyph advances, not a character-count width heuristic.
export function cardPages(
  text: string,
  visual: SceneVisual,
  sourceMediaCount = 0,
) {
  const { card, meme } = visual,
    width = card.width * card.scale,
    font = card.fontSize * card.scale,
    pad = card.padding * card.scale;
  const room = 1920 - card.y - 48 - (meme.enabled ? meme.height + meme.gap : 0);
  const mediaHeight = sourceMediaCount ? 180 : 0,
    headerFooter = 220 + pad * 2 + mediaHeight;
  const usableWidth = Math.max(1, width - pad * 2 - 4),
    lineHeight = card.lineHeight ?? 1.45;
  const linesPerPage = Math.max(
    1,
    Math.floor((room - headerFooter) / (font * lineHeight)),
  );
  const lines: string[] = [];
  for (const paragraph of text.split('\n')) {
    let line = '';
    for (const token of paragraph.split(/\s+/).filter(Boolean)) {
      const parts = Array.from(token);
      while (textWidth(parts.join(''), font) > usableWidth) {
        if (line) {
          lines.push(line);
          line = '';
        }
        let chunk = '';
        while (parts.length && textWidth(chunk + parts[0], font) <= usableWidth)
          chunk += parts.shift();
        if (!chunk) chunk = parts.shift()!;
        lines.push(chunk);
      }
      const word = parts.join('');
      if (line && textWidth(line + ' ' + word, font) > usableWidth) {
        lines.push(line);
        line = word;
      } else line += (line ? ' ' : '') + word;
    }
    lines.push(line);
  }
  const pages: string[] = [];
  for (let i = 0; i < lines.length; i += linesPerPage)
    pages.push(lines.slice(i, i + linesPerPage).join('\n'));
  const count = Math.min(linesPerPage, lines.length),
    height = headerFooter + count * font * lineHeight;
  return {
    pages: pages.length ? pages : [''],
    height,
    room,
    width,
    font,
    pad,
    linesPerPage,
    invalid: room < headerFooter + font * lineHeight,
  };
}
