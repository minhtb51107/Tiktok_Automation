import { Injectable, OnModuleInit, Logger } from '@nestjs/common';
import * as chokidar from 'chokidar';
import * as path from 'path';
import ffmpeg from 'fluent-ffmpeg';
import * as fs from 'fs';
import { RemotionRunnerService } from '../remotion-runner/remotion-runner.service';
import { WhisperService } from '../whisper/whisper.service';
import { GeminiService } from '../gemini/gemini.service';

@Injectable()
export class WatcherService implements OnModuleInit {
  private readonly logger = new Logger(WatcherService.name);

  constructor(
    private readonly remotionRunner: RemotionRunnerService,
    private readonly whisperService: WhisperService,
    private readonly geminiService: GeminiService,
  ) {}

  onModuleInit() {
    this.startWatching();
  }

  private startWatching() {
    const watchPath = path.join(process.cwd(), '..', '3_Storage_Assets', 'music_inputs');
    this.logger.log(`👀 Đang giám sát thư mục: ${watchPath}`);

    const watcher = chokidar.watch(watchPath, {
      ignored: /(^|[\/\\])\../,
      persistent: true,
      awaitWriteFinish: { stabilityThreshold: 2000, pollInterval: 100 },
    });

    // Sửa đoạn này trong hàm startWatching
    watcher.on('add', (filePath) => {
      if (!fs.existsSync(filePath)) return;

      // SỬA ĐOẠN NÀY: Dùng Regex để bắt cả .mp3 và .wav
      const ext = path.extname(filePath).toLowerCase();
      if (ext === '.mp3' || ext === '.wav') {
        const fileName = path.basename(filePath);
        this.logger.log(`🎉 [XUẤT PHÁT] Phát hiện file nhạc mới: ${fileName}`);
        this.processNewMusic(filePath, fileName);
      }
    });
  }

private async processNewMusic(filePath: string, fileName: string) {
    try {
      this.logger.log(`⏳ Đang chuẩn hóa âm thanh sang .wav: ${fileName}...`);
      
      const publicDir = path.join(process.cwd(), '..', '2_Remotion_Video', 'public');
      const wavOutputPath = path.join(publicDir, 'music.wav');

      // Dùng FFMPEG để convert mọi file input sang chuẩn .wav (48kHz, 16bit)
      await new Promise((resolve, reject) => {
        ffmpeg(filePath)
          .toFormat('wav')
          .audioChannels(2)
          .audioFrequency(48000)
          .on('end', resolve)
          .on('error', reject)
          .save(wavOutputPath);
      });

      this.logger.log(`✅ Đã chuẩn hóa xong music.wav!`);

      // Phần còn lại gọi Whisper, Gemini và Render như cũ
      const whisperJson = await this.whisperService.runWhisper(wavOutputPath, fileName); // Lưu ý truyền path .wav
      await this.geminiService.generateLyricScript(whisperJson);
      await this.remotionRunner.renderVideo(900, fileName); // số frame bạn tự tính hoặc truyền vào
      
      this.logger.log(`✨ HOÀN TẤT!`);
    } catch (error) {
      this.logger.error(`❌ Lỗi convert:`, error);
    }
  }

  private getAudioDuration(filePath: string): Promise<number> {
    return new Promise((resolve, reject) => {
      ffmpeg.ffprobe(filePath, (err, metadata) => {
        if (err) return reject(err);
        const duration = metadata.format.duration;
        duration ? resolve(Number(duration)) : reject(new Error('Không lấy được thời lượng.'));
      });
    });
  }
}