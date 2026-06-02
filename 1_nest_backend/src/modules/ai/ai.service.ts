import { Injectable, Logger } from '@nestjs/common';
import { GeminiService } from './gemini.service';
import { GroqService } from './groq.service'; 
import { OpenaiService } from './openai.service';

@Injectable()
export class AiService {
  private readonly logger = new Logger(AiService.name);

  constructor(
    private readonly gemini: GeminiService,
    private readonly groq: GroqService,     
    private readonly openai: OpenaiService,
  ) {}

  async generateJsonText(prompt: string): Promise<string> {
    try {
      this.logger.log(`[1] Đang nhờ Gemini viết kịch bản...`);
      return await this.gemini.generateText(prompt);
    } catch (e1: any) {
      this.logger.warn(`⚠️ Gemini sập (${e1.message}). Gọi Llama 3 (Groq) cứu viện...`);
      try {
        return await this.groq.generateText(prompt);
      } catch (e2: any) {
        this.logger.warn(`⚠️ Groq cũng sập (${e2.message}). Gọi OpenAI cứu viện...`);
        try {
          return await this.openai.generateText(prompt);
        } catch (e3: any) {
          // Bắt quả tang lỗi thực sự của OpenAI tại đây
          this.logger.error(`❌ OpenAI báo lỗi: ${e3.message}`);
          throw e3; 
        }
      }
    }
  }

  async processMusicScript(whisperData: any, originalLyrics?: string): Promise<any> {
    try {
      this.logger.log(`[1] Đang nhờ Gemini làm nhạc...`);
      return await this.gemini.generateLyricScript(whisperData, originalLyrics);
    } catch (e1: any) {
      this.logger.warn(`⚠️ Gemini sập (${e1.message}). Đẩy qua Groq...`);
      try {
        return await this.groq.generateLyricScript(whisperData, originalLyrics);
      } catch (e2: any) {
        this.logger.warn(`⚠️ Groq sập (${e2.message}). Đẩy qua OpenAI...`);
        try {
          return await this.openai.generateLyricScript(whisperData, originalLyrics);
        } catch (e3: any) {
          this.logger.error(`❌ OpenAI làm nhạc lỗi: ${e3.message}`);
          throw e3;
        }
      }
    }
  }

  // Gọi GEMINI cho việc tạo Vector (0 đồng trọn đời)
  async generateEmbedding(text: string): Promise<number[]> {
    this.logger.log(`🧬 Đang chuyển đổi văn bản thành Vector bằng Gemini...`);
    return await this.gemini.generateEmbedding(text);
  }
}