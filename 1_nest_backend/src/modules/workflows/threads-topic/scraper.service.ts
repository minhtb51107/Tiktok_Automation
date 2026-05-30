import { Injectable, Logger } from '@nestjs/common';
import puppeteer from 'puppeteer';

@Injectable()
export class ScraperService {
  private readonly logger = new Logger(ScraperService.name);

  async scrapeThreadsUrl(url: string) {
    this.logger.log(`Bắt đầu cào dữ liệu từ: ${url}`);
    const browser = await puppeteer.launch({ headless: true });
    const page = await browser.newPage();
    
    try {
      await page.goto(url, { waitUntil: 'networkidle2' });
      await page.waitForSelector('[data-pressable-container="true"]', { timeout: 10000 });

      const data = await page.evaluate(() => {
        const elements = Array.from(document.querySelectorAll('[data-pressable-container="true"]'));
        const extracted = elements.map(el => {
          const author = el.querySelector('span[dir="auto"]')?.textContent || 'Anonymous';
          
          const imgElements = Array.from(el.querySelectorAll('img'));
          const avatar = imgElements.length > 0 ? imgElements[0].src : 'https://cdn.pixabay.com/photo/2015/10/05/22/37/blank-profile-picture-973460_960_720.png';
          
          let attachedImage = "";
          // Thuật toán quét ảnh đính kèm thông minh
          for (let i = 1; i < imgElements.length; i++) {
             const img = imgElements[i];
             const src = img.src;
             
             // 1. Phải khác URL của Avatar
             // 2. Không chứa mã icon/emoji của hệ thống
             if (src && src !== avatar && !src.includes('emoji') && !src.includes('rsrc.php')) {
                
                // ĐIỀU KIỆN VÀNG: Kích thước thật của ảnh phải lớn (Loại bỏ các avatar reply xen kẽ cỡ 16px/36px)
                if (img.width > 100 || img.height > 100) {
                   attachedImage = src;
                   break; // Bắt được ảnh nội dung là dừng ngay
                }
             }
          }

          const textElements = Array.from(el.querySelectorAll('span[dir="auto"]'));
          const text = textElements.map(t => t.textContent).sort((a, b) => b.length - a.length)[0] || '';
          
          return { author, avatar, text, attachedImage };
        }).filter(item => item.text.length > 5);

        return {
          post: extracted[0],
          comments: extracted.slice(1)
        };
      });

      await browser.close();
      return data;
    } catch (error) {
      await browser.close();
      this.logger.error('Lỗi cào dữ liệu Threads', error);
      throw new Error('Không thể cào dữ liệu từ URL này.');
    }
  }
}