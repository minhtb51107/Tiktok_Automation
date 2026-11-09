import { Controller, Get, Post, Param, Delete, Logger, Body, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { ThreadsDramaService } from './threads-drama.service';
import { GenerateThreadsDto } from './dto/generate-threads.dto';

@Controller('api/threads')
export class ThreadsDramaController {
  private readonly logger = new Logger(ThreadsDramaController.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly threadsTopicService: ThreadsDramaService,
  ) {}

  @Post('generate')
  async generate(@Body() dto: GenerateThreadsDto) {
    // Không cần if(!url) nữa! ValidationPipe ở main.ts sẽ tự động bắt lỗi và báo 400 nếu thiếu url.
    this.logger.log(`🛠️ Bắt đầu xử lý thủ công cho URL: ${dto.url}`);
    
    // Không cần try-catch trả về { success: false } thủ công.
    // Nếu có lỗi, HttpExceptionFilter toàn cục sẽ tự bắt và trả về JSON chuẩn.
    return this.threadsTopicService.processDramaVideo(dto.url);
  }

  @Get('pending')
  async getPendingPosts() {
    // Không cần try-catch thủ công. TransformInterceptor sẽ tự bọc kết quả thành { success: true, data: posts }
    const posts = await this.prisma.threadPost.findMany({
      where: { isApproved: false },
      orderBy: { aiScore: 'desc' },
    });
    return posts;
  }

  @Post('approve/:id')
  async approveAndRender(@Param('id') id: string) {
    const post = await this.prisma.threadPost.findUnique({ where: { id } });

    // Ném ngoại lệ chuẩn thay vì throw new Error thường
    if (!post) {
      throw new NotFoundException('Không tìm thấy bài viết này trong kho!');
    }

    this.logger.log(`🎬 Đã duyệt bài [${post.aiScore} điểm]. Bắt đầu quá trình Render Video...`);

    await this.prisma.threadPost.update({
      where: { id },
      data: { isApproved: true },
    });

    // Chạy ngầm tiến trình render (Nên chuyển sang Queue ở Mục 6 sau này)
    this.threadsTopicService.processDramaVideo(post.url).then(async (res) => {
      this.logger.log(`✅ Render thành công video: ${res?.videoName}`);
      await this.prisma.threadPost.update({
        where: { id },
        data: { isRendered: true },
      });
    }).catch((err) => {
      this.logger.error(`❌ Render thất bại cho bài ${id}: ${err.message}`);
    });

    return { message: 'Đã đưa vào hàng đợi Render Video!' };
  }

  @Delete('reject/:id')
  async rejectPost(@Param('id') id: string) {
    await this.prisma.threadPost.delete({ where: { id } });
    return { message: 'Đã xóa bài viết khỏi kho.' };
  }
}