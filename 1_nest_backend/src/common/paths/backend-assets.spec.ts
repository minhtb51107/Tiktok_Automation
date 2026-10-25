import * as path from 'path';
import {
  getBackendAssetCandidates,
  resolveBackendAssetPath,
} from './backend-assets';

describe('backend asset path resolution', () => {
  it('resolves source assets when running from the backend directory', () => {
    const cwd = path.resolve('C:/workspace/1_nest_backend');
    const sourceAsset = path.join(cwd, 'src', 'assets', 'meme_dictionary.json');
    const exists = (candidate: string) => candidate === sourceAsset;

    expect(resolveBackendAssetPath('meme_dictionary.json', { cwd, exists })).toBe(
      sourceAsset,
    );
  });

  it('resolves copied assets when running compiled output', () => {
    const cwd = path.resolve('C:/workspace/1_nest_backend');
    const compiledAsset = path.join(
      cwd,
      'dist',
      'src',
      'assets',
      'sfx_dictionary.json',
    );
    const exists = (candidate: string) => candidate === compiledAsset;

    expect(resolveBackendAssetPath('sfx_dictionary.json', { cwd, exists })).toBe(
      compiledAsset,
    );
  });

  it('supports launching from the repository root', () => {
    const cwd = path.resolve('C:/workspace');
    const packageJson = path.join(cwd, '1_nest_backend', 'package.json');
    const candidates = getBackendAssetCandidates('meme_dictionary.json', {
      cwd,
      exists: (candidate) => candidate === packageJson,
    });

    expect(candidates[0]).toBe(
      path.join(cwd, '1_nest_backend', 'src', 'assets', 'meme_dictionary.json'),
    );
  });

  it('rejects path traversal', () => {
    expect(() => getBackendAssetCandidates('../.env')).toThrow(
      'Asset name must not contain a path',
    );
  });
});
