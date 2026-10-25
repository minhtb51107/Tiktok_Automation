import { describe, expect, it } from '@jest/globals';
import {
  assertRenderProcessSucceeded,
  RenderCancelledError,
} from './render-process-outcome';

describe('render process outcome contract', () => {
  it('accepts a successful process', () => {
    expect(() => assertRenderProcessSucceeded(0, false)).not.toThrow();
  });

  it('preserves cancellation as a failure contract', () => {
    expect(() => assertRenderProcessSucceeded(0, true)).toThrow(
      RenderCancelledError,
    );
  });

  it('rejects failed and missing exit codes', () => {
    expect(() => assertRenderProcessSucceeded(1, false)).toThrow(
      'Render failed with code 1',
    );
    expect(() => assertRenderProcessSucceeded(null, false)).toThrow(
      'Render failed with code unknown',
    );
  });
});
