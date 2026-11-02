import { BadRequestException } from '@nestjs/common';
import {
  defaultSceneVisual,
  defaultBgm,
  cardPages,
  SceneVisual,
  BackgroundMusic,
  normalizeVisual,
} from '../video-pipeline/scene-visual';
export function validateVisual(
  value: unknown,
  known: (id: string) => boolean,
): SceneVisual {
  const d = defaultSceneVisual(),
    v = normalizeVisual(structuredClone(value || d) as SceneVisual);
  const number = (n: unknown, min: number, max: number) => {
    if (typeof n !== 'number' || !Number.isFinite(n) || n < min || n > max)
      throw new BadRequestException(
        `Invalid layout/audio setting (${min}–${max})`,
      );
  };
  const asset = (id: unknown) => {
    if (id !== null && (typeof id !== 'string' || !known(id)))
      throw new BadRequestException('Unknown asset reference');
  };
  if (!v.card || !v.meme || !v.sfx)
    throw new BadRequestException('Incomplete visual settings');
  const c = v.card,
    m = v.meme;
  for(const n of [c.startMs,c.durationMs,v.voiceStartMs,v.voiceSourceInMs,v.voiceDurationMs,v.sfx.durationMs,v.sfx.sourceInMs])if(n!==undefined)number(n,0,86400000);
  for(const n of [c.durationMs,v.voiceDurationMs,v.sfx.durationMs])if(n!==undefined&&n<34)throw new BadRequestException('Clip duration must be at least one frame');
  number(c.x, 0, 1080);
  number(c.y, 0, 1500);
  number(c.width, 240, 1080);
  number(c.scale, 0.5, 1.5);
  number(c.padding, 12, 80);
  number(c.fontSize, 24, 64);
  number(c.gap, 0, 60);
  number(c.lineHeight ?? 1.45, 1.1, 2);
  if (!['LIGHT', 'DARK'].includes(c.appearance ?? 'LIGHT'))
    throw new BadRequestException('Invalid card appearance');
  if (c.x + c.width * c.scale > 1080 || c.width <= c.padding * 2 + 100)
    throw new BadRequestException(
      'Card leaves canvas or has no usable body width',
    );
  number(m.width, 80, 1080);
  number(m.height, 60, 900);
  number(m.gap, 0, 160);
  number(m.startMs, 0, 30000);
  number(m.durationMs, 1, 30000);
  if (m.x !== null) {
    number(m.x, 0, 1080 - m.width);
  }
  if (m.y !== null) {
    number(m.y, 0, 1920 - m.height);
  }
  for (const b of [m.enabled, v.voiceEnabled, v.bgmEnabled, v.sfx.enabled])
    if (typeof b !== 'boolean')
      throw new BadRequestException('Invalid enable flag');
  number(v.voiceVolume, 0, 1);
  number(v.sfx.volume, 0, 0.7);
  number(v.sfx.startMs, 0, 30000);
  asset(v.backgroundId);
  asset(m.assetId);
  asset(v.sfx.assetId);
  const page = cardPages('Preview', v);
  if (page.invalid)
    throw new BadRequestException(
      'Layout has insufficient room; move card up or reduce card/meme size',
    );
  if (m.enabled && m.y !== null && m.y < c.y + page.height + m.gap)
    throw new BadRequestException('Meme must be below the Threads card');
  return v;
}
export function validateBgm(
  value: unknown,
  known: (id: string) => boolean,
): BackgroundMusic {
  const v = structuredClone(value || defaultBgm()) as BackgroundMusic;
  if(v.durationMs!==undefined&&v.durationMs<34)throw new BadRequestException('BGM clip duration must be positive');
  for(const n of [v.sourceInMs,v.durationMs])if(n!==undefined&&(!Number.isInteger(n)||n<0||n>86400000))throw new BadRequestException('Invalid BGM timing');
  if (
    typeof v.enabled !== 'boolean' ||
    (v.assetId !== null && !known(v.assetId)) ||
    !Number.isFinite(v.volume) ||
    v.volume < 0 ||
    v.volume > 0.25 ||
    !Number.isFinite(v.startMs) ||
    v.startMs < 0 ||
    v.startMs > 30000
  )
    throw new BadRequestException('Invalid BGM setting; volume must be 0–0.25');
  return v;
}
