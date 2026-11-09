import { describe, expect, it } from '@jest/globals';
import {
  acceptAiStoryboard,
  validateAiStoryboardOutput,
} from './ai-storyboard';
import { selectContentCandidate } from './content-selection';
import type { ContentCandidate } from './contracts';
import {
  createSyntheticVideoProject,
  SYNTHETIC_FUNNY_AI_OUTPUT,
  SYNTHETIC_RAW_THREAD,
} from './fixtures/synthetic-thread.fixture';
import { normalizeThreadContent } from './normalization';
import {
  deserializeVideoProject,
  serializeVideoProject,
} from './serialization';
import {
  editStoryboardScene,
  mergeAiSceneProposal,
  removeStoryboardScene,
  reorderStoryboardScenes,
} from './storyboard-editor';
import { buildVideoTimeline } from './timeline-engine';

describe('editable video pipeline contract', () => {
  it('normalizes a synthetic post and removes blank and duplicate comments', () => {
    const normalized = normalizeThreadContent(SYNTHETIC_RAW_THREAD);

    expect(normalized.source.synthetic).toBe(true);
    expect(normalized.post.text).toBe(
      'Một bài Threads hoàn toàn giả lập để kiểm thử pipeline.',
    );
    expect(normalized.comments.map((comment) => comment.id)).toEqual([
      'synthetic-comment-001',
      'synthetic-comment-002',
      'synthetic-comment-003',
    ]);
    expect(normalized.post.commentIds).toEqual(
      normalized.comments.map((comment) => comment.id),
    );
  });

  it('validates synthetic AI output and rejects unknown content references', () => {
    const project = createSyntheticVideoProject('FUNNY');
    const references = [
      ...project.posts.map((post) => ({
        entityType: 'POST' as const,
        entityId: post.id,
      })),
      ...project.comments.map((comment) => ({
        entityType: 'COMMENT' as const,
        entityId: comment.id,
      })),
    ];

    expect(
      validateAiStoryboardOutput(
        SYNTHETIC_FUNNY_AI_OUTPUT,
        'FUNNY',
        references,
      ),
    ).toHaveLength(4);

    const invalid = JSON.parse(JSON.stringify(SYNTHETIC_FUNNY_AI_OUTPUT));
    invalid[0].sourceReferences[0].entityId = 'missing-content';
    expect(() =>
      validateAiStoryboardOutput(invalid, 'FUNNY', references),
    ).toThrow('points to unknown content');
  });

  it('selects exactly one content candidate without external state', () => {
    const candidates: ContentCandidate[] = [
      {
        id: 'candidate-a',
        style: 'FUNNY',
        sourceReferences: [{ entityType: 'POST', entityId: 'post-a' }],
        status: 'SELECTED',
        selectedBy: 'AI_FIXTURE',
      },
      {
        id: 'candidate-b',
        style: 'FUNNY',
        sourceReferences: [{ entityType: 'POST', entityId: 'post-b' }],
        status: 'PENDING',
      },
    ];

    const selected = selectContentCandidate(candidates, 'candidate-b');
    expect(selected.map((candidate) => [candidate.id, candidate.status])).toEqual([
      ['candidate-a', 'PENDING'],
      ['candidate-b', 'SELECTED'],
    ]);
    expect(selected[1].selectedBy).toBe('USER');
  });

  it('supports edit, delete, reorder, and preserves manually locked fields', () => {
    const original = acceptAiStoryboard(SYNTHETIC_FUNNY_AI_OUTPUT, 'FUNNY');
    const edited = editStoryboardScene(
      original,
      'funny-scene-comment-1',
      { displayText: 'Nội dung do người dùng chỉnh sửa và khóa' },
      ['DISPLAY_TEXT'],
      'offline-test-user',
    );
    const current = edited[1];
    const aiProposal = {
      ...current,
      displayText: 'AI không được ghi đè dòng này',
      narrationText: 'AI vẫn có thể cập nhật trường chưa khóa.',
    };
    const merged = mergeAiSceneProposal(current, aiProposal);

    expect(merged.displayText).toBe('Nội dung do người dùng chỉnh sửa và khóa');
    expect(merged.narrationText).toBe('AI vẫn có thể cập nhật trường chưa khóa.');
    expect(merged.manualOverride).toEqual({
      lockedFields: ['DISPLAY_TEXT'],
      revision: 1,
      lastEditedBy: 'offline-test-user',
    });

    const withoutLast = removeStoryboardScene(edited, 'funny-scene-comment-3');
    const reordered = reorderStoryboardScenes(withoutLast, [
      'funny-scene-comment-2',
      'funny-scene-post',
      'funny-scene-comment-1',
    ]);
    expect(reordered.map((scene) => [scene.id, scene.order])).toEqual([
      ['funny-scene-comment-2', 0],
      ['funny-scene-post', 1],
      ['funny-scene-comment-1', 2],
    ]);
  });

  it('serializes and deserializes a complete project without information loss', () => {
    const project = createSyntheticVideoProject('FUNNY');
    project.timeline = buildVideoTimeline({
      projectId: project.id,
      style: project.style,
      fps: 60,
      width: 1080,
      height: 1920,
      introDurationMs: 1000,
      outroDurationMs: 500,
      scenes: project.storyboard,
      audioAssets: project.audioAssets,
      mediaAssets: project.mediaAssets,
    });

    expect(deserializeVideoProject(serializeVideoProject(project))).toEqual(project);
  });
});
