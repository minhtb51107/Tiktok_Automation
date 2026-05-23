import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { WatcherModule } from './modules/watcher/watcher.module';
import { RemotionRunnerModule } from './modules/remotion-runner/remotion-runner.module';
import { WhisperModule } from './modules/whisper/whisper.module';
import { GeminiModule } from './modules/gemini/gemini.module';

@Module({
  imports: [WatcherModule, RemotionRunnerModule, WhisperModule, GeminiModule],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
