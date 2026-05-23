import { Injectable, Logger } from '@nestjs/common';
import { GoogleGenerativeAI } from '@google/generative-ai';
import * as path from 'path';
import * as fs from 'fs';
import * as dotenv from 'dotenv'; // <--- Thêm thư viện này

// Yêu cầu hệ thống đọc file .env
dotenv.config(); 

@Injectable()
export class GeminiService {
  private readonly logger = new Logger(GeminiService.name);
  
  // Lấy Key từ két sắt ra, KHÔNG GHI CỨNG NỮA
  private readonly apiKey = process.env.GEMINI_API_KEY; 
  private genAI: GoogleGenerativeAI;

  constructor() {
    // Kiểm tra xem đã có key chưa
    if (!this.apiKey) {
      this.logger.error('❌ KHÔNG TÌM THẤY GEMINI_API_KEY trong file .env');
    } else {
      this.genAI = new GoogleGenerativeAI(this.apiKey);
    }
  }

  async generateLyricScript(whisperData: any) {
    this.logger.log(`🤖 Đang nhờ Gemini dịch lời bài hát và chèn hiệu ứng...`);

    // Dùng model mới nhất
    const model = this.genAI.getGenerativeModel({ model: 'gemini-2.5-flash' });

    // Trích xuất đoạn text và thời gian từ Whisper để gửi cho AI
    const rawSegments = whisperData.segments.map(seg => ({
      start: seg.start,
      end: seg.end,
      words: seg.words.map(w => ({ text: w.word.trim(), start: w.start }))
    }));

    // Viết Prompt (Câu lệnh) ép Gemini trả về đúng định dạng file script.ts
    const prompt = `
    Tôi có dữ liệu thời gian bài hát từ Whisper:
    ${JSON.stringify(rawSegments)}

    Hãy đóng vai một chuyên gia làm video TikTok. Bạn hãy phân tích dữ liệu trên và tạo ra đoạn code TypeScript hoàn chỉnh.
    Nhiệm vụ:
    1. Dịch ý nghĩa mỗi câu hát sang tiếng Việt cho thật mượt mà và trendy.
    2. Ở những từ khóa mang cảm xúc mạnh, hãy ngẫu nhiên gán thêm thuộc tính: effect: 'shake' | 'glitch' | 'glow-gold' | 'throw-away' | 'flash-climax' | 'neon-rainbow'.
    3. Công thức tính frame: thời gian (giây) * 30. Trả về đúng hàm sec() như mẫu.

    Hãy CHỈ trả về nguyên văn đoạn code TypeScript sau, không giải thích gì thêm, không có dấu tick markdown (quy tắc sinh tử):

    const sec = (seconds: number) => Math.round(seconds * 30);

    export interface WordData {
      text: string;
      start: number; 
      effect?: 'shake' | 'glitch' | 'glow-gold' | 'throw-away' | 'flash-climax' | 'neon-rainbow'; 
    }

    export interface LyricData {
      start: number;     
      duration: number;  
      words: WordData[]; 
      vietnamese: string;
    }

    export const LYRIC_SCRIPT: LyricData[] = [
      // điền dữ liệu mảng vào đây dựa trên thông tin tôi cung cấp
    ];
    `;

    try {
      const result = await model.generateContent(prompt);
      let aiCode = result.response.text();
      
      // Xóa các ký tự thừa (```typescript và ```) nếu AI lỡ tay sinh ra
      aiCode = aiCode.replace(/```typescript/g, '').replace(/```/g, '').trim();

      // ĐƯA BẢN CODE NÀY ĐÈ VÀO THƯ MỤC REMOTION CỦA BẠN
      const scriptPath = path.join(process.cwd(), '..', '2_Remotion_Video', 'src', 'data', 'script.ts');
      fs.writeFileSync(scriptPath, aiCode, 'utf8');

      this.logger.log(`✅ Tuyệt vời! Gemini đã viết xong và lưu đè file script.ts thành công!`);
      return true;

    } catch (error) {
      this.logger.error(`❌ Lỗi khi nhờ Gemini làm việc:`, error);
      throw error;
    }
  }
}