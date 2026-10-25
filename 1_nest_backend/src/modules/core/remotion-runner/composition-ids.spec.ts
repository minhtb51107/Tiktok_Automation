import * as fs from 'fs';
import * as path from 'path';
import { REMOTION_COMPOSITION_IDS } from './composition-ids';

describe('Remotion composition IDs', () => {
  it('keeps backend call sites consistent with the registered compositions', () => {
    const rootPath = path.resolve(
      process.cwd(),
      '..',
      '2_Remotion_Video',
      'src',
      'Root.tsx',
    );
    const rootSource = fs.readFileSync(rootPath, 'utf8');
    const registeredIds = new Set(
      [...rootSource.matchAll(/id=["']([^"']+)["']/g)].map((match) => match[1]),
    );

    for (const compositionId of Object.values(REMOTION_COMPOSITION_IDS)) {
      expect(registeredIds).toContain(compositionId);
    }
  });
});
