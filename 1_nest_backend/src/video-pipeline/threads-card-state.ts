import type { MediaAsset, TimelineScene } from './contracts';
import { cardPages, normalizeVisual } from './scene-visual';

/** Shared by the card painter and the sparse render planner. Frame is scene-local. */
export function threadsCardState(item: TimelineScene, media: MediaAsset[], fps: number) {
  const visual = normalizeVisual(item.scene.visual);
  const card = visual.card;
  const attachments = media.filter(asset => asset.id.startsWith('source-') && asset.kind !== 'VIDEO');
  const height = attachments.length ? Math.min(700, Math.max(...attachments.map(asset =>
    asset.width && asset.height
      ? (card.width - 2 * card.padding) * card.scale / attachments.length * asset.height / asset.width
      : 180,
  ))) : 0;
  const layout = cardPages(item.scene.displayText, visual, attachments.length, height);
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
