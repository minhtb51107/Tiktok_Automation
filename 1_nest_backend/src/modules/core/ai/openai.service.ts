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

  async generateCore(prompt: string): Promise<string> {
    if (!this.openaiClient) throw new Error("Chưa cấu hình OpenAI Key");
    
    const [systemPart, userPart] = prompt.split('---');

    // 1. IN RAW REQUEST: Xem thực sự cái gì đang được nhét vào API
    this.logger.debug(`[OPENAI RAW REQUEST]: Đang gọi Model GPT-4o-mini...`);

    // KHÔNG try-catch bao che ở đây. Chết ở đâu văng lỗi đỏ ở đó!
    const response = await this.openaiClient.chat.completions.create({
      model: 'gpt-4o-mini', // Sếp đang cấu hình mini ở đây
      messages: [
        { role: 'system', content: systemPart ? systemPart.trim() : 'Bạn là trợ lý AI.' },
        { role: 'user', content: userPart ? userPart.trim() : prompt }
      ],
      response_format: { type: 'json_object' }
    });
    
    const rawOutput = response.choices[0].message.content || '';

    // 2. IN RAW RESPONSE: Trả về cái gì in nguyên xi cái đó, không parse!
    this.logger.warn(`\n========== [OPENAI RAW RESPONSE THỰC TẾ TỪ API] ==========\n${rawOutput}\n==========================================================\n`);

    return rawOutput;
  }

  async generateEmbedding(text: string): Promise<number[]> {
    if (!this.openaiClient) throw new Error("Chưa cấu hình OpenAI Key");
    const response = await this.openaiClient.embeddings.create({
      model: 'text-embedding-3-small',
      input: text,
    });
    return response.data[0].embedding;
  }
}