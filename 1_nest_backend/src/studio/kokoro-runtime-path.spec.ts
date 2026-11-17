import { describe, expect, it } from '@jest/globals';
import * as path from 'path';
import { resolveStudioDataRoot } from './kokoro-runtime';

describe('Kokoro Studio data root', () => {
  it('uses the isolated Studio store when configured', () => {
    const cwd = path.resolve('workspace', 'backend');
    const isolated = path.resolve('sandbox', 'store');
    expect(resolveStudioDataRoot(isolated, cwd)).toBe(isolated);
  });

  it('keeps the legacy local default when no isolated store is configured', () => {
    const cwd = path.resolve('workspace', 'backend');
    expect(resolveStudioDataRoot(undefined, cwd)).toBe(
      path.join(cwd, '.studio-data'),
    );
  });
});
