import { Module } from '@nestjs/common';
import { TiktokLyricsService } from './tiktok-lyrics.service';
// Module:
import { RemotionRunnerModule } from '../../core/remotion-runner/remotion-runner.module';
import { WhisperModule } from '../../core/ai/whisper/whisper.module';
import { AiModule } from '../../core/ai/ai.module';

@Module({
  imports: [AiModule, RemotionRunnerModule, WhisperModule],
  providers: [TiktokLyricsService],
  exports: [TiktokLyricsService]
})
export class TiktokLyricsModule {}
