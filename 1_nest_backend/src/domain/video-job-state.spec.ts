import { readFileSync } from 'fs';
import { join } from 'path';
import { describe, expect, it } from '@jest/globals';
import {
  assertVideoJobTransition,
  canTransitionVideoJob,
  VideoJobStatus,
} from './video-job-state';

describe('video job status transitions', () => {
  it('stays aligned with the Prisma VideoStatus enum', () => {
    const schema = readFileSync(
      join(process.cwd(), 'prisma', 'schema.prisma'),
      'utf8',
    );
    const match = schema.match(/enum\s+VideoStatus\s*\{([^}]*)\}/s);

    expect(match).not.toBeNull();
    const prismaStatuses = (match?.[1] ?? '')
      .split(/\r?\n/)
      .map((line) => line.replace(/\/\/.*$/, '').trim())
      .filter(Boolean);

    expect(prismaStatuses.sort()).toEqual(Object.values(VideoJobStatus).sort());
  });

  it('allows the normal three-stage workflow', () => {
    expect(
      canTransitionVideoJob(VideoJobStatus.PENDING, VideoJobStatus.SCRIPT_READY),
    ).toBe(true);
    expect(
      canTransitionVideoJob(
        VideoJobStatus.SCRIPT_READY,
        VideoJobStatus.AUDIO_READY,
      ),
    ).toBe(true);
    expect(
      canTransitionVideoJob(VideoJobStatus.AUDIO_READY, VideoJobStatus.RENDERED),
    ).toBe(true);
  });

  it('rejects a backwards transition from a rendered job', () => {
    expect(() =>
      assertVideoJobTransition(
        VideoJobStatus.RENDERED,
        VideoJobStatus.AUDIO_READY,
      ),
    ).toThrow('RENDERED -> AUDIO_READY');
  });

  it('allows a failed job to be explicitly reset to pending', () => {
    expect(
      canTransitionVideoJob(VideoJobStatus.FAILED, VideoJobStatus.PENDING),
    ).toBe(true);
  });
});
