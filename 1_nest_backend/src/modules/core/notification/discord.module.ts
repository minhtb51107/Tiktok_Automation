import { Module } from '@nestjs/common';
import { DiscordService } from './discord.service';
import { ThreadsDramaModule } from '../../workflows/threads-drama/threads-drama.module';
import { ThreadsSeriousModule } from '../../workflows/threads-serious/threads-serious.module';
import { ThreadsCompilationModule } from '../../workflows/threads-compilation/threads-compilation.module'; 
import { TiktokUploadService } from '../uploader/tiktok-upload.service';

@Module({
  imports: [
    ThreadsDramaModule,   
    ThreadsSeriousModule, 
    ThreadsCompilationModule // <-- BẮT BUỘC THÊM DÒNG NÀY ĐỂ KẾT NỐI
  ],
  providers: [
    DiscordService,
    TiktokUploadService
  ],
  exports: [DiscordService]
})
export class DiscordModule {}
