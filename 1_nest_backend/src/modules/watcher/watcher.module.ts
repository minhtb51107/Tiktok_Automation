import { Module } from '@nestjs/common';
import { WatcherService } from './watcher.service';
import { RemotionRunnerModule } from '../remotion-runner/remotion-runner.module';
import { WhisperModule } from '../whisper/whisper.module'; 
import { GeminiModule } from '../core/ai/gemini.module';
import { ThreadsDramaModule } from '../workflows/threads-drama/threads-drama.module';

@Module({
  imports: [
    RemotionRunnerModule, 
    WhisperModule, 
    GeminiModule, 
    ThreadsDramaModule 
  ],
  providers: [WatcherService],
})
export class WatcherModule {}
