import { Module } from '@nestjs/common';
import { WatcherService } from './watcher.service';
import { TiktokLyricsModule } from '../workflows/tiktok-lyrics/tiktok-lyrics.module';
import { ThreadsTopicModule } from '../workflows/threads-topic/threads-topic.module';

@Module({
  imports: [TiktokLyricsModule, ThreadsTopicModule], // Nạp 2 phân xưởng vào
  providers: [WatcherService],
})
export class WatcherModule {}