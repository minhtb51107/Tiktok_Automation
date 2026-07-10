import { Injectable } from '@nestjs/common';
import { BaseAiService } from './base-ai.service';
import OpenAI from 'openai';
import { PrismaService } from '../../../prisma/prisma.service';

@Injectable()
export class GroqService extends BaseAiService {
  private groqClient: OpenAI;

  constructor(protected readonly prisma: PrismaService) {
    super(GroqService.name, prisma);
    const key = process.env.GROQ_API_KEY;
    if (key) {
      this.groqClient = new OpenAI({ apiKey: key, baseURL: 'https://api.groq.com/openai/v1' });
    }
  }

  protected async generateCore(prompt: string, taskType: 'logic' | 'data' = 'logic'): Promise<string> {
    if (!this.groqClient) throw new Error("Thiếu cấu hình GROQ_API_KEY");
    
    const isData = taskType === 'data';
    // Động lực chọn Model: Logic nhỏ gọn dùng 8b, xử lý JSON phức tạp dùng 70b
    const modelName = isData ? 'llama-3.3-70b-versatile' : 'llama-3.1-8b-instant';
    
    this.logger.debug(`[GROQ API]: Đang gọi Model ${modelName}...`);

    const response = await this.groqClient.chat.completions.create({
      model: modelName, 
      messages: [{ role: 'user', content: prompt }],
      temperature: isData ? 0.1 : 0.3,
      response_format: isData ? { type: 'json_object' } : undefined
    });
    
    return response.choices[0].message.content || (isData ? '{}' : '');
  }
}