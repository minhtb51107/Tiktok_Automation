import { Logger } from '@nestjs/common';
import * as path from 'path';
import * as fs from 'fs';
import { PrismaService } from '../../../prisma/prisma.service';

export abstract class BaseAiService {
  protected readonly logger: Logger;
  
  constructor(
    serviceName: string,
    protected readonly prisma: PrismaService // Inject CSDL vào class cha
  ) {
    this.logger = new Logger(serviceName);
  }

  // CÁC CLASS CON BẮT BUỘC PHẢI IMPLEMENT HÀM NÀY BẰNG TỪ KHÓA 'protected'
  protected abstract generateCore(prompt: string, taskType?: 'logic' | 'data'): Promise<string>;

  // PHỄU GIÁM SÁT TOÀN BỘ HỆ THỐNG
  public async generateText(prompt: string, taskType: 'logic' | 'data' = 'logic'): Promise<string> {
    const startTime = Date.now();
    
    // Log console thu gọn (chỉ hiện 500 ký tự đầu để đỡ rác terminal)
    this.logger.debug(`📥 AI INPUT [${taskType}]: ${prompt.substring(0, 500)}...`);

    try {
      // Đẩy việc gọi API thực tế cho class con (OpenAI, Groq...)
      const result = await this.generateCore(prompt, taskType);
      const duration = Date.now() - startTime;
      
      this.logger.debug(`📤 AI OUTPUT (${duration}ms)`);

      // Lưu thành công vào CSDL (Chạy ngầm không dùng await để không làm chậm luồng chính)
      this.prisma.aiAuditLog.create({
        data: {
          provider: this.constructor.name,
          taskType,
          prompt,
          response: result,
          durationMs: duration,
          isSuccess: true,
        }
      }).catch(err => this.logger.error('Lỗi khi lưu log AI', err));

      return result;
    } catch (error: any) {
      const duration = Date.now() - startTime;
      this.logger.error(`❌ AI ERROR (${duration}ms): ${error.message}`);
      
      // Lưu lỗi vào CSDL
      this.prisma.aiAuditLog.create({
        data: {
          provider: this.constructor.name,
          taskType,
          prompt,
          durationMs: duration,
          isSuccess: false,
          errorMessage: error.message,
        }
      }).catch(err => this.logger.error('Lỗi khi lưu log AI', err));

      throw error;
    }
  }

  // Giữ nguyên hàm logic âm nhạc của sếp, nhưng sửa chỗ gọi AI thành this.generateText
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

    let retries = 3;
    while (retries > 0) {
      try {
        // QUAN TRỌNG: Đổi từ generateCore sang generateText để luồng nhạc cũng được ghi log
        let aiResponse = await this.generateText(prompt, 'data'); 
        
        aiResponse = aiResponse.replace(/```json/g, '').replace(/```typescript/g, '').replace(/```/g, '').trim();
        const jsonStart = aiResponse.indexOf('{');
        const jsonEnd = aiResponse.lastIndexOf('}');
        
        if (jsonStart === -1 || jsonEnd === -1) throw new Error("Lỗi cấu trúc JSON rỗng");
        
        const parsedData = JSON.parse(aiResponse.substring(jsonStart, jsonEnd + 1));
        
        const tsContent = `export interface WordData { text: string; start: number; } export interface LyricData { start: number; duration: number; words: WordData[]; vietnamese: string; } export const LYRIC_SCRIPT: LyricData[] = ${JSON.stringify(parsedData.lyrics, null, 2)};`;
        
        const scriptPath = path.join(process.cwd(), '../2_Remotion_Video/src/data/script.ts');
        fs.writeFileSync(scriptPath, tsContent, 'utf8');
        
        this.logger.log(`✅ Hoàn tất! Bài: ${parsedData.songTitle} - ${parsedData.artist}`);
        return { songTitle: parsedData.songTitle, artist: parsedData.artist };
      } catch (error: any) {
        retries--;
        this.logger.warn(`Lỗi phân tích JSON, đang thử lại... (${retries} lần)`);
        if (retries === 0) throw error;
        await new Promise(resolve => setTimeout(resolve, 3000));
      }
    }
  }
}