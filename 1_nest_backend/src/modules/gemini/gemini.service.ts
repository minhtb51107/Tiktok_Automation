import { Injectable, Logger } from '@nestjs/common';
import { GoogleGenerativeAI } from '@google/generative-ai';
import * as path from 'path';
import * as fs from 'fs';
import * as dotenv from 'dotenv'; 

dotenv.config(); 

@Injectable()
export class GeminiService {
  private readonly logger = new Logger(GeminiService.name);
  
  private apiKeys: string[] = [];
  private currentKeyIndex: number = 0;
  private genAI: GoogleGenerativeAI;

  constructor() {
    const envKeys = process.env.GEMINI_API_KEY;
    
    if (!envKeys) {
      this.logger.error('❌ KHÔNG TÌM THẤY GEMINI_API_KEY trong file .env');
    } else {
      this.apiKeys = envKeys.split(',').map(key => key.trim()).filter(key => key.length > 0);
      
      if (this.apiKeys.length === 0) {
        this.logger.error('❌ Danh sách Key Gemini trống!');
      } else {
        this.logger.log(`🔑 Đã nạp thành công ${this.apiKeys.length} API Key vào hệ thống xoay vòng (Rotation).`);
        this.genAI = new GoogleGenerativeAI(this.apiKeys[this.currentKeyIndex]);
      }
    }
  }

  private rotateKey() {
    this.currentKeyIndex = (this.currentKeyIndex + 1) % this.apiKeys.length;
    const newKey = this.apiKeys[this.currentKeyIndex];
    this.genAI = new GoogleGenerativeAI(newKey);
    this.logger.warn(`🔄 Đã nạp đạn! Xoay vòng sang API Key số ${this.currentKeyIndex + 1}/${this.apiKeys.length}`);
  }

  async generateLyricScript(whisperData: any) {
    this.logger.log(`🤖 Đang nhờ Gemini dịch lời bài hát và chèn hiệu ứng...`);

    const rawSegments = whisperData.segments.map(seg => ({
      start: seg.start,
      end: seg.end,
      words: seg.words.map(w => ({ text: w.word.trim(), start: w.start }))
    }));

    // ĐÃ SỬA: Ép AI chỉ trả về JSON thuần túy
    const prompt = `
    Tôi có dữ liệu thời gian bài hát:
    ${JSON.stringify(rawSegments)}

    Nhiệm vụ của bạn:
    1. Dịch ý nghĩa mỗi câu hát sang tiếng Việt thật mượt mà, hợp ngữ cảnh.
    2. Ở những từ khóa mang cảm xúc mạnh, hãy ngẫu nhiên gán thêm thuộc tính effect: 'shake' | 'glitch' | 'glow-gold' | 'throw-away' | 'flash-climax' | 'neon-rainbow'.
    3. Thời gian start và duration giữ nguyên là số thực (giây).

    QUAN TRỌNG NHẤT: BẠN CHỈ ĐƯỢC TRẢ VỀ ĐÚNG 1 MẢNG JSON HỢP LỆ. KHÔNG CÓ BẤT KỲ ĐOẠN TEXT GIẢI THÍCH NÀO TRƯỚC HAY SAU.
    Ví dụ định dạng bạn phải trả về:
    [
      {
        "start": 0.5,
        "duration": 2.5,
        "vietnamese": "Lời dịch câu 1",
        "words": [
          { "text": "Hello", "start": 0.5, "effect": "shake" }
        ]
      }
    ]
    `;

    let retries = this.apiKeys.length * 2; 
    const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

    while (retries > 0) {
      try {
        const model = this.genAI.getGenerativeModel({ model: 'gemini-2.5-flash' });
        
        const result = await model.generateContent(prompt);
        let aiResponse = result.response.text();
        
        // Dọn dẹp rác markdown nếu AI lỡ tay bọc code
        aiResponse = aiResponse.replace(/```json/g, '').replace(/```typescript/g, '').replace(/```/g, '').trim();

        // 1. TÌM VÀ CẮT LẤY CHUỖI JSON ĐỂ TRÁNH LỖI AI GIẢI THÍCH LẰNG NHẰNG
        const jsonStart = aiResponse.indexOf('[');
        const jsonEnd = aiResponse.lastIndexOf(']');
        
        if (jsonStart === -1 || jsonEnd === -1) {
          throw new Error("AI không sinh ra mảng JSON");
        }
        
        const jsonString = aiResponse.substring(jsonStart, jsonEnd + 1);

        // 2. PARSE ĐỂ KIỂM DUYỆT - Nếu JSON sai cú pháp, nó sẽ Throw Error nhảy xuống catch để auto-retry
        const parsedData = JSON.parse(jsonString);

        // 3. TỰ ĐỘNG SINH CODE TYPESCRIPT CHUẨN 100% TỪ NODE.JS
        const tsContent = `export interface WordData {
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

export const LYRIC_SCRIPT: LyricData[] = ${JSON.stringify(parsedData, null, 2)};
`;

        const scriptPath = path.join(process.cwd(), '..', '2_Remotion_Video', 'src', 'data', 'script.ts');
        fs.writeFileSync(scriptPath, tsContent, 'utf8');

        this.logger.log(`✅ Tuyệt vời! Gemini đã viết xong JSON và Node.js đã compile ra TypeScript hoàn hảo!`);
        return true;

      } catch (error: any) {
        // Nếu lỗi do AI viết sai JSON
        if (error instanceof SyntaxError || error.message === "AI không sinh ra mảng JSON") {
          this.logger.warn(`⚠️ AI viết sai cú pháp JSON. Đang bắt AI viết lại...`);
          retries--;
          continue; // Vòng lại ngay
        }

        if (error?.status === 429) {
          retries--;
          if (retries === 0) {
            this.logger.error(`❌ Đã xoay vòng hết TẤT CẢ các Key nhưng đều bị nghẽn (429).`);
            throw error;
          }
          this.logger.warn(`🔥 Key hiện tại bị nghẽn (429). Chuẩn bị đổi Key...`);
          this.rotateKey();
          await delay(2000); 
        } else {
          this.logger.error(`❌ Lỗi không xác định khi nhờ Gemini làm việc:`, error);
          throw error;
        }
      }
    }
  }
}