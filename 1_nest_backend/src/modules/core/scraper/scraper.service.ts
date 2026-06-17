import { Injectable, Logger } from '@nestjs/common';
import puppeteer from 'puppeteer';

@Injectable()
export class ScraperService {
  private readonly logger = new Logger(ScraperService.name);

  async scrapeThreadsUrl(url: string, fetchComments: boolean = true) {
    const cleanUrl = url.split('?')[0];
    const targetUrl = cleanUrl.replace('threads.com', 'threads.net');
    this.logger.log(`🔍 Bắt đầu cào URL chuẩn: ${targetUrl}`);
    
    const browser = await puppeteer.launch({ 
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-notifications', '--lang=vi-VN,vi']
    });
    const page = await browser.newPage();
    
    await page.setExtraHTTPHeaders({ 'Accept-Language': 'vi-VN,vi;q=0.9' });
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36');

    try {
      await page.goto(targetUrl, { waitUntil: 'networkidle2', timeout: 15000 });

      if (page.url() === 'https://www.threads.net/' || page.url().includes('login')) {
          throw new Error("Bot bị Meta chặn hoặc bài viết này yêu cầu 18+ bắt đăng nhập!");
      }

      await page.waitForSelector('[data-pressable-container="true"]', { timeout: 20000 });

      if (fetchComments) {
        this.logger.log(`⏳ Đang cuộn trang để móc thêm bình luận đang bị ẩn...`);
        for (let i = 0; i < 4; i++) { 
          await page.evaluate(() => window.scrollBy(0, window.innerHeight * 2));
          await new Promise(r => setTimeout(r, 1500)); 
        }
        this.logger.log(`✅ Đã cuộn xong, tiến hành thu hoạch bình luận!`);
      } else {
        this.logger.log(`⚡ Chế độ TỐC ĐỘ CAO (Chỉ lấy bài gốc, bỏ qua cuộn trang tìm bình luận)`);
      }

      const data = await page.evaluate(() => {
        const containers = Array.from(document.querySelectorAll('div[data-pressable-container="true"]'));
        if (!containers || containers.length === 0) return null;

        const results = [];
        let currentParent = null; 

        containers.forEach((el, index) => {
          const rawString = (el as HTMLElement).innerText || "";
          const lines = rawString.split('\n').map(s => s.trim()).filter(Boolean);
          
          let author = 'Anonymous';
          const spanNodes = Array.from(el.querySelectorAll('span[dir="auto"]')).map(n => n.textContent?.trim() || "");
          const validSpans = spanNodes.filter(t => t.length > 0);
          
          let authorIndex = 0;
          if (validSpans[0] === 'Đã ghim' || validSpans[0] === 'Pinned') {
              authorIndex = 1;
          }
          if (validSpans.length > authorIndex) {
              author = validSpans[authorIndex];
          }

          let likeCount, commentsCount, repostCount;
          const numRegex = /^[\d,.]+([KkMmBb])?$/; 
          const nums = [];
          for (let i = lines.length - 1; i >= 0; i--) {
              if (numRegex.test(lines[i])) nums.unshift(lines[i]);
              else break; 
          }
          if (nums.length >= 1) likeCount = nums[0];
          if (nums.length >= 2) commentsCount = nums[1];
          if (nums.length >= 3) repostCount = nums[2];

          const imgElements = Array.from(el.querySelectorAll('img'));
          let avatar = 'https://cdn.pixabay.com/photo/2015/10/05/22/37/blank-profile-picture-973460_960_720.png';
          for (const img of imgElements) {
              if (img.src && !img.src.includes('emoji') && !img.src.includes('rsrc.php') && img.width > 10 && img.width < 100) {
                  avatar = img.src; break;
              }
          }

          let attachedImage = "";
          for (const img of imgElements) {
             if (img.src && img.src !== avatar && !img.src.includes('emoji') && !img.src.includes('rsrc.php')) {
                if (img.width > 100 || img.height > 100) { attachedImage = img.src; break; }
             }
          }

          const timeMatch = rawString.match(/(?:\d{1,2}\/\d{1,2}(?:\/\d{2,4})?|\d+\s*(?:giây|phút|giờ|ngày|tuần|tháng|năm)(?:\s*trước)?|\d+[mhd])/i);
          const timeAgo = timeMatch ? timeMatch[0] : "Vừa xong";

          const timeNodeRegex = /^[\s•.\-]*(\d{1,2}\/\d{1,2}(\/\d{2,4})?|\d+\s*(giây|phút|giờ|ngày|tuần|tháng|năm|s|m|h|d|w)(\s*trước)?|\d+[mhd])[\s•.\-]*$/i;
          const textNodes = Array.from(el.querySelectorAll('span[dir="auto"]'));
          let text = textNodes
              .map(n => n.textContent?.trim() || "")
              .filter(t => t.length > 0 && t !== author && t !== 'Tác giả' && t !== 'Author' && t !== 'Đã ghim' && t !== 'Pinned' && !numRegex.test(t) && !timeNodeRegex.test(t))
              .join('\n') 
              .trim();

          if (timeMatch && timeMatch[0]) {
             text = text.replace(timeMatch[0], '');
          }
          text = text.replace(/^[\s•.\-]+/g, '').trim();

          let isReply = false;
          let replyTo = undefined;

          if (rawString.includes('Đang trả lời') || rawString.includes('Replying to')) {
              isReply = true;
              const replyMatch = rawString.match(/(?:Đang trả lời|Replying to)\s*@([a-zA-Z0-9_.]+)/i);
              if (replyMatch) replyTo = replyMatch[1];
          }

          if (index > 0 && results.length > 0 && author === results[0].author) isReply = true;
          if (isReply && !replyTo && currentParent) replyTo = currentParent;
          if (!isReply && index > 0) currentParent = author;

          if (text.length > 3) {
             results.push({ author, avatar, text, attachedImage, likeCount, comments: commentsCount, reposts: repostCount, timeAgo, isReply, replyTo, debugRawString: rawString.replace(/\n/g, ' | ') });
          }
        });

        const uniquePosts = [];
        const seenTexts = new Set();
        for (const item of results) {
           const key = item.text.substring(0, 40).trim(); 
           if (!seenTexts.has(key)) { seenTexts.add(key); uniquePosts.push(item); }
        }

        return { post: uniquePosts[0], comments: uniquePosts.slice(1) };
      });

      await browser.close();
      return data;

    } catch (error: any) {
      await browser.close();
      this.logger.error('Lỗi cào Threads: ' + error.message);
      throw new Error(error.message); 
    }
  }

  async scrapeForYouFeed(scrolls: number = 3): Promise<any[]> {
    this.logger.log('🕷️ Đang thả không Puppeteer lướt trang "For You"...');
    
    const browser = await puppeteer.launch({
      headless: true, 
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-notifications', '--lang=vi-VN,vi']
    });
    const page = await browser.newPage();
    
    await page.setExtraHTTPHeaders({ 'Accept-Language': 'vi-VN,vi;q=0.9' });
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36');
    await page.setViewport({ width: 1280, height: 800 });

    const results: any[] = [];

    try {
      this.logger.log('🌐 Đang truy cập https://www.threads.net/');
      await page.goto('https://www.threads.net/', { waitUntil: 'networkidle2', timeout: 60000 });

      for (let i = 0; i < scrolls; i++) {
        this.logger.log(`⏳ Đang cuộn trang lần ${i + 1}/${scrolls}...`);
        await page.evaluate(() => window.scrollBy(0, window.innerHeight * 2));
        await new Promise(r => setTimeout(r, 3000)); 
      }

      this.logger.log('⛏️ Đang bóc tách dòng tin...');
      
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
          } catch (err) {}
        });

        return Array.from(new Set(extractedPosts.map(a => a.url)))
          .map(url => extractedPosts.find(a => a.url === url));
      });

      results.push(...posts);
      this.logger.log(`✅ Lưới đầy! Thu hoạch được ${results.length} bài viết nguyên liệu.`);

    } catch (error: any) {
      this.logger.error(`❌ Puppeteer lỗi: ${error.message}`);
    } finally {
      await browser.close();
    }

    return results;
  }
}
