import { Module } from '@nestjs/common';
import { AiModule } from '../../core/ai/ai.module';
// Module:
import { RemotionRunnerModule } from '../../core/remotion-runner/remotion-runner.module';

// Service:
import { RemotionRunnerService } from '../../core/remotion-runner/remotion-runner.service';
import { ThreadsSeriousService } from './threads-serious.service';
import { ScraperService } from '../../core/scraper/scraper.service';
import { TtsService } from '../../core/tts/tts.service';
import { WhisperModule } from '../../core/ai/whisper/whisper.module';
import { PrismaModule } from '../../../prisma/prisma.module'; // 🔥 ĐÃ SỬA: Lên 3 cấp thư mục chuẩn xác

@Module({
  imports: [
    PrismaModule, 
    AiModule,
    RemotionRunnerModule, 
    WhisperModule
  ],
  providers: [ThreadsSeriousService, ScraperService, TtsService],
  exports: [ThreadsSeriousService]
})
export class ThreadsSeriousModule {}