import { MODULE_METADATA } from '@nestjs/common/constants';
import { describe, expect, it } from '@jest/globals';
import { AppModule } from '../app.module';
import { AiModule } from '../modules/core/ai/ai.module';
import { RemotionRunnerModule } from '../modules/core/remotion-runner/remotion-runner.module';
import { ScraperModule } from '../modules/core/scraper/scraper.module';
import { TtsModule } from '../modules/core/tts/tts.module';
import { ThreadsDramaModule } from '../modules/workflows/threads-drama/threads-drama.module';
import { ThreadsSeriousController } from '../modules/workflows/threads-serious/threads-serious.controller';
import { ThreadsSeriousModule } from '../modules/workflows/threads-serious/threads-serious.module';
import { TiktokLyricsModule } from '../modules/workflows/tiktok-lyrics/tiktok-lyrics.module';

const metadata = <T>(target: object, key: string): T[] =>
  Reflect.getMetadata(key, target) ?? [];

describe('offline module wiring', () => {
  it('keeps operational root imports dormant', () => {
    expect(metadata(AppModule, MODULE_METADATA.IMPORTS)).toEqual([]);
  });

  it('wires Drama through reusable service modules', () => {
    const imports = metadata(ThreadsDramaModule, MODULE_METADATA.IMPORTS);
    expect(imports).toEqual(
      expect.arrayContaining([
        AiModule,
        RemotionRunnerModule,
        ScraperModule,
        TtsModule,
      ]),
    );
  });

  it('registers the Serious controller', () => {
    expect(metadata(ThreadsSeriousModule, MODULE_METADATA.CONTROLLERS)).toContain(
      ThreadsSeriousController,
    );
  });

  it('provides AI to the dormant Lyrics workflow', () => {
    expect(metadata(TiktokLyricsModule, MODULE_METADATA.IMPORTS)).toContain(AiModule);
  });
});
