import { Module } from '@nestjs/common';
import { AiModule } from '../../ai/ai.module';
import { RemotionRunnerModule } from '../../remotion-runner/remotion-runner.module';
import { ThreadsTopicController } from './threads-topic.controller';
import { ThreadsTopicService } from './threads-topic.service';
import { ScraperService } from './scraper.service';
import { TtsService } from './tts.service';
import { DiscordService } from './discord.service';
import { TiktokUploadService } from './tiktok-upload.service';
import { HunterService } from './hunter.service'; // BƯỚC 1: Thêm dòng import này

@Module({
  imports: [AiModule, RemotionRunnerModule],
  controllers: [ThreadsTopicController],
  providers: [
    ThreadsTopicService, 
    ScraperService, 
    TtsService, 
    DiscordService,
    TiktokUploadService,
    HunterService // BƯỚC 2: Nhét HunterService vào đây để nó được phép chạy
  ],
  exports: [ThreadsTopicService]
})
export class ThreadsTopicModule {}