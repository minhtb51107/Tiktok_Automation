import { describe, test, expect } from '@jest/globals';
import {
  feasibility,
  selectedReplies,
  estimatedDuration,
  measuredDuration,
} from './editorial-feasibility';
import { buildVideoTimeline } from '../video-pipeline/timeline-engine';
import type { AudioAsset, StoryboardScene } from '../video-pipeline/contracts';
import { editorialFixture } from './editorial-test.fixture';
const scene: StoryboardScene = {
  id: 'narration',
  order: 0,
  sourceReferences: [],
  displayText: 'TEST DATA',
  narrationText: 'TEST DATA narration',
  voice: { provider: 'FIXTURE', voiceId: 'test', language: 'vi' },
  audioAssetId: 'audio',
  mediaAssetIds: [],
  sfxAssetIds: [],
  subtitles: [],
  timing: { paddingBeforeMs: 0, paddingAfterMs: 0 },
  styleProperties: {
    style: 'SERIOUS',
    template: 'STORY_CARD',
    cardMode: 'NARRATION',
    tone: 'ANALYTICAL',
  },
  manualOverride: { lockedFields: [], revision: 0 },
};
describe('DATA05 feasibility and duration — SYNTHETIC contract tests', () => {
  test('viral emoji thread insufficient; lower engagement does not reject material', () => {
    const f = editorialFixture(undefined, '😂😂');
    expect(feasibility(f.collection, f.quality, ['REPLY']).status).toBe(
      'INSUFFICIENT_CONTENT',
    );
    const good = editorialFixture();
    good.collection.root.engagement.likes = 1;
    expect(feasibility(good.collection, good.quality, ['REPLY']).status).toBe(
      'NEEDS_EDITORIAL_ENRICHMENT',
    );
  });
  test('no selected/unverified/wrong-parent replies can be used', () => {
    const f = editorialFixture();
    expect(feasibility(f.collection, f.quality, []).status).toBe(
      'INSUFFICIENT_CONTENT',
    );
    expect(() => selectedReplies(f.collection, ['OTHER'])).toThrow(
      'UNVERIFIED',
    );
    f.collection.replies[0].evidence.parentUrl =
      'https://www.threads.com/@test/post/OTHER';
    expect(() => selectedReplies(f.collection, ['REPLY'])).toThrow();
  });
  test('original text immutable and estimate is never measured', () => {
    const f = editorialFixture(),
      before = JSON.stringify(f);
    feasibility(f.collection, f.quality, ['REPLY']);
    expect(JSON.stringify(f)).toBe(before);
    expect(estimatedDuration('Nội dung kiểm thử')).toMatchObject({
      source: 'ESTIMATED',
      authoritative: false,
    });
  });
  test.each([59000, 60000, 61000])(
    'strict >60 seconds boundary %i',
    (durationMs) => {
      const a: AudioAsset = {
        id: 'audio',
        role: 'NARRATION',
        uri: 'test.wav',
        durationMs,
        durationSource: 'FIXTURE',
        availability: 'AVAILABLE',
      };
      const t = buildVideoTimeline({
        projectId: 'test',
        style: 'SERIOUS',
        fps: 30,
        width: 1080,
        height: 1920,
        introDurationMs: 0,
        outroDurationMs: 0,
        scenes: [scene],
        audioAssets: [a],
        mediaAssets: [],
      });
      const r = measuredDuration(t, [a]);
      expect(r.status).toBe(
        durationMs > 60000 ? 'FIXTURE_CONTRACT_PASS' : 'DURATION_TOO_SHORT',
      );
      expect(r.releaseReady).toBe(false);
      expect(r.source).toBe('FIXTURE');
    },
  );
  test('padding/music cannot compensate for insufficient voice; measured distinct from fixture', () => {
    const a: AudioAsset = {
        id: 'audio',
        role: 'NARRATION',
        uri: 'test.wav',
        durationMs: 30000,
        durationSource: 'MEASURED',
        availability: 'AVAILABLE',
      },
      t = buildVideoTimeline({
        projectId: 'test',
        style: 'SERIOUS',
        fps: 30,
        width: 1080,
        height: 1920,
        introDurationMs: 40000,
        outroDurationMs: 0,
        scenes: [scene],
        audioAssets: [a],
        mediaAssets: [],
      });
    expect(measuredDuration(t, [a]).status).toBe('DURATION_TOO_SHORT');
    a.durationSource = 'MANUAL';
    expect(measuredDuration(t, [a]).status).toBe('NOT_MEASURED');
  });
  test('muted or trimmed voice does not count full manifest duration', () => {
    const a: AudioAsset = {
        id: 'audio',
        role: 'NARRATION',
        uri: 'test.wav',
        durationMs: 81000,
        durationSource: 'FIXTURE',
        availability: 'AVAILABLE',
      },
      t = buildVideoTimeline({
        projectId: 'test',
        style: 'SERIOUS',
        fps: 30,
        width: 1080,
        height: 1920,
        introDurationMs: 0,
        outroDurationMs: 0,
        scenes: [scene],
        audioAssets: [a],
        mediaAssets: [],
      });
    t.scenes[0].scene.visual = { voiceEnabled: false } as any;
    expect(measuredDuration(t, [a]).status).toBe('DURATION_TOO_SHORT');
    t.scenes[0].scene.visual = { voiceSourceInMs: 25000 } as any;
    expect(measuredDuration(t, [a]).narrationSeconds).toBe(56);
    expect(measuredDuration(t, [a]).durationGatePassed).toBe(false);
  });
  test('missing quality is UNKNOWN, not a claim of poor content', () => {
    const f = editorialFixture();
    f.quality.replyQuality = [];
    expect(feasibility(f.collection, f.quality, ['REPLY']).status).toBe(
      'UNKNOWN',
    );
  });
  test('repetition cannot manufacture long-form feasibility from a short discussion',()=>{
    const f=editorialFixture('Công ty sai.','Nhưng công ty sai.');
    const sections=(['HOOK','COMMENTARY','RESOLUTION'] as const).map(stage=>({id:stage,stage,kind:'COMMENTARY' as const,sourceId:null,parentId:null,permalink:null,originalText:'',displayText:stage,narrationText:stage==='COMMENTARY'?'lặp lại '.repeat(250):stage,locked:false}));
    const result=feasibility(f.collection,f.quality,['REPLY'],sections);
    expect(result.status).toBe('INSUFFICIENT_CONTENT');expect(result.missingEvidence).toContain('REPETITIVE_COMMENTARY');
  });
});
