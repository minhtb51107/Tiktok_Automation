import { Module } from '@nestjs/common';
import { TiktokUploadService } from './tiktok-upload.service';
import { PrismaModule } from '../../../prisma/prisma.module';

@Module({
  imports: [PrismaModule],
  providers: [TiktokUploadService],
  exports: [TiktokUploadService],
})
export class UploaderModule {}
