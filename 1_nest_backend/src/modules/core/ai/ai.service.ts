import { Injectable, Logger, InternalServerErrorException } from '@nestjs/common';
import { GeminiService } from './providers/gemini.service';
import { OpenaiService } from './providers/openai.service';
import { GroqService } from './providers/groq.service';
import { HuggingFaceService } from './providers/huggingface.service';
import { BaseAiService } from './providers/base-ai.service';
import * as path from 'path';
import * as fs from 'fs';

@Injectable()
export class AiService {
  private readonly logger = new Logger(AiService.name);

  constructor(
    private readonly gemini: GeminiService,
    private readonly groq: GroqService,
    private readonly openai: OpenaiService,
    private readonly huggingface: HuggingFaceService,
  ) {}

  /**
   * 🔥 HÀM THẦN THÁNH: Tự động chạy chuỗi dự phòng (Fallback Chain) dạng mảng
   * Loại bỏ hoàn toàn Try-Catch lồng nhau!
   */
  async executeWithFallback(
    prompt: string,
    taskType: 'logic' | 'data' = 'logic',
    chain?: BaseAiService[]
  ): Promise<string> {
    // Thứ tự mặc định nếu không truyền: HuggingFace -> Groq -> OpenAI -> Gemini
    const providers = chain || [this.huggingface, this.groq, this.openai, this.gemini];

    for (const provider of providers) {
      try {
        this.logger.log(`🤖 [AI Chain] Đang gọi ${provider.constructor.name} (${taskType})...`);
        const result = await provider.generateText(prompt, taskType);
        if (result) return result;
      } catch (error: any) {
        this.logger.warn(`⚠️ [AI Chain] ${provider.constructor.name} lỗi (${error.message}). Đang chuyển AI tiếp theo...`);
      }
    }

    this.logger.error('❌ Tất cả AI Providers trong chuỗi dự phòng đều thất bại!');
    throw new InternalServerErrorException('Tất cả các dịch vụ AI hiện không khả dụng.');
  }

  // ===== CÁC HÀM NGHIỆP VỤ RÚT GỌN SIÊU SẠCH =====

  async generateJsonText(prompt: string): Promise<string> {
    // Chuỗi ưu tiên: OpenAI -> Groq -> HuggingFace -> Gemini
    return this.executeWithFallback(prompt, 'data', [this.openai, this.groq, this.huggingface, this.gemini]);
  }

  async processMusicScript(whisperData: any, originalLyrics?: string): Promise<any> {
    const prompt = `Bạn là chuyên gia phân tích âm nhạc. 
Xử lý dữ liệu Whisper sau và kết hợp với Lyrics gốc (nếu có). Trả về JSON hợp lệ.
====== WHISPER DATA ======
${JSON.stringify(whisperData)}
====== LYRICS GỐC ======
${originalLyrics || "Không có"}`;

    // Chuỗi ưu tiên: HuggingFace -> OpenAI -> Gemini
    return this.executeWithFallback(prompt, 'data', [this.huggingface, this.openai, this.gemini]);
  }

  async generateScoutJson(prompt: string): Promise<string> {
    // Chuỗi ưu tiên: HuggingFace -> Gemini
    return this.executeWithFallback(prompt, 'data', [this.huggingface, this.gemini]);
  }

  async askExpert(prompt: string): Promise<string> {
    return this.huggingface.generateText(prompt, 'logic');
  }

  async askHuggingFace(prompt: string): Promise<string> {
    return this.huggingface.generateText(prompt, 'logic');
  }

  async askGroq(prompt: string, isComplex = false): Promise<string> {
    return this.groq.generateText(prompt, isComplex ? 'data' : 'logic');
  }

  async askGemini(prompt: string): Promise<string> {
    return this.gemini.generateText(prompt, 'logic');
  }

  async askOpenAI(prompt: string): Promise<string> {
    return this.openai.generateText(prompt, 'logic');
  }

  async generateEmbedding(text: string): Promise<number[]> {
    this.logger.log(`🧬 Đang chuyển đổi văn bản thành Vector bằng OpenAI...`);
    return this.openai.generateEmbedding(text);
  }

  // Chuyển hàm tạo Lyric Script từ BaseAiService sang đây
  async generateLyricScript(whisperData: any, originalLyrics?: string) {
    this.logger.log(`Đang phân tích kịch bản âm thanh...`);
    const rawSegments = whisperData.segments.map((seg: any) => ({
      start: seg.start,
      end: seg.end,
      words: seg.words.map((w: any) => ({ text: w.word.trim(), start: w.start }))
    }));

    let prompt = `Từ chuỗi thời gian (timestamp) cắt bằng AI (có thể sai số):\n${JSON.stringify(rawSegments)}\n\n`;

    if (originalLyrics) {
      prompt += `⚠️ QUAN TRỌNG: DỰA CHÍNH XÁC 100% từ kho lời gốc sau:\n"""\n${originalLyrics}\n"""\n
      HƯỚNG DẪN REMIX / TÁCH ĐOẠN...
      - File nhạc có thể ngắn, remix, hoặc cắt đoạn
      - Hãy chiếu phần chữ khớp với âm thanh
      - BỎ QUA những câu không có trong dữ liệu timestamp.

      QUY TRÌNH KHỚP CHỮ:
      1. Phải ĐÚNG CHÍNH TẢ nguyên gốc.
      2. Tuân thủ việc CHIA NHỎ chữ (tối đa 7 từ 1 hàng).
      3. Dự đoán "Tên bài hát" và "Ca sĩ".\n`;
    } else {
      prompt += `Nhiệm vụ:\n1. Dựa vào timestamp, hãy tự nhận diện "Tên bài hát" và "Ca sĩ". Nếu không biết để "Unknown Song" và "Unknown Artist".\n`;
    }

    prompt += `
    QUY ĐỊNH DỊCH THUẬT TIẾNG VIỆT (RẤT QUAN TRỌNG):
    - Dịch mang tính CHUYÊN NGHIỆP TRÊN TIKTOK.
    - TUYỆT ĐỐI KHÔNG dịch kiểu word-by-word.
    - XƯNG HÔ: Linh hoạt "Anh" - "Em", "Người" - "Ta"... sao cho thơ mộng.

    QUAN TRỌNG NHẤT: BẠN CHỈ ĐƯỢC TRẢ VỀ 1 OBJECT JSON HỢP LỆ. KHÔNG GIẢI THÍCH.
    Định dạng: {"songTitle": "...", "artist": "...", "lyrics": [{"start": 4.48, "duration": 2.7, "vietnamese": "...", "words": [{"text": "I", "start": 4.48}]}]}
    `;

    const aiResponseRaw = await this.executeWithFallback(prompt, 'data', [this.openai, this.groq, this.huggingface, this.gemini]);

    const aiResponse = aiResponseRaw.replace(/```json/g, '').replace(/```typescript/g, '').replace(/```/g, '').trim();
    const jsonStart = aiResponse.indexOf('{');
    const jsonEnd = aiResponse.lastIndexOf('}');

    if (jsonStart === -1 || jsonEnd === -1) throw new Error("Lỗi cấu trúc JSON rỗng từ AI");

    const parsedData = JSON.parse(aiResponse.substring(jsonStart, jsonEnd + 1));

    const tsContent = `export interface WordData { text: string; start: number; } export interface LyricData { start: number; duration: number; words: WordData[]; vietnamese: string; } export const LYRIC_SCRIPT: LyricData[] = ${JSON.stringify(parsedData.lyrics, null, 2)};`;

    const scriptPath = path.join(process.cwd(), '../2_Remotion_Video/src/data/script.ts');
    fs.writeFileSync(scriptPath, tsContent, 'utf8');

    this.logger.log(`✅ Hoàn tất! Bài: ${parsedData.songTitle} - ${parsedData.artist}`);
    return { songTitle: parsedData.songTitle, artist: parsedData.artist };
  }
}