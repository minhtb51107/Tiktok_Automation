import { describe, it, expect } from '@jest/globals';
import { VOICE_SPEED, validVoiceSpeed, atempoFilter, spokenAmbiguities } from './voice-settings';
describe('Shared SERIOUS voice/speed contract (OFFLINE)', () => {
  it('supports exactly 0.5–3.0, step 0.05, default 1.2', () => {
    expect(VOICE_SPEED.default).toBe(1.2);
    for (const speed of [0.5, 1, 1.2, 1.5, 2, 2.5, 3]) expect(validVoiceSpeed(speed)).toBe(true);
    for (const speed of [0.49, 3.01, 1.23, NaN, Infinity, '1.2', null]) expect(validVoiceSpeed(speed)).toBe(false);
  });
  it('chains atempo above 2x without any factor outside 0.5–2', () => {
    expect(atempoFilter(2.5)).toBe('atempo=2,atempo=1.25');
    expect(atempoFilter(3)).toBe('atempo=2,atempo=1.5');
    for (const speed of [0.5, 1, 1.2, 1.5, 2, 2.5, 3]) {
      const factors = atempoFilter(speed).split(',').map(x => Number(x.split('=')[1]));
      expect(factors.every(x => x >= 0.5 && x <= 2)).toBe(true);
      expect(factors.reduce((a, b) => a * b, 1)).toBeCloseTo(speed);
    }
    expect(() => atempoFilter(3.05)).toThrow();
  });
  it('detects t/clm/cmn independently of old proposal status without matching word substrings', () => {
    expect(spokenAmbiguities('t nói clm cmn đcđ')).toEqual(['t', 'clm', 'cmn', 'đcđ']);
    expect(spokenAmbiguities('tốt công ty')).toEqual([]);
  });
});
