import { Injectable } from '@nestjs/common';
import { BaseAiService } from './base-ai.service';
import { GoogleGenerativeAI } from '@google/generative-ai';

@Injectable()
export class GeminiService extends BaseAiService {
  private apiKeys: string[] = [];
  private currentKeyIndex = 0;
  private genAI: GoogleGenerativeAI;

  constructor() {
    super(GeminiService.name);
    const envKeys = process.env.GEMINI_API_KEY;
    if (envKeys) {
      this.apiKeys = envKeys.split(',').map(k => k.trim()).filter(Boolean);
      if (this.apiKeys.length > 0) this.genAI = new GoogleGenerativeAI(this.apiKeys[0]);
    }
  }

  async generateCore(prompt: string, taskType: 'logic' | 'data' = 'logic'): Promise<string> {
    if (this.apiKeys.length === 0) {
      throw new Error("Thiếu cấu hình GEMINI_API_KEY. Vui lòng kiểm tra file .env");
    }

    const maxRetries = this.apiKeys.length;
    let attempt = 0;
    
    // Tách luồng mô hình đỉnh cao nhất năm 2026
    const modelName = taskType === 'logic' ? 'gemini-3.5-flash' : 'gemini-3.1-flash-lite';

    while (attempt < maxRetries) {
      try {
        this.logger.log(`🤖 Đang điều phối cho Gemini chạy model: [${modelName}]`);
        const model = this.genAI.getGenerativeModel({ model: modelName });
        const res = await model.generateContent(prompt);
        return res.response.text();
      } catch (error: any) {
        attempt++;
        this.logger.error(`❌ Lỗi API Gemini (${modelName}) (Lần ${attempt}/${maxRetries}): ${error.message}`);
        
        if (attempt >= maxRetries) throw new Error(`GEMINI_CRASHED: ${error.message}`);
        
        this.currentKeyIndex = (this.currentKeyIndex + 1) % this.apiKeys.length;
        this.genAI = new GoogleGenerativeAI(this.apiKeys[this.currentKeyIndex]);
        
        const waitTime = 5000 * Math.pow(3, attempt - 1);
        await new Promise(r => setTimeout(r, waitTime));
      }
    }
    return '';
  }
}