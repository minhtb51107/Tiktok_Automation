import { Injectable, Logger } from '@nestjs/common';
import { spawn } from 'child_process';
import * as path from 'path';
import * as fs from 'fs';

@Injectable()
export class RemotionRunnerService {
  private readonly logger = new Logger(RemotionRunnerService.name);

  async renderVideo(durationInFrames: number, originalFileName: string, imageFiles: string[] = [], songTitle: string = "", artist: string = "", signal?: AbortSignal): Promise<void> {
    this.logger.log(`🚀 Bắt đầu lệnh Render Video cho: ${originalFileName}`);
    
    return new Promise((resolve, reject) => {
      const remotionProjectDir = path.resolve(process.cwd(), '..', '2_Remotion_Video');
      
      const baseName = path.parse(originalFileName).name;
      const outputFileName = `${baseName}.mp4`;
      const outputLocation = path.resolve(process.cwd(), '..', '3_Storage_Assets', 'output_ready', outputFileName);

      this.logger.log(`🎬 Đang tiến hành Render ngầm...`);
      
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
        '--timeout=120000', 
        '--concurrency=12',  // ÉP LUỒNG TỐI ĐA CHO RYZEN 5
        '--log=verbose' 
      ];

      const remotionProcess = spawn('npx', cliArgs, { cwd: remotionProjectDir, shell: true, stdio: 'inherit', signal });

      const cleanupTempFile = () => { if (fs.existsSync(tempPropsFilePath)) fs.unlinkSync(tempPropsFilePath); };

      remotionProcess.on('close', (code) => {
        cleanupTempFile();
        if (signal?.aborted) return resolve(); // Tránh văng lỗi nếu bị kill
        
        if (code === 0) {
          this.logger.log(`✅ THÀNH CÔNG! Đã xuất video tại: ${outputLocation}`);
          resolve();
        } else {
          this.logger.error(`❌ Lỗi khi render: Tiến trình kết thúc với mã lỗi ${code}`);
          reject(new Error(`Render failed with code ${code}`));
        }
      });
      
      remotionProcess.on('error', (err: any) => {
        cleanupTempFile();
        if (err.name === 'AbortError') {
          this.logger.warn('🛑 Tiến trình Render Nhạc đã bị hủy!');
          return reject(new Error('ABORTED'));
        }
        this.logger.error(`❌ Lỗi hệ thống: ${err.message}`);
        reject(err);
      });
    });
  }

  async renderThreadsVideo(compositionId: string, propsFilePath: string, outputFileName: string, signal?: AbortSignal): Promise<void> {
    this.logger.log(`🚀 Bắt đầu lệnh Render Video Threads/Podcast: ${outputFileName}`);
    
    return new Promise((resolve, reject) => {
      const remotionProjectDir = path.resolve(process.cwd(), '..', '2_Remotion_Video');
      const outputLocation = path.resolve(process.cwd(), '..', '3_Storage_Assets', 'output_ready', outputFileName);

const cliArgs = [
        'remotion', 'render', 'src/index.ts', compositionId, outputLocation,
        '--codec=h264',           
        '--audio-codec=aac',      
        '--pixel-format=yuv420p', 
        `--props=${propsFilePath}`,
        '--timeout=120000', // 🔥 THÊM DÒNG NÀY: Mở rộng thời gian chờ lên 120 giây (gấp 4 lần) để Chrome kịp load video MP4
        '--concurrency=8',  // 🔥 SỬA DÒNG NÀY: Giảm nhẹ từ 12 xuống 8 luồng để phần cứng không bị nghẽn cục bộ
        '--log=info' 
      ];

      const remotionProcess = spawn('npx', cliArgs, { cwd: remotionProjectDir, shell: true, stdio: 'inherit', signal });

      remotionProcess.on('close', (code) => {
        if (signal?.aborted) return resolve(); // Tránh văng lỗi nếu bị kill

        if (code === 0) {
          this.logger.log(`📸 Video xong! Đang chụp Thumbnail (Ảnh bìa) ở khung hình chuẩn nhất...`);
          
          const thumbFileName = outputFileName.replace('.mp4', '_thumbnail.jpg');
          const thumbLocation = path.resolve(process.cwd(), '..', '3_Storage_Assets', 'output_ready', thumbFileName);
          
          const stillArgs = [
            'remotion', 'still', 'src/index.ts', compositionId, thumbLocation,
            `--props=${propsFilePath}`,
            '--frame=60', 
            '--log=error'
          ];

          const stillProcess = spawn('npx', stillArgs, { cwd: remotionProjectDir, shell: true });

          stillProcess.on('close', (stillCode) => {
             this.logger.log(`✅ THÀNH CÔNG RỰC RỠ! Đã có Video và Ảnh bìa xịn xò tại thư mục output_ready!`);
             resolve();
          });
          
        } else {
          this.logger.error(`❌ Lỗi khi render Threads: Tiến trình kết thúc với mã lỗi ${code}`);
          reject(new Error(`Render failed with code ${code}`));
        }
      });
      
      remotionProcess.on('error', (err: any) => {
        if (err.name === 'AbortError') {
          this.logger.warn('🛑 Tiến trình Render Threads đã bị hủy (Sếp ra lệnh)!');
          return reject(new Error('ABORTED'));
        }
        this.logger.error(`❌ Lỗi hệ thống: ${err.message}`);
        reject(err);
      });
    });
  }
}