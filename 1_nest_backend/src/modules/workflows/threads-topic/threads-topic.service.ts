import { Injectable, Logger } from '@nestjs/common';
import { GeminiService } from '../../gemini/gemini.service';
import { RemotionRunnerService } from '../../remotion-runner/remotion-runner.service';
import { ScraperService } from './scraper.service';
import { TtsService } from './tts.service';
import * as fs from 'fs';
import * as path from 'path';
import axios from 'axios';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

@Injectable()
export class ThreadsTopicService {
  private readonly logger = new Logger(ThreadsTopicService.name);

  constructor(
    private readonly geminiService: GeminiService,
    private readonly remotionRunnerService: RemotionRunnerService,
    private readonly scraperService: ScraperService,
    private readonly ttsService: TtsService,
  ) {}

  private async downloadAvatar(url: string, fileName: string): Promise<string> {
    const localFallback = 'avatars/default_avatar.jpg';
    try {
      if (!url || url.includes('pixabay.com') || url.startsWith('data:image')) return localFallback; 
      const avatarsDir = path.join(process.cwd(), '../2_Remotion_Video/public/avatars');
      if (!fs.existsSync(avatarsDir)) fs.mkdirSync(avatarsDir, { recursive: true });

      const filePath = path.join(avatarsDir, fileName);
      const response = await axios({
        url, method: 'GET', responseType: 'arraybuffer',
        headers: { 'User-Agent': 'Mozilla/5.0' },
        timeout: 10000 
      });
      if (response.data.length < 1000) return localFallback;
      fs.writeFileSync(filePath, response.data);
      return `avatars/${fileName}`;
    } catch (error: any) {
      return localFallback; 
    }
  }

  private async downloadAttachedImage(url: string, fileName: string): Promise<string | null> {
    if (!url || !url.startsWith('http')) return null;
    try {
      const imagesDir = path.join(process.cwd(), '../2_Remotion_Video/public/attached_images');
      if (!fs.existsSync(imagesDir)) fs.mkdirSync(imagesDir, { recursive: true });

      const filePath = path.join(imagesDir, fileName);
      const response = await axios({
        url, method: 'GET', responseType: 'arraybuffer',
        headers: { 'User-Agent': 'Mozilla/5.0' },
        timeout: 15000
      });
      fs.writeFileSync(filePath, response.data);
      return `attached_images/${fileName}`;
    } catch (error) {
      return null;
    }
  }

// NÂNG CẤP LỆNH FFMPEG: Trị dứt điểm "No frame found" của OffthreadVideo Remotion
  private async prepareDynamicBackground(totalFrames: number, timestamp: number): Promise<string> {
    const sourceBgPath = path.join(process.cwd(), '../2_Remotion_Video/public/backgrounds/source_minecraft.mp4');
    const outputBgName = `bg_temp_${timestamp}.mp4`;
    const outputBgPath = path.join(process.cwd(), '../2_Remotion_Video/public/backgrounds', outputBgName);

    if (!fs.existsSync(sourceBgPath)) {
      this.logger.warn('⚠️ Không tìm thấy source_minecraft.mp4, dùng nền mặc định.');
      return "backgrounds/minecraft_parkour.mp4";
    }

    // Cộng thêm 3 giây đệm an toàn
    const durationInSeconds = Math.ceil(totalFrames / 60) + 3; 
    
    // Đảm bảo không random quá đà lố thời gian file gốc
    const randomStartTime = Math.floor(Math.random() * (400 - durationInSeconds));

    this.logger.log(`✂️ Đang tự động cắt ${durationInSeconds}s làm nền, gọt dọc 1080x1920... (Cấu hình Remotion Safe)`);
    
    // CÚ TWIST FFMPEG CUỐI CÙNG:
    // -vf fps=60: Ép chuẩn khung hình vào thẳng trong bộ lọc ảnh
    // -g 1: Every frame is a keyframe (Diệt tận gốc lỗi trích xuất frame của Rust Compositor)
    // -movflags +faststart: Giúp Remotion đọc file siêu tốc
    const ffmpegCmd = `ffmpeg -y -ss ${randomStartTime} -i "${sourceBgPath}" -t ${durationInSeconds} -vf "crop=ih*9/16:ih,scale=1080:1920,fps=60" -c:v libx264 -pix_fmt yuv420p -profile:v baseline -level 3.0 -g 1 -movflags +faststart -an "${outputBgPath}"`;

    try {
      await execAsync(ffmpegCmd);
      return `backgrounds/${outputBgName}`;
    } catch (error) {
      this.logger.error('Lỗi khi cắt background tự động, fallback về mặc định', error);
      return "backgrounds/minecraft_parkour.mp4";
    }
  }

  private cleanupFiles(files: string[]) {
    files.forEach(file => {
      try {
        const fullPath = path.join(process.cwd(), '../2_Remotion_Video/public', file);
        if (fs.existsSync(fullPath) && !file.includes('default_avatar') && !file.includes('source_minecraft')) {
          fs.unlinkSync(fullPath);
          if (file.endsWith('audio.mp3')) {
             const parentDir = path.dirname(fullPath);
             if (fs.existsSync(parentDir)) fs.rmdirSync(parentDir); 
          }
        }
      } catch (e) {}
    });
    this.logger.log('🧹 Đã dọn sạch file rác!');
  }

async processThreadsVideo(threadUrl: string) {
    const timestamp = Date.now();
    const rawData = await this.scraperService.scrapeThreadsUrl(threadUrl);

    this.logger.log('Đang nhờ AI xử lý...');
    const prompt = `Từ bài post và danh sách comment sau, chọn ra 5 comment. 
    1. Dự đoán giới tính (male/female/neutral).
    2. Tạo số tương tác ảo ("1.2K").
    3. Dịch các từ viết tắt Gen Z và xóa Emoji ở trường "ttsText".
    4. Nếu thấy URL trong trường attachedImage, hãy giữ nguyên. Nếu trống, để chuỗi rỗng "".
    
    JSON format:
    {
      "post": {"author": "...", "avatar": "...", "text": "...", "ttsText": "...", "attachedImage": "...", "gender": "...", "likes": "...", "comments": "...", "reposts": "...", "timeAgo": "..."}, 
      "comments": [{"author": "...", "avatar": "...", "text": "...", "ttsText": "...", "attachedImage": "...", "gender": "...", "likes": "...", "timeAgo": "..."}]
    }
    Data: ${JSON.stringify(rawData)}`;
    
    let filteredData;
    try {
      const aiResponse = await this.geminiService.generateText(prompt);
      filteredData = JSON.parse(aiResponse.replace(/```json|```/g, '').trim());
    } catch (error) {
      this.logger.error("⚠️ AI lỗi Fallback!");
      filteredData = { 
        post: { ...rawData.post, ttsText: rawData.post.text, attachedImage: rawData.post.attachedImage || "", gender: 'neutral', likes: "2.1K", comments: "128", reposts: "45", timeAgo: "10 phút" }, 
        comments: rawData.comments.slice(0, 5).map(c => ({ ...c, ttsText: c.text, attachedImage: c.attachedImage || "", gender: 'neutral', likes: "12", timeAgo: "2 phút" }))
      };
    }

    const postAudio = await this.ttsService.generateAudio(filteredData.post.ttsText, `post_${timestamp}.mp3`, filteredData.post.gender);
    const postAvatarLocal = await this.downloadAvatar(filteredData.post.avatar, `avatar_post_${timestamp}.jpg`);
    const postImageLocal = await this.downloadAttachedImage(filteredData.post.attachedImage, `image_post_${timestamp}.jpg`);
    
    filteredData.post.avatar = postAvatarLocal; 
    filteredData.post.attachedImage = postImageLocal; 
    
    let totalFramesCalculated = postAudio.durationInFrames;
    const commentsProps = [];
    const trashAttachedImages: string[] = [];

    for (let i = 0; i < filteredData.comments.length; i++) {
      const cmt = filteredData.comments[i];
      const audioData = await this.ttsService.generateAudio(cmt.ttsText, `cmt_${timestamp}_${i}.mp3`, cmt.gender);
      const avatarLocal = await this.downloadAvatar(cmt.avatar, `avatar_cmt_${timestamp}_${i}.jpg`);
      const cmtImageLocal = await this.downloadAttachedImage(cmt.attachedImage, `image_cmt_${timestamp}_${i}.jpg`);
      
      cmt.avatar = avatarLocal; 
      cmt.attachedImage = cmtImageLocal;
      if (cmtImageLocal) trashAttachedImages.push(cmtImageLocal);

      totalFramesCalculated += audioData.durationInFrames;
      commentsProps.push({ ...cmt, ...audioData });
    }

    const dynamicBackground = await this.prepareDynamicBackground(totalFramesCalculated, timestamp);

    const scriptData = {
      backgroundVideo: dynamicBackground, 
      bgm: "bgm/lofi.mp3",
      post: { ...filteredData.post, ...postAudio },
      comments: commentsProps
    };

    const scriptPath = path.join(process.cwd(), '../2_Remotion_Video/public/threads_script.json');
    fs.writeFileSync(scriptPath, JSON.stringify(scriptData, null, 2));

    const outputFileName = `threads_output_${timestamp}.mp4`;
    
    // GOM TOÀN BỘ FILE RÁC NGAY TRƯỚC KHI RENDER
    const trashFiles = [
      postAudio.audioSrc, postAvatarLocal, postImageLocal,
      dynamicBackground, 
      ...commentsProps.map(c => c.audioSrc),
      ...commentsProps.map(c => c.avatar),
      ...trashAttachedImages
    ].filter(Boolean) as string[];

    // DÙNG TRY...FINALLY ĐỂ CHỐNG KẸT RÁC
    try {
      this.logger.log('Bắt đầu Render Remotion...');
      await this.remotionRunnerService.renderThreadsVideo('ThreadsTopicVideo', scriptPath, outputFileName);
      return { success: true, script: scriptData, videoName: outputFileName };
      
    } catch (error) {
      this.logger.error('❌ Render thất bại, nhưng hệ thống vẫn sẽ dọn rác...');
      throw error; 
      
    } finally {
      // Dù Render sập hay thành công, rác chắc chắn 100% sẽ được dọn!
      this.cleanupFiles(trashFiles);
    }
  }
}