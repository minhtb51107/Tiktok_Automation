import { ContentCandidate } from './contracts';

export const selectContentCandidate = (
  candidates: readonly ContentCandidate[],
  candidateId: string,
  selectedBy: ContentCandidate['selectedBy'] = 'USER',
): ContentCandidate[] => {
  if (!candidates.some((candidate) => candidate.id === candidateId)) {
    throw new Error(`Content candidate not found: ${candidateId}`);
  }
  return candidates.map((candidate) => {
    if (candidate.id === candidateId) {
      return { ...candidate, status: 'SELECTED', selectedBy };
    }
    if (candidate.status !== 'SELECTED') return candidate;
    const { selectedBy: _previousSelector, ...remaining } = candidate;
    return { ...remaining, status: 'PENDING' };
  });
};
