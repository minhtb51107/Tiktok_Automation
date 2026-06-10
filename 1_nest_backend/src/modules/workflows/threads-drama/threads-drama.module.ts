import { Module } from '@nestjs/common';
import { AiModule } from '../../core/ai/ai.module';
import { ScraperService } from '../../core/scraper/scraper.service';
import { TtsService } from '../../core/tts/tts.service';
import { RemotionRunnerModule } from '../../remotion-runner/remotion-runner.module';
import { ThreadsDramaController } from './threads-drama.controller';
import { ThreadsDramaService } from './threads-drama.service';

@Module({
  imports: [AiModule, RemotionRunnerModule], // Tuyệt đối không import Serious hay Discord
  controllers: [ThreadsDramaController],     // Đã sửa lại tên Controller cho chuẩn
  providers: [
    ThreadsDramaService, 
    ScraperService, 
    TtsService 
    // 🔥 ĐÃ XÓA: DiscordService, TiktokUploadService, HunterService ra khỏi đây!
  ],
  exports: [ThreadsDramaService] // Chỉ xuất xưởng Drama ra ngoài
})
export class ThreadsDramaModule {}