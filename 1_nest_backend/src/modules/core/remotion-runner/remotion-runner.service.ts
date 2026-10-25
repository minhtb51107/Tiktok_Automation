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
        '--concurrency=2',   // 🔥 HẠ XUỐNG 2 LUỒNG: Giữ RAM luôn an toàn không bị tràn trong lúc render dài
        '--gl=egl',          // 🔥 Sử dụng driver đồ họa tối ưu hoàn hảo cho NVIDIA
        '--chrome-arg=--gpu-preference=2', // 🔥 SIÊU CỜ: Ép Chromium bốc đúng Card rời Độc lập (RTX 3050)
        '--chrome-arg=--ignore-gpu-blocklist',
        '--chrome-arg=--enable-gpu-rasterization',
        '--log=verbose' 
      ];

      const remotionProcess = spawn('npx', cliArgs, { cwd: remotionProjectDir, shell: true, stdio: 'inherit', signal });
      const cleanupTempFile = () => { if (fs.existsSync(tempPropsFilePath)) fs.unlinkSync(tempPropsFilePath); };

      remotionProcess.on('close', (code) => {
        cleanupTempFile();
        if (signal?.aborted) return resolve();
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
        if (err.name === 'AbortError') return reject(new Error('ABORTED'));
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
        '--timeout=120000', 
        '--concurrency=2',   // 🔥 HẠ XUỐNG 2 LUỒNG: Tránh Memory Swapping (Ăn vào ổ cứng) làm chậm máy
        '--gl=angle',          // 🔥 Đồng bộ Driver đồ họa NVIDIA gánh Render
        '--chrome-arg=--gpu-preference=2', // 🔥 ÉP BUỘC CHROME CHẠY TRÊN CARD RỜI NVIDIA
        '--chrome-arg=--ignore-gpu-blocklist',
        '--chrome-arg=--enable-gpu-rasterization',
        '--log=info' 
      ];

      const remotionProcess = spawn('npx', cliArgs, { cwd: remotionProjectDir, shell: true, stdio: 'inherit', signal });

      remotionProcess.on('close', (code) => {
        if (signal?.aborted) return resolve();

        if (code === 0) {
          this.logger.log(`📸 Video xong! Đang chụp Thumbnail...`);
          const thumbFileName = outputFileName.replace('.mp4', '_thumbnail.jpg');
          const thumbLocation = path.resolve(process.cwd(), '..', '3_Storage_Assets', 'output_ready', thumbFileName);
          
          const stillArgs = [
            'remotion', 'still', 'src/index.ts', compositionId, thumbLocation,
            `--props=${propsFilePath}`,
            '--frame=60', 
            '--chrome-arg=--gpu-preference=2',
            '--log=error'
          ];

          const stillProcess = spawn('npx', stillArgs, { cwd: remotionProjectDir, shell: true });
          stillProcess.on('close', () => {
             this.logger.log(`✅ THÀNH CÔNG RỰC RỠ! Đã xuất Video lên Card rời NVIDIA mượt mà!`);
             resolve();
          });
        } else {
          this.logger.error(`❌ Lỗi khi render Threads: Tiến trình kết thúc với mã lỗi ${code}`);
          reject(new Error(`Render failed with code ${code}`));
        }
      });
      
      remotionProcess.on('error', (err: any) => {
        if (err.name === 'AbortError') return reject(new Error('ABORTED'));
        this.logger.error(`❌ Lỗi hệ thống: ${err.message}`);
        reject(err);
      });
    });
  }
}