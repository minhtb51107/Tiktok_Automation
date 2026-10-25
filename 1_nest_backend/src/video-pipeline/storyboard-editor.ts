import {
  SceneLockedField,
  StoryboardScene,
} from './contracts';
import { AiStoryboardSceneInput } from './ai-storyboard';

export type StoryboardScenePatch = Partial<
  Pick<
    StoryboardScene,
    | 'sourceReferences'
    | 'displayText'
    | 'narrationText'
    | 'voice'
    | 'audioAssetId'
    | 'mediaAssetIds'
    | 'sfxAssetIds'
    | 'subtitles'
    | 'timing'
    | 'styleProperties'
  >
>;

const reindex = (scenes: StoryboardScene[]): StoryboardScene[] =>
  scenes.map((scene, order) => ({ ...scene, order }));

export const editStoryboardScene = (
  scenes: readonly StoryboardScene[],
  sceneId: string,
  patch: StoryboardScenePatch,
  lockFields: readonly SceneLockedField[],
  editedBy: string,
): StoryboardScene[] => {
  let found = false;
  const updated = scenes.map((scene) => {
    if (scene.id !== sceneId) return scene;
    found = true;
    return {
      ...scene,
      ...patch,
      manualOverride: {
        lockedFields: [...new Set([...scene.manualOverride.lockedFields, ...lockFields])],
        revision: scene.manualOverride.revision + 1,
        lastEditedBy: editedBy,
      },
    };
  });
  if (!found) throw new Error(`Storyboard scene not found: ${sceneId}`);
  return updated;
};

export const removeStoryboardScene = (
  scenes: readonly StoryboardScene[],
  sceneId: string,
): StoryboardScene[] => {
  const remaining = scenes.filter((scene) => scene.id !== sceneId);
  if (remaining.length === scenes.length) {
    throw new Error(`Storyboard scene not found: ${sceneId}`);
  }
  return reindex(remaining);
};

export const reorderStoryboardScenes = (
  scenes: readonly StoryboardScene[],
  orderedIds: readonly string[],
): StoryboardScene[] => {
  if (
    orderedIds.length !== scenes.length ||
    new Set(orderedIds).size !== scenes.length
  ) {
    throw new Error('Scene order must contain every scene id exactly once.');
  }
  const byId = new Map(scenes.map((scene) => [scene.id, scene]));
  const ordered = orderedIds.map((id) => {
    const scene = byId.get(id);
    if (!scene) throw new Error(`Unknown scene id in order: ${id}`);
    return scene;
  });
  return reindex(ordered);
};

const locked = (scene: StoryboardScene, field: SceneLockedField): boolean =>
  scene.manualOverride.lockedFields.includes(field);

export const mergeAiSceneProposal = (
  current: StoryboardScene,
  proposal: AiStoryboardSceneInput,
): StoryboardScene => ({
  ...current,
  sourceReferences: locked(current, 'SOURCE_REFERENCES')
    ? current.sourceReferences
    : proposal.sourceReferences,
  displayText: locked(current, 'DISPLAY_TEXT')
    ? current.displayText
    : proposal.displayText,
  narrationText: locked(current, 'NARRATION_TEXT')
    ? current.narrationText
    : proposal.narrationText,
  voice: locked(current, 'VOICE') ? current.voice : proposal.voice,
  audioAssetId: locked(current, 'TIMING')
    ? current.audioAssetId
    : proposal.audioAssetId,
  mediaAssetIds: locked(current, 'MEDIA')
    ? current.mediaAssetIds
    : proposal.mediaAssetIds,
  sfxAssetIds: locked(current, 'SFX')
    ? current.sfxAssetIds
    : proposal.sfxAssetIds,
  subtitles: locked(current, 'SUBTITLES')
    ? current.subtitles
    : proposal.subtitles,
  timing: locked(current, 'TIMING') ? current.timing : proposal.timing,
  styleProperties: locked(current, 'STYLE_PROPERTIES')
    ? current.styleProperties
    : proposal.styleProperties,
});
