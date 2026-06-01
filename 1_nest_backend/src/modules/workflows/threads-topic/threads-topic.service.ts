import { Injectable, Logger } from '@nestjs/common';
import { AiService } from '../../ai/ai.service'; 
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
    private readonly aiService: AiService, 
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

  private async prepareDynamicBackground(totalFrames: number, timestamp: number): Promise<string> {
    const sourceBgPath = path.join(process.cwd(), '../2_Remotion_Video/public/backgrounds/source_minecraft.mp4');
    const outputBgName = `bg_temp_${timestamp}.mp4`;
    const outputBgPath = path.join(process.cwd(), '../2_Remotion_Video/public/backgrounds', outputBgName);

    if (!fs.existsSync(sourceBgPath)) {
      this.logger.warn('⚠️ Không tìm thấy source_minecraft.mp4, dùng nền mặc định.');
      return "backgrounds/minecraft_parkour.mp4";
    }

    const durationInSeconds = Math.ceil(totalFrames / 60) + 3; 
    const randomStartTime = Math.floor(Math.random() * (400 - durationInSeconds));

    this.logger.log(`✂️ Đang tự động cắt ${durationInSeconds}s làm nền...`);
    
    const ffmpegCmd = `ffmpeg -y -ss ${randomStartTime} -i "${sourceBgPath}" -t ${durationInSeconds} -vf "crop=ih*9/16:ih,scale=1080:1920,fps=60" -c:v libx264 -pix_fmt yuv420p -profile:v baseline -level 3.0 -g 1 -movflags +faststart -an "${outputBgPath}"`;

    try {
      await execAsync(ffmpegCmd);
      return `backgrounds/${outputBgName}`;
    } catch (error) {
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
  }

  async processThreadsVideo(threadUrl: string) {
    const timestamp = Date.now();
    const rawData = await this.scraperService.scrapeThreadsUrl(threadUrl);

    this.logger.log('Đang nhờ AI làm đạo diễn...');
    
    const memeDictionaryPath = path.join(process.cwd(), 'meme_dictionary.json');
    const sfxDictionaryPath = path.join(process.cwd(), 'sfx_dictionary.json');

    let memeDictionaryText = "{}";
    let sfxDictionaryText = "{}";

    try {
      if (fs.existsSync(memeDictionaryPath)) memeDictionaryText = fs.readFileSync(memeDictionaryPath, 'utf8');
      if (fs.existsSync(sfxDictionaryPath)) sfxDictionaryText = fs.readFileSync(sfxDictionaryPath, 'utf8');
    } catch (err) {}

    // PROMPT ĐƯỢC THIẾT KẾ LẠI ĐỂ ÉP GROQ HOẠT ĐỘNG
    const prompt = `Bạn là một Đạo diễn Video chuyên nghiệp. Từ bài post và danh sách comment sau, hãy chọn 5 comment thú vị nhất. 
    Trực tiếp thực hiện 5 YÊU CẦU SAU VÀ CHỈ TRẢ VỀ JSON:
    
    1. DỊCH THUẬT (ttsText): BẮT BUỘC dịch TẤT CẢ từ viết tắt tiếng Việt, từ lóng Gen Z sang từ hoàn chỉnh (VD: "ko"->"không", "dc"->"được", "j"->"gì", "khum"->"không", "mng"->"mọi người"). Xóa toàn bộ Emoji.
    2. GIỚI TÍNH (gender): Dựa vào Tên tác giả (author) và cách xưng hô trong text để suy luận bắt buộc là "male" (Nam) hoặc "female" (Nữ). (Ví dụ: Quỳnh, Hoa, Chị, Em gái -> female. Hùng, Huy, Anh, Bro -> male).
    3. TƯƠNG TÁC: Random số ảo hợp lý cho likes (VD: "1.2K"), timeAgo (VD: "5 phút"). Giữ nguyên URL ảnh ở "attachedImage" nếu có.
    4. SFX (Âm thanh): Dùng: ${sfxDictionaryText}. PHẢI THÊM sfx nếu comment giật gân, chê bai, hài hước. (Tỷ lệ thêm sfx là 40%). Nếu không dùng, để "".
    5. MEME: Dùng: ${memeDictionaryText}. PHẢI THÊM meme (.mp4 hoặc .jpg) nếu comment cực kỳ châm biếm, đồng tình mạnh hoặc gây sốc. Đừng lười biếng bỏ qua, nhưng cũng đừng spam. Nếu không dùng, để "".
    
    JSON format bắt buộc:
    {
      "post": {"author": "...", "avatar": "...", "text": "...", "ttsText": "...", "attachedImage": "...", "vibe": "...", "sfx": "...", "memeMp4": "...", "gender": "...", "likes": "...", "timeAgo": "..."}, 
      "comments": [{"author": "...", "avatar": "...", "text": "...", "ttsText": "...", "attachedImage": "...", "vibe": "...", "sfx": "...", "memeMp4": "...", "gender": "...", "likes": "...", "timeAgo": "..."}]
    }
    
    Data cần xử lý: ${JSON.stringify(rawData)}`;
    
    let filteredData;
    let parseRetries = 3;

    while (parseRetries > 0) {
      try {
        const aiResponse = await this.aiService.generateJsonText(prompt);
        
        const jsonStart = aiResponse.indexOf('{');
        const jsonEnd = aiResponse.lastIndexOf('}');
        if (jsonStart === -1 || jsonEnd === -1) throw new Error("JSON rỗng");
        
        filteredData = JSON.parse(aiResponse.substring(jsonStart, jsonEnd + 1));
        break; 
      } catch (error: any) {
        parseRetries--;
        await new Promise(r => setTimeout(r, 2000));
      }
    }

    if (!filteredData) throw new Error("Lỗi hệ thống AI.");

    this.logger.log('Đang tạo âm thanh và tải ảnh...');
    
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
    
    const trashFiles = [
      postAudio.audioSrc, postAvatarLocal, postImageLocal,
      dynamicBackground, 
      ...commentsProps.map(c => c.audioSrc),
      ...commentsProps.map(c => c.avatar),
      ...trashAttachedImages
    ].filter(Boolean) as string[];

    try {
      this.logger.log('🚀 Bắt đầu Render Remotion...');
      await this.remotionRunnerService.renderThreadsVideo('ThreadsTopicVideo', scriptPath, outputFileName);
      return { success: true, script: scriptData, videoName: outputFileName };
    } catch (error) {
      throw error; 
    } finally {
      this.cleanupFiles(trashFiles);
    }
  }
}