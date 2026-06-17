import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import puppeteer from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import * as path from 'path';
import * as fs from 'fs';

puppeteer.use(StealthPlugin());

@Injectable()
export class TiktokUploadService {
  private readonly logger = new Logger('🚀 AutoUploader');
  private isUploading = false; 

  constructor(private readonly prisma: PrismaService) {}

  private getProfileFolder(category: string): string {
    if (category === 'SERIOUS') return 'tiktok_profile_serious';
    return 'tiktok_profile_drama'; // Mặc định là Drama
  }

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

      const category = (pendingPost as any).category || 'DRAMA';
      const profileFolder = this.getProfileFolder(category);
      this.logger.log(`Phát hiện video [${category}] cần đăng. Sử dụng kênh: ${profileFolder}`);

      const userDataPath = path.join(process.cwd(), profileFolder);
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
          this.logger.error(`🚨 BÁO ĐỘNG: Kênh [${category}] chưa đăng nhập!`);
          this.logger.warn('👉 Bạn có 2 phút để quét mã QR trên cửa sổ đang mở. Lần sau Bot sẽ tự nhớ!');
          await page.waitForNavigation({ timeout: 120000 });
        }

        const fileInputSelector = 'input[type="file"][accept="video/*"]';
        await page.waitForSelector(fileInputSelector, { timeout: 30000 });

        const videoDir = path.resolve(process.cwd(), '../3_Storage_Assets/output_ready');
        const files = fs.readdirSync(videoDir).filter(f => f.endsWith('.mp4') && !f.includes('_preview'));
        
        if (files.length === 0) throw new Error("Không tìm thấy file MP4 gốc vật lý trong kho!");
        
        const latestFile = files.map(f => ({ name: f, time: fs.statSync(path.join(videoDir, f)).mtime.getTime() })).sort((a, b) => b.time - a.time)[0].name;
        const videoPath = path.join(videoDir, latestFile);

        this.logger.log(`🎞️ Đang upload file gốc: ${videoPath}`);
        const inputUploadHandle = await page.$(fileInputSelector);
        await inputUploadHandle.uploadFile(videoPath);

        this.logger.log('⏳ Chờ Tiktok tải file sơ bộ (20s)...');
        await new Promise(r => setTimeout(r, 20000)); 

        const finalCaption = (pendingPost.caption || 'Video tâm sự Threads #xuhuong') + '   '; 
        this.logger.log(`✍️ Đang gõ Caption...`);
        
        const editorSelector = '.public-DraftEditor-content, [contenteditable="true"]'; 
        await page.waitForSelector(editorSelector, { timeout: 15000 });
        
        const editors = await page.$$(editorSelector);
        if (editors.length > 0) {
          const targetEditor = editors[editors.length - 1];
          await targetEditor.click();
        }
        
        await page.keyboard.down('Control');
        await page.keyboard.press('A');
        await page.keyboard.up('Control');
        await page.keyboard.press('Backspace');

        const words = finalCaption.split(' ');
        for (const word of words) {
          if (word.startsWith('#')) {
            await page.keyboard.type(word, { delay: 100 });
            await new Promise(r => setTimeout(r, 1500)); 
            await page.keyboard.press('Enter');          
            await page.keyboard.type(' ', { delay: 50 });
          } else {
            await page.keyboard.type(word + ' ', { delay: 50 });
          }
        }
        await new Promise(r => setTimeout(r, 2000));
        
        await page.keyboard.press('Escape');
        await new Promise(r => setTimeout(r, 1000));

        this.logger.log('🔎 Bật công tắc [Tải lên HD chất lượng cao]...');
        try {
            await page.evaluate(() => {
                const elements = Array.from(document.querySelectorAll('div, span, p'));
                const hdLabel = elements.find(el => {
                    const txt = (el.textContent || '').toLowerCase();
                    return txt.includes('chất lượng cao') || txt.includes('high-quality') || txt.includes('high quality') || txt.includes('chất lượng hd');
                });
                if (hdLabel) {
                    let parent = hdLabel.parentElement;
                    while (parent && parent !== document.body) {
                        const toggle = parent.querySelector('[role="switch"]');
                        if (toggle && toggle.getAttribute('aria-checked') === 'false') {
                            (toggle as HTMLElement).click();
                            break;
                        }
                        parent = parent.parentElement;
                    }
                }
            });
        } catch (e) {}

        this.logger.log('🚀 Đang rình nút ĐĂNG sáng lên (Đợi Upload 100%)...');
        let clicked = false;

        for (let i = 0; i < 60; i++) {
            clicked = await page.evaluate(() => {
                const buttons = Array.from(document.querySelectorAll('button, div[role="button"], .TUXButton'));
                const postBtns = buttons.filter(b => {
                    const text = (b.textContent || '').trim().toLowerCase();
                    if (b.closest('.preview-container') || b.closest('.mobile-preview')) return false;

                    const style = window.getComputedStyle(b);
                    const isVisible = style.display !== 'none' && style.visibility !== 'hidden' && b.getBoundingClientRect().width > 0;
                    
                    const isDisabled = (b as HTMLButtonElement).disabled || 
                                       b.classList.contains('disabled') || 
                                       b.className.includes('disable') || 
                                       b.hasAttribute('disabled') || 
                                       b.getAttribute('aria-disabled') === 'true';
                    
                    return (text === 'post' || text === 'đăng' || text === 'đăng video') && isVisible && !isDisabled;
                });
                
                if (postBtns.length > 0) {
                    const targetBtn = postBtns[postBtns.length - 1] as HTMLElement;
                    targetBtn.scrollIntoView({ block: 'center' });
                    targetBtn.click();
                    return true;
                }
                return false;
            });

            if (clicked) break;
            await new Promise(r => setTimeout(r, 2000)); 
        }
        
        if (clicked) {
          this.logger.log('⏳ Đã BẤM ĐĂNG THÀNH CÔNG! Kiểm tra Popup bản quyền...');
          
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
            }, { timeout: 8000 });
          } catch (e) {}
          
          try {
            this.logger.log('⏳ Đang chờ Tiktok báo cáo kết quả (Tối đa 2 phút)...');
            await page.waitForFunction(() => {
               const bodyText = document.body.innerText;
               const isSuccessText = bodyText.includes('Manage posts') || 
                                     bodyText.includes('Quản lý bài đăng') || 
                                     bodyText.includes('Upload another video') || 
                                     bodyText.includes('Tải video khác lên') ||
                                     bodyText.includes('View profile') ||
                                     bodyText.includes('Xem hồ sơ');
               const isRedirected = !window.location.href.includes('/upload');
               return isSuccessText || isRedirected;
            }, { timeout: 120000 }); 
            this.logger.log('✅ TIKTOK ĐĐÃ XÁC NHẬN ĐĂNG THÀNH CÔNG!');
          } catch (e) {
            throw new Error('Hết thời gian chờ nhưng TikTok không báo Đăng thành công. Tiến trình tải lên bị kẹt!');
          }

          await new Promise(r => setTimeout(r, 3000));

          await this.prisma.threadPost.update({
            where: { id: pendingPost.id },
            data: { isPublished: true } 
          });

          fs.unlinkSync(videoPath); 

        } else {
          throw new Error("Video tải lên quá lâu (hết 2 phút) hoặc Tiktok đã đổi cấu trúc nút Đăng.");
        }

      } catch (err: any) {
        this.logger.error(`❌ Lỗi luồng Upload: ${err.message}`);
        throw err; 
      } finally {
        await browser.close();
      }

    } catch (error: any) {
      this.logger.error(`Lỗi hệ thống Uploader: ${error.message}`);
    } finally {
      this.isUploading = false; 
    }
  }

  async uploadPostById(postId: string) {
    if (this.isUploading) {
      throw new Error('Đang có một video khác đang được upload dở. Vui lòng đợi trong giây lát!');
    }

    try {
      this.isUploading = true;
      
      const pendingPost = await this.prisma.threadPost.findUnique({ where: { id: postId } });
      if (!pendingPost) throw new Error('Không tìm thấy bài viết này trong Database!');

      const category = (pendingPost as any).category || 'DRAMA';
      const profileFolder = this.getProfileFolder(category);
      
      this.logger.log(`🚀 KÍCH HOẠT BOT ĐĂNG TIKTOK CHO BÀI: ${pendingPost.author}`);
      this.logger.log(`Kênh mục tiêu: [${category}] - Thư mục profile: ${profileFolder}`);

      const userDataPath = path.join(process.cwd(), profileFolder);
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
          this.logger.warn(`🚨 KÊNH [${category}] CHƯA ĐĂNG NHẬP! Đợi sếp quét mã QR trên màn hình (Thời gian chờ: 2 phút)...`);
          await page.waitForNavigation({ timeout: 120000 });
        }

        const fileInputSelector = 'input[type="file"][accept="video/*"]';
        await page.waitForSelector(fileInputSelector, { timeout: 30000 });

        const videoDir = path.resolve(process.cwd(), '../3_Storage_Assets/output_ready');
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
        this.logger.log(`✍️ Điền mô tả video...`);
        
        const editorSelector = '.public-DraftEditor-content, [contenteditable="true"]'; 
        await page.waitForSelector(editorSelector, { timeout: 15000 });
        
        const editors = await page.$$(editorSelector);
        if (editors.length > 0) {
          const targetEditor = editors[editors.length - 1];
          await targetEditor.click();
        }
        
        await page.keyboard.down('Control');
        await page.keyboard.press('A');
        await page.keyboard.up('Control');
        await page.keyboard.press('Backspace');

        const words = finalCaption.split(' ');
        for (const word of words) {
          if (word.startsWith('#')) {
            await page.keyboard.type(word, { delay: 100 });
            await new Promise(r => setTimeout(r, 1500));
            await page.keyboard.press('Enter');         
            await page.keyboard.type(' ', { delay: 50 });
          } else {
            await page.keyboard.type(word + ' ', { delay: 50 });
          }
        }
        await new Promise(r => setTimeout(r, 2000));
        
        await page.keyboard.press('Escape');
        await new Promise(r => setTimeout(r, 1000));

        this.logger.log('🔎 Bật công tắc [Tải lên HD chất lượng cao]...');
        try {
            await page.evaluate(() => {
                const elements = Array.from(document.querySelectorAll('div, span, p'));
                const hdLabel = elements.find(el => {
                    const txt = (el.textContent || '').toLowerCase();
                    return txt.includes('chất lượng cao') || txt.includes('high-quality') || txt.includes('high quality') || txt.includes('chất lượng hd');
                });
                if (hdLabel) {
                    let parent = hdLabel.parentElement;
                    while (parent && parent !== document.body) {
                        const toggle = parent.querySelector('[role="switch"]');
                        if (toggle && toggle.getAttribute('aria-checked') === 'false') {
                            (toggle as HTMLElement).click();
                            break;
                        }
                        parent = parent.parentElement;
                    }
                }
            });
        } catch (e) {}

        this.logger.log('🚀 Đang rình nút ĐĂNG sáng lên (Đợi Upload 100%)...');
        let clicked = false;

        for (let i = 0; i < 60; i++) {
            clicked = await page.evaluate(() => {
                const buttons = Array.from(document.querySelectorAll('button, div[role="button"], .TUXButton'));
                const postBtns = buttons.filter(b => {
                    const text = (b.textContent || '').trim().toLowerCase();
                    if (b.closest('.preview-container') || b.closest('.mobile-preview')) return false;

                    const style = window.getComputedStyle(b);
                    const isVisible = style.display !== 'none' && style.visibility !== 'hidden' && b.getBoundingClientRect().width > 0;
                    
                    const isDisabled = (b as HTMLButtonElement).disabled || 
                                       b.classList.contains('disabled') || 
                                       b.className.includes('disable') || 
                                       b.hasAttribute('disabled') || 
                                       b.getAttribute('aria-disabled') === 'true';
                                       
                    return (text === 'post' || text === 'đăng' || text === 'đăng video') && isVisible && !isDisabled;
                });
                
                if (postBtns.length > 0) {
                    const targetBtn = postBtns[postBtns.length - 1] as HTMLElement;
                    targetBtn.scrollIntoView({ block: 'center' });
                    targetBtn.click();
                    return true;
                }
                return false;
            });

            if (clicked) break;
            await new Promise(r => setTimeout(r, 2000)); 
        }
        
        if (clicked) {
          this.logger.log('⏳ Đã BẤM ĐĂNG THÀNH CÔNG! Kiểm tra Popup bản quyền...');
          
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
            }, { timeout: 8000 }); 
          } catch (e) {}

          try {
            this.logger.log('⏳ Đang chờ Tiktok báo cáo kết quả (Tối đa 2 phút)...');
            await page.waitForFunction(() => {
               const bodyText = document.body.innerText;
               const isSuccessText = bodyText.includes('Manage posts') || 
                                     bodyText.includes('Quản lý bài đăng') || 
                                     bodyText.includes('Upload another video') || 
                                     bodyText.includes('Tải video khác lên') ||
                                     bodyText.includes('View profile') ||
                                     bodyText.includes('Xem hồ sơ');
               const isRedirected = !window.location.href.includes('/upload');
               return isSuccessText || isRedirected;
            }, { timeout: 120000 }); 
            this.logger.log('✅ TIKTOK ĐÃ XÁC NHẬN ĐĂNG THÀNH CÔNG!');
          } catch (e) {
            throw new Error('Hết thời gian chờ nhưng TikTok không báo Đăng thành công. Tiến trình tải lên bị kẹt!');
          }

          await new Promise(r => setTimeout(r, 5000));

          await this.prisma.threadPost.update({
            where: { id: pendingPost.id },
            data: { isPublished: true }
          });
          
          fs.unlinkSync(videoPath); 
          
        } else {
          throw new Error("Video tải lên quá lâu (hết 2 phút) hoặc Tiktok đã đổi cấu trúc nút Đăng.");
        }
      } catch (err: any) {
        this.logger.error(`❌ Lỗi luồng Upload: ${err.message}`);
        throw err;
      } finally {
        await browser.close();
      }
    } finally {
      this.isUploading = false;
    }
  }
}
