import { Injectable, Logger } from '@nestjs/common';
import { GeminiService } from './gemini.service';
import { GroqService } from './groq.service'; 
import { OpenaiService } from './openai.service';

@Injectable()
export class AiService {
  private readonly logger = new Logger(AiService.name);

  constructor(
    private readonly gemini: GeminiService,
    public readonly groq: GroqService, // Đổi sang public để service khác gọi ké được    
    private readonly openai: OpenaiService,
  ) {}

  // HÀM MỚI THEO KIẾN TRÚC BĂM NHỎ: Gọi thẳng Groq
  async askGroq(prompt: string, isComplex: boolean = false): Promise<string> {
    // Đổi 'llama3-8b-8192' thành 'llama-3.1-8b-instant'
    const model = isComplex ? 'llama-3.3-70b-versatile' : 'llama-3.1-8b-instant';
    return await this.groq.generateText(prompt, model);
  }

  // ... (Phần dưới giữ nguyên không đụng chạm)
  async generateJsonText(prompt: string): Promise<string> {
    try {
      this.logger.log(`[1] Đang nhờ Gemini viết kịch bản...`);
      return await this.gemini.generateText(prompt);
    } catch (e1: any) {
      this.logger.warn(`⚠️ Gemini sập (${e1.message}). Gọi Llama 3 (Groq) cứu viện...`);
      try {
        return await this.groq.generateCore(prompt); // Sửa lại thành generateCore theo code của sếp
      } catch (e2: any) {
        this.logger.warn(`⚠️ Groq cũng sập (${e2.message}). Gọi OpenAI cứu viện...`);
        try {
          return await this.openai.generateText(prompt);
        } catch (e3: any) {
          this.logger.error(`❌ OpenAI báo lỗi: ${e3.message}`);
          throw e3; 
        }
      }
    }
  }

  async processMusicScript(whisperData: any, originalLyrics?: string): Promise<any> {
    try {
      return await this.gemini.generateLyricScript(whisperData, originalLyrics);
    } catch (e1: any) {
      try { return await this.groq.generateLyricScript(whisperData, originalLyrics); } 
      catch (e2: any) { return await this.openai.generateLyricScript(whisperData, originalLyrics); }
    }
  }

  async generateEmbedding(text: string): Promise<number[]> {
    this.logger.log(`🧬 Đang chuyển đổi văn bản thành Vector bằng openai...`);
    return await this.openai.generateEmbedding(text);
  }
}