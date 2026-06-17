import { Injectable, Logger } from '@nestjs/common';
import { RemotionRunnerService } from '../../remotion-runner/remotion-runner.service';
import { ScraperService } from '../../core/scraper/scraper.service';
import { TtsService } from '../../core/tts/tts.service';
import { WhisperService } from '../../whisper/whisper.service';
import * as fs from 'fs';
import * as path from 'path';
import axios from 'axios';

@Injectable()
export class ThreadsSeriousService {
  private readonly logger = new Logger(ThreadsSeriousService.name);

  constructor(
    private readonly remotionRunnerService: RemotionRunnerService,
    private readonly scraperService: ScraperService,
    private readonly ttsService: TtsService,
    private readonly whisperService: WhisperService
  ) {}

  private async downloadAvatar(url: string, fileName: string, authorName: string): Promise<string> {
    const fallbackUrl = `https://ui-avatars.com/api/?name=${encodeURIComponent(authorName || 'User')}&background=random&size=256&bold=true&format=png`;

    if (!url || url.includes('pixabay.com') || url.includes('blank-profile') || url.includes('default')) {
        return fallbackUrl;
    }

    const avatarsDir = path.join(process.cwd(), '../2_Remotion_Video/public/avatars');
    if (!fs.existsSync(avatarsDir)) fs.mkdirSync(avatarsDir, { recursive: true });
    const filePath = path.join(avatarsDir, fileName);

    if (url.startsWith('data:image')) {
        try {
            const base64Data = url.replace(/^data:image\/\w+;base64,/, "");
            fs.writeFileSync(filePath, Buffer.from(base64Data, 'base64'));
            return `avatars/${fileName}`;
        } catch (e) {
            return fallbackUrl;
        }
    }

    let attempt = 0;
    while (attempt < 3) {
      try {
        const response = await axios({ 
          url: url, 
          method: 'GET', 
          responseType: 'arraybuffer', 
          headers: { 
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
            'Accept': 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8',
            'Referer': 'https://www.threads.net/' 
          }, 
          timeout: 10000 
        });

        const contentType = String(response.headers['content-type'] || '');
        if (contentType.includes('image') && response.data && response.data.length > 500) {
           fs.writeFileSync(filePath, response.data);
           if (fs.existsSync(filePath)) {
               return `avatars/${fileName}`;
           }
        }
      } catch (error: any) { 
          attempt++; 
          await new Promise(r => setTimeout(r, 1000)); 
      }
    }
    
    return fallbackUrl; // Nếu cố tải 3 lần không được thì dùng luôn link web
  }

  private async getGifFromGiphy(keyword: string, timestamp: number, index: number): Promise<string> {
    if (!keyword || keyword.trim() === "" || keyword.toLowerCase() === "none") return "";
    try {
        const apiKey = process.env.GIPHY_API_KEY;
        if (!apiKey) return "";
        const res = await axios.get(`https://api.giphy.com/v1/gifs/search?api_key=${apiKey}&q=${encodeURIComponent(keyword)}&limit=10`);
        if (res.data.data && res.data.data.length > 0) {
            const randomGif = res.data.data[Math.floor(Math.random() * res.data.data.length)];
            const videoUrl = randomGif.images.original.mp4 || randomGif.images.original_mp4.mp4;
            if (videoUrl) {
                const gifDir = path.join(process.cwd(), '../2_Remotion_Video/public/gifs');
                if (!fs.existsSync(gifDir)) fs.mkdirSync(gifDir, { recursive: true });
                const fileName = `gif_${timestamp}_${index}.mp4`;
                const filePath = path.join(gifDir, fileName);
                const response = await axios({ url: videoUrl, method: 'GET', responseType: 'arraybuffer', timeout: 30000 });
                fs.writeFileSync(filePath, response.data);
                return `gifs/${fileName}`;
            }
        }
    } catch (e: any) {}
    return "";
  }

  async processSeriousVideo(threadUrl: string, rawScript: string, onProgress?: (status: string) => Promise<void>, signal?: AbortSignal) {
    const timestamp = Date.now();
    const trashFiles: string[] = [];
    const scriptName = `serious_script_${timestamp}.json`;
    trashFiles.push(scriptName);

    if (signal?.aborted) throw new Error('ABORTED');

    if (onProgress) await onProgress(`🎙️ **[XƯỞNG PODCAST]** Đang đi cào bài viết gốc để lấy Avatar thật...`);
    const rawData = await this.scraperService.scrapeThreadsUrl(threadUrl);
    
    const realPost = rawData.post;
    const realComments = rawData.comments || [];

    if (signal?.aborted) throw new Error('ABORTED');

    if (onProgress) await onProgress(`🎙️ **[XƯỞNG PODCAST]** Đang ráp kịch bản AI với thông tin gốc...`);

    const chunks: any[] = [];
    const regex = /<CHUNK\s+type="(.*?)"(?:\s+author="(.*?)")?(?:\s+keyword="(.*?)")?>([\s\S]*?)<\/CHUNK>/g;
    let match;

    while ((match = regex.exec(rawScript)) !== null) {
        const type = match[1];
        const author = match[2] || "Người kể chuyện";
        const keyword = match[3] || "none";
        const textContent = match[4].trim();

        if (textContent.length > 5) {
            chunks.push({
                text: textContent,      
                caption: "",
                cardToShow: (type === 'post' || type === 'comment') ? type : "none",
                authorName: author,
                gifKeyword: keyword
            });
        }
    }

    if (chunks.length === 0) throw new Error("Không tìm thấy thẻ <CHUNK> nào! Sếp kiểm tra lại định dạng ChatGPT trả về nhé.");

    if (onProgress) await onProgress('🎙️ **[XƯỞNG PODCAST]** 🎞️ Đang gọi TTS lồng tiếng và nhặt hình minh họa...');

    const localAvatar = await this.downloadAvatar(realPost.avatar, `ava_serious_${timestamp}.jpg`, realPost.author);
    if (localAvatar.startsWith('avatars/')) trashFiles.push(localAvatar);

    const processedChunks = [];
    for (let i = 0; i < chunks.length; i++) {
        if (signal?.aborted) throw new Error('ABORTED');

        const chunk = chunks[i];
        try {
            const audioData = await this.ttsService.generateAudio(chunk.text, `serious_${timestamp}_${i}.mp3`, 'male');
            trashFiles.push(audioData.audioSrc);
            const audioFullPath = path.join(process.cwd(), '../2_Remotion_Video/public', audioData.audioSrc);

            let whisperWords = [];
            try {
               const fileName = path.basename(audioFullPath);
               const whisperOutput = await this.whisperService.runWhisper(audioFullPath, fileName, signal); 
               whisperWords = whisperOutput.words || whisperOutput; 
            } catch (wErr: any) {
               if (wErr.message === 'ABORTED') throw wErr;
               this.logger.warn(`Lỗi Whisper đoạn ${i}: Bỏ qua Karaoke.`);
            }

            const gifUrl = await this.getGifFromGiphy(chunk.gifKeyword, timestamp, i);
            if (gifUrl) trashFiles.push(gifUrl);

            let commentInfo = null;
            if (chunk.cardToShow === 'post') {
                commentInfo = {
                    author: realPost.author,
                    avatar: localAvatar, 
                    text: realPost.text, 
                    timeAgo: realPost.timeAgo || "Vừa xong"
                };
            } else if (chunk.cardToShow === 'comment') {
                const realCmt = realComments.find((c: any) => c.author === chunk.authorName);
                if (realCmt) {
                    const cmtAvatar = await this.downloadAvatar(realCmt.avatar, `ava_temp_${Date.now()}_${i}.jpg`, realCmt.author);
                    if (cmtAvatar.startsWith('avatars/')) trashFiles.push(cmtAvatar);
                    
                    commentInfo = {
                        author: realCmt.author,
                        avatar: cmtAvatar, 
                        text: realCmt.text, 
                        timeAgo: realCmt.timeAgo || "Vừa xong"
                    };
                } else {
                    const fallbackAvatar = await this.downloadAvatar('', `ava_temp_${Date.now()}_${i}.jpg`, chunk.authorName);
                    if (fallbackAvatar.startsWith('avatars/')) trashFiles.push(fallbackAvatar);
                    
                    let displayText = chunk.text;
                    const matchIntro = chunk.text.match(/^.*?[:"”]/);
                    if (matchIntro) displayText = chunk.text.replace(matchIntro[0], '').replace(/["”]/g, '').trim();

                    commentInfo = {
                        author: chunk.authorName,
                        avatar: fallbackAvatar,
                        text: displayText,
                        timeAgo: "Vừa xong"
                    };
                }
            }

            processedChunks.push({
                text: chunk.text, 
                caption: chunk.caption,
                cardToShow: chunk.cardToShow,
                commentInfo: commentInfo, 
                gifImg: gifUrl,
                audioSrc: audioData.audioSrc,
                words: whisperWords,
                durationInFrames: audioData.durationInFrames + 15
            });
        } catch (e: any) { 
            if (e.message === 'ABORTED') throw e; 
        }
    }

    if (signal?.aborted) throw new Error('ABORTED');

    const fallbackBgm = fs.existsSync(path.join(process.cwd(), '../2_Remotion_Video/public/bgm/sneaky.mp3')) ? "bgm/sneaky.mp3" : "bgm/lofi.mp3";

    const scriptData = {
      tiktok_caption: "Kinh nghiệm thực tế từ người đi trước #xuhuong #kienthuc #baihoc", 
      bgm: fallbackBgm, 
      postInfo: { 
         author: realPost.author, 
         avatar: localAvatar, 
         text: realPost.text,
         timeAgo: realPost.timeAgo || "2 giờ trước"
      }, 
      chunks: processedChunks
    };

    const scriptPath = path.join(process.cwd(), '../2_Remotion_Video/public', scriptName);
    fs.writeFileSync(scriptPath, JSON.stringify(scriptData, null, 2));

    const outputFileName = `visual_story_${timestamp}.mp4`;
    const outputPath = path.resolve(process.cwd(), '../3_Storage_Assets/output_ready', outputFileName);
    
    try {
        if (onProgress) await onProgress('🎙️ **[XƯỞNG PODCAST]** 🎬 Đã tải xong tài nguyên. Đang nung chảy GPU để Render...');
        await this.remotionRunnerService.renderThreadsVideo('SeriousAdviceVideo', scriptPath, outputFileName, signal);
        return { success: true, videoName: outputFileName, outputPath: outputPath, caption: scriptData.tiktok_caption, script: scriptData };
    } finally {
        this.cleanupFiles(trashFiles);
    }
  }

  private cleanupFiles(files: string[]) {
    files.forEach(file => {
      try {
        const fullPath = path.join(process.cwd(), '../2_Remotion_Video/public', file);
        if (fs.existsSync(fullPath) && !file.includes('default_avatar') && !file.includes('source_minecraft') && !file.includes('minecraft_parkour')) {
          fs.unlinkSync(fullPath);
          if (file.endsWith('audio.mp3')) { 
             const parentDir = path.dirname(fullPath); 
             if (fs.existsSync(parentDir)) fs.rmdirSync(parentDir); 
          }
        }
      } catch (e) {}
    });

    try {
        const whisperDir = path.join(process.cwd(), '../3_Storage_Assets/temp_whisper');
        if (fs.existsSync(whisperDir)) {
            const wFiles = fs.readdirSync(whisperDir);
            wFiles.forEach(f => {
                try { fs.unlinkSync(path.join(whisperDir, f)); } catch (err) {}
            });
        }
    } catch (e) {}
  }
}
