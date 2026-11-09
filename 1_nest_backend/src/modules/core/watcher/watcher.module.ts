import { Module } from '@nestjs/common';
import { WatcherService } from './watcher.service';
import { RemotionRunnerModule } from '../remotion-runner/remotion-runner.module'; // 👈 Thêm
import { WhisperModule } from '../ai/whisper/whisper.module';
import { AiModule } from '../ai/ai.module'; // 👈 Đảm bảo dùng AiModule thay cho GeminiModule
import { ThreadsDramaModule } from '../../workflows/threads-drama/threads-drama.module';

@Module({
  imports: [
    RemotionRunnerModule, // 👈 Thêm module này vào đây để sửa lỗi index [0]
    WhisperModule,
    AiModule,
    ThreadsDramaModule,
  ],
  providers: [WatcherService],
  exports: [WatcherService],
})
export class WatcherModule {}