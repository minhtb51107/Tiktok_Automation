import * as fs from 'fs';
import * as path from 'path';

type AssetPathOptions = {
  cwd?: string;
  exists?: (candidate: string) => boolean;
};

export const getBackendAssetCandidates = (
  fileName: string,
  options: AssetPathOptions = {},
): string[] => {
  if (path.basename(fileName) !== fileName) {
    throw new Error(`Asset name must not contain a path: ${fileName}`);
  }

  const cwd = path.resolve(options.cwd ?? process.cwd());
  const exists = options.exists ?? fs.existsSync;
  const nestedBackendRoot = path.join(cwd, '1_nest_backend');
  const backendRoot = exists(path.join(nestedBackendRoot, 'package.json'))
    ? nestedBackendRoot
    : cwd;

  return [
    path.join(backendRoot, 'src', 'assets', fileName),
    path.join(backendRoot, 'dist', 'src', 'assets', fileName),
  ];
};

export const resolveBackendAssetPath = (
  fileName: string,
  options: AssetPathOptions = {},
): string => {
  const exists = options.exists ?? fs.existsSync;
  const candidates = getBackendAssetCandidates(fileName, options);
  const resolved = candidates.find((candidate) => exists(candidate));

  if (!resolved) {
    throw new Error(
      `Backend asset not found: ${fileName}. Checked: ${candidates.join(', ')}`,
    );
  }

  return resolved;
};
