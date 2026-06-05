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
        if (fs.existsSync(fullPath) && !file.includes('default_avatar') && !file.includes('source_minecraft') && !file.includes('minecraft_parkour')) {
          fs.unlinkSync(fullPath);
          if (file.endsWith('audio.mp3')) {
             const parentDir = path.dirname(fullPath);
             if (fs.existsSync(parentDir)) fs.rmdirSync(parentDir);
           }
        }
      } catch (e) {}
    });
  }

// HÀM ĐÃ NÂNG CẤP BỘ LỌC CHỐNG "AI ẢO GIÁC" (ANTI-HALLUCINATION)
  private async processSingleText(author: string, rawText: string, avatarUrl: string, attachedImgUrl: string, sfxDictKeys: string, memeDictKeys: string) {
    const [cleanTextRaw, genderRaw, sfxMemeRaw] = await Promise.all([
      this.aiService.askGroq(`Viết lại câu sau sang tiếng Việt chuẩn, sửa lỗi chính tả, dịch từ lóng. CHỈ TRẢ VỀ CÂU ĐÃ SỬA: "${rawText}"`, false),
      this.aiService.askGroq(`Nội dung: "${rawText}". Giới tính là "male" hay "female"? CHỈ TRẢ VỀ ĐÚNG 1 CHỮ ĐÓ.`, false),
      
      // PROMPT MỚI: Quát nạt nó cấm nói nhiều
      this.aiService.askGroq(`Bạn là một hệ thống máy móc. Đọc câu: "${rawText}". Chọn 1 tên từ [${sfxDictKeys}] và 1 tên từ [${memeDictKeys}]. CHỈ IN RA DUY NHẤT: "SFX:ten_file | MEME:ten_file". TUYỆT ĐỐI KHÔNG giải thích, KHÔNG nói thêm chữ nào khác.`, false)
    ]);

    const gender = genderRaw.toLowerCase().includes('female') ? 'female' : 'male';
    
    let sfx = "";
    let meme = "";
    
    try {
      // BỘ LỌC REGEX: Dù AI có nói "Tôi chọn file ABC.mp3 nha sếp" thì nó chỉ nhặt đúng "ABC.mp3"
      const sfxMatch = sfxMemeRaw.match(/([a-zA-Z0-9_]+\.mp3)/i);
      const memeMatch = sfxMemeRaw.match(/([a-zA-Z0-9_]+\.(mp4|jpg|png))/i);

      if (sfxMatch) sfx = sfxMatch[1];
      if (memeMatch) meme = memeMatch[1];

      // Chốt chặn cuối: Nếu vì lý do nào đó tên file quá dài (tào lao) hoặc chứa dấu cách, hủy luôn
      if (sfx.length > 40 || sfx.includes(' ')) sfx = "";
      if (meme.length > 40 || meme.includes(' ')) meme = "";

    } catch (e) {
      this.logger.warn("Không trích xuất được SFX/Meme, bỏ qua bước này.");
    }

    return {
      author: author,
      avatar: avatarUrl || "",
      text: rawText,
      ttsText: cleanTextRaw.replace(/"/g, '').trim(),
      attachedImage: attachedImgUrl || "",
      gender: gender,
      sfx: sfx,
      memeMp4: meme,
      likes: Math.floor(Math.random() * 900 + 100) + " Lượt thích",
      timeAgo: Math.floor(Math.random() * 23 + 1) + " giờ trước"
    };
  }

  async processThreadsVideo(threadUrl: string, onProgress?: (status: string) => Promise<void>) {
    const timestamp = Date.now();
    const trashFiles: string[] = [];
    
    const scriptName = `threads_script_${timestamp}.json`;
    trashFiles.push(scriptName);

    if (onProgress) await onProgress('🕷️ **Bước 1/5:** Đang khởi động Puppeteer cào bài viết Threads...');
    const rawData = await this.scraperService.scrapeThreadsUrl(threadUrl);
    
    if (onProgress) await onProgress('🤖 **Bước 2/5:** Đang đưa vào dây chuyền đa tác nhân Groq phân tích...');
    
    const memeDictionaryPath = path.join(process.cwd(), 'meme_dictionary.json');
    const sfxDictionaryPath = path.join(process.cwd(), 'sfx_dictionary.json');

    // 🔥 ÉP CÂN DỮ LIỆU: Chỉ lấy cái tên file để làm Token, vứt bỏ toàn bộ JSON thừa thãi
    let memeKeys = "";
    let sfxKeys = "";

    try {
      if (fs.existsSync(memeDictionaryPath)) {
        const parsedMeme = JSON.parse(fs.readFileSync(memeDictionaryPath, 'utf8'));
        memeKeys = Object.keys(parsedMeme).join(', '); // Chỉ trích xuất Keys: "cat_crying, dog_laughing..."
      }
      if (fs.existsSync(sfxDictionaryPath)) {
        const parsedSfx = JSON.parse(fs.readFileSync(sfxDictionaryPath, 'utf8'));
        sfxKeys = Object.keys(parsedSfx).join(', '); // Chỉ trích xuất Keys: "punch, vine_boom..."
      }
    } catch (err) {
      this.logger.warn("⚠️ Lỗi đọc từ điển, hệ thống sẽ bỏ qua bước gán Meme/SFX.");
    }

    const topComments = rawData.comments.slice(0, 5);

    // 🔥 XẾP HÀNG TUẦN TỰ: Tránh lỗi Groq Rate Limit (429) do bùng nổ Request quá nhanh
    this.logger.log('Đang xử lý Bài gốc...');
    const processedPost = await this.processSingleText(rawData.post.author, rawData.post.text, rawData.post.avatar, rawData.post.attachedImage, sfxKeys, memeKeys);
    
    this.logger.log('Đang xử lý lần lượt 5 Comments...');
    const processedComments = [];
    for (const cmt of topComments) {
       // Xử lý từng comment một, chậm một chút nhưng cực kỳ an toàn
       const pCmt = await this.processSingleText(cmt.author, cmt.text, cmt.avatar, cmt.attachedImage, sfxKeys, memeKeys);
       processedComments.push(pCmt);
    }

    this.logger.log('Đang đẻ Caption Tiktok...');
    const captionRaw = await this.aiService.askGroq(`Tóm tắt drama sau thành 1 câu giật gân để đăng Tiktok, kèm 4 hashtag. Dưới 100 chữ. Nội dung: "${rawData.post.text}"`, true);

    const filteredData = {
      tiktok_caption: captionRaw.replace(/"/g, '').trim(),
      post: processedPost,
      comments: processedComments
    };

    try {
      this.logger.log('Đang tạo âm thanh và tải ảnh...');
      if (onProgress) await onProgress('🎙️ **Bước 3/5:** Đang gửi text sang FPT AI tạo giọng đọc chuẩn...');
      
      const postAudio = await this.ttsService.generateAudio(filteredData.post.ttsText, `post_${timestamp}.mp3`, filteredData.post.gender);
      trashFiles.push(postAudio.audioSrc);

      const postAvatarLocal = await this.downloadAvatar(filteredData.post.avatar, `avatar_post_${timestamp}.jpg`);
      trashFiles.push(postAvatarLocal);

      const postImageLocal = await this.downloadAttachedImage(filteredData.post.attachedImage, `image_post_${timestamp}.jpg`);
      if (postImageLocal) trashFiles.push(postImageLocal);
      
      filteredData.post.avatar = postAvatarLocal;
      filteredData.post.attachedImage = postImageLocal;
      
      let totalFramesCalculated = postAudio.durationInFrames;
      const commentsProps = [];

      for (let i = 0; i < filteredData.comments.length; i++) {
        const cmt = filteredData.comments[i];
        try {
            const audioData = await this.ttsService.generateAudio(cmt.ttsText, `cmt_${timestamp}_${i}.mp3`, cmt.gender);
            trashFiles.push(audioData.audioSrc);

            const avatarLocal = await this.downloadAvatar(cmt.avatar, `avatar_cmt_${timestamp}_${i}.jpg`);
            trashFiles.push(avatarLocal);

            const cmtImageLocal = await this.downloadAttachedImage(cmt.attachedImage, `image_cmt_${timestamp}_${i}.jpg`);
            if (cmtImageLocal) trashFiles.push(cmtImageLocal);
            
            cmt.avatar = avatarLocal;
            cmt.attachedImage = cmtImageLocal;
            
            totalFramesCalculated += audioData.durationInFrames;
            commentsProps.push({ ...cmt, ...audioData }); 
            
        } catch (cmtError: any) {
            this.logger.warn(`✂️ BỎ QUA COMMENT SỐ ${i + 1}: Cắt khỏi kịch bản vì lỗi TTS (${cmtError.message})`);
        }
      }

      const dynamicBackground = await this.prepareDynamicBackground(totalFramesCalculated, timestamp);
      trashFiles.push(dynamicBackground);

      const scriptData = {
        tiktok_caption: filteredData.tiktok_caption, 
        backgroundVideo: dynamicBackground,
        bgm: "bgm/lofi.mp3",
        post: { ...filteredData.post, ...postAudio },
        comments: commentsProps
      };

      const scriptPath = path.join(process.cwd(), '../2_Remotion_Video/public', scriptName);
      fs.writeFileSync(scriptPath, JSON.stringify(scriptData, null, 2));

      const outputFileName = `threads_output_${timestamp}.mp4`;
      const outputPath = path.resolve(process.cwd(), '../3_Storage_Assets/output_ready', outputFileName);
      
      this.logger.log('Bắt đầu Render Remotion...');
      if (onProgress) await onProgress('🎬 **Bước 4/5:** Đang nạp nguyên liệu vào lò Render Remotion (Quá trình này mất 1-2 phút)...');
      
      await this.remotionRunnerService.renderThreadsVideo('ThreadsTopicVideo', scriptPath, outputFileName);
      
      return { 
        success: true, 
        script: scriptData, 
        videoName: outputFileName, 
        outputPath,
        caption: filteredData.tiktok_caption
      };

    } catch (error) {
      throw error; 
    } finally {
      if (onProgress) await onProgress('🧹 **Bước 5/5:** Đang dọn dẹp các tệp tin rác...');
      this.cleanupFiles(trashFiles);
    }
  }
}