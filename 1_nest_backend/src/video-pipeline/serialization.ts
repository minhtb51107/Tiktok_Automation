import {
  VideoProject,
  VIDEO_PIPELINE_CONTRACT_VERSION,
} from './contracts';

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

export const validateVideoProject = (value: unknown): VideoProject => {
  if (!isRecord(value)) throw new Error('VideoProject must be an object.');
  if (value.contractVersion !== VIDEO_PIPELINE_CONTRACT_VERSION) {
    throw new Error('Unsupported VideoProject contract version.');
  }
  if (typeof value.id !== 'string' || !['FUNNY', 'SERIOUS'].includes(String(value.style))) {
    throw new Error('VideoProject identity or style is invalid.');
  }
  for (const field of [
    'sources',
    'posts',
    'comments',
    'candidates',
    'storyboard',
    'audioAssets',
    'mediaAssets',
  ]) {
    if (!Array.isArray(value[field])) {
      throw new Error(`VideoProject.${field} must be an array.`);
    }
  }
  if (!isRecord(value.publishing) || value.publishing.manualApprovalRequired !== true) {
    throw new Error('VideoProject publishing metadata requires manual approval.');
  }
  if (value.timeline !== undefined) {
    if (
      !isRecord(value.timeline) ||
      value.timeline.projectId !== value.id ||
      value.timeline.style !== value.style ||
      !Array.isArray(value.timeline.scenes)
    ) {
      throw new Error('VideoProject timeline does not match the project.');
    }
  }
  return value as unknown as VideoProject;
};

export const serializeVideoProject = (project: VideoProject): string =>
  JSON.stringify(validateVideoProject(project));

export const deserializeVideoProject = (json: string): VideoProject =>
  validateVideoProject(JSON.parse(json) as unknown);
