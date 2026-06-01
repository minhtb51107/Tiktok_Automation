import { Injectable } from '@nestjs/common';
import { BaseAiService } from './base-ai.service';
import OpenAI from 'openai';

@Injectable()
export class OpenaiService extends BaseAiService {
  private openai: OpenAI;

  constructor() {
    super(OpenaiService.name);
    const key = process.env.OPENAI_API_KEY;
    if (key) this.openai = new OpenAI({ apiKey: key });
  }

  // Triển khai hàm bắt buộc
  async generateCore(prompt: string): Promise<string> {
    if (!this.openai) throw new Error("Chưa cấu hình OpenAI Key");
    const response = await this.openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [{ role: 'user', content: prompt }],
      response_format: { type: 'json_object' } // Ép GPT trả JSON chuẩn
    });
    return response.choices[0].message.content || '';
  }
}