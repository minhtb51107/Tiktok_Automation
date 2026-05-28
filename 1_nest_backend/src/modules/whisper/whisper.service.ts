import { Injectable, Logger } from '@nestjs/common';
import { exec } from 'child_process';
import { promisify } from 'util';
import * as path from 'path';
import * as fs from 'fs';

const execAsync = promisify(exec);

@Injectable()
export class WhisperService {
  private readonly logger = new Logger(WhisperService.name);

  async runWhisper(audioPath: string, fileName: string) {
    this.logger.log(`🎧 Bắt đầu gọi Whisper nghe bài hát: ${fileName}...`);

    const outputDir = path.join(process.cwd(), '..', '3_Storage_Assets', 'temp_whisper');
    
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }
    
    // NÂNG CẤP LỖ TAI: Dùng model 'small' thay vì 'base'
    const command = `whisper "${audioPath}" --model small --output_format json --word_timestamps True --output_dir "${outputDir}"`;

    try {
      await execAsync(command);
      this.logger.log(`✅ Whisper đã nghe và bóc băng xong!`);

      const baseName = path.parse(audioPath).name; 
      const jsonFileName = `${baseName}.json`; 
      const jsonFilePath = path.join(outputDir, jsonFileName);

      const rawJsonData = fs.readFileSync(jsonFilePath, 'utf8');
      const whisperOutput = JSON.parse(rawJsonData);

      this.logger.log(`📄 Đã lấy được dữ liệu JSON có chứa timestamp.`);

      return whisperOutput;

    } catch (error) {
      this.logger.error(`❌ Lỗi khi chạy lệnh Whisper:`, error);
      throw error;
    }
  }
}