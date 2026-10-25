import { Logger } from '@nestjs/common';
import { PrismaService } from '../../../../prisma/prisma.service'; // Hoặc dùng alias @prisma/prisma.service

export abstract class BaseAiService {
  protected readonly logger: Logger;

  constructor(
    serviceName: string,
    protected readonly prisma: PrismaService
  ) {
    this.logger = new Logger(serviceName);
  }

  // Các class con bắt buộc phải implement hàm này
  protected abstract generateCore(prompt: string, taskType?: 'logic' | 'data'): Promise<string>;

  // Phễu giám sát & ghi log toàn bộ AI
  public async generateText(prompt: string, taskType: 'logic' | 'data' = 'logic'): Promise<string> {
    const startTime = Date.now();
    this.logger.debug(`📥 AI INPUT [${taskType}]: ${prompt.substring(0, 300)}...`);

    try {
      const result = await this.generateCore(prompt, taskType);
      const duration = Date.now() - startTime;

      this.logger.debug(`📤 AI OUTPUT (${duration}ms)`);

      // Lưu log thành công vào DB ngầm
      this.prisma.aiAuditLog.create({
        data: {
          provider: this.constructor.name,
          taskType,
          prompt,
          response: result,
          durationMs: duration,
          isSuccess: true,
        }
      }).catch(err => this.logger.error('Lỗi khi lưu log AI', err));

      return result;
    } catch (error: any) {
      const duration = Date.now() - startTime;
      this.logger.error(`❌ AI ERROR (${duration}ms): ${error.message}`);

      // Lưu log thất bại vào DB ngầm
      this.prisma.aiAuditLog.create({
        data: {
          provider: this.constructor.name,
          taskType,
          prompt,
          durationMs: duration,
          isSuccess: false,
          errorMessage: error.message,
        }
      }).catch(err => this.logger.error('Lỗi khi lưu log AI', err));

      throw error;
    }
  }
}