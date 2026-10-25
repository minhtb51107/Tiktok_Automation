export const DORMANT_FEATURE_FLAGS = [
  'ENABLE_DISCORD',
  'ENABLE_WATCHER',
  'ENABLE_AUTO_HUNTER',
  'ENABLE_TIKTOK_UPLOADER',
] as const;

export type RuntimeConfig = {
  port: number;
  dormantFeatures: readonly string[];
};

const parseBoolean = (name: string, value: string | undefined): boolean => {
  if (value === undefined || value.trim() === '') return false;
  if (value === 'true') return true;
  if (value === 'false') return false;
  throw new Error(`${name} must be either "true" or "false".`);
};

export const requireEnvironmentVariables = (
  names: readonly string[],
  env: NodeJS.ProcessEnv,
): void => {
  const missing = names.filter((name) => !env[name]?.trim());
  if (missing.length > 0) {
    throw new Error(`Missing required environment variables: ${missing.join(', ')}`);
  }
};

export const validateRuntimeConfig = (
  env: NodeJS.ProcessEnv = process.env,
): RuntimeConfig => {
  const rawPort = env.PORT?.trim() || '3000';
  const port = Number(rawPort);

  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('PORT must be an integer between 1 and 65535.');
  }

  const enabledDormantFeatures = DORMANT_FEATURE_FLAGS.filter((flag) =>
    parseBoolean(flag, env[flag]),
  );

  if (enabledDormantFeatures.length > 0) {
    throw new Error(
      `Operational modules are dormant in the recovery baseline: ${enabledDormantFeatures.join(', ')}`,
    );
  }

  return { port, dormantFeatures: DORMANT_FEATURE_FLAGS };
};
