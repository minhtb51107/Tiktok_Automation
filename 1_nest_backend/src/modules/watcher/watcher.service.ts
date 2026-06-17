import { Injectable, OnModuleInit, Logger } from '@nestjs/common';
import * as chokidar from 'chokidar';
import * as path from 'path';
import ffmpeg from 'fluent-ffmpeg';
import * as fs from 'fs';
import { Client } from 'genius-lyrics';
import axios from 'axios'; 
import FormData = require('form-data'); 

import { RemotionRunnerService } from '../remotion-runner/remotion-runner.service';
import { WhisperService } from '../whisper/whisper.service';
import { GeminiService } from '../core/ai/gemini.service';
import { ThreadsDramaService } from '../workflows/threads-drama/threads-drama.service';


@Injectable()
export class WatcherService implements OnModuleInit {
  private readonly logger = new Logger(WatcherService.name);
  private timer: NodeJS.Timeout;
  private geniusClient = new Client();

  constructor(
    private readonly remotionRunner: RemotionRunnerService,
    private readonly whisperService: WhisperService,
    private readonly geminiService: GeminiService,
    private readonly threadsTopicService: ThreadsDramaService, 
  ) {}

  onModuleInit() {
    this.startWatching();
  }

  private cleanMusicText(text: string): string {
    if (!text) return '';
    return text
      .replace(/\s*[\(\[][^\]\)]*(remix|speed up|slowed|lofi|edit|cover|mix|version|china|speedup)[^\]\)]*[\)\]]/gi, '')
      .replace(/\s*-\s*(remix|speed up|slowed|lofi|edit|cover|mix|china).*/gi, '')
      .trim();
  }

  private startWatching() {
    const assetsDir = path.join(process.cwd(), '..', '3_Storage_Assets');
    const musicDir = path.join(assetsDir, 'music_inputs');
    const imageDir = path.join(assetsDir, 'background_images');
    const threadsDir = path.join(assetsDir, 'threads_inputs'); // Thêm folder threads

    if (!fs.existsSync(musicDir)) fs.mkdirSync(musicDir, { recursive: true });
    if (!fs.existsSync(imageDir)) fs.mkdirSync(imageDir, { recursive: true });
    if (!fs.existsSync(threadsDir)) fs.mkdirSync(threadsDir, { recursive: true });

    this.logger.log(`👀 Đang giám sát thư mục nhạc: ${musicDir}`);
    this.logger.log(`👀 Đang giám sát thư mục Threads: ${threadsDir}`);

    const watcher = chokidar.watch([musicDir, imageDir, threadsDir], {
      ignored: /(^|[\/\\])\../,
      persistent: true,
      awaitWriteFinish: { stabilityThreshold: 2000, pollInterval: 100 },
    });

    watcher.on('add', (filePath) => {
      if (!fs.existsSync(filePath)) return;
      const ext = path.extname(filePath).toLowerCase();
      const fileName = path.basename(filePath);

      if (['.mp3', '.wav', '.jpg', '.jpeg', '.png'].includes(ext) && !filePath.includes('threads_inputs')) {
        this.logger.log(`📥 Phát hiện file nhạc/ảnh mới: ${fileName}`);
        this.checkAndProcess(musicDir, imageDir);
      }
      
      if (ext === '.txt' && filePath.includes('threads_inputs')) {
        this.logger.log(`📥 Phát hiện file yêu cầu Threads mới: ${fileName}`);
        this.checkAndProcessThreads(threadsDir);
      }
    });
  }

  private checkAndProcess(musicDir: string, imageDir: string) {
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(async () => {
      try {
        const musicFiles = fs.readdirSync(musicDir).filter(f => f.endsWith('.mp3') || f.endsWith('.wav'));
        const imageFiles = fs.readdirSync(imageDir).filter(f => f.endsWith('.jpg') || f.endsWith('.jpeg') || f.endsWith('.png'));

        if (musicFiles.length > 0 && imageFiles.length > 0) {
          const inputMusicPath = path.join(musicDir, musicFiles[0]);
          const fileName = musicFiles[0];
          this.logger.log(`🎉 [XUẤT PHÁT] Đã đủ nguyên liệu. Bắt đầu xử lý bài: ${fileName}!`);
          await this.processNewMusic(inputMusicPath, fileName, imageDir, imageFiles);
        }
      } catch (error) {
        this.logger.error(`❌ Lỗi lúc kiểm tra thư mục:`, error);
      }
    }, 3000); 
  }

  private checkAndProcessThreads(threadsDir: string) {
    if (this.timer) clearTimeout(this.timer);

    this.timer = setTimeout(async () => {
      try {
        const txtFiles = fs.readdirSync(threadsDir).filter(f => f.endsWith('.txt'));

        if (txtFiles.length > 0) {
          const txtFilePath = path.join(threadsDir, txtFiles[0]);
          this.logger.log(`🎉 [THREADS] Phát hiện file yêu cầu: ${txtFiles[0]}`);

          const url = fs.readFileSync(txtFilePath, 'utf-8').trim();

          if (url && url.includes('threads.net')) {
            this.logger.log(`🔗 Đang xử lý link: ${url}`);
            await this.threadsTopicService.processDramaVideo(url);
            fs.unlinkSync(txtFilePath);
            this.logger.log(`🗑️ Đã xóa file yêu cầu ${txtFiles[0]}`);
          } else {
            this.logger.warn(`⚠️ File ${txtFiles[0]} không chứa link Threads hợp lệ.`);
          }
        }
      } catch (error) {
        this.logger.error(`❌ Lỗi lúc kiểm tra thư mục Threads:`, error);
      }
    }, 2000); 
  }

  private async processNewMusic(filePath: string, fileName: string, imageDir: string, imageFiles: string[]) {
  }
}
