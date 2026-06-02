import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { ScraperService } from './scraper.service';
import { AiService } from '../../ai/ai.service';
import { PrismaService } from '../../../prisma/prisma.service'; 
import { DiscordService } from './discord.service';
import * as crypto from 'crypto';

@Injectable()
export class HunterService {
  private readonly logger = new Logger('🕵️‍♂️ AutoHunter');

  constructor(
    private readonly scraperService: ScraperService,
    private readonly aiService: AiService,
    private readonly prisma: PrismaService,
    private readonly discordService: DiscordService,
  ) {}

  @Cron(CronExpression.EVERY_2_HOURS)
  async startHunting() {
    this.logger.log('🚀 BẮT ĐẦU CA TUẦN TRA KÉP (Kết hợp 2 Chiến thuật)...');

    try {
      // Chạy Chiến thuật 1
      await this.huntWithAiKeywords();
      
      // Chạy Chiến thuật 2
      await this.huntWithForYouFeed();

    } catch (e: any) {
      this.logger.error(`❌ Lỗi tổng trong ca đi săn: ${e.message}`);
    }

    this.logger.log('🏁 Kết thúc ca đi săn kép. Kho đã đầy thêm, đi ngủ đợi 2 tiếng sau!');
  }

  // ====================================================================
  // CHIẾN THUẬT 1: AI TỰ ĐẺ TỪ KHÓA (ĐỘT BIẾN GEN)
  // ====================================================================
  private async huntWithAiKeywords() {
    this.logger.log('🧠 [Chiến thuật 1] Đang vắt óc nghĩ từ khóa bắt trend mới nhất...');
    let dynamicKeywords: string[] = [];

    try {
      const keywordPrompt = `
        Bạn là một GenZ Việt Nam sành sỏi, chuyên hóng hớt drama trên mạng xã hội Threads.
        Hãy đẻ ra ngẫu nhiên 3 cụm từ khóa (từ 2 đến 5 chữ) mang đậm chất đời sống, drama, tâm sự, thả thính, góc khuất công sở, hoặc câu hỏi ngớ ngẩn mà người ta hay đăng trên mạng.
        YÊU CẦU BẮT BUỘC: 
        - Phải dùng ngôn ngữ đời thường, tự nhiên, đôi khi hơi bựa.
        - Trả về CHỈ MỘT MẢNG JSON HỢP LỆ, không giải thích gì thêm.
        Ví dụ: ["bị cắm sừng", "sếp hãm", "hỏi ngu xíu"]
      `;
      const aiKeyRes = await this.aiService.generateJsonText(keywordPrompt);
      const cleanJson = aiKeyRes.substring(aiKeyRes.indexOf('['), aiKeyRes.lastIndexOf(']') + 1);
      dynamicKeywords = JSON.parse(cleanJson);
      this.logger.log(`🎯 Lưới đã đan xong với các từ khóa: ${JSON.stringify(dynamicKeywords)}`);
    } catch (e) {
      this.logger.warn('⚠️ AI không đẻ được từ khóa, dùng lưới dự phòng...');
      dynamicKeywords = ['tâm sự', 'chuyện công sở', 'hỏi thật']; // Fallback nếu AI lỗi
    }

    for (const keyword of dynamicKeywords) {
      try {
        const targetUrl = `https://www.threads.net/search?q=${encodeURIComponent(keyword)}`;
        this.logger.log(`\n🔍 Đang rà quét từ khóa ngẫu nhiên: [${keyword}]`);
        
        const rawData = await this.scraperService.scrapeThreadsUrl(targetUrl);
        if (!rawData || !rawData.post) continue;

        await this.processAndSavePost(rawData.post, targetUrl);

      } catch (error: any) {
        this.logger.error(`❌ Lỗi khi rà quét [${keyword}]: ${error.message}`);
      }
    }
  }

  // ====================================================================
  // CHIẾN THUẬT 2: KÝ SINH THUẬT TOÁN "FOR YOU"
  // ====================================================================
  private async huntWithForYouFeed() {
    this.logger.log('\n🕷️ [Chiến thuật 2] Đang lướt ký sinh trang chủ "For You"...');
    try {
      const rawPosts = await this.scraperService.scrapeForYouFeed(4);

      if (!rawPosts || rawPosts.length === 0) {
        this.logger.warn('⚠️ Lưới For You trống không, mạng lag hoặc DOM Threads thay đổi.');
        return;
      }

      for (const postData of rawPosts) {
        this.logger.log(`\n🔍 Đang mổ xẻ bài của [${postData.author}]: ${postData.url}`);
        await this.processAndSavePost(postData, postData.url);
      }
    } catch (error: any) {
      this.logger.error(`❌ Lỗi khi quét For You: ${error.message}`);
    }
  }

  // ====================================================================
  // HÀM DÙNG CHUNG: CHẤM ĐIỂM VÀ LƯU DATABASE
  // ====================================================================
  private async processAndSavePost(postData: any, fallbackUrl: string) {
    try {
      // Cắt phần params dư thừa ở URL Threads để lấy ID chuẩn
      const cleanUrl = postData.url ? postData.url.split('?')[0] : fallbackUrl; 
      const contentHash = crypto.createHash('md5').update(postData.text || '').digest('hex');
      const threadId = cleanUrl || `thread_${contentHash}`; 

      // BƯỚC A: CHỐNG TRÙNG LẶP ID (Database Check)
      const isExists = await this.prisma.threadPost.findUnique({ where: { threadId: threadId } });
      if (isExists) {
        this.logger.log(`⏭️ Bài này đã bốc rồi, bỏ qua!`);
        return;
      }

      // BƯỚC B: RADAR VECTOR (Chống Đạo Nhái)
      const embedding = await this.aiService.generateEmbedding(postData.text);
      const similarPosts: any[] = await this.prisma.$queryRaw`
        SELECT id, 1 - (embedding <=> ${embedding}::vector) as similarity
        FROM "ThreadPost"
        WHERE 1 - (embedding <=> ${embedding}::vector) > 0.85
        LIMIT 1;
      `;

      if (similarPosts && similarPosts.length > 0) {
        this.logger.warn(`⚠️ Đạo nhái ý tưởng (Giống ${Math.round(similarPosts[0].similarity * 100)}%). Vứt!`);
        return;
      }

      // BƯỚC C: AI GIÁM KHẢO CHẤM ĐIỂM
      this.logger.log(`⚖️ Content sạch! Chuyển cho AI chấm độ mặn...`);
      const scorePrompt = `
        Đọc bài viết sau và CHẤM ĐIỂM độ mặn mòi, drama, thú vị, hoặc khả năng lên xu hướng Tiktok từ 1 đến 10.
        Bài viết: "${postData.text}"
        Định dạng JSON BẮT BUỘC:
        {"score": 8, "vibe": "funny"}
      `;
      const aiScoreRes = await this.aiService.generateJsonText(scorePrompt);
      const cleanJson = aiScoreRes.substring(aiScoreRes.indexOf('{'), aiScoreRes.lastIndexOf('}') + 1);
      const aiEvaluation = JSON.parse(cleanJson);

      this.logger.log(`📊 AI chấm: ${aiEvaluation.score}/10 điểm - Vibe: ${aiEvaluation.vibe}`);

      // BƯỚC D: LƯU VÀO KHO NEON DB
      if (aiEvaluation.score >= 7) {
        await this.prisma.$executeRaw`
          INSERT INTO "ThreadPost" (
            "id", "threadId", "author", "avatarUrl", "content", 
            "attachedImg", "url", "aiScore", "vibe", "embedding", "updatedAt"
          ) VALUES (
            gen_random_uuid(), ${threadId}, ${postData.author}, ${postData.avatar}, ${postData.text}, 
            ${postData.attachedImage || null}, ${cleanUrl}, ${aiEvaluation.score}, ${aiEvaluation.vibe}, 
            ${embedding}::vector, NOW()
          );
        `;
        this.logger.log(`✅ VIÊN KIM CƯƠNG ĐÃ ĐƯỢC LƯU VÀO KHO!`);
      } else {
        this.logger.warn(`🗑️ Khá nhạt nhẽo (Dưới 7 điểm). Bỏ qua.`);
      }

    } catch (postError: any) {
      this.logger.error(`❌ Lỗi xử lý bài viết: ${postError.message}`);
    }
  }
}