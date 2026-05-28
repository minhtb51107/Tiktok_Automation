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
        this.logger.log(`🔑 Đã nạp thành công ${this.apiKeys.length} API Key.`);
        this.genAI = new GoogleGenerativeAI(this.apiKeys[this.currentKeyIndex]);
      }
    }
  }

  private rotateKey() {
    this.currentKeyIndex = (this.currentKeyIndex + 1) % this.apiKeys.length;
    this.genAI = new GoogleGenerativeAI(this.apiKeys[this.currentKeyIndex]);
    this.logger.warn(`🔄 Đã chuyển sang API Key số ${this.currentKeyIndex + 1}`);
  }

  async generateLyricScript(whisperData: any, originalLyrics?: string) {
    this.logger.log(`🤖 Đang nhờ Gemini phân tích bài hát và ráp nối dữ liệu...`);

    const rawSegments = whisperData.segments.map((seg: any) => ({
      start: seg.start,
      end: seg.end,
      words: seg.words.map((w: any) => ({ text: w.word.trim(), start: w.start }))
    }));

    let prompt = `Tôi có dữ liệu thời gian (timestamp) của một bài hát được bóc tách bằng AI (có thể có sai sót về mặt từ ngữ):\n${JSON.stringify(rawSegments)}\n\n`;

    if (originalLyrics) {
      prompt += `⚠️ QUAN TRỌNG: Dưới đây là TOÀN BỘ LỜI BÀI HÁT GỐC CHÍNH XÁC 100% từ kho dữ liệu:\n"""\n${originalLyrics}\n"""\n
      HƯỚNG DẪN XỬ LÝ BẢN REMIX / ĐOẠN TRÍCH NGẮN (ĐỌC KỸ):
      - File nhạc hiện tại có thể chỉ là một đoạn ngắn, một bản Remix, hoặc chỉ hát một phần nhỏ (ví dụ: chỉ hát đoạn điệp khúc) của bài hát gốc ở trên.
      - Hãy đối chiếu phần chữ lủng củng mà AI nghe được (trong dữ liệu timestamp) với TOÀN BỘ LỜI BÀI HÁT GỐC để tìm ra xem đoạn nhạc này đang thực sự hát khúc nào.
      - BẠN CHỈ ĐƯỢC LẤY những câu thực sự có hát trong đoạn nhạc để khớp thời gian. Hãy BỎ QUA HOÀN TOÀN các đoạn/câu lyric khác không được hát. Tuyệt đối KHÔNG ĐƯỢC nhồi nhét toàn bộ lời bài hát gốc vào nếu bài nhạc không hát hết.
      
      QUÂN LỆNH KHỚP CHỮ:
      1. Đối với những câu thực sự được hát, bạn phải dùng CHÍNH XÁC từng từ ngữ và chính tả từ LỜI BÀI HÁT GỐC ở trên để thay thế cho phần chữ bị sai của timestamp.
      2. Phải tuân thủ nghiêm ngặt việc CHIA NHỎ các đoạn hát thành các câu CỰC NGẮN (từ 3 đến tối đa 7 từ mỗi câu) để làm video Tiktok. Không gom câu dài.
      3. Dự đoán "Tên bài hát" và "Ca sĩ/Tác giả" thể hiện bài này.\n`;
    } else {
      prompt += `Nhiệm vụ của bạn:\n1. Dựa vào dữ liệu timestamp, hãy dự đoán chính xác "Tên bài hát" và "Ca sĩ/Tác giả". Nếu quá lạ hãy để "Unknown Song" và "Unknown Artist".\n`;
    }

    // ĐÂY LÀ PHẦN ĐÃ ĐƯỢC NÂNG CẤP MẠNH MẼ ĐỂ TRỊ BỆNH DỊCH THÔ CỨNG
    prompt += `
    ⚠️ QUÂN LỆNH DỊCH THUẬT TIẾNG VIỆT (VÔ CÙNG QUAN TRỌNG):
    - BẠN LÀ MỘT NHÀ THƠ, MỘT DỊCH GIẢ ÂM NHẠC CHUYÊN NGHIỆP TRÊN TIKTOK. 
    - TUYỆT ĐỐI KHÔNG dịch thô cứng kiểu word-by-word (Google Translate). 
    - ĐẠI TỪ XƯNG HÔ: Đánh giá nội dung bài hát. Nếu là nhạc tình yêu, tâm trạng, buồn bã hay thả thính, TUYỆT ĐỐI KHÔNG dùng "Tôi" và "Bạn". Hãy linh hoạt sử dụng "Anh" - "Em", "Người" - "Ta", v.v... sao cho thật lãng mạn, da diết và tự nhiên.
    - DỊCH THOÁT Ý: Nắm bắt đúng tâm tư, cảm xúc và linh hồn của bài hát. Đôi khi không cần dịch sát nghĩa đen, mà phải dịch đúng cái "vibe" (cảm giác) của câu hát sang tiếng Việt thật mượt mà, đậm chất thơ.

    Các yêu cầu bắt buộc khác:
    - Giá trị 'start' của mỗi câu phải là 'start' của từ đầu tiên trong câu đó. 'duration' là thời gian hiển thị.

    QUAN TRỌNG NHẤT: BẠN CHỈ ĐƯỢC TRẢ VỀ ĐÚNG 1 OBJECT JSON HỢP LỆ. KHÔNG GIẢI THÍCH GÌ THÊM.
    Ví dụ định dạng trả về:
    {
      "songTitle": "Tên bài hát",
      "artist": "Tên ca sĩ",
      "lyrics": [
        {
          "start": 4.48,
          "duration": 2.7,
          "vietnamese": "Trong đầu anh giờ đây ngập tràn bóng hình em",
          "words": [
            { "text": "I", "start": 4.48 },
            { "text": "got", "start": 5.08 },
            { "text": "a", "start": 5.68 }
          ]
        }
      ]
    }
    `;

    let retries = 6; 
    let currentWaitTime = 5000; 
    let currentModel = 'gemini-2.5-flash'; 
    
    const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

    while (retries > 0) {
      try {
        const model = this.genAI.getGenerativeModel({ model: currentModel });
        const result = await model.generateContent(prompt);
        let aiResponse = result.response.text();
        
        aiResponse = aiResponse.replace(/```json/g, '').replace(/```typescript/g, '').replace(/```/g, '').trim();

        const jsonStart = aiResponse.indexOf('{');
        const jsonEnd = aiResponse.lastIndexOf('}');
        
        if (jsonStart === -1 || jsonEnd === -1) {
          throw new Error("AI không sinh ra object JSON");
        }
        
        const jsonString = aiResponse.substring(jsonStart, jsonEnd + 1);
        const parsedData = JSON.parse(jsonString);

        const tsContent = `export interface WordData {
  text: string;
  start: number; 
}

export interface LyricData {
  start: number;     
  duration: number;  
  words: WordData[]; 
  vietnamese: string;
}

export const LYRIC_SCRIPT: LyricData[] = ${JSON.stringify(parsedData.lyrics, null, 2)};
`;

        const scriptPath = path.join(process.cwd(), '..', '2_Remotion_Video', 'src', 'data', 'script.ts');
        fs.writeFileSync(scriptPath, tsContent, 'utf8');

        this.logger.log(`✅ Gemini đã hoàn tất! Bài hát: ${parsedData.songTitle} - ${parsedData.artist} (Model: ${currentModel})`);
        
        return {
          songTitle: parsedData.songTitle,
          artist: parsedData.artist
        };

      } catch (error: any) {
        if (error instanceof SyntaxError || error.message === "AI không sinh ra object JSON") {
          this.logger.warn(`⚠️ AI viết sai cú pháp JSON. Đang thử lại...`);
          retries--;
          continue; 
        }

        if (error?.status === 404) {
          this.logger.warn(`🚨 Model "${currentModel}" lỗi 404! Chuyển sang "gemini-flash"...`);
          currentModel = 'gemini-flash';
          retries--;
          continue;
        }

        if (error?.status === 429 || error?.status === 503 || error?.status === 500) {
          retries--;
          if (retries === 0) {
            this.logger.error(`❌ Đã thử lại nhiều lần nhưng Google vẫn sập! Xin hãy thử lại sau vài phút.`);
            throw error;
          }

          this.logger.warn(`🔥 Server Gemini đang bận (Lỗi ${error.status}). Sẽ đợi ${currentWaitTime / 1000}s rồi thử lại... (${retries} lần thử còn lại)`);
          
          this.rotateKey();
          await delay(currentWaitTime);
          currentWaitTime += 5000; 
          continue; 
        } else {
          this.logger.error(`❌ Lỗi Gemini:`, error);
          throw error;
        }
      }
    }
  }
}