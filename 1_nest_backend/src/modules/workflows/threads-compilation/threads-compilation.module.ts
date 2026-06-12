import { Module } from '@nestjs/common';
import { AiModule } from '../../core/ai/ai.module';
import { RemotionRunnerModule } from '../../remotion-runner/remotion-runner.module';
import { ThreadsCompilationService } from './threads-compilation.service';
import { ScraperService } from '../../core/scraper/scraper.service';
import { TtsService } from '../../core/tts/tts.service';

@Module({
  imports: [AiModule, RemotionRunnerModule],
  providers: [ThreadsCompilationService, ScraperService, TtsService],
  exports: [ThreadsCompilationService] // <-- Quan trọng: Export ra để DiscordModule có thể mượn dùng
})
export class ThreadsCompilationModule {}