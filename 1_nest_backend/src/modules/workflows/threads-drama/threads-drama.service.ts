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
export class ThreadsDramaService {
  private readonly logger = new Logger(ThreadsDramaService.name);

  constructor(
    private readonly aiService: AiService, 
    private readonly remotionRunnerService: RemotionRunnerService,
    private readonly scraperService: ScraperService,
    private readonly ttsService: TtsService,
  ) {}

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
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/14.1.2 Safari/605.1.15',
        'Mozilla/5.0 (iPhone; CPU iPhone OS 16_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.6 Mobile/15E148 Safari/604.1',
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:109.0) Gecko/20100101 Firefox/115.0'
    ];

    let attempt = 0;
    const maxAttempts = 15; 
    
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
          timeout: 15000 
        });

        if (response.data.length > 500) {
           fs.writeFileSync(filePath, response.data);
           return `avatars/${fileName}`;
        }
        throw new Error("File tải về quá nhỏ, có thể bị lỗi");
      } catch (error: any) {
        attempt++;
        this.logger.warn(`Lỗi tải Avatar [${authorName}] lần ${attempt}/${maxAttempts}. Đang thử lại...`);
        await new Promise(resolve => setTimeout(resolve, attempt * 2000));
      }
    }
    
    this.logger.error(`❌ BẤT LỰC! Không thể lấy được Avatar của [${authorName}] sau 15 lần cố gắng.`);
    return 'avatars/default_avatar.jpg'; 
  }

  private async downloadAttachedImage(url: string, fileName: string): Promise<string | null> {
    if (!url || !url.startsWith('http')) return null;
    let attempt = 0;
    while(attempt < 5) {
        try {
          const imagesDir = path.join(process.cwd(), '../2_Remotion_Video/public/attached_images');
          if (!fs.existsSync(imagesDir)) fs.mkdirSync(imagesDir, { recursive: true });
          const filePath = path.join(imagesDir, fileName);
          const response = await axios({ url, method: 'GET', responseType: 'arraybuffer', headers: { 'User-Agent': 'Mozilla/5.0' }, timeout: 15000 });
          if(response.data.length > 1000){
             fs.writeFileSync(filePath, response.data);
             return `attached_images/${fileName}`;
          }
        } catch (e) { attempt++; await new Promise(r => setTimeout(r, 2000)); }
    }
    return null;
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
    const outputBgName = `bg_temp_${timestamp}.mp4`;
    const outputBgPath = path.join(process.cwd(), '../2_Remotion_Video/public/backgrounds', outputBgName);
    if (!fs.existsSync(sourceBgPath)) return "backgrounds/minecraft_parkour.mp4";
    const durationInSeconds = Math.ceil(totalFrames / 60) + 3; 
    const randomStartTime = Math.floor(Math.random() * (400 - durationInSeconds));
    const ffmpegCmd = `ffmpeg -y -ss ${randomStartTime} -i "${sourceBgPath}" -t ${durationInSeconds} -vf "crop=ih*9/16:ih,scale=1080:1920,fps=60" -c:v libx264 -pix_fmt yuv420p -profile:v baseline -level 3.0 -g 1 -movflags +faststart -an "${outputBgPath}"`;
    try { await execAsync(ffmpegCmd); return `backgrounds/${outputBgName}`; } 
    catch (e) { return "backgrounds/minecraft_parkour.mp4"; }
  }

  private cleanupFiles(files: string[]) {
    files.forEach(file => {
      try {
        const fullPath = path.join(process.cwd(), '../2_Remotion_Video/public', file);
        if (fs.existsSync(fullPath) && !file.includes('default_avatar') && !file.includes('source_minecraft') && !file.includes('minecraft_parkour')) {
          fs.unlinkSync(fullPath);
          if (file.endsWith('audio.mp3')) { const parentDir = path.dirname(fullPath); if (fs.existsSync(parentDir)) fs.rmdirSync(parentDir); }
        }
      } catch (e) {}
    });
  }

  private cleanRubbishText(rawText: string): string {
    let text = (rawText || '').trim();
    
    let prev = "";
    while (text !== prev) {
      prev = text;
      text = text.replace(/^[\s•.\-]*Tác giả[\s•.\-]*/i, '');
      text = text.replace(/^[\s•.\-]*Author[\s•.\-]*/i, '');
      text = text.replace(/^[\s•.\-]*(\d{1,2}\/\d{1,2}(\/\d{2,4})?|\d+\s*(giây|phút|giờ|ngày|tuần|tháng|năm|s|m|h|d|w)(\s*trước)?|\d+[mhd])[\s•.\-]*/i, '');
      text = text.trim();
    }

    text = text.replace(/(?:\d+[KkMmBb.,]*\s*(?:Lượt thích|Bình luận|Chia sẻ|likes|comments|shares|reposts)\s*)+/gi, '');
    text = text.replace(/(?:\b\d+[KkMmBb.,]*\s*)+$/gi, ''); 
    text = text.replace(/(Lượt thích|Bình luận|Chia sẻ|Thích|Trả lời)$/gi, '');
    
    return text.replace(/^[.\s]+/, '').trim();
  }

  private validateMedia(fileName: string, keys: string[]): string {
    if (!fileName) return "";
    const match = fileName.match(/([a-zA-Z0-9_]+\.(mp3|mp4|jpg|png))/i);
    if (match && keys.includes(match[1])) return match[1];
    return "";
  }

  private formatNumber(num: any): string {
    if (num === undefined || num === null || num === "") return "";
    const str = num.toString().trim();
    if (/[KkMmBb]/.test(str)) return str;
    const n = parseInt(str.replace(/[,.]/g, ''), 10);
    if (isNaN(n)) return str;
    if (n >= 1000000) return (n / 1000000).toFixed(1).replace(/\.0$/, '') + 'M';
    if (n >= 1000) return (n / 1000).toFixed(1).replace(/\.0$/, '') + 'K';
    return n.toString();
  }

  private parseInteractionNumber(str: any): number {
    if (!str) return 0;
    const cleanStr = str.toString().toUpperCase().trim();
    let multiplier = 1;
    if (cleanStr.includes('K')) multiplier = 1000;
    else if (cleanStr.includes('M')) multiplier = 1000000;
    else if (cleanStr.includes('B')) multiplier = 1000000000;

    let numPart = cleanStr.replace(/[KMB]/g, '');
    if (multiplier > 1) {
        numPart = numPart.replace(',', '.');
        const parsed = parseFloat(numPart);
        return isNaN(parsed) ? 0 : Math.floor(parsed * multiplier);
    } else {
        numPart = numPart.replace(/[,.]/g, '');
        const parsed = parseInt(numPart, 10);
        return isNaN(parsed) ? 0 : parsed;
    }
  }

  private getStats(realStats: any) {
    if (!realStats) realStats = {};
    const likes = realStats.likeCount ?? realStats.likes;
    const comments = realStats.replyCount ?? realStats.comments ?? realStats.reply_count;
    const reposts = realStats.repostCount ?? realStats.reposts ?? realStats.repost_count;
    const shares = realStats.shareCount ?? realStats.shares ?? realStats.share_count;

    return {
      likes: likes !== undefined ? this.formatNumber(likes) : (Math.floor(Math.random() * 500) + 10).toString(),
      comments: comments !== undefined ? this.formatNumber(comments) : (Math.floor(Math.random() * 50) + 1).toString(),
      reposts: reposts !== undefined ? this.formatNumber(reposts) : (Math.floor(Math.random() * 15)).toString(),
      shares: shares !== undefined ? this.formatNumber(shares) : (Math.floor(Math.random() * 20)).toString(),
      timeAgo: realStats.timeAgo || (Math.floor(Math.random() * 12 + 1) + " giờ trước")
    };
  }

  async processDramaVideo(threadUrl: string, onProgress?: (status: string) => Promise<void>, signal?: AbortSignal) {
    const timestamp = Date.now();
    const trashFiles: string[] = [];
    const scriptName = `threads_script_${timestamp}.json`;
    trashFiles.push(scriptName);

    if (signal?.aborted) throw new Error('ABORTED');

    if (onProgress) await onProgress('🕷️ **Bước 1:** Đang cào dữ liệu Threads...');
    const rawData = await this.scraperService.scrapeThreadsUrl(threadUrl);

    this.logger.log('\n\n================= 🛠️ KIỂM TRA DỮ LIỆU TỪ SCRAPER =================');
    this.logger.log(`[POST GỐC]: Lượt Thích lấy được: ${rawData.post.likeCount || 'THẤT BẠI'} | Bình luận lấy được: ${rawData.post.comments || 'THẤT BẠI'}`);
    this.logger.log(`[CHUỖI GIAO DIỆN GỐC TỪ INSTAGRAM]: \n=> ${rawData.post.debugRawString}`);
    this.logger.log('==================================================================\n');

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

    const topLevelComments = rawData.comments.filter((c: any) => c.text && !c.isReply && !c.replyTo && !c.parent_id && c.text.length >= 5);
    const sortedByLikes = [...topLevelComments].sort((a: any, b: any) => {
        return this.parseInteractionNumber(b.likeCount || b.likes) - this.parseInteractionNumber(a.likeCount || a.likes);
    });

    this.logger.log('🧠 Tự động nhặt comment CHỈ LẤY CHA từ trên xuống để đảm bảo video dài...');
    let totalWords = (rawData.post.text || '').split(/\s+/).length;
    let topComments = [];

    for (const cmt of sortedByLikes) {
        topComments.push(cmt);
        totalWords += (cmt.text || '').split(/\s+/).length;
        if (totalWords >= 300 && topComments.length >= 6) break;
        if (topComments.length >= 25) break; 
    }

    const textsToProcess: { id: string, role: string, text: string }[] = [];
    textsToProcess.push({ 
        id: 'post', 
        role: 'BÀI VIẾT GỐC (Chủ đề chính)',
        text: this.cleanRubbishText(rawData.post.text) 
    });
    
    const cmtHierarchy = [];
    this.logger.log('\n\n================= 🛠️ DANH SÁCH BÌNH LUẬN CHA =================');
    for (let i = 0; i < topComments.length; i++) {
        const cmt = topComments[i];
        const bestChild = null; 
        
        textsToProcess.push({ 
            id: `cmt_${i}`, 
            role: `BÌNH LUẬN phản hồi bài viết gốc của ${rawData.post.author}`,
            text: this.cleanRubbishText(cmt.text) 
        });
        cmtHierarchy.push({ cmt, bestChild });

        this.logger.log(`[CỤM ${i+1}] CHA: ${cmt.author} - "${cmt.text.substring(0,25)}..."`);
    }
    this.logger.log('=========================================================\n');

    if (signal?.aborted) throw new Error('ABORTED');

    if (onProgress) await onProgress('🤖 **Bước 2:** Đóng gói nguyên liệu gửi cho GPT phân tích...');
    
const batchPrompt = `Bạn là Đạo diễn Video TikTok. Chuẩn bị kịch bản hiển thị và kịch bản TTS.
KHO ÂM THANH:\n${sfxDictString}\nKHO MEME:\n${memeDictString}\n

YÊU CẦU CỰC KỲ NGHIÊM NGẶT: 
1. "isSpam": Phân tích "text" xem có mang tính chất rác, quảng cáo (PR, link bio, xem bói...) hay không. Trả về true nếu là quảng cáo. (Trừ id="post" gốc).
2. "displayText": KỊCH BẢN MÀN HÌNH. GIỮ NGUYÊN 100% câu chữ, văn phong, lỗi chính tả, teencode của bản gốc.
3. "ttsText": KỊCH BẢN ÂM THANH. Nhiệm vụ của bạn là "BỘ GIẢI MÃ":
   - [LỆNH CẤM]: TUYỆT ĐỐI KHÔNG thêm thắt từ ngữ, KHÔNG làm cho câu văn lịch sự hay hoa mỹ hơn. Giữ nguyên 100% các từ ngữ bình thường, giữ nguyên thái độ cục súc hoặc trẩu tre của bản gốc.
   - [GIẢI MÃ]: CHỈ dịch các từ viết tắt, teencode, tiếng lóng sang tiếng Việt hoàn chỉnh dựa trên ngữ cảnh của "BÀI VIẾT GỐC". 
   - [ĐỌC SỐ]: Viết rõ các con số để máy đọc không vấp (VD: "20k" -> "hai mươi cành", "20tr" -> "hai mươi củ", "1m5" -> "một mét năm").
   - [VÍ DỤ CHUẨN]: 
     + Gốc: "chê nha, trg này dạy dở vl" -> ttsText: "chê nha, trường này dạy dở vãi lồi" (Giữ nguyên chữ 'chê nha', chỉ dịch 'trg' và 'vl').
     + Gốc: "đm thg nyc kh báo j" -> ttsText: "đờ mờ thằng người yêu cũ không báo gì".
4. "meme": Chọn 1 file từ KHO MEME. NẾU TRONG KHO KHÔNG CÓ CÁI NÀO PHÙ HỢP, hãy tự nghĩ ra 1 TỪ KHÓA TÌM KIẾM bằng Tiếng Anh (VD: "cat facepalm", "dog laughing", "sad crying") để hệ thống tự đi tìm. NẾU KHÔNG CẦN THÌ ĐỂ TRỐNG "".

DANH SÁCH TEXT:
${textsToProcess.map(t => `{"id": "${t.id}", "role": "${t.role}", "text": "${t.text}"}`).join('\n')}

TRẢ VỀ DUY NHẤT 1 MẢNG JSON ĐÚNG ĐỊNH DẠNG SAU (CẤM LỜI BÌNH):
[ { "id": "id", "isSpam": false, "displayText": "...", "ttsText": "...", "gender": "male", "sfx": "...", "meme": "..." } ]`;

    let parsedBatch: any[] = [];
    try {
        let batchRes = await this.aiService.askOpenAI(batchPrompt); 
        const jsonMatch = batchRes.match(/\[\s*\{[\s\S]*\}\s*\]/);
        if (jsonMatch) parsedBatch = JSON.parse(jsonMatch[0]);
    } catch (e) { this.logger.error("❌ Batch AI thất bại."); }

    const aiMap = new Map();
    parsedBatch.forEach(item => aiMap.set(item.id, item));

    const getAiData = (id: string, safeText: string) => {
        const data = aiMap.get(id) || {};
        return { 
            isSpam: data.isSpam === true, 
            displayText: data.displayText || safeText,
            ttsText: data.ttsText || data.displayText || safeText, 
            gender: data.gender === 'female' ? 'female' : 'male', 
            sfx: this.validateMedia(data.sfx, sfxKeys), 
            meme: data.meme || "" 
        };
    };

    let captionRaw = "Drama Threads quá cháy 🔥 #drama #giaitri #xuhuong #threads";
    const captionPrompt = `Viết 1 dòng Caption TikTok cực kỳ giật gân, tò mò (kèm 3 hashtag) dựa trên nội dung sau. TUYỆT ĐỐI KHÔNG CHÉP LẠI NỘI DUNG GỐC! Nội dung: "${rawData.post.text}"`;
    try {
        let aiCaption = await this.aiService.askGemini(captionPrompt);
        if (aiCaption) captionRaw = aiCaption.replace(/^["']|["']$/g, '').trim();
    } catch(e) {}

    if (signal?.aborted) throw new Error('ABORTED');

    if (onProgress) await onProgress('🎙️ **Bước 3:** Đang lồng tiếng và tải tài nguyên...');
    
    const postSafeText = textsToProcess.find(t => t.id === 'post')?.text || "";
    const postAi = getAiData('post', postSafeText);
    
    let postAudio;
    try {
        postAudio = await this.ttsService.generateAudio(postAi.ttsText, `post_${timestamp}.mp3`, postAi.gender);
        postAudio.durationInFrames += 60; 
        trashFiles.push(postAudio.audioSrc);
    } catch (error: any) {
        this.logger.error("🚨 Bài viết GỐC bị mất giọng đọc! Hủy Render Video.");
        throw new Error(`Tất cả API Giọng Đọc đều sập khi xử lý BÀI VIẾT GỐC. Bắt buộc hủy toàn bộ Video! (Chi tiết: ${error.message})`);
    }

    let postMeme = this.validateMedia(postAi.meme, memeKeys);
    if (!postMeme && postAi.meme && postAi.meme.length > 2) {
        postMeme = await this.fetchMemeFromAPI(postAi.meme, timestamp, 'post');
    }
    if (postMeme && postMeme.includes('api_meme')) trashFiles.push(postMeme);

    const postProps = {
      author: rawData.post.author, 
      text: postAi.displayText, 
      ttsText: postAi.ttsText,
      avatar: await this.downloadAvatar(rawData.post.avatar, `avatar_post_${timestamp}.jpg`, rawData.post.author),
      attachedImage: rawData.post.attachedImage ? await this.downloadAttachedImage(rawData.post.attachedImage, `img_post_${timestamp}.jpg`) : "",
      gender: postAi.gender, 
      sfx: postAi.sfx, 
      memeMp4: postMeme, 
      ...this.getStats(rawData.post), 
      ...postAudio
    };
    trashFiles.push(postProps.avatar);
    if (postProps.attachedImage) trashFiles.push(postProps.attachedImage);
    
    let totalFramesCalculated = postProps.durationInFrames;
    const commentsProps = [];

    for (let i = 0; i < cmtHierarchy.length; i++) {
        if (signal?.aborted) throw new Error('ABORTED');

        const { cmt } = cmtHierarchy[i];
        try {
            const cmtSafeText = textsToProcess.find(t => t.id === `cmt_${i}`)?.text || "";
            const cmtAi = getAiData(`cmt_${i}`, cmtSafeText);

            if (cmtAi.isSpam) {
                this.logger.warn(`🗑️ AI đã loại bỏ COMMENT SỐ ${i + 1} vì phát hiện là Quảng cáo/Spam.`);
                continue; 
            }

            const cAudio = await this.ttsService.generateAudio(cmtAi.ttsText, `cmt_${timestamp}_${i}.mp3`, cmtAi.gender);
            trashFiles.push(cAudio.audioSrc);

            let cmtMeme = this.validateMedia(cmtAi.meme, memeKeys);
            if (!cmtMeme && cmtAi.meme && cmtAi.meme.length > 2) {
                cmtMeme = await this.fetchMemeFromAPI(cmtAi.meme, timestamp, i);
            }
            if (cmtMeme && cmtMeme.includes('api_meme')) trashFiles.push(cmtMeme);

            const cmtData = {
              author: cmt.author, 
              text: cmtAi.displayText, 
              avatar: await this.downloadAvatar(cmt.avatar, `ava_cmt_${timestamp}_${i}.jpg`, cmt.author),
              attachedImage: cmt.attachedImage ? await this.downloadAttachedImage(cmt.attachedImage, `img_cmt_${timestamp}_${i}.jpg`) : "",
              sfx: cmtAi.sfx, 
              memeMp4: cmtMeme, 
              ...this.getStats(cmt), 
              audioSrc: cAudio.audioSrc, 
              parentAudioDuration: cAudio.durationInFrames
            };
            trashFiles.push(cmtData.avatar);
            if (cmtData.attachedImage) trashFiles.push(cmtData.attachedImage);

            let totalCmtDuration = cAudio.durationInFrames + 60;

            totalFramesCalculated += totalCmtDuration;
            commentsProps.push({ ...cmtData, durationInFrames: totalCmtDuration, reply: null }); 
        } catch (e) { this.logger.warn(`✂️ BỎ QUA COMMENT SỐ ${i + 1}`); }
    }

    if (signal?.aborted) throw new Error('ABORTED');

    totalFramesCalculated += 120; 
    const dynamicBackground = await this.prepareDynamicBackground(totalFramesCalculated, timestamp);
    trashFiles.push(dynamicBackground);

    const scriptData = {
      tiktok_caption: captionRaw, 
      backgroundVideo: dynamicBackground, 
      bgm: "bgm/sneaky.mp3", 
      post: postProps, 
      comments: commentsProps
    };
    const scriptPath = path.join(process.cwd(), '../2_Remotion_Video/public', scriptName);
    fs.writeFileSync(scriptPath, JSON.stringify(scriptData, null, 2));

    const outputFileName = `threads_output_${timestamp}.mp4`;
    const outputPath = path.resolve(process.cwd(), '../3_Storage_Assets/output_ready', outputFileName);
    
    if (onProgress) await onProgress('🎬 **Bước 4:** Đang Render Remotion...');

    await this.remotionRunnerService.renderThreadsVideo('ThreadsTopicVideo', scriptPath, outputFileName, signal);
    
    this.cleanupFiles(trashFiles);
    
    return { success: true, script: scriptData, videoName: outputFileName, outputPath: outputPath, caption: captionRaw };
  }
}
