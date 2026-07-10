import { Injectable } from '@nestjs/common';
import { BaseAiService } from './base-ai.service';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { PrismaService } from '../../../prisma/prisma.service';

@Injectable()
export class GeminiService extends BaseAiService {
  private apiKeys: string[] = [];
  private currentKeyIndex = 0;
  private genAI: GoogleGenerativeAI;

  constructor(protected readonly prisma: PrismaService) {
    super(GeminiService.name, prisma);
    const envKeys = process.env.GEMINI_API_KEY;
    if (envKeys) {
      this.apiKeys = envKeys.split(',').map(k => k.trim()).filter(Boolean);
      if (this.apiKeys.length > 0) this.genAI = new GoogleGenerativeAI(this.apiKeys[0]);
    }
  }

  private rotateKey() {
    if (this.apiKeys.length <= 1) return; 
    this.currentKeyIndex = (this.currentKeyIndex + 1) % this.apiKeys.length;
    this.genAI = new GoogleGenerativeAI(this.apiKeys[this.currentKeyIndex]);
    this.logger.warn(`🔄 Đã chuyển sang API Key Gemini số ${this.currentKeyIndex + 1}`);
  }

  protected async generateCore(prompt: string, taskType: 'logic' | 'data' = 'logic'): Promise<string> {
    if (this.apiKeys.length === 0) {
      throw new Error("Thiếu cấu hình GEMINI_API_KEY. Vui lòng kiểm tra file .env");
    }

    const maxRetries = this.apiKeys.length;
    let attempt = 0;
    
    // Cập nhật model name (Google đã dùng gemini-1.5-flash)
    const modelName = taskType === 'logic' ? 'gemini-1.5-flash' : 'gemini-1.5-flash-8b';

    while (attempt < maxRetries) {
      try {
        this.logger.log(`[GEMINI API]: Đang gọi Model ${modelName}`);
        const model = this.genAI.getGenerativeModel({ model: modelName });
        
        // Cấu hình ép xuất JSON (Hỗ trợ từ Gemini 1.5)
        const config = taskType === 'data' ? { generationConfig: { responseMimeType: "application/json" } } : {};

        const res = await model.generateContent({
          contents: [{ role: 'user', parts: [{ text: prompt }] }],
          ...config
        });
        return res.response.text();
      } catch (error: any) {
        attempt++;
        this.logger.error(`❌ Lỗi API Gemini (${modelName}) (Lần ${attempt}/${maxRetries}): ${error.message}`);
        
        if (attempt >= maxRetries) throw new Error(`GEMINI_CRASHED: ${error.message}`);
        
        this.rotateKey();
        
        const waitTime = 5000 * Math.pow(3, attempt - 1);
        await new Promise(r => setTimeout(r, waitTime));
      }
    }
    return '';
  }

  async generateEmbedding(text: string): Promise<number[]> {
    if (!this.genAI) throw new Error("Chưa cấu hình Gemini Key");
    
    let attempt = 0;
    while (attempt < this.apiKeys.length) {
      try {
       const model = this.genAI.getGenerativeModel({ model: 'embedding-001' });
        const result = await model.embedContent(text);
        return result.embedding.values;
      } catch (error: any) {
        attempt++;
        this.logger.warn(`Lỗi tạo Vector Gemini (Lần ${attempt}): ${error.message}`);
        
        if (attempt >= this.apiKeys.length) break;
        
        this.rotateKey();
        await new Promise(r => setTimeout(r, 2000));
      }
    }
    throw new Error("Không thể tạo Vector, toàn bộ Key Gemini đã sập!");
  }
}