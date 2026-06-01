import { Injectable, Logger } from '@nestjs/common';
import * as path from 'path';
import ffmpeg from 'fluent-ffmpeg';
import * as fs from 'fs';
import { Client } from 'genius-lyrics';
import axios from 'axios';
import FormData = require('form-data');

import { RemotionRunnerService } from '../../remotion-runner/remotion-runner.service';
import { WhisperService } from '../../whisper/whisper.service';
import { GeminiService } from '../../ai/gemini.service';

@Injectable()
export class TiktokLyricsService {
  private readonly logger = new Logger(TiktokLyricsService.name);
  private timer: NodeJS.Timeout;
  private geniusClient = new Client();

  constructor(
    private readonly remotionRunner: RemotionRunnerService,
    private readonly whisperService: WhisperService,
    private readonly geminiService: GeminiService,
  ) {}

  private cleanMusicText(text: string): string {
    if (!text) return '';
    return text
      .replace(/\s*[\(\[][^\]\)]*(remix|speed up|slowed|lofi|edit|cover|mix|version|china|speedup)[^\]\)]*[\)\]]/gi, '')
      .replace(/\s*-\s*(remix|speed up|slowed|lofi|edit|cover|mix|china).*/gi, '')
      .trim();
  }

  // Hàm này sẽ được Watcher gọi khi có file nhạc mới
  public checkAndProcess(musicDir: string, imageDir: string) {
    if (this.timer) clearTimeout(this.timer);

    this.timer = setTimeout(async () => {
      try {
        const musicFiles = fs.readdirSync(musicDir).filter(f => f.endsWith('.mp3') || f.endsWith('.wav'));
        const imageFiles = fs.readdirSync(imageDir).filter(f => f.endsWith('.jpg') || f.endsWith('.jpeg') || f.endsWith('.png'));

        if (musicFiles.length > 0 && imageFiles.length > 0) {
          const inputMusicPath = path.join(musicDir, musicFiles[0]);
          const fileName = musicFiles[0];
          
          this.logger.log(`🎉 [TIKTOK] Đã đủ nguyên liệu. Bắt đầu xử lý bài: ${fileName}!`);
          await this.processNewMusic(inputMusicPath, fileName, imageDir, imageFiles);
        } else {
          this.logger.log(`⏳ [TIKTOK] Đang chờ thêm nhạc và ảnh...`);
        }
      } catch (error) {
        this.logger.error(`❌ [TIKTOK] Lỗi lúc kiểm tra thư mục:`, error);
      }
    }, 3000);
  }

  private async processNewMusic(filePath: string, fileName: string, imageDir: string, imageFiles: string[]) {
    try {
      const publicDir = path.join(process.cwd(), '..', '2_Remotion_Video', 'public');
      const wavOutputPath = path.join(publicDir, 'music.wav');

      const oldPublicFiles = fs.readdirSync(publicDir);
      oldPublicFiles.forEach(file => {
        if (file.endsWith('.jpg') || file.endsWith('.jpeg') || file.endsWith('.png') || file.endsWith('.wav')) {
          fs.unlinkSync(path.join(publicDir, file));
        }
      });

      imageFiles.forEach(img => fs.copyFileSync(path.join(imageDir, img), path.join(publicDir, img)));
      
      let shazamTitle = "";
      let shazamArtist = "";
      let originalLyrics = "";

      const apiKey = process.env.AUDD_API_KEY;
      if (apiKey) {
        const form = new FormData();
        form.append('file', fs.createReadStream(filePath));
        form.append('api_token', apiKey);
        try {
          const response = await axios.post('https://api.audd.io/', form, { headers: form.getHeaders() });
          if (response.data && response.data.result) {
            shazamTitle = response.data.result.title;
            shazamArtist = response.data.result.artist;
            this.logger.log(`✅ [TIKTOK] Shazam nhận diện bài: "${shazamTitle} - ${shazamArtist}"`);
          }
        } catch (e: any) {}
      }

      if (shazamTitle) {
        try {
          const searches = await this.geniusClient.songs.search(`${shazamTitle} ${shazamArtist}`);
          if (searches.length > 0) {
            let rawLyrics = await searches[0].lyrics();
            originalLyrics = rawLyrics.replace(/\[.*?\]/g, '').replace(/\n{3,}/g, '\n\n').trim();
          }
        } catch (err: any) {}
      }

      await new Promise((resolve, reject) => {
        ffmpeg(filePath).toFormat('wav').audioChannels(2).audioFrequency(48000)
          .on('end', resolve).on('error', reject).save(wavOutputPath);
      });

      const whisperJson = await this.whisperService.runWhisper(wavOutputPath, fileName); 
      const aiData = await this.geminiService.generateLyricScript(whisperJson, originalLyrics);
      
      let finalTitle = this.cleanMusicText(shazamTitle || aiData.songTitle);
      let finalArtist = this.cleanMusicText(shazamArtist || aiData.artist);

      if (!finalTitle || finalTitle.includes('Unknown')) {
        finalTitle = this.cleanMusicText(path.parse(fileName).name); 
        finalArtist = 'Tiktok Music'; 
      }

      // CHÚ Ý: Chỗ này sau sẽ truyền compositionId là 'ProLyricVideo'
      await this.remotionRunner.renderVideo(900, fileName, imageFiles, finalTitle, finalArtist); 
      this.logger.log(`✨ [TIKTOK] HOÀN TẤT TOÀN BỘ QUY TRÌNH! ĐÃ CÓ VIDEO!`);

      const txtFiles = fs.readdirSync(path.dirname(filePath)).filter(f => f.endsWith('.txt'));
      txtFiles.forEach(txt => fs.unlinkSync(path.join(path.dirname(filePath), txt)));

    } catch (error) {
      this.logger.error(`❌ [TIKTOK] Lỗi trong lúc xử lý:`, error);
    }
  }
}