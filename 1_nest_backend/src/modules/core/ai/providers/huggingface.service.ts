import { Injectable } from '@nestjs/common';
import { BaseAiService } from './base-ai.service';
import { PrismaService } from '../../../../prisma/prisma.service';

@Injectable()
export class HuggingFaceService extends BaseAiService {
  // Găm model Qwen 72B Instruct thông qua Router
  private defaultModel = 'Qwen/Qwen2.5-72B-Instruct';

  constructor(protected readonly prisma: PrismaService) {
    super(HuggingFaceService.name, prisma);
  }

  protected async generateCore(prompt: string, taskType?: 'logic' | 'data'): Promise<string> {
    try {
      this.logger.log(`[HUGGINGFACE API]: Đang gọi Chat Completion qua ROUTER API (${this.defaultModel})...`);

      const isData = taskType === 'data';

      const systemContent = isData
        ? 'Bạn là một trợ lý AI chuyên nghiệp, chỉ xuất ra cấu trúc cấu hình dữ liệu JSON sạch.'
        : 'Bạn là một đạo diễn biên kịch tài ba, tuân thủ tuyệt đối cấu trúc văn bản được yêu cầu.';

      // 🔥 ĐÃ CẬP NHẬT: Sử dụng Router API tối tân của Hugging Face
      const response = await fetch(
        'https://router.huggingface.co/v1/chat/completions',
        {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${process.env.HUGGINGFACE_API_KEY}`,
            'Content-Type': 'application/json',
            // Router vẫn hỗ trợ sếp ghim cụm chip SambaNova chạy với tốc độ tên lửa!
            'X-Inference-Provider': 'sambanova',
            'x-use-cache': 'false'
          },
          body: JSON.stringify({
            model: this.defaultModel, // Tên model truyền mượt mà ở Body JSON
            messages: [
              { role: 'system', content: systemContent },
              { role: 'user', content: prompt }
            ],
            max_tokens: 4096,
            temperature: 0.3,
          }),
          signal: AbortSignal.timeout(90000)
        }
      );

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Hugging Face Router báo lỗi HTTP ${response.status}: ${errorText}`);
      }

      const resData = await response.json() as any;
      return resData.choices[0].message.content || '';

    } catch (error: any) {
      this.logger.error(`❌ Lỗi Hugging Face Router API: ${error.message}`);
      throw error;
    }
  }
}