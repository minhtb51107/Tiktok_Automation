import { Module } from '@nestjs/common';
import { TiktokUploadService } from './tiktok-upload.service';

@Module({
  providers: [TiktokUploadService],
  exports: [TiktokUploadService],
})
export class UploaderModule {}