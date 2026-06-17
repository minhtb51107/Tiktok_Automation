import { Module } from '@nestjs/common';
import { RemotionRunnerService } from './remotion-runner.service';

@Module({
  providers: [RemotionRunnerService],
  exports: [RemotionRunnerService], // <--- Thêm dòng này để chia sẻ Service ra ngoài
})
export class RemotionRunnerModule {}
