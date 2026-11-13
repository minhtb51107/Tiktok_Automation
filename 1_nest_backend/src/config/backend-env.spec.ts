import { describe, expect, test } from '@jest/globals';
import * as path from 'path';
import { loadBackendEnv, resolveBackendEnvPath } from './backend-env';

describe('worktree-local backend environment', () => {
  const root = path.resolve('C:/isolated/current-backend');

  test('uses only the current backend .env by default', () => {
    expect(resolveBackendEnvPath({}, root)).toBe(path.join(root, '.env'));
  });

  test('rejects DOTENV_CONFIG_PATH pointing to another worktree', () => {
    expect(() =>
      resolveBackendEnvPath(
        { DOTENV_CONFIG_PATH: 'C:/old-worktree/1_nest_backend/.env' },
        root,
      ),
    ).toThrow('EXTERNAL_DOTENV_CONFIG_PATH_REJECTED');
  });

  test('accepts the exact local path and never invents a credential', () => {
    const local = path.join(root, '.env');
    const env = { DOTENV_CONFIG_PATH: local };
    const loaded = loadBackendEnv(env, root);
    expect(loaded.path).toBe(local);
    expect(loaded.exists).toBe(false);
    expect(loaded.huggingFaceCredential).toBe('absent');
  });
});
