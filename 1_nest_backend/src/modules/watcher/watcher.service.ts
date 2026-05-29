import { Injectable, OnModuleInit, Logger } from '@nestjs/common';
import * as chokidar from 'chokidar';
import * as path from 'path';
import * as fs from 'fs';
import { TiktokLyricsService } from '../workflows/tiktok-lyrics/tiktok-lyrics.service';
import { ThreadsTopicService } from '../workflows/threads-topic/threads-topic.service';

@Injectable()
export class WatcherService implements OnModuleInit {
  private readonly logger = new Logger(WatcherService.name);

  constructor(
    private readonly tiktokService: TiktokLyricsService,
    private readonly threadsService: ThreadsTopicService,
  ) {}

  onModuleInit() {
    this.startWatching();
  }

  private startWatching() {
    const assetsDir = path.join(process.cwd(), '..', '3_Storage_Assets');

    // 1. Phân xưởng TikTok
    const tiktokMusicDir = path.join(assetsDir, '1_Tiktok_Lyrics', 'inputs_music');
    const tiktokImageDir = path.join(assetsDir, '1_Tiktok_Lyrics', 'inputs_image');

    // 2. Phân xưởng Threads
    const threadsTextDir = path.join(assetsDir, '2_Threads_Topic', 'inputs_text');
    const threadsImageDir = path.join(assetsDir, '2_Threads_Topic', 'inputs_image');

    // Tạo thư mục nếu chưa có
    [tiktokMusicDir, tiktokImageDir, threadsTextDir, threadsImageDir].forEach(dir => {
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    });

    this.logger.log(`👀 Đang giám sát luồng TikTok: ${tiktokMusicDir}`);
    this.logger.log(`👀 Đang giám sát luồng Threads: ${threadsTextDir}`);

    const watcher = chokidar.watch([tiktokMusicDir, tiktokImageDir, threadsTextDir, threadsImageDir], {
      ignored: /(^|[\/\\])\../,
      persistent: true,
      awaitWriteFinish: { stabilityThreshold: 2000, pollInterval: 100 },
    });

    watcher.on('add', (filePath) => {
      if (!fs.existsSync(filePath)) return;
      const fileName = path.basename(filePath);

      // Nếu có mp3 ném vào phân xưởng Tiktok
      if (filePath.includes('1_Tiktok_Lyrics') && (filePath.endsWith('.mp3') || filePath.endsWith('.wav'))) {
        this.logger.log(`📥 [TikTok] Phát hiện file nhạc mới: ${fileName}`);
        this.tiktokService.checkAndProcess(tiktokMusicDir, tiktokImageDir);
      }

      // Nếu có text (.txt) ném vào phân xưởng Threads
      if (filePath.includes('2_Threads_Topic') && filePath.endsWith('.txt')) {
        this.logger.log(`📥 [Threads] Phát hiện file text mới: ${fileName}`);
        this.threadsService.checkAndProcess(threadsTextDir, threadsImageDir);
      }
    });
  }
}