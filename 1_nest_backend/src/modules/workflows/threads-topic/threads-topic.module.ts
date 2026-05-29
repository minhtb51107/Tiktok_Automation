import { Module } from '@nestjs/common';
import { ThreadsTopicService } from './threads-topic.service';

@Module({
  providers: [ThreadsTopicService],
  exports: [ThreadsTopicService]
})
export class ThreadsTopicModule {}