import { describe, it, expect } from '@jest/globals';
import { sourceImageUrl, publicV4 } from './source-images';
import { fitBackground } from '../video-pipeline/editing';
import { ttsCacheKeys } from './kokoro-runtime';
describe('Quality gates offline', () => {
  it('keys TTS by item, normalized input/version, voice/model/device and speed', () => {
    const r: any = {
        packageVersion: 'test-package',
        modelVersion: 'test-model-config-voicepacks',
        device: 'cpu',
      },
      c = { itemId: 'item-a', normalizationVersion: 'vi-numbers-1' },
      key = (
        text = 'hai mươi hai',
        voice = 'my_yen',
        speed = 1.2,
        rt = r,
        context = c,
      ) => ttsCacheKeys(text, voice, speed, rt, context);
    const original = key();
    expect(key()).toEqual(original);
    for (const changed of [
      key('bảy trăm'),
      key(undefined, 'hung_thinh'),
      key(undefined, undefined, 1.5),
      key(undefined, undefined, undefined, { ...r, modelVersion: 'changed' }),
      key(undefined, undefined, undefined, r, { ...c, itemId: 'item-b' }),
      key(undefined, undefined, undefined, r, {
        ...c,
        normalizationVersion: 'v2',
      }),
    ])
      expect(changed.cacheKey).not.toBe(original.cacheKey);
    expect(key(undefined, undefined, 1.5).baseKey).toBe(original.baseKey);
  });
  it('rejects private/credential/redirect domains before image retrieval', () => {
    for (const s of [
      'http://scontent.cdninstagram.com/x',
      'https://localhost/x',
      'https://cdninstagram.com.attacker.com/x',
      'https://u:p@scontent.cdninstagram.com/x',
    ])
      expect(() => sourceImageUrl(s)).toThrow();
    for (const ip of [
      '127.0.0.1',
      '10.1.2.3',
      '172.16.1.1',
      '192.168.1.1',
      '169.254.169.254',
      '100.64.0.1',
    ])
      expect(publicV4(ip)).toBe(false);
    expect(publicV4('8.8.8.8')).toBe(true);
  });
  it('fits or loops a snapshot without modifying saved range or timeline', () => {
    const saved = {
      id: 'bg-test',
      assetId: 'local',
      startMs: 0,
      durationMs: 17966,
      sourceInMs: 40000,
      sourceOutMs: 57966,
      loop: false,
      enabled: true,
    };
    const fit = fitBackground(saved, 77800, 133867, 'FIT');
    expect(fit).toMatchObject({
      durationMs: 77800,
      sourceInMs: 40000,
      sourceOutMs: 117800,
      loop: false,
    });
    expect(saved.durationMs).toBe(17966);
    expect(fitBackground(saved, 77800, 133867, 'LOOP')).toMatchObject({
      durationMs: 77800,
      sourceOutMs: 57966,
      loop: true,
    });
    expect(
      fitBackground({ ...saved, durationMs: 30000 }, 77800, 133867, 'TRIM')
        .durationMs,
    ).toBe(17966);
  });
});
