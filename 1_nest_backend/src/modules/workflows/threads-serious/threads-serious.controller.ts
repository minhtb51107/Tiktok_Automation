import { Controller, Post, Body, Param, Get } from '@nestjs/common';
import { ThreadsSeriousService } from './threads-serious.service';

@Controller('workflows/threads-serious')
export class ThreadsSeriousController {
  constructor(private readonly threadsSeriousService: ThreadsSeriousService) {}

  // 1. Gửi URLs thô -> Nhận kịch bản để duyệt
  @Post('script-draft')
  async createScriptDraft(@Body() body: { urls: string[] }) {
    return await this.threadsSeriousService.phase1_CreateScript(body.urls);
  }

  // 2. Gửi kịch bản đã được bạn chỉnh sửa từ UI -> Tạo toàn bộ assets âm thanh/hình ảnh
  @Post(':id/process-assets')
  async processAssets(
    @Param('id') id: string,
    @Body() body: { editedChunks: any[] }
  ) {
    return await this.threadsSeriousService.phase2_ProcessAssets(id, body.editedChunks);
  }

  // 3. Ấn nút tiếp tục -> Tiến hành Render video hoàn chỉnh
  @Post(':id/render')
  async renderVideo(@Param('id') id: string) {
    return await this.threadsSeriousService.phase3_RenderVideo(id);
  }
}