import { Injectable, Logger, BadRequestException, NotFoundException } from '@nestjs/common';
// Module:
import { RemotionRunnerModule } from '../../core/remotion-runner/remotion-runner.module';

// Service:
import { RemotionRunnerService } from '../../core/remotion-runner/remotion-runner.service';
import { ScraperService } from '../../core/scraper/scraper.service';
import { TtsService } from '../../core/tts/tts.service';
import { AiService } from '../../core/ai/ai.service';
import { PrismaService } from '../../../prisma/prisma.service';
import * as fs from 'fs';
import * as path from 'path';
import axios from 'axios';
import { VideoStatus } from '@prisma/client';

@Injectable()
export class ThreadsSeriousService {
  private readonly logger = new Logger(ThreadsSeriousService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly remotionRunnerService: RemotionRunnerService,
    private readonly scraperService: ScraperService,
    private readonly ttsService: TtsService,
    private readonly aiService: AiService,
  ) {}

  // =========================================================================
  // GIAI ĐOẠN 1: CHUẨN HÓA VIẾT TẮT & CHẺ NHỎ NGUYÊN TÁC BÀI GỐC
  // =========================================================================
  async phase1_CreateScript(threadUrls: string[], existingPostId?: string, inputRawScript?: string): Promise<any> {
    this.logger.log(`Phase 1: Bắt đầu cào dữ liệu tự động...`);
    
    const scrapedResults = [];
    for (let i = 0; i < threadUrls.length; i++) {
      const url = threadUrls[i];
      this.logger.log(`⏳ [SCRAPER] Đang tiến hành cào URL (${i + 1}/${threadUrls.length}): ${url}`);
      
      try {
        const result = await this.scraperService.scrapeThreadsUrl(url);
        scrapedResults.push(result);
      } catch (err: any) {
        this.logger.error(`❌ Thất bại khi cào URL ${url}: ${err.message || err}`);
        scrapedResults.push(null);
      }

      if (i < threadUrls.length - 1) {
        this.logger.log(`😴 Chờ 2.5 giây để tránh bị Threads gắn cờ Spam...`);
        await new Promise(resolve => setTimeout(resolve, 2500));
      }
    }

    const validData = scrapedResults.filter((item): item is NonNullable<typeof item> => !!item);
    if (validData.length === 0) throw new BadRequestException("Không cào được dữ liệu từ bất kỳ bài viết Threads nào.");

    const realPost = validData[0].post;
    const realComments = validData.flatMap(data => data.comments || []);

    let rawScript = inputRawScript;

    if (!rawScript || rawScript.trim() === "") {
      const seenPostTexts = new Set<string>();
      let aiInputContext = `DƯỚI ĐÂY LÀ NỘI DUNG TOÀN BỘ BÀI VIẾT VÀ CÁC BÌNH LUẬN GỐC (THÔ):\n\n`;

      validData.forEach((data, idx) => {
        const currentUrl = threadUrls[idx];
        const urlAuthorMatch = currentUrl.match(/@([a-zA-Z0-9._-]+)/);
        const urlAuthor = urlAuthorMatch ? urlAuthorMatch[1].toLowerCase() : '';

        let contentText = '';
        let finalAuthor = urlAuthor;
        const type = idx === 0 ? 'post' : 'comment';

        if (data.post && data.post.author?.toLowerCase() === urlAuthor) {
          contentText = data.post.text?.trim() || '';
          finalAuthor = data.post.author;
        } 
        else if (data.comments && data.comments.length > 0) {
          const matchingComment = data.comments.find(
            (c: any) => c.author?.toLowerCase() === urlAuthor
          );
          if (matchingComment) {
            contentText = matchingComment.text?.trim() || '';
            finalAuthor = matchingComment.author;
          }
        }

        if (!contentText) {
          if (idx === 0 && data.post) {
            contentText = data.post.text?.trim() || '';
            finalAuthor = data.post.author || urlAuthor;
          } else if (data.comments && data.comments.length > 0) {
            contentText = data.comments[0].text?.trim() || '';
            finalAuthor = data.comments[0].author || urlAuthor;
          } else if (data.post) {
            contentText = data.post.text?.trim() || '';
            finalAuthor = data.post.author || urlAuthor;
          }
        }

        if (contentText && !seenPostTexts.has(contentText)) {
          seenPostTexts.add(contentText);
          const cleanAuthor = type === 'post' ? 'Nhân vật chính' : finalAuthor;
          aiInputContext += `[${type === 'post' ? 'BÀI VIẾT GỐC' : 'BÌNH LUẬN GỐC'} - Tác giả: ${cleanAuthor}]: "${contentText}"\n\n`;
        }
      });

      const promptInstructions = `
Bạn là một chuyên gia chuẩn hóa văn bản lồng tiếng (TTS) chuyên nghiệp.
Nhiệm vụ của bạn là lấy 100% nội dung của bài viết gốc và các bình luận gốc tương ứng ở trên để tạo thành kịch bản video liền mạch từ đầu đến cuối.

🚨 BỘ LUẬT KHÔNG ĐƯỢC PHÉP VI PHẠM (CỰC KỲ NGHIÊM NGẶT):
1. GIỮ NGUYÊN NỘI DUNG GỐC 100%: Tuyệt đối không được tóm tắt, không viết lại lời dẫn, không cắt bớt ý, không thay đổi văn phong tự sự xù xì của tác giả. Bạn phải xử lý tuần tự từng phần [BÀI VIẾT GỐC] và các [BÌNH LUẬN GỐC] theo đúng thứ tự xuất hiện ở trên.
2. KHÔNG ĐƯỢC BỎ SÓT BẤT KỲ TỪ NÀO (KỂ CẢ TIÊU ĐỀ/DANH MỤC): Phải dịch và chẻ từ từ đầu tiên đến từ cuối cùng của toàn bộ các văn bản gốc ở trên. CẤM tự ý bỏ qua các từ phân loại hoặc tiêu đề ở đầu dòng (ví dụ từ: "sự nghiệp", "tâm sự", "chia sẻ"...). Hãy xếp luôn từ tiêu đề này vào khối <CHUNK> đầu tiên để đọc lên bình thường.
3. KHÔNG THÊM LỜI DẪN NGOÀI: Không tự chế các câu mở đầu hay câu kết. Vào thẳng nội dung thô ngay từ chữ đầu tiên.

👉 BẠN CHỈ ĐƯỢC PHÉP THỰC HIỆN ĐÚNG 2 THAO TÁC CƠ KHÍ SAU:
1. CHUẨN HÓA CÁC TỪ VIẾT TẮT / KÝ HIỆU (Để bộ đọc AI Kokoro đọc trơn tru):
   - Chuyển "mn" -> "mọi người", "m" hoặc "mk" -> "mình", "đc" -> "được", "cty" -> "công ty", "kh" -> "không", "vđ" -> "vấn đề", "mng" -> "mọi người"...
   - Chuyển các con số tài chính như "50M", "35M", "50m+" thành chữ viết rõ ràng: "50 triệu", "35 triệu", "trên 50 triệu".
   - Dịch các từ tiếng Anh lóng/viết tắt nếu cần để đọc thuần Việt tự nhiên nhất (Ví dụ: "job" -> "công việc", "peer pressure" -> "áp lực đồng trang lứa", "handle" -> "xử lý").
   - Ngoài việc sửa viết tắt ở trên, KHÔNG THAY ĐỔI hay vứt bỏ bất kỳ từ ngữ nào khác trong câu gốc.

2. PHÂN CHIA THÀNH CÁC KHỐI <CHUNK> THEO ĐÚNG THỨ TỰ TRUYỀN THỐNG:
   - Cắt văn bản đã chuẩn hóa viết tắt ở trên thành các đoạn thoại ngắn liên tiếp từ đầu đến cuối bài viết và các bình luận.
   - Mỗi khối <CHUNK> chứa tối đa 25-30 từ để chạy sub dồn dập trên TikTok.
   - Khi chuyển từ Bài viết sang Bình luận nào, hãy giữ đúng thông tin người nói bằng thuộc tính "author" tương ứng.

🎯 ĐẦU RA BẮT BUỘC: Bạn phải xuất kịch bản theo đúng cú pháp thẻ khối mẫu dưới đây:
Đối với bài viết gốc:
<CHUNK type="post" author="Nhân vật chính">Nội dung câu thoại đã chuẩn hóa</CHUNK>

Đối với các bình luận gốc:
<CHUNK type="comment" author="Tên_Tác_Giả_Bình_Luận_Gốc">Nội dung câu thoại bình luận đã chuẩn hóa</CHUNK>

⚠️ CHÚ Ý: CẤM viết thêm bất kỳ câu chữ giải thích nào ngoài các thẻ <CHUNK>. Hãy xuất kịch bản ngay bây giờ:`;

      const fullPrompt = `${aiInputContext}\n===\n[HƯỚNG HÃNG CHUẨN HÓA VÀ CHẺ NHỎ KỊCH BẢN]:\n${promptInstructions}`;
      
      let maxRetries = 3;
      let delayMs = 3000;
      
      for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
          this.logger.log(`🤗 [HUGGING FACE] Tiến hành gửi request kịch bản (Lần thử ${attempt}/${maxRetries})...`);
          rawScript = await this.aiService.askHuggingFace(fullPrompt);
          
          if (rawScript && rawScript.trim() !== "" && !rawScript.toLowerCase().includes("failed") && !rawScript.toLowerCase().includes("error")) {
              this.logger.log(`✅ Hugging Face phản hồi thành công ở lần thử thứ ${attempt}.`);
              break; 
          }
          throw new Error("Phản hồi trống hoặc dính chuỗi ký tự báo lỗi hệ thống.");
        } catch (err: any) {
          this.logger.warn(`⚠️ Lần thử ${attempt} thất bại do lỗi hạ tầng: ${err.message || err}`);
          if (attempt === maxRetries) {
              this.logger.error(`🚨 Hugging Face sập liên tục. Kích hoạt bộ cứu cánh bổ củi offline bằng code thuần.`);
              rawScript = realPost.text || '';
          } else {
              this.logger.log(`⏳ Đang nghỉ ${delayMs/1000} giây trước khi thử lại...`);
              await new Promise(resolve => setTimeout(resolve, delayMs));
          }
        }
      }
    }

    const chunks = this.parseScriptIntoChunks(rawScript, realPost);
    if (chunks.length === 0) throw new BadRequestException("AI trả về sai cấu trúc kịch bản thẻ khối.");

    let finalRecord;
    const dbPayload = {
      status: VideoStatus.SCRIPT_READY,
      aiScriptDraft: chunks,
      category: 'SERIOUS',
      finalScriptData: { realPost, realComments }
    };

    if (existingPostId) {
      finalRecord = await this.prisma.threadPost.update({ where: { id: existingPostId }, data: dbPayload });
    } else {
      finalRecord = await this.prisma.threadPost.create({
        data: {
          threadId: `thread_${Date.now()}`,
          author: realPost.author,
          content: realPost.text || '',
          url: threadUrls[0],
          caption: "Bài học đắt giá về tư duy tài chính và sự nghiệp. #xuhuong #phatbientuduy",
          ...dbPayload
        }
      });
    }

    return { id: finalRecord.id, status: finalRecord.status, chunks };
  }

  // =========================================================================
  // GIAI ĐOẠN 2: ÉP AUDIO KOKORO SIÊU TỐC (ĐÃ CHUYỂN SANG VÒNG LẶP TUẦN TỰ TRÁNH TRÀN RAM)
  // =========================================================================
  async phase2_ProcessAssets(postId: string, editedChunks: any[]): Promise<any> {
    const post = await this.prisma.threadPost.findUnique({ where: { id: postId } });
    if (!post) throw new NotFoundException("Không tìm thấy bản ghi.");

    const { realPost, realComments } = post.finalScriptData as any;
    const timestamp = Date.now();
    const trashFiles: string[] = [];

    // 🚀 ĐÃ SỬA: Chạy tuần tự (Sequential) từng đoạn audio một bằng vòng lặp for...of
    // Triệt tiêu hoàn toàn lỗi OpenBLAS: Memory allocation failed!
    const validAudioResults = [];
    for (let i = 0; i < editedChunks.length; i++) {
      const chunk = editedChunks[i];
      this.logger.log(`🎙️ [TTS] Đang lồng tiếng đoạn ${i + 1}/${editedChunks.length}...`);
      
      try {
        const audioData = await this.ttsService.generateAudio(
          chunk.text, 
          `serious_${timestamp}_${i}.mp3`, 
          'female'
        );
        validAudioResults.push({ chunk, audioData, index: i });
      } catch (e: any) {
        this.logger.error(`❌ Lỗi sinh audio đoạn ${i}: ${e?.message || e}`);
      }
    }

    const processedChunks = [];
    const localAvatar = await this.downloadAvatar(realPost.avatar, `ava_serious_${timestamp}.jpg`, realPost.author);

    for (const item of validAudioResults) {
      const { chunk, audioData, index } = item;
      if (audioData.audioSrc) trashFiles.push(audioData.audioSrc);

      const chunkTotalFrames = audioData.durationInFrames + 15;
      let commentInfo = null;
      const cardToShow = (chunk.type === 'post' || chunk.type === 'comment') ? chunk.type : 'none';

      if (cardToShow === 'post') {
        commentInfo = { author: realPost.author, avatar: localAvatar, text: chunk.text, timeAgo: "Vừa xong" };
      } else if (cardToShow === 'comment') {
        const realCmt = realComments.find((c: any) => c.author === chunk.authorName);
        if (realCmt) {
          const cmtAvatar = await this.downloadAvatar(realCmt.avatar, `ava_temp_${timestamp}_${index}.jpg`, realCmt.author);
          if (cmtAvatar.startsWith('avatars/')) trashFiles.push(cmtAvatar);
          commentInfo = { author: realCmt.author, avatar: cmtAvatar, text: chunk.text, timeAgo: "Vừa xong" };
        } else {
          const fallbackAvatar = await this.downloadAvatar('', `ava_temp_${timestamp}_${index}.jpg`, chunk.authorName);
          if (fallbackAvatar.startsWith('avatars/')) trashFiles.push(fallbackAvatar);
          commentInfo = { author: chunk.authorName, avatar: fallbackAvatar, text: chunk.text, timeAgo: "Vừa xong" };
        }
      }

      processedChunks.push({
        text: chunk.text, 
        cardToShow: cardToShow,
        commentInfo: commentInfo, 
        audioSrc: audioData.audioSrc,
        durationInFrames: chunkTotalFrames
      });
    }

    const fallbackBgm = fs.existsSync(path.join(process.cwd(), '../2_Remotion_Video/public/bgm/sneaky.mp3')) ? "bgm/sneaky.mp3" : "bgm/lofi.mp3";

    const scriptData = {
      tiktok_caption: post.caption, 
      bgm: fallbackBgm, 
      backgroundVideo: "backgrounds/source_1.mp4", 
      postInfo: { author: realPost.author, avatar: localAvatar, text: realPost.text, timeAgo: "Vừa xong" }, 
      chunks: processedChunks
    };

    if (localAvatar.startsWith('avatars/')) trashFiles.push(localAvatar);

    await this.prisma.threadPost.update({
      where: { id: postId },
      data: {
        status: VideoStatus.AUDIO_READY,
        finalScriptData: { scriptData, trashFiles }
      }
    });

    return { id: post.id, status: VideoStatus.AUDIO_READY, message: "Hệ thống tinh gọn đã đóng gói xong Audio." };
  }

  // =========================================================================
  // GIAI ĐOẠN 3: KẾT XUẤT VIDEO REMOTION
  // =========================================================================
  async phase3_RenderVideo(postId: string): Promise<any> {
    const post = await this.prisma.threadPost.findUnique({ where: { id: postId } });
    if (!post || post.status !== VideoStatus.AUDIO_READY) throw new BadRequestException("Trạng thái không hợp lệ.");

    const { scriptData, trashFiles } = post.finalScriptData as any;
    const timestamp = Date.now();
    const scriptName = `serious_script_${timestamp}.json`;
    const scriptPath = path.join(process.cwd(), '../2_Remotion_Video/public', scriptName);

    fs.writeFileSync(scriptPath, JSON.stringify(scriptData, null, 2));

    const outputFileName = `visual_story_${timestamp}.mp4`;
    const outputPath = path.resolve(process.cwd(), '../3_Storage_Assets/output_ready', outputFileName);

    try {
      await this.remotionRunnerService.renderThreadsVideo('SeriousAdviceVideo', scriptPath, outputFileName);
      
      await this.prisma.threadPost.update({
        where: { id: postId },
        data: { status: VideoStatus.RENDERED, isRendered: true, caption: scriptData.tiktok_caption }
      });

      this.cleanupFiles(trashFiles);

      return { success: true, videoName: outputFileName, outputPath: outputPath, caption: scriptData.tiktok_caption };
    } finally {
      if (fs.existsSync(scriptPath)) {
        fs.unlinkSync(scriptPath);
      }
    }
  }

  private async downloadAvatar(url: string, fileName: string, authorName: string): Promise<string> {
    const fallbackUrl = `https://ui-avatars.com/api/?name=${encodeURIComponent(authorName || 'User')}&background=random&size=256&bold=true&format=png`;
    if (!url || url.includes('pixabay.com') || url.includes('blank-profile') || url.includes('default')) return fallbackUrl;
    const avatarsDir = path.join(process.cwd(), '../2_Remotion_Video/public/avatars');
    if (!fs.existsSync(avatarsDir)) fs.mkdirSync(avatarsDir, { recursive: true });
    const filePath = path.join(avatarsDir, fileName);

    if (url.startsWith('data:image')) {
        try {
            const base64Data = url.replace(/^data:image\/\w+;base64,/, "");
            fs.writeFileSync(filePath, Buffer.from(base64Data, 'base64'));
            return `avatars/${fileName}`;
        } catch { return fallbackUrl; }
    }

    try {
      const response = await axios({ 
        url: url, method: 'GET', responseType: 'arraybuffer', 
        headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)', 'Referer': 'https://www.threads.net/' }, 
        timeout: 5000 
      });
      const contentType = String(response.headers['content-type'] || '');
      if (contentType.includes('image') && response.data && response.data.length > 500) {
         fs.writeFileSync(filePath, response.data);
         return `avatars/${fileName}`;
      }
    } catch {}
    return fallbackUrl;
  }

  private cleanupFiles(files: string[]) {
    files.forEach(file => {
      try {
        if (file.includes('avatars/')) return; 
        const fullPath = path.join(process.cwd(), '../2_Remotion_Video/public', file);
        if (fs.existsSync(fullPath)) fs.unlinkSync(fullPath);
      } catch {}
    });
  }

  // =========================================================================
  // BỘ TỰ ĐỘNG BỔ CỦI KỊCH BẢN - KHÔNG BAO GIỜ LO CRASH LỖI THẺ KHỐI
  // =========================================================================
  private parseScriptIntoChunks(rawScript: string, realPost: any): any[] {
    const chunks: any[] = [];
    
    const tagRegex = /<CHUNK([\s\S]*?)>([\s\S]*?)<\/CHUNK>/gi;
    let match;
    while ((match = tagRegex.exec(rawScript)) !== null) {
        const textContent = match[2].trim();
        if (textContent.length > 2) {
            const typeMatch = match[1].match(/type=["'](.*?)["']/i);
            const authorMatch = match[1].match(/author=["'](.*?)["']/i);
            chunks.push({
                text: textContent,
                type: typeMatch ? typeMatch[1] : 'post',
                authorName: authorMatch ? authorMatch[1] : (realPost.author || "Nhân vật chính")
            });
        }
    }

    if (chunks.length === 0) {
        this.logger.warn("⚠️ AI không xuất thẻ <CHUNK>. Kích hoạt bộ tự động chẻ câu bằng thuật toán Regex...");
        let cleanText = rawScript.replace(/```[a-zA-Z]*|```/g, '').trim();
        const sentences = cleanText.split(/(?<=[.!?])\s+/);
        
        for (const sentence of sentences) {
            const trimmed = sentence.trim();
            if (trimmed.length > 5 && !trimmed.toLowerCase().startsWith("dưới đây là") && !trimmed.toLowerCase().startsWith("đây là")) {
                chunks.push({
                    text: trimmed,
                    type: 'post',
                    authorName: realPost.author || "Nhân vật chính"
                });
            }
        }
    }

    if (chunks.length === 0 && realPost && realPost.text) {
        this.logger.error("🚨 AI trả về rỗng! Tự động bốc bài viết gốc thô chẻ câu làm kịch bản...");
        const sentences = realPost.text.split(/(?<=[.!?])\s+/);
        for (const sentence of sentences) {
            const trimmed = sentence.trim();
            if (trimmed.length > 2) {
                chunks.push({
                    text: trimmed,
                    type: 'post',
                    authorName: realPost.author || "Nhân vật chính"
                });
            }
        }
    }
    
    return chunks;
  }
}