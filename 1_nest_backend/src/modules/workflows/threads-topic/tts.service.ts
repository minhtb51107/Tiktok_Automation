import { Injectable, Logger } from '@nestjs/common';
import * as fs from 'fs';
import * as path from 'path';
import axios from 'axios';
import getMp3Duration from 'get-mp3-duration';

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

  // 🔥 HÀM TỔNG CHỈ HUY: Lưới tản nhiệt 3 Lớp (FPT -> Viettel -> Zalo)
  async generateAudio(text: string, fileName: string, gender: string) {
    try {
      return await this.generateFptAudio(text, fileName, gender);
    } catch (fptError: any) {
      this.logger.warn(`⚠️ FPT AI SẬP (${fptError.message}). Đẩy qua Viettel AI...`);
      
      try {
        return await this.generateViettelAudio(text, fileName, gender);
      } catch (viettelError: any) {
        this.logger.warn(`⚠️ VIETTEL AI CŨNG SẬP (${viettelError.message}). Gọi chốt chặn Zalo AI...`);
        
        try {
          return await this.generateZaloAudio(text, fileName, gender);
        } catch (zaloError: any) {
          this.logger.error(`❌ CẢ 3 ÔNG LỚN ĐỀU SẬP! Không cứu được comment này.`);
          throw zaloError; 
        }
      }
    }
  }

  // =======================================================
  // 🎙️ TỔ ĐỌC 1: FPT AI (Chính)
  // =======================================================
  private async generateFptAudio(text: string, fileName: string, gender: string) {
    if (this.fptApiKeys.length === 0) throw new Error("Chưa cấu hình FPT_AI_KEY");

    let voice = 'banmai'; 
    if (gender === 'female') {
      const femaleVoices = ['banmai', 'thuminh', 'linhsan', 'lanngoc'];
      voice = femaleVoices[Math.floor(Math.random() * femaleVoices.length)];
    } else {
      const maleVoices = ['leminh', 'minhquang', 'thanhlong'];
      voice = maleVoices[Math.floor(Math.random() * maleVoices.length)];
    }

    this.logger.log(`🎙️ [FPT] Đang dùng giọng ${gender === 'female' ? 'Nữ' : 'Nam'} (${voice}) đọc...`);

    let downloadRetries = 3;
    let attempt = 0;

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
        if (!audioUrl) throw new Error("FPT không trả về link audio");

        const filePath = path.join(this.publicDir, fileName);
        
        while (downloadRetries > 0) {
          await new Promise(r => setTimeout(r, 2500));
          try {
            const audioRes = await axios({ url: audioUrl, method: 'GET', responseType: 'arraybuffer' });
            if (audioRes.data.byteLength > 100) {
              fs.writeFileSync(filePath, audioRes.data);
              const durationInFrames = Math.ceil((getMp3Duration(fs.readFileSync(filePath)) / 1000) * 60);
              return { audioSrc: `threads_audio/${fileName}`, durationInFrames };
            }
          } catch (e) { downloadRetries--; }
        }
        throw new Error("Không tải được file vật lý từ FPT");
      } catch (err: any) {
        this.currentFptKeyIndex = (this.currentFptKeyIndex + 1) % this.fptApiKeys.length;
        attempt++;
      }
    }
    throw new Error("FPT sập toàn tập");
  }

  // =======================================================
  // 🪖 TỔ ĐỌC 2: VIETTEL AI (Dự phòng 1)
  // =======================================================
  private async generateViettelAudio(text: string, fileName: string, gender: string) {
    const apiKey = process.env.VIETTEL_AI_KEY;
    if (!apiKey) throw new Error("Chưa cấu hình VIETTEL_AI_KEY");

    // Viettel Voices: Nữ (hn-quynhanh, sg-hoaimy), Nam (hn-tienquan, sg-minhhoang)
    const voice = gender === 'female' 
      ? (Math.random() > 0.5 ? 'hn-quynhanh' : 'sg-hoaimy') 
      : (Math.random() > 0.5 ? 'hn-tienquan' : 'sg-minhhoang');

    this.logger.log(`🪖 [VIETTEL] Đang dùng giọng ${voice} ứng cứu...`);

    const response = await axios({
      method: 'POST',
      url: 'https://viettelai.vn/tts/speech_synthesis',
      headers: {
        'accept': '*/*',
        'Content-Type': 'application/json',
        'token': apiKey
      },
      data: {
        text: text,
        voice: voice,
        speed: 1,
        tts_return_option: 3 // Option 3 trả về trực tiếp file audio stream (âm thanh vật lý)
      },
      responseType: 'arraybuffer' // Hứng luôn file âm thanh
    });

    if (response.data.byteLength < 100) throw new Error("Viettel trả về file lỗi");

    const filePath = path.join(this.publicDir, fileName);
    fs.writeFileSync(filePath, response.data);
    
    const durationInFrames = Math.ceil((getMp3Duration(fs.readFileSync(filePath)) / 1000) * 60);
    this.logger.log(`✅ [VIETTEL] Cứu thành công!`);
    
    return { audioSrc: `threads_audio/${fileName}`, durationInFrames };
  }

  // =======================================================
  // 🚑 TỔ ĐỌC 3: ZALO AI (Dự phòng 2)
  // =======================================================
  private async generateZaloAudio(text: string, fileName: string, gender: string) {
    const apiKey = process.env.ZALO_AI_KEY;
    if (!apiKey) throw new Error("Chưa cấu hình ZALO_AI_KEY");

    const speakerId = gender === 'female' ? (Math.random() > 0.5 ? 1 : 2) : (Math.random() > 0.5 ? 3 : 4);
    this.logger.log(`🚑 [ZALO] Đang dùng giọng ${gender === 'female' ? 'Nữ' : 'Nam'} đọc cứu viện cuối cùng...`);

    const response = await axios({
      method: 'POST',
      url: 'https://api.zalo.ai/v1/tts/synthesize',
      headers: {
        'apikey': apiKey,
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      data: `input=${encodeURIComponent(text)}&speaker_id=${speakerId}&speed=1.0`
    });

    if (response.data.error_code !== 0) throw new Error(response.data.error_message);

    const audioUrl = response.data.data.url;
    const filePath = path.join(this.publicDir, fileName);

    let downloadRetries = 3;
    while (downloadRetries > 0) {
      await new Promise(r => setTimeout(r, 2000));
      try {
        const audioRes = await axios({ url: audioUrl, method: 'GET', responseType: 'arraybuffer' });
        if (audioRes.data.byteLength > 100) {
          fs.writeFileSync(filePath, audioRes.data);
          const durationInFrames = Math.ceil((getMp3Duration(fs.readFileSync(filePath)) / 1000) * 60);
          this.logger.log(`✅ [ZALO] Cứu thành công!`);
          return { audioSrc: `threads_audio/${fileName}`, durationInFrames };
        }
      } catch (e) { downloadRetries--; }
    }
    throw new Error("Lỗi tải file vật lý từ Zalo AI");
  }
}