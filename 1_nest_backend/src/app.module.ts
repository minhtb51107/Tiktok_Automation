import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { WatcherModule } from './modules/watcher/watcher.module';
import { RemotionRunnerModule } from './modules/remotion-runner/remotion-runner.module';
import { WhisperModule } from './modules/whisper/whisper.module';
import { GeminiModule } from './modules/core/ai/gemini.module';
import { ScheduleModule } from '@nestjs/schedule'; 
import { PrismaModule } from './prisma/prisma.module';

// 🔥 IMPORT TRẠM TRUNG GIAN (Nó đã chứa sẵn Drama và Serious bên trong)
import { DiscordModule } from './modules/core/notification/discord.module';

@Module({
  imports: [
    ScheduleModule.forRoot(),
    WatcherModule, 
    RemotionRunnerModule, 
    WhisperModule, 
    GeminiModule,
    PrismaModule,
    DiscordModule // <--- Khởi động trạm trung gian
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}