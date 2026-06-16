import { Injectable, Logger } from '@nestjs/common';
import { exec } from 'child_process';
import { promisify } from 'util';
import * as path from 'path';
import * as fs from 'fs';

const execAsync = promisify(exec);

@Injectable()
export class WhisperService {
  private readonly logger = new Logger(WhisperService.name);

  // NÂNG CẤP: Nhận thêm signal từ tuyến trên
  async runWhisper(audioPath: string, fileName: string, signal?: AbortSignal) {
    this.logger.log(`🎧 Bắt đầu gọi Whisper nghe bài hát: ${fileName}...`);

    const outputDir = path.resolve(process.cwd(), '..', '3_Storage_Assets', 'temp_whisper');
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }
    
    // CHỐT CHẶN: Nếu đã bị hủy từ trước khi chạy lệnh thì văng lỗi luôn
    if (signal?.aborted) throw new Error('ABORTED');
    
    const absoluteAudioPath = path.resolve(audioPath);
    
    const command = `whisper "${absoluteAudioPath}" --model base --language vi --output_format json --word_timestamps True --output_dir "${outputDir}"`;

    try {
      // 🔥 TRUYỀN SIGNAL VÀO EXEC: Node.js sẽ tự động kill Python nếu có lệnh hủy
      const { stdout, stderr } = await execAsync(command, { 
          cwd: outputDir,
          env: { ...process.env, PYTHONIOENCODING: 'utf-8', PYTHONUTF8: '1' },
          signal: signal 
      });
      
      this.logger.log(`[WHISPER ĐÃ NGHE ĐƯỢC]:\n${stdout.trim() || "🚨 TRỐNG TRƠN! (Nó không nghe thấy chữ nào)"}`);
      
      if (stderr && !stderr.includes('UserWarning')) {
         this.logger.warn(`[WHISPER CẢNH BÁO]:\n${stderr}`);
      }

      const baseName = path.parse(absoluteAudioPath).name; 
      let files = fs.readdirSync(outputDir);
      let jsonFileName = files.find(f => f.includes(baseName) && f.endsWith('.json'));

      if (!jsonFileName) {
          throw new Error(`Whisper chạy xong nhưng TỪ CHỐI xuất file JSON vì không nhận ra tiếng người!`);
      }

      const jsonFilePath = path.join(outputDir, jsonFileName);
      const rawJsonData = fs.readFileSync(jsonFilePath, 'utf8');
      const whisperOutput = JSON.parse(rawJsonData);

      this.logger.log(`📄 Đã bóc băng thành công và có chữ Karaoke cho ${fileName}!`);
      return whisperOutput;

    } catch (error: any) {
      // XỬ LÝ LỖI HỦY BỎ
      if (error.name === 'AbortError' || signal?.aborted) {
         this.logger.warn(`🛑 Tiến trình Whisper đã bị BÓP CỔ CHẾT TỨC TƯỞI (Lệnh dừng khẩn cấp)!`);
         throw new Error('ABORTED');
      }
      
      this.logger.error(`❌ Lỗi chí mạng khi bóc băng Whisper: ${error.message}`);
      throw error;
    }
  }
}