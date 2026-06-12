import { Injectable, Logger } from '@nestjs/common';
import { AiService } from '../../core/ai/ai.service'; 
import { RemotionRunnerService } from '../../remotion-runner/remotion-runner.service';
import { ScraperService } from '../../core/scraper/scraper.service';
import { TtsService } from '../../core/tts/tts.service';
import * as fs from 'fs';
import * as path from 'path';
import axios from 'axios';

@Injectable()
export class ThreadsSeriousService {
  private readonly logger = new Logger(ThreadsSeriousService.name);

  constructor(
    private readonly aiService: AiService, 
    private readonly remotionRunnerService: RemotionRunnerService,
    private readonly scraperService: ScraperService,
    private readonly ttsService: TtsService,
  ) {}

  // 🔥 1. Tải Avatar vật lý để chống lỗi CORS của Remotion
  private async downloadAvatar(url: string, fileName: string, authorName: string): Promise<string> {
    const avatarsDir = path.join(process.cwd(), '../2_Remotion_Video/public/avatars');
    if (!fs.existsSync(avatarsDir)) fs.mkdirSync(avatarsDir, { recursive: true });
    const filePath = path.join(avatarsDir, fileName);

    const targetUrl = (!url || url.includes('pixabay.com') || url.includes('blank-profile')) 
                      ? `https://ui-avatars.com/api/?name=${encodeURIComponent(authorName)}&background=random&size=256` : url;
    try {
        const response = await axios({ 
          url: targetUrl, method: 'GET', responseType: 'arraybuffer', 
          headers: { 'User-Agent': 'Mozilla/5.0' }, timeout: 15000 
        });
        if (response.data.length > 500) {
           fs.writeFileSync(filePath, response.data);
           return `avatars/${fileName}`;
        }
    } catch (error: any) { 
        this.logger.warn(`Lỗi tải Avatar Serious: ${error.message}`); 
    }
    return 'avatars/default_avatar.jpg'; 
  }

  // 🔥 2. Bộ lọc Pexels chuẩn chỉnh, chỉ lấy Video Dọc HD/4K
  private async getPexelsVideoUrl(keyword: string): Promise<string> {
    try {
      const apiKey = process.env.PEXELS_API_KEY;
      if (!apiKey) return ""; 
      
      const res = await axios.get(`https://api.pexels.com/videos/search?query=${encodeURIComponent(keyword)}&per_page=5&orientation=portrait&size=large`, {
          headers: { Authorization: apiKey }
      });

      if (res.data.videos && res.data.videos.length > 0) {
          const randomVid = res.data.videos[Math.floor(Math.random() * res.data.videos.length)];
          const videoFiles = randomVid.video_files;
          
          // Ưu tiên video dọc độ phân giải cao nhất
          const hdVideo = videoFiles.sort((a: any, b: any) => b.width - a.width).find((v: any) => v.width >= 720 && v.height >= 1280);
          
          return hdVideo ? hdVideo.link : videoFiles[0].link;
      }
    } catch (e: any) {
      this.logger.warn(`Pexels không tìm thấy [${keyword}], sẽ dùng nền Neon mặc định.`);
    }
    return "";
  }

  async processSeriousVideo(threadUrl: string, onProgress?: (status: string) => Promise<void>) {
    const timestamp = Date.now();
    const trashFiles: string[] = [];
    const scriptName = `serious_script_${timestamp}.json`;
    trashFiles.push(scriptName);

    if (onProgress) await onProgress('🕷️ Đang cào dữ liệu Threads...');
    const rawData = await this.scraperService.scrapeThreadsUrl(threadUrl);

    let fullText = rawData.post.text + '\n';
    const topComments = rawData.comments.sort((a: any, b: any) => parseInt(b.likeCount || '0') - parseInt(a.likeCount || '0')).slice(0, 4);
    topComments.forEach((cmt: any) => fullText += cmt.text + '\n');

    if (onProgress) await onProgress('🤖 Đang nhờ GPT-5 băm nhỏ kịch bản và đạo diễn B-Roll...');

    // 🔥 3. Ép Keyword Pexels chỉ được 1-2 chữ
    const chunkPrompt = `
      Biến nội dung tâm sự sau thành một kịch bản Podcast ngắn.
      1. Sửa lỗi chính tả, ngắt thành từng câu ngắn.
      2. NGHĨ RA 1 TỪ KHÓA PEXELS (TIẾNG ANH): BẮT BUỘC CHỈ 1 ĐẾN 2 TỪ (Ví dụ: "sad", "walking", "rain", "coffee", "office"). TUYỆT ĐỐI KHÔNG DÀI HƠN 2 TỪ.
      NỘI DUNG: "${fullText.substring(0, 1000)}"

      TRẢ VỀ ĐÚNG ĐỊNH DẠNG JSON OBJECT NÀY:
      {
        "chunks": [
          { "text": "Khi bạn 20 tuổi, bạn chênh vênh...", "keyword": "night city" }
        ]
      }
    `;

    let chunks: { text: string, keyword: string }[] = [];
    try {
      let aiRes = await this.aiService.askGemini(chunkPrompt);
      
      // 🔥 4. Gọt sạch rác Markdown của AI trước khi Parse
      aiRes = aiRes.replace(/```json/g, '').replace(/```/g, '').trim();
      const jsonStart = aiRes.indexOf('{');
      const jsonEnd = aiRes.lastIndexOf('}');
      
      if (jsonStart === -1 || jsonEnd === -1) {
          throw new Error("AI không trả về định dạng JSON hợp lệ");
      }
      
      const cleanJsonStr = aiRes.substring(jsonStart, jsonEnd + 1);
      const parsed = JSON.parse(cleanJsonStr);
      
      if (parsed.chunks && Array.isArray(parsed.chunks)) {
          chunks = parsed.chunks;
      } else {
          throw new Error("JSON thiếu mảng 'chunks'");
      }
    } catch (e: any) {
      this.logger.error(`Lỗi băm kịch bản: ${e.message}`);
      throw new Error("Lỗi phân tích kịch bản bằng AI GPT-5. Vui lòng thử lại!");
    }

    if (onProgress) await onProgress('🎞️ Đang tải giọng đọc và tìm kiếm video minh họa...');

    const processedChunks = [];
    for (let i = 0; i < chunks.length; i++) {
        const chunk = chunks[i];
        try {
            const audioData = await this.ttsService.generateAudio(chunk.text, `serious_${timestamp}_${i}.mp3`, 'male');
            trashFiles.push(audioData.audioSrc);

            const brollUrl = await this.getPexelsVideoUrl(chunk.keyword);

            processedChunks.push({
                text: chunk.text,
                keyword: chunk.keyword,
                brollUrl: brollUrl, 
                audioSrc: audioData.audioSrc,
                durationInFrames: audioData.durationInFrames + 30 
            });
        } catch (e) { }
    }

    // TẢI AVATAR VẬT LÝ
    const localAvatar = await this.downloadAvatar(rawData.post.avatar, `ava_serious_${timestamp}.jpg`, rawData.post.author);
    trashFiles.push(localAvatar);

    // Đảm bảo có fallback nhạc nền
    const fallbackBgm = fs.existsSync(path.join(process.cwd(), '../2_Remotion_Video/public/bgm/sad_piano.mp3')) 
        ? "bgm/sad_piano.mp3" 
        : "bgm/sneaky.mp3";

    const scriptData = {
      tiktok_caption: "Góc tâm sự và lời khuyên #phattrienbanthan #baihoc #podcast", 
      bgm: fallbackBgm, 
      postInfo: { author: rawData.post.author, avatar: localAvatar }, 
      chunks: processedChunks
    };

    const scriptPath = path.join(process.cwd(), '../2_Remotion_Video/public', scriptName);
    fs.writeFileSync(scriptPath, JSON.stringify(scriptData, null, 2));

    const outputFileName = `serious_output_${timestamp}.mp4`;
    
    if (onProgress) await onProgress('🎬 Đang Render Video Podcast...');
    await this.remotionRunnerService.renderThreadsVideo('SeriousAdviceVideo', scriptPath, outputFileName);
    
    this.cleanupFiles(trashFiles);
    const outputPath = path.resolve(process.cwd(), '../3_Storage_Assets/output_ready', outputFileName);
    
    return { success: true, videoName: outputFileName, outputPath: outputPath, caption: scriptData.tiktok_caption, script: scriptData };
  }

  private cleanupFiles(files: string[]) {
    files.forEach(file => {
      try {
        const fullPath = path.join(process.cwd(), '../2_Remotion_Video/public', file);
        if (fs.existsSync(fullPath)) fs.unlinkSync(fullPath);
      } catch (e) {}
    });
  }
}