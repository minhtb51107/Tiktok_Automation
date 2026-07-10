import { Injectable } from '@nestjs/common';
import { BaseAiService } from './base-ai.service';
import OpenAI from 'openai';
import { PrismaService } from '../../../prisma/prisma.service';

@Injectable()
export class OpenaiService extends BaseAiService {
  private openaiClient: OpenAI;

  constructor(protected readonly prisma: PrismaService) {
    super(OpenaiService.name, prisma);
    const key = process.env.OPENAI_API_KEY;
    if (key) this.openaiClient = new OpenAI({ apiKey: key });
  }

  protected async generateCore(prompt: string, taskType?: 'logic' | 'data'): Promise<string> {
    if (!this.openaiClient) throw new Error("Chưa cấu hình OpenAI Key");
    
    const [systemPart, userPart] = prompt.split('---');
    const isData = taskType === 'data';

    this.logger.debug(`[OPENAI API]: Đang gọi Model gpt-4o-mini (Task: ${taskType || 'logic'})...`);

    const response = await this.openaiClient.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: systemPart ? systemPart.trim() : 'Bạn là trợ lý AI.' },
        { role: 'user', content: userPart ? userPart.trim() : prompt }
      ],
      // Nếu là data, tự động ép định dạng JSON chuẩn
      response_format: isData ? { type: 'json_object' } : undefined,
      temperature: isData ? 0.2 : 0.7,
    });
    
    return response.choices[0].message.content || (isData ? '{}' : '');
  }

  // Hàm nhúng Vector giữ nguyên (không cần đưa vào phễu giám sát vì không trả về text)
  async generateEmbedding(text: string): Promise<number[]> {
    if (!this.openaiClient) throw new Error("Chưa cấu hình OpenAI Key");
    const response = await this.openaiClient.embeddings.create({
      model: 'text-embedding-3-small',
      input: text,
    });
    return response.data[0].embedding;
  }
}