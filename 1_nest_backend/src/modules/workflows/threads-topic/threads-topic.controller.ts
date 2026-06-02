import { Controller, Get, Post, Param, Delete, Logger, Body } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { ThreadsTopicService } from './threads-topic.service';

@Controller('api/threads')
export class ThreadsTopicController {
  private readonly logger = new Logger(ThreadsTopicController.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly threadsTopicService: ThreadsTopicService,
  ) {}

  // ====================================================================
  // 0. API: TẠO VIDEO THỦ CÔNG (Cho phép dán link trực tiếp)
  // ====================================================================
  @Post('generate')
  async generate(@Body('url') url: string) {
    if (!url) {
      return { success: false, message: 'Vui lòng cung cấp url bài viết Threads' };
    }
    
    this.logger.log(`🛠️ Bắt đầu xử lý thủ công cho URL: ${url}`);
    
    try {
      // Gọi thẳng vào service xử lý tổng thể
      const result = await this.threadsTopicService.processThreadsVideo(url);
      return result;
    } catch (error: any) {
      this.logger.error(`❌ Lỗi xử lý thủ công: ${error.message}`);
      return { success: false, message: error.message };
    }
  }

  // ====================================================================
  // 1. API: LẤY DANH SÁCH BÀI CHỜ DUYỆT (TỪ AUTO HUNTER)
  // ====================================================================
  @Get('pending')
  async getPendingPosts() {
    try {
      const posts = await this.prisma.threadPost.findMany({
        where: { isApproved: false },
        orderBy: { aiScore: 'desc' }, // Ưu tiên bài điểm cao lên đầu
      });
      return { success: true, data: posts };
    } catch (error: any) {
      return { success: false, message: error.message };
    }
  }

  // ====================================================================
  // 2. API: DUYỆT BÀI VÀ TỰ ĐỘNG RENDER VIDEO
  // ====================================================================
  @Post('approve/:id')
  async approveAndRender(@Param('id') id: string) {
    try {
      // Tìm bài viết trong kho
      const post = await this.prisma.threadPost.findUnique({ where: { id } });
      if (!post) throw new Error('Không tìm thấy bài viết này trong kho!');

      this.logger.log(`🎬 Đã duyệt bài [${post.aiScore} điểm]. Bắt đầu quá trình Render Video...`);

      // Đánh dấu là đã duyệt
      await this.prisma.threadPost.update({
        where: { id },
        data: { isApproved: true },
      });

      // Kích hoạt lõi Render (Chạy ngầm để API trả về kết quả ngay lập tức)
      this.threadsTopicService.processThreadsVideo(post.url).then(async (res) => {
        this.logger.log(`✅ Render thành công video: ${res?.videoName}`);
        // Đánh dấu đã render xong
        await this.prisma.threadPost.update({
          where: { id },
          data: { isRendered: true },
        });
      }).catch((err) => {
        this.logger.error(`❌ Render thất bại cho bài ${id}: ${err.message}`);
      });

      return { success: true, message: 'Đã đưa vào hàng đợi Render Video!' };
    } catch (error: any) {
      return { success: false, message: error.message };
    }
  }

  // ====================================================================
  // 3. API: TỪ CHỐI & XÓA BÀI KHỎI KHO
  // ====================================================================
  @Delete('reject/:id')
  async rejectPost(@Param('id') id: string) {
    try {
      await this.prisma.threadPost.delete({ where: { id } });
      return { success: true, message: 'Đã xóa bài viết khỏi kho.' };
    } catch (error: any) {
      return { success: false, message: error.message };
    }
  }
}