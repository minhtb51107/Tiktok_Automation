import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { WatcherModule } from './modules/watcher/watcher.module';
import { RemotionRunnerModule } from './modules/remotion-runner/remotion-runner.module';
import { WhisperModule } from './modules/whisper/whisper.module';
import { GeminiModule } from './modules/ai/gemini.module';
import { ThreadsTopicModule } from './modules/workflows/threads-topic/threads-topic.module';
import { ScheduleModule } from '@nestjs/schedule'; // IMPORT MODULE NÀY
import { PrismaModule } from './prisma/prisma.module';

@Module({
  imports: [
    ScheduleModule.forRoot(),
    WatcherModule, 
    RemotionRunnerModule, 
    WhisperModule, 
    GeminiModule,
    ThreadsTopicModule,
    PrismaModule // Đã thêm module Threads
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}