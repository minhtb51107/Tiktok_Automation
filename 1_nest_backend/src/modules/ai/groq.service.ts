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
      // Vẫn dùng OpenAI library nhưng trỏ thẳng vào tim của Groq
      this.groqClient = new OpenAI({ apiKey: key, baseURL: 'https://api.groq.com/openai/v1' });
    }
  }

  // HÀM MỚI: Trả text bình thường, hỗ trợ chọn model nhẹ/nặng
  // Cập nhật model mặc định sang bản 3.1 mới nhất
  async generateText(prompt: string, model: string = 'llama-3.1-8b-instant'): Promise<string> {
    if (!this.groqClient) throw new Error("Thiếu cấu hình GROQ_API_KEY");
    
    try {
      const response = await this.groqClient.chat.completions.create({
        model: model, 
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.3, // Nghiêm túc, không bịa
      });
      return response.choices[0].message.content || '';
    } catch (error: any) {
      this.logger.error(`Groq Error: ${error.message}`);
      throw error;
    }
  }

  // Giữ lại hàm cũ của sếp lỡ có chỗ nào xài
  async generateCore(prompt: string, taskType: 'logic' | 'data' = 'logic'): Promise<string> {
    if (!this.groqClient) throw new Error("Thiếu cấu hình GROQ_API_KEY");
    const response = await this.groqClient.chat.completions.create({
      model: 'llama-3.3-70b-versatile', 
      messages: [{ role: 'user', content: prompt }],
      response_format: { type: 'json_object' }
    });
    return response.choices[0].message.content || '{}';
  }
}