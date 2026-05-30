import { Injectable, Logger } from '@nestjs/common';
import * as googleTTS from 'google-tts-api'; 
import { getAudioDurationInSeconds } from 'get-audio-duration';
import * as fs from 'fs';
import * as path from 'path';
import axios from 'axios';
import * as dotenv from 'dotenv';
dotenv.config();

@Injectable()
export class TtsService {
  private readonly logger = new Logger(TtsService.name);
  private readonly FPS = 60; 
  private readonly fptApiKey = process.env.FPT_AI_KEY;

  private estimateDurationInSeconds(text: string): number {
    if (!text) return 2;
    const wordCount = text.split(/\s+/).length;
    return (wordCount * 0.35) + 0.5;
  }

  // CƠ CHẾ POLLING KIÊN NHẪN: Tăng lên 30 lượt thử (~1 phút đợi) để ép FPT nhả file bằng được
  private async downloadFptAudio(url: string, filePath: string, retries = 30): Promise<boolean> {
    await new Promise(resolve => setTimeout(resolve, 3000));

    for (let i = 0; i < retries; i++) {
      try {
        const response = await axios({
          method: 'GET',
          url: url,
          responseType: 'arraybuffer',
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
          },
          timeout: 10000,
        });
        
        const contentType = response.headers['content-type'];
        if (typeof contentType === 'string' && contentType.includes('application/json')) {
          this.logger.debug(`FPT.AI đang render âm thanh (Lượt quét ${i + 1}/${retries})... Đợi thêm 1.5s`);
          await new Promise(resolve => setTimeout(resolve, 1500));
          continue; 
        }

        if (response.data.length < 1000) {
          await new Promise(resolve => setTimeout(resolve, 1500));
          continue;
        }

        fs.writeFileSync(filePath, response.data);
        this.logger.log(`✅ Đã tải xong file giọng đọc chuẩn từ FPT.AI!`);
        return true; 
        
      } catch (error: any) {
        if (error.response?.status !== 404) {
          this.logger.warn(`Lỗi kết nối khi tải audio: ${error.message}`);
        }
        await new Promise(resolve => setTimeout(resolve, 1500)); 
      }
    }
    return false;
  }

  private async fallbackToGoogleTTS(text: string, outputPath: string, gender: string) {
    this.logger.warn('⚠️ Kích hoạt luồng cứu cánh dự phòng Google TTS...');
    // SỬA ĐỔI: slow: false để đồng bộ nhịp điệu nhanh và cuốn như FPT
    const chunks = await googleTTS.getAllAudioBase64(text, {
      lang: 'vi',
      slow: false, 
      host: 'https://translate.google.com',
      timeout: 10000,
    });
    const audioBuffer = Buffer.concat(chunks.map(chunk => Buffer.from(chunk.base64, 'base64')));
    fs.writeFileSync(outputPath, audioBuffer);
  }

  async generateAudio(text: string, fileName: string, gender: string = 'neutral'): Promise<{ audioSrc: string, durationInFrames: number }> {
    const outputPath = path.join(process.cwd(), '../2_Remotion_Video/public/threads_audio', fileName);
    
    if (!fs.existsSync(path.dirname(outputPath))) {
      fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    }

    let finalDurationFrames = Math.ceil(this.estimateDurationInSeconds(text) * this.FPS);

    try {
      if (this.fptApiKey) {
        let voiceName = 'banmai'; 
        if (gender === 'male') voiceName = 'leminh'; 
        
        const fptResponse = await axios.post('https://api.fpt.ai/hmi/tts/v5', text, {
          headers: {
            'api-key': this.fptApiKey,
            'voice': voiceName,
            'speed': '1', 
            'format': 'mp3'
          },
          timeout: 40000 // NÂNG LÊN 40 GIÂY: Tránh đứt gãy luồng kết nối khi server FPT tải chậm
        });

        if (fptResponse.data && fptResponse.data.async) {
          const success = await this.downloadFptAudio(fptResponse.data.async, outputPath);
          if (!success) throw new Error("FPT.AI trả file quá chậm.");
        } else {
          throw new Error("API FPT.AI không trả về link async.");
        }
      } else {
        await this.fallbackToGoogleTTS(text, outputPath, gender);
      }

      if (fs.existsSync(outputPath)) {
        const durationInSeconds = await getAudioDurationInSeconds(outputPath);
        finalDurationFrames = Math.ceil(durationInSeconds * this.FPS) + 6;
      }

      return { audioSrc: `threads_audio/${fileName}`, durationInFrames: finalDurationFrames };

    } catch (error: any) {
      this.logger.error(`🚨 Luồng FPT.AI gặp sự cố (${error.message}). Chuyển hướng sang Google TTS!`);
      try {
        await this.fallbackToGoogleTTS(text, outputPath, gender);
        if (fs.existsSync(outputPath)) {
          const durationInSeconds = await getAudioDurationInSeconds(outputPath);
          finalDurationFrames = Math.ceil(durationInSeconds * this.FPS) + 6;
        }
        return { audioSrc: `threads_audio/${fileName}`, durationInFrames: finalDurationFrames };
      } catch (fallbackError: any) {
        this.logger.error(`❌ Lỗi luồng dự phòng!`, fallbackError);
        return { audioSrc: null, durationInFrames: finalDurationFrames }; 
      }
    }
  }
}