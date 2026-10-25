import {
  ContentStyle,
  SourceReference,
  StoryboardScene,
  StyleSpecificSceneProperties,
  SubtitleCue,
  VoiceSelection,
} from './contracts';

export type AiStoryboardSceneInput = Omit<StoryboardScene, 'manualOverride'>;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const isNonNegativeNumber = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0;

const assertString = (value: unknown, path: string): string => {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`${path} must be a non-empty string.`);
  }
  return value;
};

const validateVoice = (value: unknown, path: string): VoiceSelection => {
  if (!isRecord(value)) throw new Error(`${path} must be an object.`);
  const provider = assertString(value.provider, `${path}.provider`);
  if (!['EDGE', 'GOOGLE', 'OPENAI', 'FIXTURE'].includes(provider)) {
    throw new Error(`${path}.provider is unsupported.`);
  }
  return {
    provider: provider as VoiceSelection['provider'],
    voiceId: assertString(value.voiceId, `${path}.voiceId`),
    language: assertString(value.language, `${path}.language`),
  };
};

const validateStyleProperties = (
  value: unknown,
  style: ContentStyle,
  path: string,
): StyleSpecificSceneProperties => {
  if (!isRecord(value) || value.style !== style) {
    throw new Error(`${path}.style must match ${style}.`);
  }
  if (style === 'FUNNY') {
    if (
      value.template !== 'THREADS_CARD' ||
      !['POST', 'COMMENT', 'MEME'].includes(String(value.emphasis))
    ) {
      throw new Error(`${path} is not a valid FUNNY scene configuration.`);
    }
    return value as unknown as StyleSpecificSceneProperties;
  }
  if (
    value.template !== 'STORY_CARD' ||
    !['POST', 'COMMENT', 'NARRATION'].includes(String(value.cardMode)) ||
    !['REFLECTIVE', 'ANALYTICAL', 'EMOTIONAL'].includes(String(value.tone))
  ) {
    throw new Error(`${path} is not a valid SERIOUS scene configuration.`);
  }
  return value as unknown as StyleSpecificSceneProperties;
};

const validateSubtitles = (value: unknown, path: string): SubtitleCue[] => {
  if (!Array.isArray(value)) throw new Error(`${path} must be an array.`);
  return value.map((cue, index) => {
    const cuePath = `${path}[${index}]`;
    if (!isRecord(cue)) throw new Error(`${cuePath} must be an object.`);
    if (!isNonNegativeNumber(cue.startMs) || !isNonNegativeNumber(cue.endMs)) {
      throw new Error(`${cuePath} timestamps must be non-negative numbers.`);
    }
    if (cue.endMs <= cue.startMs) {
      throw new Error(`${cuePath}.endMs must be greater than startMs.`);
    }
    return {
      id: assertString(cue.id, `${cuePath}.id`),
      text: assertString(cue.text, `${cuePath}.text`),
      startMs: cue.startMs,
      endMs: cue.endMs,
    };
  });
};

const stringArray = (value: unknown, path: string): string[] => {
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) {
    throw new Error(`${path} must be a string array.`);
  }
  return [...value];
};

export const validateAiStoryboardOutput = (
  value: unknown,
  style: ContentStyle,
  availableReferences?: readonly SourceReference[],
): AiStoryboardSceneInput[] => {
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error('AI storyboard output must be a non-empty array.');
  }

  const ids = new Set<string>();
  const referenceKeys = availableReferences
    ? new Set(
        availableReferences.map(
          (reference) => `${reference.entityType}:${reference.entityId}`,
        ),
      )
    : undefined;
  return value.map((scene, index) => {
    const path = `scenes[${index}]`;
    if (!isRecord(scene)) throw new Error(`${path} must be an object.`);
    const id = assertString(scene.id, `${path}.id`);
    if (ids.has(id)) throw new Error(`Duplicate scene id: ${id}`);
    ids.add(id);
    if (scene.order !== index) {
      throw new Error(`${path}.order must be contiguous and start at zero.`);
    }
    if (!Array.isArray(scene.sourceReferences) || scene.sourceReferences.length === 0) {
      throw new Error(`${path}.sourceReferences must not be empty.`);
    }
    const sourceReferences = scene.sourceReferences.map((reference, refIndex) => {
      if (
        !isRecord(reference) ||
        !['POST', 'COMMENT'].includes(String(reference.entityType))
      ) {
        throw new Error(`${path}.sourceReferences[${refIndex}] is invalid.`);
      }
      const normalizedReference = {
        entityType: reference.entityType as 'POST' | 'COMMENT',
        entityId: assertString(
          reference.entityId,
          `${path}.sourceReferences[${refIndex}].entityId`,
        ),
      };
      if (
        referenceKeys &&
        !referenceKeys.has(
          `${normalizedReference.entityType}:${normalizedReference.entityId}`,
        )
      ) {
        throw new Error(
          `${path}.sourceReferences[${refIndex}] points to unknown content.`,
        );
      }
      return normalizedReference;
    });
    if (!isRecord(scene.timing)) throw new Error(`${path}.timing is invalid.`);
    if (
      !isNonNegativeNumber(scene.timing.paddingBeforeMs) ||
      !isNonNegativeNumber(scene.timing.paddingAfterMs)
    ) {
      throw new Error(`${path}.timing padding must be non-negative.`);
    }
    const rawManualDuration = scene.timing.manualSceneDurationMs;
    let manualDuration: number | undefined;
    if (rawManualDuration !== undefined) {
      if (!isNonNegativeNumber(rawManualDuration)) {
        throw new Error(`${path}.timing.manualSceneDurationMs is invalid.`);
      }
      manualDuration = rawManualDuration;
    }

    return {
      id,
      order: index,
      sourceReferences,
      displayText: assertString(scene.displayText, `${path}.displayText`),
      narrationText: assertString(scene.narrationText, `${path}.narrationText`),
      voice: validateVoice(scene.voice, `${path}.voice`),
      ...(scene.audioAssetId === undefined
        ? {}
        : {
            audioAssetId: assertString(
              scene.audioAssetId,
              `${path}.audioAssetId`,
            ),
          }),
      mediaAssetIds: stringArray(scene.mediaAssetIds, `${path}.mediaAssetIds`),
      sfxAssetIds: stringArray(scene.sfxAssetIds, `${path}.sfxAssetIds`),
      subtitles: validateSubtitles(scene.subtitles, `${path}.subtitles`),
      timing: {
        paddingBeforeMs: scene.timing.paddingBeforeMs,
        paddingAfterMs: scene.timing.paddingAfterMs,
        ...(manualDuration === undefined
          ? {}
          : { manualSceneDurationMs: manualDuration }),
      },
      styleProperties: validateStyleProperties(
        scene.styleProperties,
        style,
        `${path}.styleProperties`,
      ),
    };
  });
};

export const acceptAiStoryboard = (
  value: unknown,
  style: ContentStyle,
  availableReferences?: readonly SourceReference[],
): StoryboardScene[] =>
  validateAiStoryboardOutput(value, style, availableReferences).map((scene) => ({
    ...scene,
    manualOverride: { lockedFields: [], revision: 0 },
  }));
