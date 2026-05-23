import { Injectable, OnModuleInit, Logger } from '@nestjs/common';
import * as chokidar from 'chokidar';
import * as path from 'path';
import * as ffmpeg from 'fluent-ffmpeg';
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
      awaitWriteFinish: {
        stabilityThreshold: 2000,
        pollInterval: 100,
      },
    });

    watcher.on('add', (filePath) => {
      // Kiểm tra file có thực sự tồn tại (chống lỗi sự kiện ảo khi xóa file)
      if (!fs.existsSync(filePath)) return;

      if (path.extname(filePath).toLowerCase() === '.mp3') {
        const fileName = path.basename(filePath);
        this.logger.log(`🎉 [XUẤT PHÁT] Phát hiện file nhạc mới: ${fileName}`);
        this.processNewMusic(filePath, fileName);
      }
    });
  }

  private async processNewMusic(filePath: string, fileName: string) {
    try {
      this.logger.log(`⏳ Bắt đầu xử lý: ${fileName}...`);

      // 1. Lấy thông số nhạc
      const durationInSeconds = await this.getAudioDuration(filePath);
      const durationInFrames = Math.ceil(durationInSeconds * 30); // 30 FPS

      // 2. Copy nhạc vào xưởng Remotion để nó nhận diện file
      const remotionMusicPath = path.join(process.cwd(), '..', '2_Remotion_Video', 'src', 'music.mp3');
      fs.copyFileSync(filePath, remotionMusicPath);
      this.logger.log(`📁 Đã copy nhạc vào 2_Remotion_Video/src/`);

      // 3. Gọi Whisper bóc băng
      const whisperJson = await this.whisperService.runWhisper(filePath, fileName);

      // 4. Gọi Gemini tạo file script.ts
      await this.geminiService.generateLyricScript(whisperJson);

      // 5. Gọi Remotion xuất video
      await this.remotionRunner.renderVideo(remotionMusicPath, durationInFrames, fileName);

      this.logger.log(`✨ HOÀN TẤT TỰ ĐỘNG HÓA CHO: ${fileName}`);
    } catch (error) {
      if (error instanceof Error) {
        this.logger.error(`❌ Lỗi hệ thống khi xử lý ${fileName}:`, error.message);
      } else {
        this.logger.error(`❌ Lỗi không xác định:`, String(error));
      }
    }
  }

  private getAudioDuration(filePath: string): Promise<number> {
    return new Promise((resolve, reject) => {
      ffmpeg.ffprobe(filePath, (err, metadata) => {
        if (err) return reject(err);
        const duration = metadata.format.duration;
        duration ? resolve(duration) : reject(new Error('Không lấy được thời lượng.'));
      });
    });
  }
}