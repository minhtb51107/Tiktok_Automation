import { Injectable, Logger } from '@nestjs/common';
import * as fs from 'fs';
import * as path from 'path';
import axios from 'axios';
import ffmpeg from 'fluent-ffmpeg'; 
import { execSync } from 'child_process';

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

  private cleanTextForTTS(text: string): string {
    if (!text) return "";
    return text
      .replace(/(?:\r\n|\r|\n)/g, '. ') 
      .replace(/["*#_~\[\]]/g, '')      
      .replace(/(http|https):\/\/[^\s]+/g, 'link web') 
      .trim();
  }

  private smartChunkText(text: string): string[] {
      const rawSentences = text.split(/([.?!:\n]+)/); 
      const chunks: string[] = [];
      let currentChunk = '';

      for (let i = 0; i < rawSentences.length; i++) {
          const part = rawSentences[i];
          currentChunk += part;
          
          if (part.match(/[.?!:\n]+/) || currentChunk.length >= 150) {
              const cleaned = currentChunk.trim();
              if (cleaned.length > 2) chunks.push(cleaned);
              currentChunk = '';
          }
      }
      if (currentChunk.trim().length > 2) chunks.push(currentChunk.trim());
      
      const finalChunks: string[] = [];
      for (const c of chunks) {
          if (c.length > 200) {
              const half = Math.floor(c.length / 2);
              const spaceIndex = c.indexOf(' ', half);
              const splitPoint = spaceIndex === -1 ? half : spaceIndex;
              finalChunks.push(c.substring(0, splitPoint).trim());
              finalChunks.push(c.substring(splitPoint).trim());
          } else {
              finalChunks.push(c);
          }
      }
      return finalChunks;
  }

  private getAudioDuration(filePath: string): Promise<number> {
    return new Promise((resolve) => {
      ffmpeg.ffprobe(filePath, (err, metadata) => {
        if (err || !metadata || !metadata.format || !metadata.format.duration) {
          this.logger.warn(`⚠️ Lỗi đọc metadata file âm thanh. Set tạm 5 giây để tránh lỗi đè hình!`);
          resolve(5); 
        } else {
          resolve(metadata.format.duration); 
        }
      });
    });
  }

  async generateAudio(text: string, fileName: string, gender: string): Promise<{ audioSrc: string, durationInFrames: number }> {
    const scriptPath = 'D:/LCOM108_NMLT/code/100_bai_code/tep_chua_python/Kokoro-Vietnamese/make_tts.py';
    
    // Thư mục lưu file mp3/wav public của Remotion
    const outputDir = path.join(process.cwd(), '../2_Remotion_Video/public/threads_audio');
    if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });
    
    const filePath = path.join(outputDir, fileName);
    const safeFilePath = filePath.replace(/\\/g, '/');
    const cleanedText = text.replace(/"/g, '\\"').replace(/\n/g, ' ');

    try {
        this.logger.log(`🤖 [KOKORO OFFLINE] Đang xử lý cấu trúc câu bằng Kokoro Vietnamese: "${cleanedText.substring(0, 30)}..."`);
        
        // Gọi trực tiếp python hệ thống để thực thi make_tts.py
        const command = `python "${scriptPath}" "${cleanedText}" "${gender}" "${safeFilePath}"`;
        const result = execSync(command).toString().trim();

        if (result.includes("SUCCESS") && fs.existsSync(filePath)) {
            // Tính toán tạm thời durationInFrames dựa trên độ dài ký tự hoặc dùng metadata
            // Trung bình 1 từ đọc khoảng 3-4 frames (ở 30fps)
            const wordCount = text.split(' ').length;
            const durationInFrames = Math.max(90, wordCount * 12); 

            return {
                audioSrc: `threads_audio/${fileName}`,
                durationInFrames: durationInFrames
            };
        } else {
            throw new Error(`Python trả về lỗi: ${result}`);
        }
    } catch (error: any) {
        this.logger.error(`❌ Lỗi Kokoro: ${error.message}`);
        // Nếu muốn an toàn, bạn có thể quăng khối try-catch cũ của FPT/Viettel/Zalo vào đây để làm dự phòng
        throw error;
    }
}
  private async getFptBuffer(text: string, voice: string, part: number, total: number): Promise<Buffer> {
    if (this.fptApiKeys.length === 0) throw new Error("Chưa điền FPT_AI_KEY");

    let downloadRetries = 60; 
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
        if (!audioUrl) throw new Error("FPT không trả về link");
        
        const noCacheUrl = `${audioUrl}?t=${Date.now()}`;

        while (downloadRetries > 0) {
          await new Promise(r => setTimeout(r, 2000)); 
          try {
            const audioRes = await axios({ 
                url: noCacheUrl, 
                method: 'GET', 
                responseType: 'arraybuffer',
                headers: { 
                    'User-Agent': 'Mozilla/5.0',
                    'Cache-Control': 'no-cache, no-store, must-revalidate'
                }
            });
            
            const size = audioRes.data.length || audioRes.data.byteLength;
            if (size > 1000) {
              this.logger.debug(`[FPT THÀNH CÔNG] Lấy xong file câu ${part}/${total} sau ${61 - downloadRetries} lần thử.`);
              return Buffer.from(audioRes.data);
            }
          } catch (e: any) {
             if (e.response && e.response.status !== 404) {
                 throw new Error(`Lỗi S3: HTTP ${e.response.status}`);
             }
          }
          downloadRetries--;
        }
        throw new Error("Đã kiên trì đợi FPT 2 phút nhưng nó vẫn không nhả file.");
      } catch (err: any) {
        lastErrorMsg = this.extractError(err);
        this.currentFptKeyIndex = (this.currentFptKeyIndex + 1) % this.fptApiKeys.length;
        attempt++;
        downloadRetries = 60; // Reset lại lòng kiên nhẫn cho Key tiếp theo
      }
    }
    throw new Error(`FPT bế tắc: ${lastErrorMsg}`);
  }

  private async getViettelBuffer(text: string, voice: string, part: number, total: number): Promise<Buffer> {
    const apiKey = process.env.VIETTEL_AI_KEY;
    if (!apiKey) throw new Error("Chưa điền VIETTEL_AI_KEY");

    const response = await axios({
      method: 'POST',
      url: 'https://viettelai.vn/tts/speech_synthesis',
      headers: { 'accept': '*/*', 'Content-Type': 'application/json', 'token': apiKey.trim() },
      data: { text: text, voice: voice, speed: 1, tts_return_option: 3 },
      responseType: 'arraybuffer' 
    });

    if (response.data.byteLength < 1000) throw new Error("Viettel rỗng");
    this.logger.debug(`🪖 [VIETTEL] Đã đọc xong câu ${part}/${total}`);
    return Buffer.from(response.data);
  }

  private async getZaloBuffer(text: string, speakerId: number, part: number, total: number): Promise<Buffer> {
    const apiKey = process.env.ZALO_AI_KEY;
    if (!apiKey) throw new Error("Chưa điền ZALO_AI_KEY");

    const response = await axios({
      method: 'POST',
      url: 'https://api.zalo.ai/v1/tts/synthesize',
      headers: { 'apikey': apiKey.trim(), 'Content-Type': 'application/x-www-form-urlencoded' },
      data: `input=${encodeURIComponent(text)}&speaker_id=${speakerId}&speed=1.0`
    });

    if (response.data.error_code !== 0) throw new Error(`Zalo lỗi`);

    const audioUrl = response.data.data.url;
    let downloadRetries = 4;
    while (downloadRetries > 0) {
      await new Promise(r => setTimeout(r, 2500));
      try {
        const audioRes = await axios({ url: audioUrl, method: 'GET', responseType: 'arraybuffer' });
        if (audioRes.data.byteLength > 1000) {
          this.logger.debug(`🚑 [ZALO] Đã đọc xong câu ${part}/${total}`);
          return Buffer.from(audioRes.data);
        }
      } catch (e) { }
      downloadRetries--;
    }
    throw new Error("Lỗi tải MP3 Zalo");
  }

  // Bên trong Class TtsService của bạn:
private async getKokoroBuffer(text: string, gender: string, part: number, total: number): Promise<Buffer> {
    // Đường dẫn tới file make_tts.py nằm trong thư mục bạn vừa clone
    const scriptPath = 'D:/LCOM108_NMLT/code/100_bai_code/tep_chua_python/Kokoro-Vietnamese/make_tts.py';
    
    // Tạo một file tạm để Python lưu âm thanh vào đó
    const tempFile = path.join(this.publicDir, `temp_part_${part}.wav`);

    try {
        // Thực thi lệnh Python: python make_tts.py "nội dung text" "female" "đường dẫn file"
        // Sử dụng chuỗi bọc cẩn thận để tránh lỗi ký tự đặc biệt của tiếng Việt
        const command = `python "${scriptPath}" "${text.replace(/"/g, '\\"')}" "${gender}" "${tempFile.replace(/\\/g, '/')}"`;
        
        this.logger.log(`🤖 [KOKORO OFFLINE] Đang ép Python xử lý câu ${part}/${total}...`);
        const result = execSync(command).toString().trim();

        if (result.includes("SUCCESS") && fs.existsSync(tempFile)) {
            // Đọc file tạm đã tạo thành Buffer để cho NestJS nối file
            const buffer = fs.readFileSync(tempFile);
            
            // Xóa file tạm đi cho sạch ổ cứng
            fs.unlinkSync(tempFile); 
            
            return buffer;
        } else {
            throw new Error(`Python trả về lỗi: ${result}`);
        }
    } catch (error: any) {
        if (fs.existsSync(tempFile)) fs.unlinkSync(tempFile);
        throw new Error(`Lỗi thực thi Kokoro Python: ${error.message}`);
    }
}
}
