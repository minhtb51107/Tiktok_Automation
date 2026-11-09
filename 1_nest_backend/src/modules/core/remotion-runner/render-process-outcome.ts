export class RenderCancelledError extends Error {
  constructor() {
    super('ABORTED');
    this.name = 'RenderCancelledError';
  }
}

export const assertRenderProcessSucceeded = (
  exitCode: number | null,
  aborted: boolean,
): void => {
  if (aborted) throw new RenderCancelledError();
  if (exitCode !== 0) {
    throw new Error(`Render failed with code ${exitCode ?? 'unknown'}`);
  }
};
