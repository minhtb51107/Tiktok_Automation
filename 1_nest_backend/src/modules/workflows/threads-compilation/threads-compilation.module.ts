import { Module } from '@nestjs/common';
import { AiModule } from '../../core/ai/ai.module';
// Module:
import { RemotionRunnerModule } from '../../core/remotion-runner/remotion-runner.module';
import { ThreadsCompilationService } from './threads-compilation.service';
import { ScraperModule } from '../../core/scraper/scraper.module';
import { TtsModule } from '../../core/tts/tts.module';

@Module({
  imports: [AiModule, RemotionRunnerModule, ScraperModule, TtsModule],
  providers: [ThreadsCompilationService],
  exports: [ThreadsCompilationService] // <-- Quan trọng: Export ra để DiscordModule có thể mượn dùng
})
export class ThreadsCompilationModule {}
