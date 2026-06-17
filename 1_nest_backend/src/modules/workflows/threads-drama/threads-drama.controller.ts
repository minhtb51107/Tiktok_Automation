import { Controller, Get, Post, Param, Delete, Logger, Body } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { ThreadsDramaService } from './threads-drama.service';

@Controller('api/threads')
export class ThreadsDramaController {
  private readonly logger = new Logger(ThreadsDramaController.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly threadsTopicService: ThreadsDramaService,
  ) {}

  @Post('generate')
  async generate(@Body('url') url: string) {
    if (!url) {
      return { success: false, message: 'Vui lòng cung cấp url bài viết Threads' };
    }
    
    this.logger.log(`🛠️ Bắt đầu xử lý thủ công cho URL: ${url}`);
    
    try {
      const result = await this.threadsTopicService.processDramaVideo(url);
      return result;
    } catch (error: any) {
      this.logger.error(`❌ Lỗi xử lý thủ công: ${error.message}`);
      return { success: false, message: error.message };
    }
  }

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

  @Post('approve/:id')
  async approveAndRender(@Param('id') id: string) {
    try {
      const post = await this.prisma.threadPost.findUnique({ where: { id } });
      if (!post) throw new Error('Không tìm thấy bài viết này trong kho!');

      this.logger.log(`🎬 Đã duyệt bài [${post.aiScore} điểm]. Bắt đầu quá trình Render Video...`);

      await this.prisma.threadPost.update({
        where: { id },
        data: { isApproved: true },
      });

      this.threadsTopicService.processDramaVideo(post.url).then(async (res) => {
        this.logger.log(`✅ Render thành công video: ${res?.videoName}`);
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
