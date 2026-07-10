import { Injectable, Logger } from '@nestjs/common';
import { GeminiService } from './gemini.service';
import { GroqService } from './groq.service'; 
import { OpenaiService } from './openai.service';
import { HuggingFaceService } from './huggingface.service';

@Injectable()
export class AiService {
  private readonly logger = new Logger(AiService.name);

  constructor(
    private readonly gemini: GeminiService, 
    private readonly groq: GroqService,      
    private readonly openai: OpenaiService,  
    private readonly huggingface: HuggingFaceService,
  ) {}

  async askHuggingFace(prompt: string): Promise<string> {
    return await this.huggingface.generateText(prompt, 'logic');
  }

  // FIX LỖI TS2345: Đổi model thành 'data' hoặc 'logic'
  async askGroq(prompt: string, isComplex: boolean = false): Promise<string> {
    return await this.groq.generateText(prompt, isComplex ? 'data' : 'logic'); 
  }

  async askGemini(prompt: string): Promise<string> {
    return await this.gemini.generateText(prompt, 'logic');
  }

  // FIX LỖI TS2445: generateCore -> generateText
  async askOpenAI(prompt: string): Promise<string> {
    return await this.openai.generateText(prompt, 'logic');
  }

  async generateJsonText(prompt: string): Promise<string> {
    try {
      this.logger.log(`[1] Đang dùng não GPT-4o để chấm điểm và phân tích...`);
      return await this.openai.generateText(prompt, 'data');
    } catch (e1: any) {
      this.logger.warn(`⚠️ GPT sập (${e1.message}). Gọi Llama 3 (Groq) cứu viện...`);
      try {
        return await this.groq.generateText(prompt, 'data');
      } catch (e2: any) {
        this.logger.warn(`⚠️ Groq sập (${e2.message}). Điều động Hugging Face Hub ứng cứu...`);
        try {
          return await this.huggingface.generateText(prompt, 'data');
        } catch (eHf: any) {
          this.logger.warn(`⚠️ Hugging Face cũng lỗi (${eHf.message}). Chuyển sang Gemini cứu viện cuối cùng...`);
          try {
            return await this.gemini.generateText(prompt, 'data');
          } catch (e3: any) {
            this.logger.error(`❌ Toàn bộ API AI bao gồm cả Hugging Face đều báo lỗi!`);
            throw e3; 
          }
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
      this.logger.log(`Đang dùng Hugging Face tạo kịch bản âm nhạc...`);
      return await this.huggingface.generateText(prompt, 'data');
    } catch (e1: any) {
      try { 
        this.logger.warn(`⚠️ Hugging Face lỗi, chuyển sang GPT dự phòng...`);
        return await this.openai.generateText(prompt, 'data'); 
      } 
      catch (e2: any) { 
        this.logger.warn(`⚠️ GPT lỗi, chuyển sang Gemini...`);
        return await this.gemini.generateText(prompt, 'data'); 
      }
    }
  }

  async generateEmbedding(text: string): Promise<number[]> {
    this.logger.log(`🧬 Đang chuyển đổi văn bản thành Vector bằng OpenAI...`);
    return await this.openai.generateEmbedding(text);
  }

  async askExpert(prompt: string): Promise<string> {
    this.logger.log(`🧠 Gọi chuyên gia Hugging Face để xào nấu kịch bản...`);
    return await this.huggingface.generateText(prompt, 'logic'); 
  }

  async generateScoutJson(prompt: string): Promise<string> {
    try {
      this.logger.log(`🕵️ Đang dùng Hugging Face làm Lính Trinh Sát...`);
      return await this.huggingface.generateText(prompt, 'data');
    } catch (e1: any) {
      this.logger.warn(`⚠️ Hugging Face bận. Điều động Gemini (Free) đi săn thay thế...`);
      return await this.gemini.generateText(prompt, 'data');
    }
  }
}