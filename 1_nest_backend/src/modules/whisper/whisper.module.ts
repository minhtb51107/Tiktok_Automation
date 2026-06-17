import { Module } from '@nestjs/common';
import { WhisperService } from './whisper.service';

@Module({
  providers: [WhisperService],
  exports: [WhisperService] // <--- Bắt buộc phải có dòng này
})
export class WhisperModule {}
