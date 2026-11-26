import type { MediaAsset, TimelineScene } from './contracts';
import { cardPages, normalizeVisual } from './scene-visual';

/** Shared by the card painter and the sparse render planner. Frame is scene-local. */
export function threadsCardState(item: TimelineScene, media: MediaAsset[], fps: number) {
  const visual = normalizeVisual(item.scene.visual);
  const card = visual.card;
  const width = card.width * card.scale;
  const desktopScale = width / 640;
  const fontAdjust = card.fontSize === 15 || card.fontSize === 40 ? 1 : card.fontSize / 40;
  const padAdjust = card.padding === 24 || card.padding === 40 ? 1 : card.padding / 40;
  const lineHeight = !card.lineHeight || card.lineHeight === 1.45 ? 1.4 : card.lineHeight;
  const effectiveFont = 15 * desktopScale * fontAdjust;
  const effectivePad = 24 * desktopScale * padAdjust;
  const effectiveVisual = {
    ...visual,
    card: {
      ...card,
      scale: 1,
      width,
      fontSize: effectiveFont,
      padding: effectivePad,
      lineHeight,
    },
  };
  const attachments = media.filter(asset => asset.id.startsWith('source-') && asset.kind !== 'VIDEO');
  const height = attachments.length ? Math.min(700, Math.max(...attachments.map(asset =>
    asset.width && asset.height
      ? (width - 2 * effectivePad) / attachments.length * asset.height / asset.width
      : 180,
  ))) : 0;
  const rawLayout = cardPages(item.scene.displayText, effectiveVisual, attachments.length, height);
  const layout = {
    ...rawLayout,
    pages: rawLayout.pages.length === 1 ? [item.scene.displayText] : rawLayout.pages,
    lineHeight,
    desktopScale,
  };
  const contentStart = item.contentStartFrame - item.startFrame;
  const framesPerPage = Math.max(1, (item.contentEndFrame - item.contentStartFrame) / layout.pages.length);
  const visibleFrom = Math.ceil((card.startMs || 0) * fps / 1000);
  const visibleUntil = card.durationMs === undefined ? Infinity : Math.ceil(((card.startMs || 0) + card.durationMs) * fps / 1000);
  return {
    visual, attachments, layout, contentStart, imageHeight: height,
    at: (frame: number) => ({
      pageIndex: Math.min(layout.pages.length - 1, Math.floor(Math.max(0, frame - contentStart) / framesPerPage)),
      visible: card.enabled !== false && frame >= visibleFrom && frame < visibleUntil,
    }),
  };
}
