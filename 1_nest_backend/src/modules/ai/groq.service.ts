import { Injectable } from '@nestjs/common';
import { BaseAiService } from './base-ai.service';
import OpenAI from 'openai';

@Injectable()
export class GroqService extends BaseAiService {
  private groqClient: OpenAI;

  constructor() {
    super(GroqService.name);
    const key = process.env.GROQ_API_KEY;
    if (key) {
      this.groqClient = new OpenAI({ apiKey: key, baseURL: 'https://api.groq.com/openai/v1' });
    }
  }

  async generateCore(prompt: string, taskType: 'logic' | 'data' = 'logic'): Promise<string> {
    if (!this.groqClient) throw new Error("Thiếu cấu hình GROQ_API_KEY");
    
    // Groq đủ nhanh để dùng 70b-versatile cho mọi tác vụ
    const response = await this.groqClient.chat.completions.create({
      model: 'llama-3.3-70b-versatile', 
      messages: [{ role: 'user', content: prompt }],
      response_format: { type: 'json_object' }
    });
    
    return response.choices[0].message.content || '{}';
  }
}