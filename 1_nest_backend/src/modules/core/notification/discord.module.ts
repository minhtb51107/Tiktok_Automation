import { Module } from '@nestjs/common';
import { DiscordService } from './discord.service';
import { ThreadsDramaModule } from '../../workflows/threads-drama/threads-drama.module';
import { ThreadsSeriousModule } from '../../workflows/threads-serious/threads-serious.module';
import { TiktokUploadService } from '../uploader/tiktok-upload.service';

@Module({
  imports: [
    ThreadsDramaModule,   // Mượn xưởng Drama
    ThreadsSeriousModule  // Mượn xưởng Serious
  ],
  providers: [
    DiscordService,
    TiktokUploadService
  ],
  exports: [DiscordService]
})
export class DiscordModule {}