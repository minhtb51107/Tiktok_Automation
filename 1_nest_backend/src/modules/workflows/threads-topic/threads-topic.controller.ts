// src/modules/workflows/threads-topic/threads-topic.controller.ts
import { Controller, Post, Body } from '@nestjs/common';
import { ThreadsTopicService } from './threads-topic.service';

@Controller('api/threads')
export class ThreadsTopicController {
  constructor(private readonly threadsTopicService: ThreadsTopicService) {}

  @Post('generate')
  async generate(@Body('url') url: string) {
    if (!url) {
      return { success: false, message: 'Vui lòng cung cấp url bài viết Threads' };
    }
    
    // Gọi thẳng vào service xử lý tổng thể
    const result = await this.threadsTopicService.processThreadsVideo(url);
    return result;
  }
}