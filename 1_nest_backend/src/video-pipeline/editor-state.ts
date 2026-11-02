import type { StudioSession } from '../studio/studio.contracts';
import type { EditorSettings } from '../studio/editor.types';
import {
  defaultSceneVisual,
  defaultBgm,
  normalizeVisual,
} from './scene-visual';
export function editorSettings(s: StudioSession): EditorSettings {
  const selected = s.items
    .filter((i) => i.selected)
    .sort((a, b) => a.order - b.order);
  const byId = new Map(selected.map((i) => [i.id, i]));
  const prior = (s.editor?.scenes || [])
    .filter((x) => byId.has(x.itemId))
    .map((x) => ({ ...x, visual: normalizeVisual(x.visual) }));
  return {
    backgroundId: s.editor?.backgroundId ?? null,
    backgroundTracks:s.editor?.backgroundTracks ?? [],
    backgroundMusic: s.editor?.backgroundMusic ?? defaultBgm(),
    scenes: [
      ...prior,
      ...selected
        .filter((i) => !prior.some((x) => x.itemId === i.id))
        .map((i) => ({
          itemId: i.id,
          enabled: true,
          paddingBeforeMs: 200,
          paddingAfterMs: 300,
          silentDurationMs: 3000,
          mediaAssetIds: [],
          visual: defaultSceneVisual(),
        })),
    ],
  };
}
