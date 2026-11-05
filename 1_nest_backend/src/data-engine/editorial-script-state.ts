import type { StudioSession } from '../studio/studio.contracts';
import { hash } from './rules';
export function editorialScriptHash(s: StudioSession) {
  return hash(
    s.items
      .filter((i) => i.selected)
      .sort((a, b) => a.order - b.order)
      .map((i) => ({
        id: i.id,
        sourceReference: i.sourceReference,
        originalText: i.originalText,
        displayText: i.displayText,
        spokenText: i.spokenText,
        editorial: i.editorial,
      })),
  );
}
