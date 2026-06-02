import { Injectable, Logger } from '@nestjs/common';
import axios from 'axios';
import * as fs from 'fs';
import * as path from 'path';

@Injectable()
export class TtsService {
  private readonly logger = new Logger(TtsService.name);
  private apiKeys: string[] = [];
  private currentKeyIndex: number = 0;

  constructor() {
    const envKeys = process.env.FPT_API_KEY || process.env.FPT_AI_KEY;
    if (envKeys) {
      this.apiKeys = envKeys.split(',').map(key => key.trim()).filter(key => key.length > 0);
    }
  }

  private rotateKey() {
    if (this.apiKeys.length <= 1) return;
    this.currentKeyIndex = (this.currentKeyIndex + 1) % this.apiKeys.length;
    this.logger.warn(`🔄 FPT dính lỗi. Đã chuyển sang API Key FPT số ${this.currentKeyIndex + 1}`);
  }

  async generateAudio(text: string, fileName: string, gender: string = 'neutral'): Promise<{ audioSrc: string, durationInFrames: number }> {
    if (!text || text.trim() === '') {
      this.logger.warn(`⚠️ Text đầu vào rỗng. Bỏ qua tạo TTS, trả về thời lượng ảo (fileName: ${fileName})`);
      const publicDir = path.join(process.cwd(), '../2_Remotion_Video/public/threads_audio');
      if (!fs.existsSync(publicDir)) fs.mkdirSync(publicDir, { recursive: true });
      fs.writeFileSync(path.join(publicDir, fileName), Buffer.from(''));
      return { audioSrc: `threads_audio/${fileName}`, durationInFrames: 30 };
    }

    if (this.apiKeys.length === 0) throw new Error("Lỗi thiếu cấu hình FPT.AI");

    // LỌC SẠCH KÝ TỰ ĐẶC BIỆT, TOÁN HỌC, NGOẶC NHỌN (Giữ lại chữ, số và dấu chấm phẩy)
    const cleanText = text.replace(/[^\w\s\dàáãạảăắằẳẵặâấầẩẫậèéẹẻẽêềếểễệđìíĩỉịòóõọỏôốồổỗộơớờởỡợùúũụủưứừửữựỳýỵỷỹ,.\?!]/gi, ' ').replace(/\s+/g, ' ').trim();

    const femaleVoices = ['banmai', 'thuminh', 'thuquynh', 'linhsan', 'lanngoc'];
    const maleVoices = ['leminh', 'minhquang', 'thanhlong', 'chienthang'];

    let voice = 'banmai'; 
    if (gender === 'male') {
      voice = maleVoices[Math.floor(Math.random() * maleVoices.length)];
    } else {
      voice = femaleVoices[Math.floor(Math.random() * femaleVoices.length)];
    }

    this.logger.log(`🎙️ [FPT] Đang dùng giọng ${gender === 'male' ? 'Nam' : 'Nữ'} (${voice}) đọc: "${cleanText.substring(0, 40)}..."`);

    const url = 'https://api.fpt.ai/hmi/tts/v5';
    let fptRetries = 5;
    let audioUrl = '';

    while (fptRetries > 0) {
      const currentApiKey = this.apiKeys[this.currentKeyIndex];
      const headers = {
        'api-key': currentApiKey,
        'voice': voice,
        'speed': '',
        'Content-Type': 'application/x-www-form-urlencoded'
      };

      try {
        const response = await axios.post(url, cleanText, { headers });
        if (response.data && response.data.async) {
          audioUrl = response.data.async;
          break; 
        }
        throw new Error("Không nhận được URL từ FPT");
      } catch (error: any) {
        fptRetries--;
        this.rotateKey();
        if (fptRetries === 0) throw new Error("FPT.AI sập toàn tập");
        await new Promise(res => setTimeout(res, 3000)); 
      }
    }

    // GIỚI HẠN THỜI GIAN TẢI FILE: Tối đa 10 lần thử (khoảng 30 giây) thay vì 25 lần
    let downloadRetries = 10; 
    const publicDir = path.join(process.cwd(), '../2_Remotion_Video/public/threads_audio');
    if (!fs.existsSync(publicDir)) fs.mkdirSync(publicDir, { recursive: true });
    
    const filePath = path.join(publicDir, fileName);

    while (downloadRetries > 0) {
      try {
        await new Promise(res => setTimeout(res, 3000)); 
        const audioRes = await axios.get(audioUrl, { responseType: 'arraybuffer' });
        
        if (audioRes.data.byteLength > 100) {
            fs.writeFileSync(filePath, audioRes.data);
            
            const estimatedSeconds = Math.max(cleanText.length * 0.08, 1.5); 
            const durationInFrames = Math.ceil(estimatedSeconds * 60);

            return {
                audioSrc: `threads_audio/${fileName}`,
                durationInFrames: durationInFrames
            };
        }
        throw new Error("File chưa sẵn sàng hoặc rỗng");
      } catch (error) {
        downloadRetries--;
        if (downloadRetries === 0) {
            this.logger.error(`🚨 FPT quá tải không trả về file cho URL: ${audioUrl}. Hủy bỏ sau 30s.`);
            throw new Error("Timeout khi tải file từ FPT.AI (Khả năng do kịch bản quá dị)");
        }
      }
    }
    throw new Error("Lỗi không xác định trong TTS");
  }
}