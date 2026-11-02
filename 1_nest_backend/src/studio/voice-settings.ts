// Shared JSON settings contract used by the Studio UI and backend.
export const VOICE_SPEED = {
  min: 0.5,
  max: 3,
  step: 0.05,
  default: 1.2,
} as const;
export function spokenAmbiguities(text: string): string[] {
  return [
    ...new Set(
      Array.from(
        text.matchAll(/(?<![\p{L}\p{N}_])(t|đcđ|clm|cmn)(?![\p{L}\p{N}_])/giu),
        (m) => m[1],
      ),
    ),
  ];
}
export function validVoiceSpeed(value: unknown): value is number {
  return (
    typeof value === 'number' &&
    Number.isFinite(value) &&
    value >= VOICE_SPEED.min &&
    value <= VOICE_SPEED.max &&
    Math.abs(value / VOICE_SPEED.step - Math.round(value / VOICE_SPEED.step)) <
      1e-7
  );
}
export function atempoFilter(speed: number): string {
  if (!validVoiceSpeed(speed))
    throw Error('Speed must be 0.5–3.0 in steps of 0.05');
  const factors: number[] = [];
  while (speed > 2) {
    factors.push(2);
    speed /= 2;
  }
  factors.push(speed);
  return factors.map((v) => `atempo=${v}`).join(',');
}
