import type { VideoPreviewProps } from './contracts';
import { frameRange } from './editing';
import { threadsCardState } from './threads-card-state';

/** Only the single, full-screen gameplay track and static Threads cards are supported. */
export function planSparseCapture(props: VideoPreviewProps, range: [number, number]) {
  const { timeline, mediaAssets } = props;
  const stop = (reason: string) => ({ supported: false as const, reason });
  const tracks = (props.backgroundTracks ?? []).filter(clip => clip.enabled);
  const background = tracks[0];
  const asset = mediaAssets.find(a => a.id === background?.assetId);
  if (timeline.style !== 'SERIOUS' || tracks.length !== 1 ||
    !asset || asset.kind !== 'VIDEO' || asset.availability !== 'AVAILABLE')
    return stop('SINGLE_SERIOUS_GAMEPLAY_REQUIRED');
  const bounds = frameRange(background.startMs, background.durationMs, timeline.fps);
  if (bounds.start !== 0 || bounds.end < timeline.totalFrames || (background.offsetMs ?? 0) !== 0)
    return stop('GAMEPLAY_COVERAGE_OR_OFFSET');
  const sourceIn = Math.floor(background.sourceInMs * timeline.fps / 1000);
  const sourceOut = Math.ceil(background.sourceOutMs * timeline.fps / 1000);
  const span = sourceOut - sourceIn;
  if (span < 1 || (!background.loop && span < timeline.totalFrames))
    return stop('GAMEPLAY_SOURCE_RANGE');
  const states: {start: number; end: number; capture: number}[] = [];
  const stillImages = new Set<string>();
  let nextScene = 0;
  for (const item of timeline.scenes) {
    const from = item.startFrame, until = from + item.durationInFrames;
    if (from < nextScene || until !== item.endFrame || !item.scene.threadsCard ||
      item.scene.editorial?.kind === 'COMMENTARY' || item.subtitles.length)
      return stop('NONSTATIC_OR_OVERLAPPING_SCENE');
    nextScene = until;
    const sceneAssets = item.scene.mediaAssetIds
      .map(id => mediaAssets.find(a => a.id === id))
      .filter((a): a is NonNullable<typeof a> => a !== undefined);
    const card = threadsCardState(item, sceneAssets, timeline.fps);
    if (card.visual.meme.enabled || card.visual.imageMode === 'PAN' || card.visual.backgroundOverride ||
        sceneAssets.some(a => a.kind !== 'IMAGE'))
      return stop('DYNAMIC_OR_OVERRIDDEN_CARD');
    for (const a of card.attachments) {
      if (a.availability === 'AVAILABLE') stillImages.add(a.uri);
    }
    const avatar = item.scene.threadsCard.avatarUrl;
    if (avatar) stillImages.add(avatar);
    let previous: typeof states[number] | undefined, previousPage = -1;
    for (let frame = Math.max(from, range[0]); frame < Math.min(until, range[1] + 1); frame++) {
      const { visible, pageIndex } = card.at(frame - from);
      if (!visible) continue;
      if (previous?.end === frame && previousPage === pageIndex) previous.end++;
      else {
        previous = { start: frame, end: frame + 1, capture: frame };
        previousPage = pageIndex;
        states.push(previous);
      }
    }
  }
  if (states.length > 32) return stop('TOO_MANY_CARD_STATES');
  return { supported: true as const, states, span, sourceIn, loop: background.loop && span < timeline.totalFrames,
    backgroundId: background.id, stillImages: [...stillImages] };
}
