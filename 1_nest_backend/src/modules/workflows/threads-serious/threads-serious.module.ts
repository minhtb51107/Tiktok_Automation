import { Module } from '@nestjs/common';
import { AiModule } from '../../core/ai/ai.module';
// Module:
import { RemotionRunnerModule } from '../../core/remotion-runner/remotion-runner.module';
import { ThreadsSeriousService } from './threads-serious.service';
import { ThreadsSeriousController } from './threads-serious.controller';
import { ScraperModule } from '../../core/scraper/scraper.module';
import { TtsModule } from '../../core/tts/tts.module';
import { PrismaModule } from '../../../prisma/prisma.module';

@Module({
  imports: [
    PrismaModule, 
    AiModule,
    RemotionRunnerModule,
    ScraperModule,
    TtsModule,
  ],
  controllers: [ThreadsSeriousController],
  providers: [ThreadsSeriousService],
  exports: [ThreadsSeriousService]
})
export class ThreadsSeriousModule {}
