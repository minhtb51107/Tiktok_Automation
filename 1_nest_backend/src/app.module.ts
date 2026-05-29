import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { WatcherModule } from './modules/watcher/watcher.module';
import { RemotionRunnerModule } from './modules/remotion-runner/remotion-runner.module';
import { WhisperModule } from './modules/whisper/whisper.module';
import { GeminiModule } from './modules/gemini/gemini.module';
import { TiktokLyricsModule } from './modules/workflows/tiktok-lyrics/tiktok-lyrics.module';
import { ThreadsTopicModule } from './modules/workflows/threads-topic/threads-topic.module';

@Module({
  imports: [WatcherModule, RemotionRunnerModule, WhisperModule, GeminiModule, TiktokLyricsModule, ThreadsTopicModule],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
