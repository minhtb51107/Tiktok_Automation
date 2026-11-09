import {validateRange} from '../video-pipeline/editing';
import { buildStudioPreview } from '../video-pipeline/studio-preview';
import { BadRequestException } from '@nestjs/common';
import type { StudioSession } from './studio.contracts';
import type { EditorSettings } from './editor.types';
import { validateVisual, validateBgm } from './editor-visual';
import type { LibraryAsset } from './public-assets';

export { editorSettings } from '../video-pipeline/editor-state';
export function validateEditor(
  s: StudioSession,
  body: EditorSettings,
  library: LibraryAsset[] = [],
): EditorSettings {
  const ids = s.items.filter((i) => i.selected).map((i) => i.id);
  const knownBackground = (id: string) =>
    s.studioMedia?.some((a) => a.id === id && ['IMAGE','GIF','VIDEO'].includes(a.kind)) ||
    library.some(
      (a) => a.id === id && ['IMAGE', 'GIF', 'VIDEO'].includes(a.kind),
    );
  if (body?.backgroundId && !knownBackground(body.backgroundId))
    throw new BadRequestException('Unknown background asset');
  if (
    !Array.isArray(body?.scenes) ||
    body.scenes.length !== ids.length ||
    new Set(body.scenes.map((x) => x.itemId)).size !== ids.length
  )
    throw new BadRequestException(
      'Editor must retain every selected item exactly once',
    );
  for (const x of body.scenes) {
    const v = x.visual;
    if (v?.backgroundId && !knownBackground(v.backgroundId))
      throw new BadRequestException('Invalid scene background');
    if (
      v?.sfx.assetId &&
      !library.some((a) => a.id === v.sfx.assetId && a.category === 'SFX') && !s.studioMedia?.some(a=>a.id===v.sfx.assetId&&a.category==='SFX')
    )
      throw new BadRequestException('Invalid SFX asset');
    if (
      v?.meme.assetId &&
      !s.studioMedia?.some((a) => a.id === v.meme.assetId) &&
      !library.some(
        (a) => a.id === v.meme.assetId && ['IMAGE', 'GIF'].includes(a.kind),
      )
    )
      throw new BadRequestException('Invalid meme asset');
    if (!ids.includes(x.itemId) || typeof x.enabled !== 'boolean')
      throw new BadRequestException('Invalid editor scene');
    for (const n of [x.paddingBeforeMs, x.paddingAfterMs, x.silentDurationMs])
      if (!Number.isInteger(n) || n < 0 || n > 30000)
        throw new BadRequestException(
          'Timing must be integer milliseconds, 0–30000',
        );
    if (x.silentDurationMs < 100)
      throw new BadRequestException(
        'Visual-only duration must be at least 100ms',
      );
    if (
      !Array.isArray(x.mediaAssetIds) ||
      x.mediaAssetIds.length > 5 ||
      x.mediaAssetIds.some(
        (id) =>
          !s.studioMedia?.some((a) => a.id === id) &&
          !library.some(
            (a) => a.id === id && ['IMAGE', 'GIF'].includes(a.kind),
          ),
      )
    )
      throw new BadRequestException('Unknown local media');
  }
  const tracks=body.backgroundTracks??s.editor?.backgroundTracks??[];
  if(!Array.isArray(tracks)||tracks.length>20||new Set(tracks.map(t=>t.id)).size!==tracks.length)throw new BadRequestException('Invalid background tracks');
  for(const c of tracks){const a=library.find(a=>a.id===c.assetId)||s.studioMedia?.find(a=>a.id===c.assetId);if(!a||!['IMAGE','VIDEO'].includes(a.kind)||typeof c.enabled!=='boolean'||!/^bg-[a-zA-Z0-9-]+$/.test(c.id))throw new BadRequestException('Invalid background clip');try{validateRange(c,a.durationMs);}catch(e){throw new BadRequestException((e as Error).message);}}
  return {
    backgroundTracks:structuredClone(tracks),
    backgroundId: body.backgroundId ?? null,
    backgroundMusic: validateBgm(body.backgroundMusic, (id) =>
      library.some((a) => a.id === id && a.category === 'BGM') || !!s.studioMedia?.some(a=>a.id===id&&a.category==='BGM'),
    ),
    scenes: body.scenes.map((x) => ({
      itemId: x.itemId,
      enabled: x.enabled,
      paddingBeforeMs: x.paddingBeforeMs,
      paddingAfterMs: x.paddingAfterMs,
      silentDurationMs: x.silentDurationMs,
      mediaAssetIds: [...new Set(x.mediaAssetIds)],
      visual: validateVisual(
        x.visual,
        (id) =>
          s.studioMedia?.some((a) => a.id === id) ||
          library.some((a) => a.id === id),
      ),
    })),
  };
}
export function prepareEditor(s: StudioSession, library: LibraryAsset[] = []) {
  try {
    return buildStudioPreview(s, library);
  } catch (e) {
    throw new BadRequestException(
      e instanceof Error ? e.message : 'Preview preparation failed',
    );
  }
}
