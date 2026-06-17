import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { ScraperService } from '../../core/scraper/scraper.service';
import { AiService } from '../../core/ai/ai.service';
import { DiscordService } from '../../core/notification/discord.service';
import { PrismaService } from '../../../prisma/prisma.service'; 
import * as crypto from 'crypto';

@Injectable()
export class HunterSeriousService {
  private readonly logger = new Logger('🕵️‍♂️ AutoHunter [SERIOUS]');

  constructor(
    private readonly scraperService: ScraperService,
    private readonly aiService: AiService,
    private readonly prisma: PrismaService,
    private readonly discordService: DiscordService,
  ) {}

  @Cron('0 */15 * * * *') 
  async startHunting() {
    this.logger.log('🚀 [SERIOUS] BẮT ĐẦU ĐI SĂN BÀI HỌC CUỘC SỐNG / SỰ NGHIỆP...');
    try {
      await this.huntWithAiKeywords();
    } catch (e: any) {
      this.logger.error(`❌ [SERIOUS] Lỗi tổng trong ca đi săn: ${e.message}`);
    }
  }

  private async huntWithAiKeywords() {
    let dynamicKeywords: string[] = [];

    try {
      const keywordPrompt = `
        Bạn là một chuyên gia tâm lý và phát triển sự nghiệp.
        Hãy tạo ra ngẫu nhiên 3 cụm từ khóa (2 đến 5 chữ) mà giới trẻ, sinh viên, người đi làm hay dùng để tâm sự, hỏi xin lời khuyên trên mạng xã hội Threads.
        Chủ đề: Định hướng sự nghiệp, bài học cuộc sống, tình yêu trưởng thành, khó khăn khi đi làm, khủng hoảng tuổi 20.
        YÊU CẦU: Trả về CHỈ MỘT MẢNG JSON HỢP LỆ.
        Ví dụ: ["bài học tuổi 20", "áp lực đồng trang lứa", "khi đi làm mới thấy"]
      `;
      const aiKeyRes = await this.aiService.generateScoutJson(keywordPrompt);
      const cleanJson = aiKeyRes.substring(aiKeyRes.indexOf('['), aiKeyRes.lastIndexOf(']') + 1);
      dynamicKeywords = JSON.parse(cleanJson);
      this.logger.log(`🎯 [SERIOUS] Lưới đã đan với các từ khóa: ${JSON.stringify(dynamicKeywords)}`);
    } catch (e) {
      dynamicKeywords = ['bài học cuộc sống', 'áp lực đồng trang lứa', 'chuyện đi làm']; 
    }

    for (const keyword of dynamicKeywords) {
      try {
        const targetUrl = `https://www.threads.net/search?q=${encodeURIComponent(keyword)}`;
        this.logger.log(`\n🔍 [SERIOUS] Đang rà quét từ khóa: [${keyword}]`);
        
        const rawData = await this.scraperService.scrapeThreadsUrl(targetUrl);
        if (!rawData || !rawData.post) continue;

        await this.processAndSavePost(rawData.post, targetUrl);

      } catch (error: any) { }
    }
  }

  private async processAndSavePost(postData: any, fallbackUrl: string) {
    try {
      const cleanUrl = postData.url ? postData.url.split('?')[0] : fallbackUrl; 
      const contentHash = crypto.createHash('md5').update(postData.text || '').digest('hex');
      const threadId = cleanUrl || `thread_${contentHash}`; 

      const isExists = await this.prisma.threadPost.findUnique({ where: { threadId: threadId } });
      if (isExists) return;

      const embedding = await this.aiService.generateEmbedding(postData.text);
      const similarPosts: any[] = await this.prisma.$queryRaw`
        SELECT id, 1 - (embedding <=> ${embedding}::vector) as similarity
        FROM "ThreadPost"
        WHERE 1 - (embedding <=> ${embedding}::vector) > 0.85
        LIMIT 1;
      `;

      if (similarPosts && similarPosts.length > 0) return;

      this.logger.log(`⚖️ [SERIOUS] Content sạch! Chuyển cho Trinh Sát chấm độ SÂU SẮC...`);
      const scorePrompt = `
        Đọc bài viết sau và CHẤM ĐIỂM độ sâu sắc, truyền cảm hứng, tính giáo dục, hoặc khả năng làm podcast tâm sự (từ 1 đến 10).
        Bài viết: "${postData.text}"
        Định dạng JSON BẮT BẮT BUỘC:
        {"score": 8, "vibe": "motivational"}
      `;
      const aiScoreRes = await this.aiService.generateScoutJson(scorePrompt);
      const cleanJson = aiScoreRes.substring(aiScoreRes.indexOf('{'), aiScoreRes.lastIndexOf('}') + 1);
      const aiEvaluation = JSON.parse(cleanJson);

      this.logger.log(`📊 [SERIOUS] AI chấm: ${aiEvaluation.score}/10 điểm - Vibe: ${aiEvaluation.vibe}`);

      if (aiEvaluation.score >= 7) {
        await this.prisma.$executeRaw`
          INSERT INTO "ThreadPost" (
            "id", "threadId", "author", "avatarUrl", "content", 
            "attachedImg", "url", "aiScore", "vibe", "category", "embedding", "updatedAt"
          ) VALUES (
            gen_random_uuid(), ${threadId}, ${postData.author}, ${postData.avatar}, ${postData.text}, 
            ${postData.attachedImage || null}, ${cleanUrl}, ${aiEvaluation.score}, ${aiEvaluation.vibe}, 
            'SERIOUS', ${embedding}::vector, NOW()
          );
        `;
        this.logger.log(`✅ [SERIOUS] BÀI HỌC HAY ĐÃ LƯU VÀO KHO!`);

        const savedPost = await this.prisma.threadPost.findUnique({ where: { threadId: threadId } });
        if (savedPost) {
           await this.discordService.sendPostToReview(savedPost);
        }
      }
    } catch (postError: any) { }
  }
}
