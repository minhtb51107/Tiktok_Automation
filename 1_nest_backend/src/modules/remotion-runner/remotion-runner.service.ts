import { Injectable, Logger } from '@nestjs/common';
import { spawn } from 'child_process';
import * as path from 'path';

@Injectable()
export class RemotionRunnerService {
  private readonly logger = new Logger(RemotionRunnerService.name);

  async renderVideo(durationInFrames: number, originalFileName: string): Promise<void> {
    this.logger.log(`🚀 Bắt đầu lệnh Render Video cho: ${originalFileName}`);
    
    return new Promise((resolve, reject) => {
      const remotionProjectDir = path.resolve(process.cwd(), '..', '2_Remotion_Video');
      
      // FIX LỖI ĐUÔI FILE: Bóc lấy tên gốc (ví dụ "music") và gắn cứng đuôi ".mp4"
      const baseName = path.parse(originalFileName).name;
      const outputFileName = `${baseName}.mp4`;
      
      const outputLocation = path.resolve(process.cwd(), '..', '3_Storage_Assets', 'output_ready', outputFileName);

      this.logger.log(`🎬 Đang tiến hành Render ngầm... (Hãy xem thanh tiến độ của Remotion bên dưới 👇)`);
      
      const cliArgs = [
        'remotion', 'render', 'src/index.ts', 'ProLyricVideo', outputLocation,
        '--codec=h264',           
        '--audio-codec=aac',      
        '--pixel-format=yuv420p', 
        '--crf=22',               // 👈 ĐÃ SỬA: Đưa về chuẩn 22 để trình phát video không bị sập
        '--log=verbose' 
      ];

      this.logger.debug(`[DEBUG 2] Lệnh thực thi CLI: npx ${cliArgs.join(' ')}`);

      const remotionProcess = spawn('npx', cliArgs, {
        cwd: remotionProjectDir,
        shell: true,
        stdio: 'inherit' 
      });

      remotionProcess.on('close', (code) => {
        if (code === 0) {
          this.logger.log(`✅ THÀNH CÔNG! Đã xuất video tại: ${outputLocation}`);
          resolve();
        } else {
          this.logger.error(`❌ Lỗi khi render: Tiến trình kết thúc với mã lỗi ${code}`);
          reject(new Error(`Render failed with code ${code}`));
        }
      });
      
      remotionProcess.on('error', (err) => {
        this.logger.error(`❌ Lỗi hệ thống: ${err.message}`);
        reject(err);
      });
    });
  }
}