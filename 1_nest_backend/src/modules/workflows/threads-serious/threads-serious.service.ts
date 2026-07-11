import { Injectable, Logger } from '@nestjs/common';
import { RemotionRunnerService } from '../../remotion-runner/remotion-runner.service';
import { ScraperService } from '../../core/scraper/scraper.service';
import { TtsService } from '../../core/tts/tts.service';
import { WhisperService } from '../../whisper/whisper.service';
import { AiService } from '../../core/ai/ai.service';
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
    private readonly whisperService: WhisperService,
    private readonly aiService: AiService
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
    
    return fallbackUrl;
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

  async processSeriousVideo(threadUrls: string[], rawScript?: string, onProgress?: (status: string) => Promise<void>, signal?: AbortSignal) {
    const timestamp = Date.now();
    const trashFiles: string[] = [];
    const scriptName = `serious_script_${timestamp}.json`;
    trashFiles.push(scriptName);

    if (signal?.aborted) throw new Error('ABORTED');

    if (onProgress) await onProgress(`🎙️ **[XƯỞNG PODCAST]** Đang tiến hành cào dữ liệu hàng loạt từ danh sách các URL bài viết...`);
    
    const scrapedResults = await Promise.all(
      threadUrls.map(async (url) => {
        try {
          return await this.scraperService.scrapeThreadsUrl(url);
        } catch (err: any) {
          return null;
        }
      })
    );

    const validData = scrapedResults.filter((item): item is NonNullable<typeof item> => !!item);
    if (validData.length === 0) throw new Error("Không cào được dữ liệu từ bất kỳ URL Threads nào sếp cung cấp.");

    const realPost = validData[0].post;
    const realComments = validData.flatMap(data => data.comments || []);

    if (signal?.aborted) throw new Error('ABORTED');

    if (!rawScript || rawScript.trim() === "") {
      if (onProgress) await onProgress('🧠 **[KOKORO OFFLINE]** Đang áp dụng Prompt biên kịch đan xen phân vai Podcast từ tư liệu sạch...');
      
      const seenPostTexts = new Set<string>();
      let aiInputContext = `DƯỚI ĐÂY LÀ NỘI DUNG CÁC BÀI VIẾT GỐC VÀ BÌNH LUẬN CHÍNH XÁC (ĐÃ LỌC TRÙNG LẶP):\n\n`;
      let uniqueIndex = 1;

      validData.forEach((data, idx) => {
        const currentUrl = threadUrls[idx];
        const urlAuthorMatch = currentUrl.match(/@([a-zA-Z0-9._-]+)/);
        const urlAuthor = urlAuthorMatch ? urlAuthorMatch[1] : '';

        if (data.post && data.post.author === urlAuthor) {
          const text = data.post.text?.trim();
          if (text && !seenPostTexts.has(text)) {
            seenPostTexts.add(text);
            aiInputContext += `[TƯ LIỆU SỐ ${uniqueIndex}] (Bài Gốc) [${data.post.author}]: "${data.post.text}"\n\n`;
            uniqueIndex++;
          }
        } else if (data.comments && data.comments.length > 0) {
          const targetComment = data.comments.find((cmt: any) => cmt.author === urlAuthor);
          if (targetComment && targetComment.text) {
            const text = targetComment.text.trim();
            if (!seenPostTexts.has(text)) {
              seenPostTexts.add(text);
              aiInputContext += `[TƯ LIỆU SỐ ${uniqueIndex}] (Bình Luận) [${targetComment.author}]: "${targetComment.text}"\n\n`;
              uniqueIndex++;
            }
          }
        }
      });

      const promptInstructions = `
Bạn là một đạo diễn kiêm biên kịch xuất sắc cho kênh TikTok "Góc Nhìn Sự Nghiệp" (thể loại Podcast/Serious Advice sâu sắc).
Nhiệm vụ của bạn là biến danh sách các tư liệu thô ở trên thành một kịch bản video hoàn chỉnh thông qua các thẻ khối <CHUNK>.

⚠️ QUY TẮC PHÂN VAI VÀ GIỮ NGUYÊN VĂN PHONG (BẮT BUỘC):
1. TUYỆT ĐỐI KHÔNG nhắc đến các tên nick, ID cá nhân (elisee.ph, austindox...) trong lời thoại lồng tiếng. Hãy dùng từ thay thế tự nhiên như "Một bạn trẻ tâm sự", "Có góc nhìn cho rằng",...
2. Đối với các thẻ type="post" và type="comment" (Đại diện cho Card hiển thị trên màn hình): Bạn BẮT BUỘC phải giữ nguyên văn phong NGÔI THỨ NHẤT ("Mình", "Tôi", "Anh", "Chị") y hệt như tư liệu gốc. Hãy cô đọng, gọt giũa lại cho súc tích, thâm thúy nhưng phải là lời tự sự TRỰC TIẾP của nhân vật đó, không được viết kiểu tóm tắt hay kể hộ ở ngôi thứ ba.
3. Đối với các thẻ type="narration" (Lời của người dẫn chuyện/Biên kịch): Đây MỚI LÀ NƠI bạn dùng giọng ngôi thứ ba để dẫn dắt, kết nối hoặc phân tích chuyên sâu (Ví dụ: "Hãy xem lời tâm sự của một bạn trẻ...", "Rõ ràng bài học ở đây là...").

CẤU TRÚC ĐAN XEN THEO TIẾN TRÌNH KỂ CHUYỆN:
- Đoạn 1 (type="narration"): Đặt vấn đề bằng một câu Hook nhức nhối để giữ chân người xem (Không hiện Card).
- Đoạn 2 (type="narration"): Câu dẫn dắt giới thiệu câu chuyện.
- Đoạn 3 (type="post"): Lời tự sự trực tiếp của bài gốc (Xưng "Mit", "Tôi").
- Đoạn 4 (type="narration"): Lời bình luận ngắn của biên kịch để chuyển mạch sang cụm giải pháp tài chính.
- Đoạn 5 & 6 (Liên tiếp các thẻ type="comment"): Các góc nhìn thực tế từ các bình luận (Giữ văn phong NGÔI THỨ NHẤT "Mình", "Tôi").
- Đoạn 7 (type="narration"): PHÂN TÍCH CHUYÊN SÂU cụm giải pháp trên bằng góc nhìn của người dẫn chuyện để đúc kết bản chất vấn đề.
- Đoạn 8 & 9 (Liên tiếp các thẻ type="comment"): Các tư duy đường dài tiếp theo (Vẫn giữ văn phong NGÔI THỨ NHẤT "Mình", "Tôi").
- Đoạn 10 (type="narration"): PHÂN TÍCH CHUYÊN SÂU cụm tư duy này, lồng ghép thực tế về áp lực/stress để tạo tính phản biện.
- Đoạn 11 (type="narration"): KẾT BÀI bằng một lời khuyên triết lý, đúc kết tư duy đắt giá làm thông suốt tư tưởng người nghe.

QUY ĐỊNH THUỘC TÍNH THẺ CHUNK Y HỆT TRƯỚC ĐÓ:
<CHUNK type="post|comment|narration" author="Tên tác giả nếu có" keyword="Từ khóa tiếng Anh tìm video nền">Nội dung lời thoại</CHUNK>

Hãy xuất kịch bản đỉnh cao ngay bây giờ:`;

      const fullPrompt = `${aiInputContext}\n===\n${promptInstructions}`;
      rawScript = await this.aiService.askHuggingFace(fullPrompt);
    }

    if (onProgress) await onProgress('🎙行业 Đang chạy bộ Parser thích ứng để trích xuất cấu trúc kịch bản...');

    const chunks: any[] = [];
    const cleanScript = rawScript.replace(/```json|```xml|```/g, '').trim();

    if (cleanScript.startsWith('[') || cleanScript.startsWith('{')) {
        try {
            const jsonChunks = cleanScript.startsWith('{') ? JSON.parse(cleanScript).chunks : JSON.parse(cleanScript);
            for (const item of jsonChunks) {
                const type = item.type || 'narration';
                const author = item.author || (type === 'post' ? realPost.author : "Người kể chuyện");
                const keyword = item.keyword || "none";
                const textContent = (item.content || item.text || "").trim();

                if (textContent.length > 5) {
                    chunks.push({
                        text: textContent,      
                        type: type,
                        authorName: author,
                        gifKeyword: keyword
                    });
                }
            }
        } catch (e: any) {
            this.logger.error("Lỗi parse kịch bản dạng JSON: " + (e?.message || e));
        }
    } 

    if (chunks.length === 0) {
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
                    type: type,
                    authorName: author,
                    gifKeyword: keyword
                });
            }
        }
    }

    if (chunks.length === 0) throw new Error("Không thể bóc tách kịch bản! AI trả về sai cấu trúc kịch bản nghiêm trọng.");

    if (onProgress) await onProgress('🎙️ **[KOKORO OFFLINE]** 🎞️ Đang tiến hành lồng tiếng và tạo sub Karaoke...');

    const localAvatar = await this.downloadAvatar(realPost.avatar, `ava_serious_${timestamp}.jpg`, realPost.author);

    // BƯỚC 1: ÉP TOÀN BỘ KOKORO PYTHON SINH AUDIO SONG SONG BẰNG GPU (CỰC NHANH)
    const audioGenerationResults = await Promise.all(
        chunks.map(async (chunk, i) => {
            if (signal?.aborted) return null;
            try {
                const voiceType = chunk.type === 'narration' ? 'female' : 'female'; 
                const audioData = await this.ttsService.generateAudio(chunk.text, `serious_${timestamp}_${i}.mp3`, voiceType);
                return { chunk, audioData, index: i };
            } catch (e: any) {
                this.logger.error(`Lỗi sinh audio đoạn ${i}: ${e?.message || e}`);
                return null;
            }
        })
    );

    const validAudioResults = audioGenerationResults.filter(r => r !== null) as any[];

    // BƯỚC 2: CHẠY WHISPER TUẦN TỰ TỪNG CÂU TRÊN CPU (MODEL TINY SIÊU NHẸ)
    const processedChunks = [];
    
    for (const item of validAudioResults) {
        if (signal?.aborted) throw new Error('ABORTED');
        
        const { chunk, audioData, index } = item;
        try {
            if (audioData.audioSrc) trashFiles.push(audioData.audioSrc);
            const audioFullPath = path.join(process.cwd(), '../2_Remotion_Video/public', audioData.audioSrc);

            let whisperWords = [];
            try {
                const fileName = path.basename(audioFullPath);
                const whisperOutput = await this.whisperService.runWhisper(audioFullPath, fileName, signal); 
                whisperWords = whisperOutput.words || whisperOutput; 
            } catch (wErr: any) {
                if (wErr.message === 'ABORTED') throw wErr;
                this.logger.warn(`Lỗi Whisper đoạn ${index}: Bỏ qua Karaoke.`);
            }

            const gifUrl = await this.getGifFromGiphy(chunk.gifKeyword, timestamp, index);
            if (gifUrl) trashFiles.push(gifUrl);

            let commentInfo = null;
            const cardToShow = (chunk.type === 'post' || chunk.type === 'comment') ? chunk.type : 'none';

            if (cardToShow === 'post') {
                commentInfo = {
                    author: realPost.author,
                    avatar: localAvatar, 
                    text: realPost.text, 
                    timeAgo: realPost.timeAgo || "Vừa xong"
                };
            } else if (cardToShow === 'comment') {
                const realCmt = realComments.find((c: any) => c.author === chunk.authorName);
                if (realCmt) {
                    const cmtAvatar = await this.downloadAvatar(realCmt.avatar, `ava_temp_${timestamp}_${index}.jpg`, realCmt.author);
                    if (cmtAvatar.startsWith('avatars/')) trashFiles.push(cmtAvatar);
                    
                    commentInfo = {
                        author: realCmt.author,
                        avatar: cmtAvatar, 
                        text: realCmt.text, 
                        timeAgo: realCmt.timeAgo || "Vừa xong"
                    };
                } else {
                    const fallbackAvatar = await this.downloadAvatar('', `ava_temp_${timestamp}_${index}.jpg`, chunk.authorName);
                    if (fallbackAvatar.startsWith('avatars/')) trashFiles.push(fallbackAvatar);

                    commentInfo = {
                        author: chunk.authorName,
                        avatar: fallbackAvatar,
                        text: chunk.text,
                        timeAgo: "Vừa xong"
                    };
                }
            }

            processedChunks.push({
                text: chunk.text, 
                caption: "",
                cardToShow: cardToShow,
                commentInfo: commentInfo, 
                gifImg: gifUrl,
                audioSrc: audioData.audioSrc,
                words: whisperWords,
                durationInFrames: audioData.durationInFrames + 15
            });

        } catch (e: any) {
            this.logger.error(`Lỗi xử lý hậu kỳ đoạn ${index}: ${e?.message || e}`);
        }
    }

    if (signal?.aborted) throw new Error('ABORTED');

    const fallbackBgm = fs.existsSync(path.join(process.cwd(), '../2_Remotion_Video/public/bgm/sneaky.mp3')) ? "bgm/sneaky.mp3" : "bgm/lofi.mp3";

    const scriptData = {
      tiktok_caption: "Bài học đắt giá về tư duy tài chính và sự nghiệp. #xuhuong #phatbientuduy #baihoccuocsong", 
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
        if (onProgress) await onProgress('🎙️ **[XƯỞNG PODCAST]** 🎬 Đã chuẩn bị xong toàn bộ tài nguyên. Tiến hành render video...');
        await this.remotionRunnerService.renderThreadsVideo('SeriousAdviceVideo', scriptPath, outputFileName, signal);
        return { success: true, videoName: outputFileName, outputPath: outputPath, caption: scriptData.tiktok_caption, script: scriptData };
    } finally {
        if (localAvatar.startsWith('avatars/')) trashFiles.push(localAvatar);
        this.cleanupFiles(trashFiles);
    }
  }

  private cleanupFiles(files: string[]) {
    files.forEach(file => {
      try {
        if (file.includes('avatars/') || file.includes('ava_serious_')) {
          return; 
        }

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