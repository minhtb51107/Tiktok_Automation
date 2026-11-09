import { describe, expect, it } from '@jest/globals';
import {
  requireEnvironmentVariables,
  validateRuntimeConfig,
} from './runtime-config';

describe('runtime config', () => {
  it('uses the safe offline defaults', () => {
    expect(validateRuntimeConfig({})).toMatchObject({ port: 3000 });
  });

  it('rejects an invalid port', () => {
    expect(() => validateRuntimeConfig({ PORT: '70000' })).toThrow(
      'PORT must be an integer between 1 and 65535.',
    );
  });

  it('rejects attempts to activate dormant operational modules', () => {
    expect(() => validateRuntimeConfig({ ENABLE_DISCORD: 'true' })).toThrow(
      'Operational modules are dormant in the recovery baseline',
    );
  });

  it('reports missing variable names without exposing values', () => {
    expect(() =>
      requireEnvironmentVariables(['DATABASE_URL', 'DISCORD_BOT_TOKEN'], {}),
    ).toThrow('DATABASE_URL, DISCORD_BOT_TOKEN');
  });
});
