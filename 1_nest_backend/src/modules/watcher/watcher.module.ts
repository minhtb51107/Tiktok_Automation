import { Module } from '@nestjs/common';
import { WatcherService } from './watcher.service';
import { RemotionRunnerModule } from '../remotion-runner/remotion-runner.module';
import { WhisperModule } from '../whisper/whisper.module'; // <--- Thêm dòng này
import { GeminiModule } from '../gemini/gemini.module';

@Module({
  imports: [RemotionRunnerModule, WhisperModule, GeminiModule], // <--- Thêm GeminiModule
  providers: [WatcherService],
})
export class WatcherModule {}