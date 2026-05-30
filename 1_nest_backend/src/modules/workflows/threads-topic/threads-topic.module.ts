import { Module } from '@nestjs/common';
import { ThreadsTopicController } from './threads-topic.controller';
import { ThreadsTopicService } from './threads-topic.service';
import { ScraperService } from './scraper.service';
import { TtsService } from './tts.service';
import { GeminiModule } from '../../gemini/gemini.module';
import { RemotionRunnerModule } from '../../remotion-runner/remotion-runner.module';

@Module({
  imports: [GeminiModule, RemotionRunnerModule],
  controllers: [ThreadsTopicController],
  providers: [ThreadsTopicService, ScraperService, TtsService],
  // BẮT BUỘC PHẢI CÓ DÒNG NÀY ĐỂ WATCHER CÓ THỂ GỌI ĐƯỢC
  exports: [ThreadsTopicService] 
})
export class ThreadsTopicModule {}