import { Module } from '@nestjs/common';
import { TiktokLyricsService } from './tiktok-lyrics.service';
import { RemotionRunnerModule } from '../../remotion-runner/remotion-runner.module';
import { WhisperModule } from '../../whisper/whisper.module';
import { GeminiModule } from '../../ai/gemini.module';

@Module({
  imports: [RemotionRunnerModule, WhisperModule, GeminiModule],
  providers: [TiktokLyricsService],
  exports: [TiktokLyricsService]
})
export class TiktokLyricsModule {}