import { describe, expect, it } from '@jest/globals';
import { createSyntheticVideoProject } from './fixtures/synthetic-thread.fixture';
import { createRemotionPreviewRequest } from './preview-adapter';
import { buildVideoTimeline } from './timeline-engine';

const preparedProject = (style: 'FUNNY' | 'SERIOUS') => {
  const project = createSyntheticVideoProject(style);
  project.timeline = buildVideoTimeline({
    projectId: project.id,
    style,
    fps: 60,
    width: 1080,
    height: 1920,
    introDurationMs: 1000,
    outroDurationMs: 500,
    scenes: project.storyboard,
    audioAssets: project.audioAssets,
    mediaAssets: project.mediaAssets,
  });
  return project;
};

describe('Remotion preview adapter', () => {
  it.each([
    ['FUNNY', 'FunnyTimelinePreview'],
    ['SERIOUS', 'SeriousTimelinePreview'],
  ] as const)('maps %s projects without recalculating duration', (style, id) => {
    const project = preparedProject(style);
    const request = createRemotionPreviewRequest(project);

    expect(request.compositionId).toBe(id);
    expect(request.durationInFrames).toBe(project.timeline?.totalFrames);
    expect(request.fps).toBe(project.timeline?.fps);
    expect(request.inputProps.timeline).toBe(project.timeline);
    expect(request.inputProps.previewMode).toBe(true);
  });

  it('rejects projects that have not passed timeline generation', () => {
    expect(() =>
      createRemotionPreviewRequest(createSyntheticVideoProject('FUNNY')),
    ).toThrow('has no timeline');
  });
});
