import { Module } from '@nestjs/common';
import { AiModule } from '../../core/ai/ai.module';
import { RemotionRunnerModule } from '../../remotion-runner/remotion-runner.module';
import { ThreadsSeriousService } from './threads-serious.service';
import { ScraperService } from '../../core/scraper/scraper.service';
import { TtsService } from '../../core/tts/tts.service';
import { WhisperModule } from '../../whisper/whisper.module';

@Module({
  imports: [AiModule, RemotionRunnerModule, WhisperModule],
  providers: [ThreadsSeriousService, ScraperService, TtsService],
  exports: [ThreadsSeriousService]
})
export class ThreadsSeriousModule {}