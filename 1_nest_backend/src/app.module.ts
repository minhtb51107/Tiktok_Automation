import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { WatcherModule } from './modules/core/watcher/watcher.module';
import { RemotionRunnerModule } from './modules/core/remotion-runner/remotion-runner.module';
import { WhisperModule } from './modules/core/ai/whisper/whisper.module'
import { ScraperModule } from './modules/core/scraper/scraper.module';
import { TtsModule } from './modules/core/tts/tts.module';
import { UploaderModule } from './modules/core/uploader/uploader.module';
import { AutoHunterModule } from './modules/workers/auto-hunter/auto-hunter.module';
import { ScheduleModule } from '@nestjs/schedule'; 
import { PrismaModule } from './prisma/prisma.module';

import { DiscordModule } from './modules/core/notification/discord.module';

@Module({
  imports: [
    ScheduleModule.forRoot(),
    WatcherModule, 
    RemotionRunnerModule, 
    WhisperModule, 
    PrismaModule,
    ScraperModule,
    TtsModule,
    UploaderModule,
    // AutoHunterModule,
    DiscordModule // <--- Khởi động trạm trung gian
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
