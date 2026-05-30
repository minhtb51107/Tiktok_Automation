import { Module } from '@nestjs/common';
import { WatcherService } from './watcher.service';
import { RemotionRunnerModule } from '../remotion-runner/remotion-runner.module';
import { WhisperModule } from '../whisper/whisper.module'; 
import { GeminiModule } from '../gemini/gemini.module';
// 1. THÊM DÒNG NÀY ĐỂ NHẬN DIỆN THREADS
import { ThreadsTopicModule } from '../workflows/threads-topic/threads-topic.module';

@Module({
  imports: [
    RemotionRunnerModule, 
    WhisperModule, 
    GeminiModule, 
    // 2. KHAI BÁO MODULE VÀO ĐÂY
    ThreadsTopicModule 
  ],
  providers: [WatcherService],
})
export class WatcherModule {}