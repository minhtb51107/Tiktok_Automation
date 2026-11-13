import { config } from 'dotenv';
import * as path from 'path';

export function resolveBackendEnvPath(
  env: NodeJS.ProcessEnv = process.env,
  backendRoot = path.resolve(__dirname, '../..'),
) {
  const local = path.resolve(backendRoot, '.env');
  const requested = env.DOTENV_CONFIG_PATH?.trim();
  if (requested && path.resolve(requested) !== local)
    throw Error('EXTERNAL_DOTENV_CONFIG_PATH_REJECTED');
  return local;
}

export function loadBackendEnv(
  env: NodeJS.ProcessEnv = process.env,
  backendRoot = path.resolve(__dirname, '../..'),
) {
  const envPath = resolveBackendEnvPath(env, backendRoot);
  const result = config({
    path: envPath,
    processEnv: env,
    override: false,
    quiet: true,
  });
  if (result.error && (result.error as NodeJS.ErrnoException).code !== 'ENOENT')
    throw Error('LOCAL_DOTENV_LOAD_FAILED');
  return {
    path: envPath,
    exists: !result.error,
    huggingFaceCredential: env.HUGGINGFACE_API_KEY?.trim()
      ? ('present' as const)
      : ('absent' as const),
  };
}

export const BACKEND_ENV = loadBackendEnv();
