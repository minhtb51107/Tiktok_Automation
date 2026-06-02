import { Injectable } from '@nestjs/common';
import { BaseAiService } from './base-ai.service';
import OpenAI from 'openai';

@Injectable()
export class OpenaiService extends BaseAiService {
  private openaiClient: OpenAI;

  constructor() {
    super(OpenaiService.name);
    const key = process.env.OPENAI_API_KEY;
    if (key) this.openaiClient = new OpenAI({ apiKey: key });
  }

  // Hàm tạo text thông thường
  async generateCore(prompt: string): Promise<string> {
    if (!this.openaiClient) throw new Error("Chưa cấu hình OpenAI Key");
    const response = await this.openaiClient.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [{ role: 'user', content: prompt }],
      response_format: { type: 'json_object' }
    });
    return response.choices[0].message.content || '';
  }

  // HÀM TẠO VECTOR (EMBEDDING)
  async generateEmbedding(text: string): Promise<number[]> {
    if (!this.openaiClient) throw new Error("Chưa cấu hình OpenAI Key");
    try {
      const response = await this.openaiClient.embeddings.create({
        model: 'text-embedding-3-small',
        input: text,
      });
      return response.data[0].embedding;
    } catch (error: any) {
      this.logger.error(`Lỗi tạo Embedding: ${error.message}`);
      throw error;
    }
  }
}