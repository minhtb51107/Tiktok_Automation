import { Injectable, Logger } from '@nestjs/common';
import { bundle } from '@remotion/bundler';
import { renderMedia, selectComposition } from '@remotion/renderer';
import * as path from 'path';

@Injectable()
export class RemotionRunnerService {
  private readonly logger = new Logger(RemotionRunnerService.name);

  async renderVideo(audioPath: string, durationInFrames: number, fileName: string) {
    this.logger.log(`🚀 Bắt đầu lệnh Render Video cho: ${fileName}`);
    
    try {
      const remotionProjectDir = path.join(process.cwd(), '..', '2_Remotion_Video');
      const entryPoint = path.join(remotionProjectDir, 'src', 'index.ts');
      
      const outputFileName = fileName.replace('.mp3', '.mp4');
      const outputLocation = path.join(process.cwd(), '..', '3_Storage_Assets', 'output_ready', outputFileName);
      const compositionId = 'ProLyricVideo'; 

      this.logger.log(`📦 Đang chuẩn bị Xưởng sản xuất (Bundling)...`);
      const bundleLocation = await bundle({
        entryPoint,
        webpackOverride: (config) => config,
      });

      this.logger.log(`🔍 Đang lấy thông số khung hình...`);
      const composition = await selectComposition({
        serveUrl: bundleLocation,
        id: compositionId,
      });

      composition.durationInFrames = durationInFrames;

      this.logger.log(`🎬 Đang Render video... (Vui lòng đợi)`);
      
      // Biến ghi nhớ tiến độ để tránh log spam
      let lastReportedProgress = -1;

await renderMedia({
        composition,
        serveUrl: bundleLocation,
        codec: 'h264',
        outputLocation,
        timeoutInMilliseconds: 120000, // <--- THÊM DÒNG NÀY VÀO (Cho phép tối đa 120 giây/1 khung hình)
        onProgress: ({ progress }) => {
          const currentProgress = Math.floor(progress * 10) * 10; 
          if (currentProgress > lastReportedProgress) {
            this.logger.log(`⏳ Tiến độ Render: ${currentProgress}%`);
            lastReportedProgress = currentProgress;
          }
        },
      });

      this.logger.log(`✅ THÀNH CÔNG! Đã xuất video tại: ${outputLocation}`);
      
    } catch (error) {
      if (error instanceof Error) {
        this.logger.error(`❌ Lỗi khi render: ${error.message}`);
      } else {
        this.logger.error(`❌ Lỗi không xác định khi render: ${String(error)}`);
      }
    }
  }
}