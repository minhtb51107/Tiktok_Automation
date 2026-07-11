import { Injectable, Logger } from '@nestjs/common';
import { exec } from 'child_process';
import { promisify } from 'util';
import * as path from 'path';
import * as fs from 'fs';

const execAsync = promisify(exec);

@Injectable()
export class WhisperService {
  private readonly logger = new Logger(WhisperService.name);

  async runWhisper(audioPath: string, fileName: string, signal?: AbortSignal) {
    this.logger.log(`🎧 Whisper đang bóc sub Karaoke câu: ${fileName}...`);

    const outputDir = path.resolve(process.cwd(), '..', '3_Storage_Assets', 'temp_whisper');
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }
    
    if (signal?.aborted) throw new Error('ABORTED');
    
    const absoluteAudioPath = path.resolve(audioPath);
    
    // Ép chạy bằng CPU phối hợp với model tiny siêu nhẹ, triệt tiêu lỗi thiếu Driver CUDA của bộ thư viện torch hệ thống
    const command = `whisper "${absoluteAudioPath}" --model tiny --language vi --output_format json --word_timestamps True --device cpu --output_dir "${outputDir}"`;

    try {
      await execAsync(command, { 
          cwd: outputDir,
          env: { ...process.env, PYTHONIOENCODING: 'utf-8', PYTHONUTF8: '1' },
          signal: signal 
      });
      
      const baseName = path.parse(absoluteAudioPath).name; 
      let files = fs.readdirSync(outputDir);
      let jsonFileName = files.find(f => f.includes(baseName) && f.endsWith('.json'));

      if (!jsonFileName) {
          throw new Error(`Không tìm thấy file kết quả JSON của Whisper.`);
      }

      const jsonFilePath = path.join(outputDir, jsonFileName);
      const rawJsonData = fs.readFileSync(jsonFilePath, 'utf8');
      const whisperOutput = JSON.parse(rawJsonData);

      this.logger.log(`✅ Bóc chữ Karaoke thành công: ${fileName}`);
      return whisperOutput;

    } catch (error: any) {
      if (error.name === 'AbortError' || signal?.aborted) {
         throw new Error('ABORTED');
      }
      this.logger.error(`❌ Lỗi Whisper: ${error.message}`);
      throw error;
    }
  }
}