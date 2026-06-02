import { Module } from '@nestjs/common';
import { ThreadsTopicController } from './threads-topic.controller';
import { ThreadsTopicService } from './threads-topic.service';
import { ScraperService } from './scraper.service';
import { TtsService } from './tts.service';
import { AiModule } from '../../ai/ai.module'; // <--- 1. Import AiModule thay thế Gemini
import { RemotionRunnerModule } from '../../remotion-runner/remotion-runner.module';
import { DiscordService } from './discord.service'; // 1. THÊM DÒNG NÀY

@Module({
  imports: [AiModule, RemotionRunnerModule], // <--- 2. Đổi GeminiModule thành AiModule tại đây
  controllers: [ThreadsTopicController],
  providers: [ThreadsTopicService, ScraperService, TtsService, DiscordService],
  exports: [ThreadsTopicService] 
})
export class ThreadsTopicModule {}