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
import { GeminiService } from '../gemini/gemini.service';

@Injectable()
export class WatcherService implements OnModuleInit {
  private readonly logger = new Logger(WatcherService.name);
  private timer: NodeJS.Timeout;
  private geniusClient = new Client();

  constructor(
    private readonly remotionRunner: RemotionRunnerService,
    private readonly whisperService: WhisperService,
    private readonly geminiService: GeminiService,
  ) {}

  onModuleInit() {
    this.startWatching();
  }

  // Hàm quét và lọc sạch các hậu tố Remix, China Remix, Speed Up, Lofi...
  private cleanMusicText(text: string): string {
    if (!text) return '';
    return text
      .replace(/\s*[\(\[][^\]\)]*(remix|speed up|slowed|lofi|edit|cover|mix|version|china|speedup)[^\]\)]*[\)\]]/gi, '') // Xóa (China Remix), [Speed Up]...
      .replace(/\s*-\s*(remix|speed up|slowed|lofi|edit|cover|mix|china).*/gi, '') // Xóa dạng "- Remix..."
      .trim();
  }

  private startWatching() {
    const assetsDir = path.join(process.cwd(), '..', '3_Storage_Assets');
    const musicDir = path.join(assetsDir, 'music_inputs');
    const imageDir = path.join(assetsDir, 'background_images');

    if (!fs.existsSync(musicDir)) fs.mkdirSync(musicDir, { recursive: true });
    if (!fs.existsSync(imageDir)) fs.mkdirSync(imageDir, { recursive: true });

    this.logger.log(`👀 Đang giám sát thư mục nhạc: ${musicDir}`);
    this.logger.log(`👀 Đang giám sát thư mục ảnh: ${imageDir}`);

    const watcher = chokidar.watch([musicDir, imageDir], {
      ignored: /(^|[\/\\])\../,
      persistent: true,
      awaitWriteFinish: { stabilityThreshold: 2000, pollInterval: 100 },
    });

    watcher.on('add', (filePath) => {
      if (!fs.existsSync(filePath)) return;
      const ext = path.extname(filePath).toLowerCase();
      if (['.mp3', '.wav', '.jpg', '.jpeg', '.png', '.txt'].includes(ext)) {
        const fileName = path.basename(filePath);
        this.logger.log(`📥 Phát hiện file mới: ${fileName}`);
        this.checkAndProcess(musicDir, imageDir);
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
        } else {
          this.logger.log(`⏳ Đang chờ thêm nhạc và ảnh...`);
        }
      } catch (error) {
        this.logger.error(`❌ Lỗi lúc kiểm tra thư mục:`, error);
      }
    }, 3000); 
  }

  private async processNewMusic(filePath: string, fileName: string, imageDir: string, imageFiles: string[]) {
    try {
      const publicDir = path.join(process.cwd(), '..', '2_Remotion_Video', 'public');
      const wavOutputPath = path.join(publicDir, 'music.wav');

      const oldPublicFiles = fs.readdirSync(publicDir);
      oldPublicFiles.forEach(file => {
        if (file.endsWith('.jpg') || file.endsWith('.jpeg') || file.endsWith('.png')) {
          fs.unlinkSync(path.join(publicDir, file));
        }
      });

      imageFiles.forEach(img => {
        fs.copyFileSync(path.join(imageDir, img), path.join(publicDir, img));
      });
      this.logger.log(`✅ Đã nạp ${imageFiles.length} ảnh vào Remotion.`);

      let shazamTitle = "";
      let shazamArtist = "";
      let originalLyrics = "";

      const apiKey = process.env.AUDD_API_KEY;
      if (!apiKey) {
        this.logger.warn(`⚠️ Chưa cấu hình AUDD_API_KEY. Sẽ bỏ qua bước nhận diện âm thanh.`);
      } else {
        this.logger.log(`🎧 Đang gửi nhạc cho chuyên gia Shazam (AudD) nghe thử...`);
        const form = new FormData();
        form.append('file', fs.createReadStream(filePath));
        form.append('api_token', apiKey);

        try {
          const response = await axios.post('https://api.audd.io/', form, {
            headers: form.getHeaders(),
          });
          
          if (response.data && response.data.result) {
            shazamTitle = response.data.result.title;
            shazamArtist = response.data.result.artist;
            this.logger.log(`✅ Shazam nhận diện thành công bài: "${shazamTitle} - ${shazamArtist}"`);
          } else {
            this.logger.warn(`⚠️ Shazam không nhận ra bài hát này.`);
          }
        } catch (e: any) {
          this.logger.error(`❌ Lỗi gọi API Shazam: ${e.message}`);
        }
      }

      if (shazamTitle) {
        const searchQuery = `${shazamTitle} ${shazamArtist}`;
        this.logger.log(`🔍 Đang mang "${searchQuery}" lên Genius tìm lời chuẩn...`);
        try {
          const searches = await this.geniusClient.songs.search(searchQuery);
          if (searches.length > 0) {
            let rawLyrics = await searches[0].lyrics();
            originalLyrics = rawLyrics.replace(/\[.*?\]/g, '').replace(/\n{3,}/g, '\n\n').trim();
            this.logger.log(`✅ Đã cào và làm sạch lời bài hát gốc từ Genius!`);
          } else {
            this.logger.warn(`⚠️ Genius không có lời bài này.`);
          }
        } catch (err: any) {
          this.logger.warn(`⚠️ Lỗi kết nối Genius (Bỏ qua).`);
        }
      }

      // Đã bỏ bộ lọc chèn im lặng, nhạc sẽ phát mượt mà ngay lập tức
      this.logger.log(`⏳ Đang chuẩn hóa âm thanh sang .wav gốc...`);
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

      const whisperJson = await this.whisperService.runWhisper(wavOutputPath, fileName); 
      const aiData = await this.geminiService.generateLyricScript(whisperJson, originalLyrics);
      
      // 👉 TIẾN HÀNH LỌC SẠCH TÊN BÀI HÁT & TÁC GIẢ GỐC TẠI ĐÂY
      let finalTitle = this.cleanMusicText(shazamTitle || aiData.songTitle);
      let finalArtist = this.cleanMusicText(shazamArtist || aiData.artist);

      if (!finalTitle || finalTitle.includes('Unknown')) {
        const baseName = path.parse(fileName).name;
        finalTitle = this.cleanMusicText(baseName); 
        finalArtist = 'Tiktok Music'; 
      }

      this.logger.log(`🎬 Chốt thông tin xuất video: ${finalTitle} - ${finalArtist}`);

      await this.remotionRunner.renderVideo(900, fileName, imageFiles, finalTitle, finalArtist); 
      this.logger.log(`✨ HOÀN TẤT TOÀN BỘ QUY TRÌNH! ĐÃ CÓ VIDEO!`);

      const txtFiles = fs.readdirSync(path.dirname(filePath)).filter(f => f.endsWith('.txt'));
      txtFiles.forEach(txt => fs.unlinkSync(path.join(path.dirname(filePath), txt)));

    } catch (error) {
      this.logger.error(`❌ Lỗi trong lúc xử lý:`, error);
    }
  }
}