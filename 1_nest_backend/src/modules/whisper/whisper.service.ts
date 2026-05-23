import { Injectable, Logger } from '@nestjs/common';
import { exec } from 'child_process';
import { promisify } from 'util';
import * as path from 'path';
import * as fs from 'fs';

// Biến hàm exec thành Promise để có thể dùng async/await chờ nó chạy xong
const execAsync = promisify(exec);

@Injectable()
export class WhisperService {
  private readonly logger = new Logger(WhisperService.name);

  async runWhisper(audioPath: string, fileName: string) {
    this.logger.log(`🎧 Bắt đầu gọi Whisper nghe bài hát: ${fileName}...`);

    // Đường dẫn lưu file json tạm thời
    const outputDir = path.join(process.cwd(), '..', '3_Storage_Assets', 'temp_whisper');
    
    // Lệnh Terminal y hệt như bạn hay gõ (Mình thêm --word_timestamps True để lấy thời gian khớp từng chữ)
    const command = `whisper "${audioPath}" --model base --output_format json --word_timestamps True --output_dir "${outputDir}"`;

    try {
      // 1. NestJS gõ lệnh và ngồi chờ Whisper chạy xong
      await execAsync(command);
      this.logger.log(`✅ Whisper đã nghe và bóc băng xong!`);

      // 2. Tìm và đọc file JSON vừa được tạo ra
      const jsonFileName = fileName.replace('.mp3', '.json');
      const jsonFilePath = path.join(outputDir, jsonFileName);

      const rawJsonData = fs.readFileSync(jsonFilePath, 'utf8');
      const whisperOutput = JSON.parse(rawJsonData);

      this.logger.log(`📄 Đã lấy được dữ liệu JSON có chứa timestamp.`);

      // Trả dữ liệu về để chuẩn bị đưa cho AI dịch
      return whisperOutput;

    } catch (error) {
      this.logger.error(`❌ Lỗi khi chạy lệnh Whisper:`, error);
      throw error;
    }
  }
}