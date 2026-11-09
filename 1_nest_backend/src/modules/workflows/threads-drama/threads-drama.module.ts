import { Module } from '@nestjs/common';
import { AiModule } from '../../core/ai/ai.module';
import { RemotionRunnerModule } from '../../core/remotion-runner/remotion-runner.module';
import { ScraperModule } from '../../core/scraper/scraper.module';
import { TtsModule } from '../../core/tts/tts.module';
import { ThreadsDramaController } from './threads-drama.controller';
import { ThreadsDramaService } from './threads-drama.service';

@Module({
  imports: [AiModule, RemotionRunnerModule, ScraperModule, TtsModule],
  controllers: [ThreadsDramaController],     // Đã sửa lại tên Controller cho chuẩn
  providers: [ThreadsDramaService],
  exports: [ThreadsDramaService] // Chỉ xuất xưởng Drama ra ngoài
})
export class ThreadsDramaModule {}
