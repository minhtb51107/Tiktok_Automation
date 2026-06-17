import { Injectable, Logger } from '@nestjs/common';
import { GeminiService } from './gemini.service';
import { GroqService } from './groq.service'; 
import { OpenaiService } from './openai.service';

@Injectable()
export class AiService {
  private readonly logger = new Logger(AiService.name);

  constructor(
    private readonly gemini: GeminiService, 
    private readonly groq: GroqService,      // FIX: Đổi về private cho đồng bộ
    private readonly openai: OpenaiService,  // FIX: Đổi về private cho đồng bộ
  ) {}

  async askGroq(prompt: string, isComplex: boolean = false): Promise<string> {
    const model = isComplex ? 'llama-3.3-70b-versatile' : 'llama-3.1-8b-instant';
    return await this.groq.generateText(prompt, model); // Nếu BaseAiService của sếp dùng generateText
  }

  async askGemini(prompt: string): Promise<string> {
    return await this.gemini.generateText(prompt);
  }

  async askOpenAI(prompt: string): Promise<string> {
    return await this.openai.generateCore(prompt);
  }

  async generateJsonText(prompt: string): Promise<string> {
    try {
      this.logger.log(`[1] Đang dùng não GPT-4o để chấm điểm và phân tích...`);
      return await this.openai.generateCore(prompt);
    } catch (e1: any) {
      this.logger.warn(`⚠️ GPT sập (${e1.message}). Gọi Llama 3 (Groq) cứu viện...`);
      try {
        return await this.groq.generateCore(prompt);
      } catch (e2: any) {
        this.logger.warn(`⚠️ Groq cũng sập (${e2.message}). Gọi Gemini cứu viện...`);
        try {
          return await this.gemini.generateCore(prompt);
        } catch (e3: any) {
          this.logger.error(`❌ Toàn bộ API AI đều báo lỗi!`);
          throw e3; 
        }
      }
    }
  }

  async processMusicScript(whisperData: any, originalLyrics?: string): Promise<any> {
    const prompt = `Bạn là chuyên gia phân tích âm nhạc. 
Xử lý dữ liệu Whisper sau và kết hợp với Lyrics gốc (nếu có). Trả về JSON hợp lệ.
====== WHISPER DATA ======
${JSON.stringify(whisperData)}
====== LYRICS GỐC ======
${originalLyrics || "Không có"}`;

    try {
      this.logger.log(`Đang dùng GPT tạo kịch bản âm nhạc...`);
      return await this.openai.generateCore(prompt);
    } catch (e1: any) {
      try { 
        this.logger.warn(`⚠️ GPT làm nhạc lỗi, chuyển sang Groq...`);
        return await this.groq.generateCore(prompt); 
      } 
      catch (e2: any) { 
        this.logger.warn(`⚠️ Groq lỗi, chuyển sang Gemini...`);
        return await this.gemini.generateCore(prompt); 
      }
    }
  }

  async generateEmbedding(text: string): Promise<number[]> {
    this.logger.log(`🧬 Đang chuyển đổi văn bản thành Vector bằng OpenAI...`);
    return await this.openai.generateEmbedding(text);
  }

  async askExpert(prompt: string): Promise<string> {
    this.logger.log(`🧠 Gọi chuyên gia GPT-4o để xào nấu kịch bản...`);
    return await this.openai.generateCore(prompt); 
  }

  async generateScoutJson(prompt: string): Promise<string> {
    try {
      this.logger.log(`🕵️ Đang dùng Llama-3 (Groq) siêu rẻ làm Lính Trinh Sát...`);
      return await this.groq.generateCore(prompt);
    } catch (e1: any) {
      this.logger.warn(`⚠️ Groq bận. Điều động Gemini (Free) đi săn thay thế...`);
      return await this.gemini.generateCore(prompt);
    }
  }
}
