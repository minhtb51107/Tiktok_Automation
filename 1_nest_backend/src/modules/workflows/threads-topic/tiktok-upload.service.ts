import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../../../prisma/prisma.service';
import puppeteer from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import * as path from 'path';
import * as fs from 'fs';

// Kích hoạt áo choàng tàng hình
puppeteer.use(StealthPlugin());

@Injectable()
export class TiktokUploadService {
  private readonly logger = new Logger('🚀 AutoUploader');
  private isUploading = false; 

  constructor(private readonly prisma: PrismaService) {}

  // @Cron(CronExpression.EVERY_MINUTE) // Tắt luôn bộ quét ngầm của Uploader
  async checkAndUpload() {
    if (this.isUploading) {
      this.logger.warn('Đang có tiến trình Upload chạy dở, bỏ qua lượt này.');
      return;
    }

    try {
      this.isUploading = true;

      const pendingPost = await this.prisma.threadPost.findFirst({
        where: { isRendered: true, isPublished: false },
        orderBy: { aiScore: 'desc' }
      });

      if (!pendingPost) {
        this.logger.log('Kho chứa rỗng hoặc đã đăng hết. Chờ mẻ mới...');
        return;
      }

      this.logger.log(`Phát hiện video cần đăng: ID [${pendingPost.id}] - Chuẩn bị lên thớt!`);

      const userDataPath = path.join(process.cwd(), 'tiktok_profile');
      const browser = await puppeteer.launch({
        headless: false, 
        userDataDir: userDataPath, 
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-notifications', '--window-size=1280,960']
      });

      const page = await browser.newPage();
      await page.setViewport({ width: 1280, height: 960 });

      try {
        this.logger.log('🌐 Đang truy cập Tiktok Creator Center...');
        await page.goto('https://www.tiktok.com/creator-center/upload', { waitUntil: 'networkidle2', timeout: 60000 });

        if (page.url().includes('login')) {
          this.logger.error('🚨 BÁO ĐỘNG: Bot chưa được đăng nhập Tiktok!');
          this.logger.warn('👉 Bạn có 2 phút để quét mã QR/Đăng nhập thủ công trên cửa sổ Chromium vừa mở. Lần sau Bot sẽ tự nhớ!');
          await page.waitForNavigation({ timeout: 120000 });
        }

        const fileInputSelector = 'input[type="file"][accept="video/*"]';
        await page.waitForSelector(fileInputSelector, { timeout: 30000 });

        const videoDir = path.resolve(process.cwd(), '../3_Storage_Assets/output_ready');
        
        // 🔥 FIX: LỌC BỎ CÁC FILE PREVIEW MỜ CĂM CỦA DISCORD RA KHỎI TẦM MẮT BOT
        const files = fs.readdirSync(videoDir).filter(f => f.endsWith('.mp4') && !f.includes('_preview'));
        
        if (files.length === 0) throw new Error("Không tìm thấy file MP4 gốc vật lý trong kho!");
        
        const latestFile = files.map(f => ({ name: f, time: fs.statSync(path.join(videoDir, f)).mtime.getTime() })).sort((a, b) => b.time - a.time)[0].name;
        const videoPath = path.join(videoDir, latestFile);

        this.logger.log(`🎞️ Đang upload file gốc 4K nét căng: ${videoPath}`);
        const inputUploadHandle = await page.$(fileInputSelector);
        await inputUploadHandle.uploadFile(videoPath);

        this.logger.log('⏳ Chờ Tiktok xử lý file sơ bộ (20s)...');
        await new Promise(r => setTimeout(r, 20000)); 

        const finalCaption = (pendingPost.caption || 'Video tâm sự Threads #xuhuong') + '   '; 
        this.logger.log(`✍️ Đang gõ Caption: ${finalCaption}`);
        
        const editorSelector = '.public-DraftEditor-content, [contenteditable="true"]'; 
        await page.waitForSelector(editorSelector, { timeout: 15000 });
        
        const editors = await page.$$(editorSelector);
        if (editors.length > 0) {
            await editors[0].click();
        }
        
        await page.keyboard.down('Control');
        await page.keyboard.press('A');
        await page.keyboard.up('Control');
        await page.keyboard.press('Backspace');

        await page.keyboard.type(finalCaption, { delay: 100 });
        await new Promise(r => setTimeout(r, 2000));
        
        await page.keyboard.press('Escape');
        await new Promise(r => setTimeout(r, 1000));

        this.logger.log('🚀 Đang chờ nút ĐĂNG sáng lên (tối đa 60s)...');
        
        let clicked = false;
        for (let i = 0; i < 30; i++) {
            clicked = await page.evaluate(() => {
                const buttons = Array.from(document.querySelectorAll('button, div[role="button"]'));
                const postBtn = buttons.find(b => {
                    const text = (b.textContent || '').trim().toLowerCase();
                    return (text === 'post' || text === 'đăng' || text === 'đăng video') 
                           && !(b as HTMLButtonElement).disabled 
                           && !b.classList.contains('disabled')
                           && !b.className.includes('disable');
                });
                
                if (postBtn) {
                    (postBtn as HTMLElement).click();
                    return true;
                }
                return false;
            });

            if (clicked) break;
            await new Promise(r => setTimeout(r, 2000)); 
        }
        
        if (clicked) {
          this.logger.log('⏳ Đã bấm ĐĂNG! Kiểm tra xem Tiktok có hỏi chặn bản quyền không...');
          
          try {
            await page.waitForFunction(() => {
              const btns = Array.from(document.querySelectorAll('button, div[role="button"]'));
              const confirmBtn = btns.find(b => {
                 const txt = (b.textContent || '').trim().toLowerCase();
                 return txt === 'post now' || txt === 'vẫn đăng' || txt === 'đăng ngay' || txt === 'tiếp tục đăng' || txt === 'tiếp tục';
              });
              if (confirmBtn) {
                 (confirmBtn as HTMLElement).click();
                 return true;
              }
              return false;
            }, { timeout: 5000 });
            this.logger.log('🛑 Đã phát hiện và bấm xuyên qua Popup cảnh báo của Tiktok!');
          } catch (e) {
            this.logger.log('✅ Không có Popup. Đang chờ xác nhận hoàn tất...');
          }
          
          try {
            await page.waitForFunction(() => {
               const bodyText = document.body.innerText;
               return bodyText.includes('Manage posts') || bodyText.includes('Quản lý bài đăng') || bodyText.includes('Upload another video') || bodyText.includes('Tải video khác lên');
            }, { timeout: 120000 }); 
            this.logger.log('✅ TIKTOK ĐÃ XÁC NHẬN ĐĂNG THÀNH CÔNG!');
          } catch (e) {
            this.logger.warn('⚠️ Hết 2 phút chờ xác nhận nhưng không thấy thông báo. Vẫn tiến hành chốt Database.');
          }

          await new Promise(r => setTimeout(r, 5000));

          await this.prisma.threadPost.update({
            where: { id: pendingPost.id },
            data: { isPublished: true } 
          });

          fs.unlinkSync(videoPath); // Xóa file gốc 4K đi cho nhẹ máy

        } else {
          throw new Error("Không thể click nút Đăng. Có thể video vi phạm bản quyền bị cấm Đăng hoặc giao diện Tiktok đã đổi.");
        }

      } catch (err: any) {
        this.logger.error(`❌ Lỗi luồng Upload: ${err.message}`);
      } finally {
        await browser.close();
      }

    } catch (error: any) {
      this.logger.error(`Lỗi hệ thống Uploader: ${error.message}`);
    } finally {
      this.isUploading = false; 
    }
  }

  // HÀM: KÍCH HOẠT ĐĂNG TIKTOK DÀNH CHO NÚT BẤM DISCORD
  async uploadPostById(postId: string) {
    if (this.isUploading) {
      throw new Error('Đang có một video khác đang được upload dở. Vui lòng đợi trong giây lát!');
    }

    try {
      this.isUploading = true;
      
      const pendingPost = await this.prisma.threadPost.findUnique({ where: { id: postId } });
      if (!pendingPost) throw new Error('Không tìm thấy bài viết này trong Database!');

      this.logger.log(`🚀 KÍCH HOẠT BOT ĐĂNG TIKTOK CHO BÀI: ${pendingPost.author}`);

      const userDataPath = path.join(process.cwd(), 'tiktok_profile');
      const browser = await puppeteer.launch({
        headless: false, 
        userDataDir: userDataPath,
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-notifications', '--window-size=1280,960']
      });

      const page = await browser.newPage();
      await page.setViewport({ width: 1280, height: 960 });

      try {
        this.logger.log('🌐 Đang mở Tiktok Creator Center...');
        await page.goto('https://www.tiktok.com/creator-center/upload', { waitUntil: 'networkidle2', timeout: 60000 });

        if (page.url().includes('login')) {
          this.logger.warn('🚨 Chưa đăng nhập! Đợi sếp quét mã QR trên màn hình (Thời gian chờ: 2 phút)...');
          await page.waitForNavigation({ timeout: 120000 });
        }

        const fileInputSelector = 'input[type="file"][accept="video/*"]';
        await page.waitForSelector(fileInputSelector, { timeout: 30000 });

        const videoDir = path.resolve(process.cwd(), '../3_Storage_Assets/output_ready');
        
        // 🔥 FIX TƯƠNG TỰ CHO LUỒNG NÚT BẤM: CHỈ LẤY FILE GỐC
        const files = fs.readdirSync(videoDir).filter(f => f.endsWith('.mp4') && !f.includes('_preview'));
        
        if (files.length === 0) throw new Error("Thư mục trống, không thấy file video gốc (.mp4) nào!");
        
        const latestFile = files.map(f => ({ name: f, time: fs.statSync(path.join(videoDir, f)).mtime.getTime() })).sort((a, b) => b.time - a.time)[0].name;
        const videoPath = path.join(videoDir, latestFile);

        this.logger.log(`🎞️ Đang nạp video siêu nét vào Tiktok: ${videoPath}`);
        const inputUploadHandle = await page.$(fileInputSelector);
        await inputUploadHandle.uploadFile(videoPath);

        this.logger.log('⏳ Đợi 20 giây cho Tiktok xử lý file sơ bộ...');
        await new Promise(r => setTimeout(r, 20000));

        const finalCaption = (pendingPost.caption || 'Video tâm sự Threads #xuhuong') + '   ';
        this.logger.log(`✍️ Điền mô tả video: ${finalCaption}`);
        
        const editorSelector = '.public-DraftEditor-content, [contenteditable="true"]'; 
        await page.waitForSelector(editorSelector, { timeout: 15000 });
        
        const editors = await page.$$(editorSelector);
        if (editors.length > 0) {
            await editors[0].click();
        }
        
        await page.keyboard.down('Control');
        await page.keyboard.press('A');
        await page.keyboard.up('Control');
        await page.keyboard.press('Backspace');

        await page.keyboard.type(finalCaption, { delay: 100 });
        await new Promise(r => setTimeout(r, 2000));
        
        await page.keyboard.press('Escape');
        await new Promise(r => setTimeout(r, 1000));

        this.logger.log('🚀 Đang chờ nút ĐĂNG sáng lên (tối đa 60s)...');
        
        let clicked = false;
        for (let i = 0; i < 30; i++) {
            clicked = await page.evaluate(() => {
                const buttons = Array.from(document.querySelectorAll('button, div[role="button"]'));
                const postBtn = buttons.find(b => {
                    const text = (b.textContent || '').trim().toLowerCase();
                    return (text === 'post' || text === 'đăng' || text === 'đăng video') 
                           && !(b as HTMLButtonElement).disabled 
                           && !b.classList.contains('disabled')
                           && !b.className.includes('disable');
                });
                
                if (postBtn) {
                    (postBtn as HTMLElement).click();
                    return true;
                }
                return false;
            });

            if (clicked) break;
            await new Promise(r => setTimeout(r, 2000)); 
        }
        
        if (clicked) {
          this.logger.log('⏳ Đã bấm ĐĂNG! Kiểm tra xem Tiktok có hỏi chặn bản quyền không...');
          
          try {
            await page.waitForFunction(() => {
              const btns = Array.from(document.querySelectorAll('button, div[role="button"]'));
              const confirmBtn = btns.find(b => {
                 const txt = (b.textContent || '').trim().toLowerCase();
                 return txt === 'post now' || txt === 'vẫn đăng' || txt === 'đăng ngay' || txt === 'tiếp tục đăng' || txt === 'tiếp tục';
              });
              if (confirmBtn) {
                 (confirmBtn as HTMLElement).click();
                 return true;
              }
              return false;
            }, { timeout: 5000 }); 
            this.logger.log('🛑 Đã phát hiện và bấm xuyên qua Popup cảnh báo của Tiktok!');
          } catch (e) {
            this.logger.log('✅ Không có Popup. Đang chờ xác nhận hoàn tất...');
          }

          try {
            await page.waitForFunction(() => {
               const bodyText = document.body.innerText;
               return bodyText.includes('Manage posts') || bodyText.includes('Quản lý bài đăng') || bodyText.includes('Upload another video') || bodyText.includes('Tải video khác lên');
            }, { timeout: 120000 }); 
            this.logger.log('✅ TIKTOK ĐÃ XÁC NHẬN ĐĂNG THÀNH CÔNG!');
          } catch (e) {
            this.logger.warn('⚠️ Hết 2 phút chờ xác nhận nhưng không thấy thông báo. Vẫn tiến hành chốt Database.');
          }

          await new Promise(r => setTimeout(r, 5000));

          await this.prisma.threadPost.update({
            where: { id: pendingPost.id },
            data: { isPublished: true }
          });
          
          fs.unlinkSync(videoPath); // Xóa file gốc 4K đi cho sạch máy
          
        } else {
          throw new Error("Không thể click nút Đăng. Có thể video vi phạm bản quyền bị cấm Đăng hoặc giao diện Tiktok đã đổi.");
        }
      } finally {
        await browser.close();
      }
    } finally {
      this.isUploading = false;
    }
  }
}