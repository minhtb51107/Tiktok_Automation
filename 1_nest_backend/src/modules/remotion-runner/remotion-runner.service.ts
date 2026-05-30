import { Injectable, Logger } from '@nestjs/common';
import { spawn } from 'child_process';
import * as path from 'path';
import * as fs from 'fs';

@Injectable()
export class RemotionRunnerService {
  private readonly logger = new Logger(RemotionRunnerService.name);

  // ĐÃ SỬA: Nhận tham số songTitle và artist trực tiếp từ Watcher
  async renderVideo(durationInFrames: number, originalFileName: string, imageFiles: string[] = [], songTitle: string = "", artist: string = ""): Promise<void> {
    this.logger.log(`🚀 Bắt đầu lệnh Render Video cho: ${originalFileName}`);
    
    return new Promise((resolve, reject) => {
      const remotionProjectDir = path.resolve(process.cwd(), '..', '2_Remotion_Video');
      
      const baseName = path.parse(originalFileName).name;
      const outputFileName = `${baseName}.mp4`;
      const outputLocation = path.resolve(process.cwd(), '..', '3_Storage_Assets', 'output_ready', outputFileName);

      this.logger.log(`🎬 Đang tiến hành Render ngầm... (Tự động chèn Intro: ${songTitle} - ${artist})`);
      
      // Đóng gói data được lấy từ AI vào props
      const propsData = { 
        imageList: imageFiles,
        songTitle: songTitle || "UNKNOWN SONG",
        artist: artist || "UNKNOWN ARTIST"
      };
      
      const tempPropsFileName = `props_${Date.now()}.json`;
      const tempPropsFilePath = path.join(remotionProjectDir, tempPropsFileName);
      
      fs.writeFileSync(tempPropsFilePath, JSON.stringify(propsData));
      
      const cliArgs = [
        'remotion', 'render', 'src/index.ts', 'ProLyricVideo', outputLocation,
        '--codec=h264',           
        '--audio-codec=aac',      
        '--pixel-format=yuv420p', 
        '--crf=22',
        `--props=${tempPropsFileName}`,
        // --- 2 DÒNG CẤU HÌNH FIX LỖI TIMEOUT ---
        '--timeout=120000', // Tăng thời gian chờ tối đa cho mỗi frame lên 120 giây (mặc định 30s)
        '--concurrency=1',  // Chỉ ép máy tính render 1-2 frame cùng lúc để tránh nghẽn cổ chai CPU (Có thể tăng lên 2 nếu máy mạnh)
        // ---------------------------------------
        '--log=verbose' 
      ];

      const remotionProcess = spawn('npx', cliArgs, {
        cwd: remotionProjectDir,
        shell: true,
        stdio: 'inherit' 
      });

      const cleanupTempFile = () => {
        if (fs.existsSync(tempPropsFilePath)) {
          fs.unlinkSync(tempPropsFilePath);
        }
      };

      remotionProcess.on('close', (code) => {
        cleanupTempFile();
        if (code === 0) {
          this.logger.log(`✅ THÀNH CÔNG! Đã xuất video tại: ${outputLocation}`);
          resolve();
        } else {
          this.logger.error(`❌ Lỗi khi render: Tiến trình kết thúc với mã lỗi ${code}`);
          reject(new Error(`Render failed with code ${code}`));
        }
      });
      
      remotionProcess.on('error', (err) => {
        cleanupTempFile();
        this.logger.error(`❌ Lỗi hệ thống: ${err.message}`);
        reject(err);
      });
    });
  }

  // --- THÊM HÀM MỚI DÀNH RIÊNG CHO THREADS ---
  async renderThreadsVideo(compositionId: string, propsFilePath: string, outputFileName: string): Promise<void> {
    this.logger.log(`🚀 Bắt đầu lệnh Render Video Threads: ${outputFileName}`);
    
    return new Promise((resolve, reject) => {
      const remotionProjectDir = path.resolve(process.cwd(), '..', '2_Remotion_Video');
      const outputLocation = path.resolve(process.cwd(), '..', '3_Storage_Assets', 'output_ready', outputFileName);

const cliArgs = [
        'remotion', 'render', 'src/index.ts', compositionId, outputLocation,
        '--codec=h264',           
        '--audio-codec=aac',      
        '--pixel-format=yuv420p', 
        `--props=${propsFilePath}`,
        // Xóa dòng '--concurrency=1' đi, để Remotion tự dùng 100% sức mạnh CPU
        '--log=info' // Đổi từ verbose sang info cho terminal bớt lag
      ];

      const remotionProcess = spawn('npx', cliArgs, {
        cwd: remotionProjectDir,
        shell: true,
        stdio: 'inherit' 
      });

      remotionProcess.on('close', (code) => {
        if (code === 0) {
          this.logger.log(`✅ THÀNH CÔNG! Đã xuất video Threads tại: ${outputLocation}`);
          resolve();
        } else {
          this.logger.error(`❌ Lỗi khi render Threads: Tiến trình kết thúc với mã lỗi ${code}`);
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