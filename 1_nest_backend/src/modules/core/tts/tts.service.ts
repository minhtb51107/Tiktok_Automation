import { Injectable, Logger } from '@nestjs/common';
import * as fs from 'fs';
import * as path from 'path';
import axios from 'axios';
import ffmpeg from 'fluent-ffmpeg'; // 🔥 Dùng FFmpeg thần thánh thay cho get-mp3-duration

@Injectable()
export class TtsService {
  private readonly logger = new Logger(TtsService.name);
  private fptApiKeys: string[] = [];
  private currentFptKeyIndex = 0;
  private publicDir = path.join(process.cwd(), '../2_Remotion_Video/public/threads_audio');

  constructor() {
    if (!fs.existsSync(this.publicDir)) {
      fs.mkdirSync(this.publicDir, { recursive: true });
    }
    const fptKeysEnv = process.env.FPT_AI_KEY;
    if (fptKeysEnv) {
      this.fptApiKeys = fptKeysEnv.split(',').map(k => k.trim());
    }
  }

  private extractError(error: any): string {
    if (error.response && error.response.data) {
      if (error.response.data instanceof Buffer) return error.response.data.toString('utf8').substring(0, 150);
      if (typeof error.response.data === 'object') return JSON.stringify(error.response.data);
      return error.response.data.toString().substring(0, 150);
    }
    return error.message;
  }

  // 🧹 HÀM LÀM SẠCH VĂN BẢN TRƯỚC KHI ĐỌC (Cứu sập Viettel/Zalo)
  private cleanTextForTTS(text: string): string {
    if (!text) return "";
    return text
      .replace(/(?:\r\n|\r|\n)/g, '. ') // Biến dấu xuống dòng thành dấu chấm để ngắt giọng
      .replace(/["*#_~\[\]]/g, '')      // Bỏ các ký tự Markdown làm nghẹn họng AI
      .replace(/(http|https):\/\/[^\s]+/g, 'link web') // Đổi link thành chữ "link web" cho dễ nghe
      .trim();
  }

  // ⏱️ HÀM ĐO THỜI GIAN BẰNG FFPROBE CHUẨN 100%
  private getAudioDuration(filePath: string): Promise<number> {
    return new Promise((resolve) => {
      ffmpeg.ffprobe(filePath, (err, metadata) => {
        if (err || !metadata || !metadata.format || !metadata.format.duration) {
          this.logger.warn(`⚠️ Lỗi đọc metadata file âm thanh. Set tạm 5 giây để tránh lỗi đè hình!`);
          resolve(5); 
        } else {
          resolve(metadata.format.duration); // Trả về số giây chuẩn tới phần thập phân
        }
      });
    });
  }

  async generateAudio(text: string, fileName: string, gender: string) {
    // Tắm rửa sạch sẽ cho đoạn text trước khi đưa cho AI đọc
    const cleanText = this.cleanTextForTTS(text);

    try {
      return await this.generateFptAudio(cleanText, fileName, gender);
    } catch (fptError: any) {
      this.logger.warn(`⚠️ FPT AI SẬP [${this.extractError(fptError)}]. Đẩy qua Viettel AI...`);
      try {
        return await this.generateViettelAudio(cleanText, fileName, gender);
      } catch (viettelError: any) {
        this.logger.warn(`⚠️ VIETTEL AI SẬP [${this.extractError(viettelError)}]. Gọi chốt chặn Zalo AI...`);
        try {
          return await this.generateZaloAudio(cleanText, fileName, gender);
        } catch (zaloError: any) {
          this.logger.error(`❌ ZALO AI CŨNG SẬP NỐT [${this.extractError(zaloError)}]! Ra lệnh cắt bỏ Card bình luận này!`);
          throw new Error("Không thể tạo giọng đọc cho Card này."); 
        }
      }
    }
  }

  // =======================================================
  // 🎙️ TỔ ĐỌC 1: FPT AI
  // =======================================================
  private async generateFptAudio(text: string, fileName: string, gender: string) {
    if (this.fptApiKeys.length === 0) throw new Error("Chưa điền FPT_AI_KEY vào file .env");

    let voice = 'banmai'; 
    if (gender === 'female') {
      const femaleVoices = ['banmai'];
      voice = femaleVoices[Math.floor(Math.random() * femaleVoices.length)];
    } else {
      const maleVoices = ['leminh'];
      voice = maleVoices[Math.floor(Math.random() * maleVoices.length)];
    }

    this.logger.log(`🎙️ [FPT] Đang dùng giọng ${gender === 'female' ? 'Nữ' : 'Nam'} (${voice}) đọc...`);

    // 🔥 NÂNG CẤP: Kiên nhẫn chờ FPT tối đa 60 giây (24 lần x 2.5s) cho các bài siêu dài
    let downloadRetries = 24; 
    let attempt = 0;
    let lastErrorMsg = "";

    while (attempt < this.fptApiKeys.length) {
      const apiKey = this.fptApiKeys[this.currentFptKeyIndex];
      try {
        const response = await axios({
          method: 'POST',
          url: 'https://api.fpt.ai/hmi/tts/v5',
          headers: { 'api-key': apiKey, 'speed': '0', 'voice': voice, 'format': 'mp3' },
          data: text
        });

        const audioUrl = response.data.async;
        if (!audioUrl) throw new Error("FPT gọi thành công nhưng không trả về link tải MP3");

        const filePath = path.join(this.publicDir, fileName);
        
        while (downloadRetries > 0) {
          await new Promise(r => setTimeout(r, 2500)); 
          try {
            const audioRes = await axios({ url: audioUrl, method: 'GET', responseType: 'arraybuffer' });
            
            if (audioRes.data.byteLength > 1000) {
              fs.writeFileSync(filePath, audioRes.data);
              
              // ĐO THỜI GIAN BẰNG FFPROBE
              const durationSeconds = await this.getAudioDuration(filePath);
              const durationInFrames = Math.ceil(durationSeconds * 60);
              
              return { audioSrc: `threads_audio/${fileName}`, durationInFrames };
            }
          } catch (e) {}
          downloadRetries--;
        }
        throw new Error("Có link tải từ FPT nhưng chờ 60 giây vẫn chưa xong (Bài quá dài)");
      } catch (err: any) {
        lastErrorMsg = this.extractError(err);
        this.logger.debug(`FPT Key [${apiKey.substring(0, 5)}***] lỗi: ${lastErrorMsg}`);
        this.currentFptKeyIndex = (this.currentFptKeyIndex + 1) % this.fptApiKeys.length;
        attempt++;
      }
    }
    throw new Error(`Tất cả FPT Keys đều sập. Lỗi cuối: ${lastErrorMsg}`);
  }

  // =======================================================
  // 🪖 TỔ ĐỌC 2: VIETTEL AI
  // =======================================================
  private async generateViettelAudio(text: string, fileName: string, gender: string) {
    const apiKey = process.env.VIETTEL_AI_KEY;
    if (!apiKey) throw new Error("Chưa điền VIETTEL_AI_KEY vào file .env");

    const voice = gender === 'female' 
      ? (Math.random() > 0.5 ? 'hn-quynhanh' : 'sg-hoaimy') 
      : (Math.random() > 0.5 ? 'hn-tienquan' : 'sg-minhhoang');

    this.logger.log(`🪖 [VIETTEL] Đang dùng giọng ${voice} ứng cứu...`);

    const response = await axios({
      method: 'POST',
      url: 'https://viettelai.vn/tts/speech_synthesis',
      // Nhớ đảm bảo apiKey lấy từ tài khoản Viettel (Thường là một chuỗi ngẫu nhiên dài)
      headers: { 'accept': '*/*', 'Content-Type': 'application/json', 'token': apiKey.trim() },
      data: { text: text, voice: voice, speed: 1, tts_return_option: 3 },
      responseType: 'arraybuffer' 
    });

    if (response.data.byteLength < 1000) throw new Error("Viettel trả về file rác/trống");

    const filePath = path.join(this.publicDir, fileName);
    fs.writeFileSync(filePath, response.data);
    
    // ĐO THỜI GIAN BẰNG FFPROBE
    const durationSeconds = await this.getAudioDuration(filePath);
    const durationInFrames = Math.ceil(durationSeconds * 60);
    this.logger.log(`✅ [VIETTEL] Cứu thành công!`);
    
    return { audioSrc: `threads_audio/${fileName}`, durationInFrames };
  }

  // =======================================================
  // 🚑 TỔ ĐỌC 3: ZALO AI
  // =======================================================
  private async generateZaloAudio(text: string, fileName: string, gender: string) {
    const apiKey = process.env.ZALO_AI_KEY;
    if (!apiKey) throw new Error("Chưa điền ZALO_AI_KEY vào file .env");

    const speakerId = gender === 'female' ? (Math.random() > 0.5 ? 1 : 2) : (Math.random() > 0.5 ? 3 : 4);
    this.logger.log(`🚑 [ZALO] Đang dùng giọng ${gender === 'female' ? 'Nữ' : 'Nam'} đọc cứu viện cuối cùng...`);

    const response = await axios({
      method: 'POST',
      url: 'https://api.zalo.ai/v1/tts/synthesize',
      headers: { 'apikey': apiKey.trim(), 'Content-Type': 'application/x-www-form-urlencoded' },
      data: `input=${encodeURIComponent(text)}&speaker_id=${speakerId}&speed=1.0`
    });

    if (response.data.error_code !== 0) {
        throw new Error(`Zalo từ chối (Thường do hết hạn mức Free hoặc bài quá dài): ${response.data.error_message}`);
    }

    const audioUrl = response.data.data.url;
    const filePath = path.join(this.publicDir, fileName);

    let downloadRetries = 4;
    while (downloadRetries > 0) {
      await new Promise(r => setTimeout(r, 2500));
      try {
        const audioRes = await axios({ url: audioUrl, method: 'GET', responseType: 'arraybuffer' });
        if (audioRes.data.byteLength > 1000) {
          fs.writeFileSync(filePath, audioRes.data);
          
          // ĐO THỜI GIAN BẰNG FFPROBE
          const durationSeconds = await this.getAudioDuration(filePath);
          const durationInFrames = Math.ceil(durationSeconds * 60);
          this.logger.log(`✅ [ZALO] Cứu thành công!`);
          return { audioSrc: `threads_audio/${fileName}`, durationInFrames };
        }
      } catch (e) { }
      downloadRetries--;
    }
    throw new Error("Lỗi tải file MP3 vật lý từ Server Zalo AI");
  }
}