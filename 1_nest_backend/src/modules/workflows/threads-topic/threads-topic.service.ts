import { Injectable, Logger } from '@nestjs/common';

@Injectable()
export class ThreadsTopicService {
  private readonly logger = new Logger(ThreadsTopicService.name);
  private timer: NodeJS.Timeout;

  public checkAndProcess(textDir: string, imageDir: string) {
    if (this.timer) clearTimeout(this.timer);

    this.timer = setTimeout(async () => {
      this.logger.log(`🎉 [THREADS] Đã nhận tín hiệu mới. Bắt đầu xử lý Topic!`);
      // Code gọi Gemini viết bài và xuất Remotion video cho Threads sẽ viết ở đây sau...
    }, 3000);
  }
}