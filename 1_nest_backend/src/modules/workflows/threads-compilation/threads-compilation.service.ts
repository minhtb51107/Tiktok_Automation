import { Injectable, Logger } from '@nestjs/common';
import { AiService } from '../../core/ai/ai.service'; 
import { ScraperService } from '../../core/scraper/scraper.service';
import { TtsService } from '../../core/tts/tts.service';
import { RemotionRunnerService } from '../../remotion-runner/remotion-runner.service';
import * as fs from 'fs';
import * as path from 'path';
import axios from 'axios';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

@Injectable()
export class ThreadsCompilationService {
  private readonly logger = new Logger(ThreadsCompilationService.name);

  constructor(
    private readonly scraperService: ScraperService,
    private readonly aiService: AiService,
    private readonly ttsService: TtsService,
    private readonly remotionRunnerService: RemotionRunnerService,
  ) {}

  // ====================================================================
  // 🔥 CÁC HÀM XỬ LÝ MEDIA (AVATAR, ẢNH, SFX, MEME TỪ GIPHY)
  // ====================================================================
  private async downloadAvatar(url: string, fileName: string, authorName: string): Promise<string> {
    const avatarsDir = path.join(process.cwd(), '../2_Remotion_Video/public/avatars');
    if (!fs.existsSync(avatarsDir)) fs.mkdirSync(avatarsDir, { recursive: true });
    const filePath = path.join(avatarsDir, fileName);

    if (url && url.startsWith('data:image')) {
        const base64Data = url.replace(/^data:image\/\w+;base64,/, "");
        const buffer = Buffer.from(base64Data, 'base64');
        fs.writeFileSync(filePath, buffer);
        return `avatars/${fileName}`;
    }

    const userAgents = [
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/14.1.2 Safari/605.1.15'
    ];

    let attempt = 0;
    const maxAttempts = 5; 
    const targetUrl = (!url || url.includes('pixabay.com') || url.includes('blank-profile')) 
                      ? `https://ui-avatars.com/api/?name=${authorName}&background=random&size=256` 
                      : url;

    while (attempt < maxAttempts) {
      try {
        const randomUA = userAgents[Math.floor(Math.random() * userAgents.length)];
        const response = await axios({ 
          url: targetUrl, 
          method: 'GET', 
          responseType: 'arraybuffer', 
          headers: { 
            'User-Agent': randomUA,
            'Accept': 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8',
            'Referer': 'https://www.threads.net/'
          }, 
          timeout: 10000 
        });

        if (response.data.length > 500) {
           fs.writeFileSync(filePath, response.data);
           return `avatars/${fileName}`;
        }
      } catch (error: any) {
        attempt++;
        await new Promise(resolve => setTimeout(resolve, attempt * 1000));
      }
    }
    return 'avatars/default_avatar.jpg'; 
  }

  private async downloadAttachedImage(url: string, fileName: string): Promise<string | null> {
    if (!url || !url.startsWith('http')) return null;
    let attempt = 0;
    while(attempt < 3) {
        try {
          const imagesDir = path.join(process.cwd(), '../2_Remotion_Video/public/attached_images');
          if (!fs.existsSync(imagesDir)) fs.mkdirSync(imagesDir, { recursive: true });
          const filePath = path.join(imagesDir, fileName);
          const response = await axios({ url, method: 'GET', responseType: 'arraybuffer', headers: { 'User-Agent': 'Mozilla/5.0' }, timeout: 10000 });
          if(response.data.length > 1000){
             fs.writeFileSync(filePath, response.data);
             return `attached_images/${fileName}`;
          }
        } catch (e) { attempt++; await new Promise(r => setTimeout(r, 1000)); }
    }
    return null;
  }

  private validateMedia(fileName: string, keys: string[]): string {
    if (!fileName) return "";
    const match = fileName.match(/([a-zA-Z0-9_]+\.(mp3|mp4|jpg|png))/i);
    if (match && keys.includes(match[1])) return match[1];
    return "";
  }

  private async fetchMemeFromAPI(keyword: string, timestamp: number, id: string | number): Promise<string> {
    try {
        const apiKey = process.env.GIPHY_API_KEY;
        if (!apiKey || !keyword) return "";

        this.logger.log(`🔎 Kho thiếu Meme! Đang gọi Giphy API tìm: [${keyword}]...`);
        
        const url = `https://api.giphy.com/v1/gifs/search?api_key=${apiKey}&q=${encodeURIComponent(keyword)}&limit=1`;
        const res = await axios.get(url, { timeout: 10000 });
        
        if (res.data.data && res.data.data.length > 0) {
            const mp4Url = res.data.data[0].images.original_mp4.mp4;
            const memesDir = path.join(process.cwd(), '../2_Remotion_Video/public/memes');
            if (!fs.existsSync(memesDir)) fs.mkdirSync(memesDir, { recursive: true });
            
            const fileName = `api_meme_${timestamp}_${id}.mp4`;
            const filePath = path.join(memesDir, fileName);
            
            const videoRes = await axios({ url: mp4Url, method: 'GET', responseType: 'arraybuffer', timeout: 15000 });
            
            if (videoRes.data.length > 1000) {
               fs.writeFileSync(filePath, videoRes.data);
               this.logger.log(`✅ Lấy Meme từ Giphy thành công: ${fileName}`);
               return `memes/${fileName}`;
            }
        }
    } catch (e: any) {
        this.logger.warn(`⚠️ Lỗi khi lấy Meme ngoài cho [${keyword}]: ${e.message}`);
    }
    return "";
  }

  private async prepareDynamicBackground(totalFrames: number, timestamp: number): Promise<string> {
    const sourceBgPath = path.join(process.cwd(), '../2_Remotion_Video/public/backgrounds/source_minecraft.mp4');
    const outputBgName = `bg_temp_comp_${timestamp}.mp4`;
    const outputBgPath = path.join(process.cwd(), '../2_Remotion_Video/public/backgrounds', outputBgName);
    
    if (!fs.existsSync(sourceBgPath)) return "backgrounds/minecraft_parkour.mp4";
    
    const durationInSeconds = Math.ceil(totalFrames / 60) + 3; 
    const randomStartTime = Math.floor(Math.random() * (400 - durationInSeconds));
    const ffmpegCmd = `ffmpeg -y -ss ${randomStartTime} -i "${sourceBgPath}" -t ${durationInSeconds} -vf "crop=ih*9/16:ih,scale=1080:1920,fps=60" -c:v libx264 -pix_fmt yuv420p -profile:v baseline -level 3.0 -g 1 -movflags +faststart -an "${outputBgPath}"`;
    
    try { 
        await execAsync(ffmpegCmd); 
        return `backgrounds/${outputBgName}`; 
    } catch (e) { 
        return "backgrounds/minecraft_parkour.mp4"; 
    }
  }

  async processCompilationVideo(threadUrls: string[], onProgress?: (status: string) => Promise<void>) {
    const timestamp = Date.now();
    const trashFiles: string[] = [];
    const scriptName = `compilation_script_${timestamp}.json`;
    trashFiles.push(scriptName);

    this.logger.log(`\n======================================================`);
    this.logger.log(`🚀 BẮT ĐẦU XƯỞNG TỔNG HỢP: ${threadUrls.length} LINK THREADS`);
    this.logger.log(`======================================================\n`);

    if (onProgress) await onProgress(`🕷️ **Bước 1:** Đang cào dữ liệu ${threadUrls.length} bài viết...`);
    
    const rawPosts = [];
    const seenTexts = new Set(); 

    for (let i = 0; i < threadUrls.length; i++) {
      const url = threadUrls[i];
      try {
        this.logger.log(`📥 Đang cào Link ${i + 1}/${threadUrls.length}...`);
        const data = await this.scraperService.scrapeThreadsUrl(url, false);
        
        if (data && data.post && data.post.text) {
            const hasForeignChars = /[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uac00-\ud7af]/.test(data.post.text);
            if (hasForeignChars) {
                this.logger.warn(`⚠️ Bỏ qua Link ${i + 1} vì phát hiện chữ lạ (Có thể là quảng cáo)!`);
                continue;
            }

            const textKey = data.post.text.substring(0, 50).trim().toLowerCase();
            if (!seenTexts.has(textKey)) {
                seenTexts.add(textKey);
                rawPosts.push(data.post);
                this.logger.log(`✅ Cào thành công Link ${i + 1}`);
            } else {
                this.logger.warn(`⚠️ Bỏ qua Link ${i + 1} vì phát hiện copy-paste (trùng nội dung)!`);
            }
        }
      } catch (error) {
        this.logger.warn(`❌ Lỗi cào link ${url}, sẽ bỏ qua link này!`);
      }
    }

    if (rawPosts.length === 0) throw new Error("Không cào được bài viết nào hợp lệ!");

    // 🔥 NẠP KHO MEME VÀ SFX ĐỂ AI CHỌN LỰA
    let memeDictString = "", sfxDictString = "";
    let memeKeys: string[] = [], sfxKeys: string[] = [];
    try {
      const memeObj = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'meme_dictionary.json'), 'utf8'));
      memeKeys = Object.keys(memeObj);
      memeDictString = Object.entries(memeObj).map(([k, v]) => `${k}: ${v}`).join('\n'); 

      const sfxObj = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'sfx_dictionary.json'), 'utf8'));
      sfxKeys = Object.keys(sfxObj);
      sfxDictString = Object.entries(sfxObj).map(([k, v]) => `${k}: ${v}`).join('\n');
    } catch (err) {}

    this.logger.log(`🤖 Chuyển giao dữ liệu SẠCH cho AI dịch kịch bản & ghép Meme...`);
    if (onProgress) await onProgress('🤖 **Bước 2:** Đang dùng Gemini phân giải kịch bản & chèn Meme...');

    const batchPrompt = `
      Nhiệm vụ: Dịch kịch bản âm thanh, chọn SFX và Meme cho video TỔNG HỢP.
      
      KHO ÂM THANH:\n${sfxDictString}\n
      KHO MEME:\n${memeDictString}\n

      YÊU CẦU DÀNH CHO CÁC BÀI VIẾT:
      1. "ttsText": CHỈ dịch toàn bộ từ viết tắt, tiếng lóng sang tiếng Việt chuẩn. Giữ nguyên 100% ý nghĩa và văn phong gốc.
      2. "sfx": Chọn 1 file âm thanh từ KHO ÂM THANH sao cho hợp ngữ cảnh (hoặc để trống "").
      3. "meme": Chọn 1 file từ KHO MEME hợp ngữ cảnh. NẾU KHÔNG CÓ CÁI NÀO PHÙ HỢP, tự nghĩ ra 1 TỪ KHÓA TÌM KIẾM bằng Tiếng Anh để tìm trên nền tảng Giphy. NẾU KHÔNG CẦN THÌ ĐỂ TRỐNG "".
      
      DANH SÁCH BÀI VIẾT:
      ${rawPosts.map((p, i) => `{"id": "post_${i}", "text": "${p.text}"}`).join('\n')}

      TRẢ VỀ DUY NHẤT 1 OBJECT JSON CÓ ĐỊNH DẠNG NHƯ SAU:
      {
        "data": [
          { "id": "post_0", "ttsText": "...", "sfx": "...", "meme": "..." }
        ]
      }
    `;

    let parsedBatch: any[] = [];
    try {
        this.logger.log(`🧠 Đang gọi Gemini xử lý kịch bản (Thông minh + Miễn phí)...`);
        
        this.logger.log(`\n========== 📥 [GEMINI - INPUT PROMPT] ==========`);
        this.logger.log(batchPrompt);
        this.logger.log(`================================================\n`);

        let aiRes = await this.aiService.askGemini(batchPrompt);
        
        this.logger.log(`\n========== 📤 [GEMINI - AI RESPONSE] ==========`);
        this.logger.log(aiRes);
        this.logger.log(`=================================================\n`);

        const cleanJson = aiRes.substring(aiRes.indexOf('{'), aiRes.lastIndexOf('}') + 1);
        const parsedObj = JSON.parse(cleanJson);
        
        if (parsedObj.data) {
           parsedBatch = parsedObj.data;
           this.logger.log(`✅ Gemini dịch xong mĩ mãn!`);
        }
    } catch (e: any) {
        this.logger.error(`❌ AI dịch bị lỗi (${e.message}), sẽ giữ nguyên văn bản gốc để đọc.`);
        parsedBatch = rawPosts.map((p, i) => ({ id: `post_${i}`, ttsText: p.text }));
    }

    const aiMap = new Map();
    parsedBatch.forEach((item: any) => aiMap.set(item.id, item));

    this.logger.log(`🎙️ Chuyển kịch bản sang xưởng Âm Thanh TTS...`);
    if (onProgress) await onProgress('🎙️ **Bước 3:** Đang lồng tiếng và tải tài nguyên...');

    let totalFramesCalculated = 0;
    const finalPostsProps = [];

    for (let i = 0; i < rawPosts.length; i++) {
        try {
            const p = rawPosts[i];
            const aiData = aiMap.get(`post_${i}`) || {};
            const ttsText = aiData.ttsText || p.text;
            const gender = Math.random() > 0.5 ? 'male' : 'female';
            
            this.logger.log(`▶️ Đang tạo giọng đọc và tải ảnh cho bài số ${i + 1}...`);
            const audioData = await this.ttsService.generateAudio(ttsText, `comp_${timestamp}_${i}.mp3`, gender);
            trashFiles.push(audioData.audioSrc);

            totalFramesCalculated += audioData.durationInFrames + 60;

            const avatarLocal = await this.downloadAvatar(p.avatar, `avatar_comp_${timestamp}_${i}.jpg`, p.author || 'Anonymous');
            if (avatarLocal && !avatarLocal.includes('default_avatar')) trashFiles.push(avatarLocal);

            let attachedImgLocal = "";
            if (p.attachedImage) {
                const downloadedImg = await this.downloadAttachedImage(p.attachedImage, `img_comp_${timestamp}_${i}.jpg`);
                if (downloadedImg) {
                    attachedImgLocal = downloadedImg;
                    trashFiles.push(attachedImgLocal);
                }
            }

            // 🔥 XỬ LÝ GẮN MEME
            let postMeme = this.validateMedia(aiData.meme, memeKeys);
            if (!postMeme && aiData.meme && aiData.meme.length > 2) {
                postMeme = await this.fetchMemeFromAPI(aiData.meme, timestamp, `comp_${i}`);
            }
            if (postMeme && postMeme.includes('api_meme')) trashFiles.push(postMeme);

            // 🔥 XỬ LÝ GẮN SFX
            let postSfx = this.validateMedia(aiData.sfx, sfxKeys);

            finalPostsProps.push({
                author: p.author || 'Anonymous',
                text: p.text,
                ttsText: ttsText,
                avatar: avatarLocal, 
                attachedImage: attachedImgLocal, 
                sfx: postSfx,           // Đã cấp quyền gắn SFX
                memeMp4: postMeme,      // Đã cấp quyền gắn Meme
                likes: p.likeCount || "10K",
                comments: "100",
                reposts: "50",
                shares: "20",
                timeAgo: p.timeAgo || "2 giờ trước",
                audioSrc: audioData.audioSrc,
                durationInFrames: audioData.durationInFrames + 60,
                parentAudioDuration: audioData.durationInFrames
            });
        } catch (error: any) {
            this.logger.warn(`✂️ BỎ QUA BÀI SỐ ${i + 1} vì lỗi: ${error.message}`);
        }
    }

    if (finalPostsProps.length === 0) {
        throw new Error("Toàn bộ các bài đều lỗi âm thanh, không thể tổng hợp thành video!");
    }

    totalFramesCalculated += 120;
    const dynamicBackground = await this.prepareDynamicBackground(totalFramesCalculated, timestamp);
    trashFiles.push(dynamicBackground);

    const scriptData = {
      tiktok_caption: "Tổng hợp những câu chuyện thú vị trên Threads #xuhuong",
      backgroundVideo: dynamicBackground,
      bgm: "bgm/sneaky.mp3",
      post: finalPostsProps[0], 
      comments: finalPostsProps.slice(1) 
    };
    
    const scriptPath = path.join(process.cwd(), '../2_Remotion_Video/public', scriptName);
    fs.writeFileSync(scriptPath, JSON.stringify(scriptData, null, 2));

    const outputFileName = `compilation_output_${timestamp}.mp4`;
    const outputPath = path.resolve(process.cwd(), '../3_Storage_Assets/output_ready', outputFileName);

    this.logger.log(`🎬 Bàn giao Script cho Remotion Render...`);
    if (onProgress) await onProgress('🎬 **Bước 4:** Đang xả khói Render Video...');
    
    await this.remotionRunnerService.renderThreadsVideo('ThreadsTopicVideo', scriptPath, outputFileName);

    this.logger.log(`🧹 Đang dọn dẹp file nháp...`);
    trashFiles.forEach(file => {
      try {
        const fullPath = path.join(process.cwd(), '../2_Remotion_Video/public', file);
        if (fs.existsSync(fullPath)) fs.unlinkSync(fullPath);
      } catch (e) {}
    });

    this.logger.log(`🎉 HOÀN TẤT XƯỞNG TỔNG HỢP! Đã có Video.`);
    return { success: true, videoName: outputFileName, outputPath, caption: scriptData.tiktok_caption };
  }
}