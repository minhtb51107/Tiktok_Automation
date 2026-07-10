import { Injectable } from '@nestjs/common';
import { BaseAiService } from './base-ai.service';
import { HfInference } from '@huggingface/inference';
import { PrismaService } from '../../../prisma/prisma.service';

@Injectable()
export class HuggingFaceService extends BaseAiService {
  private hf: HfInference;
  private defaultModel = 'Qwen/Qwen2.5-72B-Instruct'; 

  constructor(protected readonly prisma: PrismaService) {
    super(HuggingFaceService.name, prisma);
    this.hf = new HfInference(process.env.HUGGINGFACE_API_KEY);
  }

  protected async generateCore(prompt: string, taskType?: 'logic' | 'data'): Promise<string> {
    try {
      this.logger.log(`[HUGGINGFACE API]: Đang gọi Chat Completion với Model ${this.defaultModel}...`);
      
      const isData = taskType === 'data';
      
      // Chuyển sang chatCompletion để tương thích 100% với cấu hình provider của Hugging Face
     const response = await this.hf.chatCompletion({
        model: this.defaultModel,
        messages: [
          { role: 'system', content: 'Bạn là một trợ lý AI chỉ xuất ra JSON sạch.' },
          { role: 'user', content: prompt }
        ],
        max_tokens: 4096, // TĂNG LÊN ĐỂ KHÔNG BỊ CẮT CỤT CHUỖI JSON ĐẦU RA
        temperature: 0.2, 
      });

      return response.choices[0].message.content || '';
    } catch (error: any) {
      this.logger.error(`❌ Lỗi Hugging Face API: ${error.message}`);
      throw error;
    }
  }
}