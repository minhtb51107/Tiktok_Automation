import { Injectable, Logger } from '@nestjs/common';
import puppeteer from 'puppeteer';

@Injectable()
export class ScraperService {
  private readonly logger = new Logger(ScraperService.name);

async scrapeThreadsUrl(url: string) {
    // 1. ÉP BUỘC ĐỔI .COM THÀNH .NET TRƯỚC KHI TRUY CẬP ĐỂ KHÔNG BỊ ĐÁ VĂNG
    const targetUrl = url.replace('threads.com', 'threads.net');
    this.logger.log(`Bắt đầu cào dữ liệu từ URL chuẩn xác: ${targetUrl}`);
    
    const browser = await puppeteer.launch({ 
      headless: true,
      args: [
        '--no-sandbox', 
        '--disable-setuid-sandbox', 
        '--disable-notifications',
        '--lang=vi-VN,vi',
        '--disable-blink-features=AutomationControlled' // CHỐNG META PHÁT HIỆN BOT
      ]
    });
    const page = await browser.newPage();
    
    await page.setExtraHTTPHeaders({ 'Accept-Language': 'vi-VN,vi;q=0.9' });
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');

    try {
      await page.goto(targetUrl, { waitUntil: 'networkidle2', timeout: 15000 });

      // 2. KIỂM TRA XEM CÓ BỊ ĐÁ VỀ TRANG CHỦ HOẶC BẮT ĐĂNG NHẬP KHÔNG
      const currentUrl = page.url();
      if (currentUrl === 'https://www.threads.net/' || currentUrl.includes('login')) {
          throw new Error("Bot bị Meta chặn hoặc bài viết này 18+ yêu cầu đăng nhập. Bot đã bị đá văng ra trang chủ!");
      }

      await page.waitForSelector('[data-pressable-container="true"]', { timeout: 10000 });

      const data = await page.evaluate(() => {
        const mainPostEl = document.querySelector('div[data-pressable-container="true"]');
        if (!mainPostEl) return null;

        const authorEl = mainPostEl.querySelector('span[dir="auto"]');
        const author = authorEl ? authorEl.textContent : 'Anonymous';

        const imgElements = Array.from(mainPostEl.querySelectorAll('img'));
        const avatar = imgElements.length > 0 ? imgElements[0].src : 'https://cdn.pixabay.com/photo/2015/10/05/22/37/blank-profile-picture-973460_960_720.png';

        let attachedImage = "";
        for (let i = 1; i < imgElements.length; i++) {
           const img = imgElements[i];
           const src = img.src;
           if (src && src !== avatar && !src.includes('emoji') && !src.includes('rsrc.php')) {
              if (img.width > 100 || img.height > 100) {
                 attachedImage = src;
                 break; 
              }
           }
        }

        const textNodes = Array.from(mainPostEl.querySelectorAll('span[dir="auto"]'));
        
        // 3. LỌC BỎ RÁC NHƯ "Mười sáu giờ", TÊN TÁC GIẢ, CÁC NÚT BẤM (Thường rất ngắn)
        const text = textNodes
            .map(n => n.textContent)
            .filter(t => t && t.length > 15 && t !== author && !t.includes('giờ') && !t.includes('phút'))
            .join('. ');

        return {
          post: { author, avatar, text, attachedImage },
          comments: [] 
        };
      });

      await browser.close();
      if (!data || !data.post || data.post.text.length < 5) {
          throw new Error("Cào được giao diện nhưng không thấy nội dung chữ.");
      }
      
      return data;
    } catch (error: any) {
      await browser.close();
      this.logger.error('Lỗi cào dữ liệu Threads: ' + error.message);
      throw new Error(error.message); // Quăng đúng lỗi ra Discord để bạn biết
    }
  }

  // ====================================================================
  // CHIẾN THUẬT 2: KÝ SINH THUẬT TOÁN (LƯỚT TRANG CHỦ THREADS)
  // ====================================================================
  async scrapeForYouFeed(scrolls: number = 3): Promise<any[]> {
    this.logger.log('🕷️ Đang khởi động Puppeteer lướt trang "For You"...');
    
    const browser = await puppeteer.launch({
      headless: true, 
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-notifications', '--lang=vi-VN,vi']
    });

    const page = await browser.newPage();
    
    await page.setExtraHTTPHeaders({ 'Accept-Language': 'vi-VN,vi;q=0.9' });
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
    await page.setViewport({ width: 1280, height: 800 });

    const results: any[] = [];

    try {
      this.logger.log('🌐 Đang truy cập https://www.threads.net/');
      await page.goto('https://www.threads.net/', { waitUntil: 'networkidle2', timeout: 60000 });

      for (let i = 0; i < scrolls; i++) {
        this.logger.log(`🖱️ Đang cuộn trang lần ${i + 1}/${scrolls}...`);
        await page.evaluate(() => window.scrollBy(0, window.innerHeight * 2));
        await new Promise(r => setTimeout(r, 3000)); 
      }

      this.logger.log('🕸️ Đang bóc tách dữ liệu từ bảng tin...');
      
      const posts = await page.evaluate(() => {
        const extractedPosts = [];
        const postElements = document.querySelectorAll('div[data-pressable-container="true"]');
        
        postElements.forEach((el) => {
          try {
            const urlEl = el.querySelector('a[href*="/post/"]');
            const url = urlEl ? 'https://www.threads.net' + urlEl.getAttribute('href') : null;
            
            const authorEl = el.querySelector('span[dir="auto"]');
            const author = authorEl ? authorEl.textContent : 'Unknown';

            const avatarEl = el.querySelector('img');
            const avatar = avatarEl ? avatarEl.getAttribute('src') : null;

            const textNodes = Array.from(el.querySelectorAll('span[dir="auto"]'));
            const text = textNodes.map(n => n.textContent).sort((a, b) => (b?.length || 0) - (a?.length || 0))[0] || '';

            const images = Array.from(el.querySelectorAll('img'));
            const attachedImage = images.length > 1 ? images[images.length - 1].getAttribute('src') : null;

            if (url && text.length > 15) { 
              extractedPosts.push({ url, author, avatar, text, attachedImage });
            }
          } catch (err) {
            // Bỏ qua lỗi
          }
        });

        return Array.from(new Set(extractedPosts.map(a => a.url)))
          .map(url => extractedPosts.find(a => a.url === url));
      });

      results.push(...posts);
      this.logger.log(`🎣 Lưới đã kéo lên! Thu hoạch được ${results.length} bài viết nguyên bản.`);

    } catch (error: any) {
      this.logger.error(`❌ Puppeteer lỗi: ${error.message}`);
    } finally {
      await browser.close();
    }

    return results;
  }
}