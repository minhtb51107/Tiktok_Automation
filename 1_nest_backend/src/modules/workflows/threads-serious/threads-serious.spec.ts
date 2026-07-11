import { Test, TestingModule } from '@nestjs/testing';
import { ThreadsSeriousService } from './threads-serious.service';
import { ScraperService } from '../../core/scraper/scraper.service';
import { AiModule } from '../../core/ai/ai.module';
import { RemotionRunnerModule } from '../../remotion-runner/remotion-runner.module';
import { WhisperModule } from '../../whisper/whisper.module';
import { TtsService } from '../../core/tts/tts.service';
import { PrismaModule } from '../../../prisma/prisma.module';
import { Logger } from '@nestjs/common';
import { describe, beforeAll, afterAll, it, expect } from '@jest/globals';
import { AiService } from '../../core/ai/ai.service';

describe('--- MÔ PHỎNG KIỂM TRA LUỒNG THREADS SERIOUS ---', () => {
  let module: TestingModule;
  let service: ThreadsSeriousService;
  let scraperService: ScraperService;
  let aiService: AiService;
  const logger = new Logger('TestSeriousFlow');

  const MOCK_THREADS_URLS = [
    'https://www.threads.com/@elisee.ph/post/DTxXggckj6p', 
    'https://www.threads.com/@austindox/post/DTx_u5eEwGm', 
    'https://www.threads.com/@cassandrale179/post/DTyDv5Gj610',
    'https://www.threads.com/@quynhgiangg/post/DTx1mh3CQdK',
    'https://www.threads.com/@hoangfotu/post/DTxYk59DPX6',
    'https://www.threads.com/@kaicongchua311/post/DTxgnfLEp63'
  ];

  beforeAll(async () => {
    module = await Test.createTestingModule({
      imports: [PrismaModule, AiModule, RemotionRunnerModule, WhisperModule],
      providers: [ThreadsSeriousService, ScraperService, TtsService],
    }).compile();

    service = module.get<ThreadsSeriousService>(ThreadsSeriousService);
    scraperService = module.get<ScraperService>(ScraperService);
    aiService = module.get<AiService>(AiService);

    await module.init();
  });

  afterAll(async () => {
    if (module) {
      logger.log('🛑 Đang giải phóng tài nguyên hệ thống...');
      await module.close();
    }
  });

  it('MÔ PHỎNG THỰC TẾ: HUGGING FACE TÁCH BIỆT CARD GỐC VÀ LỜI AI ĐỌC', async () => {
    logger.log('🚀 BƯỚC 1: Tiến hành cào dữ liệu và loại bỏ lặp trùng...');

    const scrapedResults = await Promise.all(
      MOCK_THREADS_URLS.map(async (url) => {
        try {
          return await scraperService.scrapeThreadsUrl(url);
        } catch (err: any) {
          return null;
        }
      })
    );

    const validData = scrapedResults.filter((item): item is NonNullable<typeof item> => !!item);
    
    console.log('\n================================================================');
    console.log('📦 [TƯ LIỆU SẠCH ĐẦU VÀO]');
    console.log('================================================================');

    let aiInputContext = `DƯỚI ĐÂY LÀ NỘI DUNG CÁC BÀI VIẾT GỐC VÀ BÌNH LUẬN CHÍNH XÁC TỪ URL:\n\n`;
    let uniqueIndex = 1;
    const seenPostTexts = new Set<string>();

    validData.forEach((data, idx) => {
      if (!data) return;

      const currentUrl = MOCK_THREADS_URLS[idx];
      const urlAuthorMatch = currentUrl.match(/@([a-zA-Z0-9._-]+)/);
      const urlAuthor = urlAuthorMatch ? urlAuthorMatch[1] : '';

      // Fix lỗi gọi sai tên biến kết quả ở đây (thay result thành data, thay seenTexts thành seenPostTexts)
      if (data.post && data.post.author === urlAuthor) {
        const text = data.post.text?.trim();
        if (text && !seenPostTexts.has(text)) {
          seenPostTexts.add(text);
          const logLine = `[TƯ LIỆU SỐ ${uniqueIndex}] (Bài Gốc) [${data.post.author}]: "${data.post.text}"`;
          console.log(logLine);
          aiInputContext += logLine + '\n\n';
          uniqueIndex++;
        }
      } 
      else if (data.comments && data.comments.length > 0) {
        const targetComment = data.comments.find((cmt: any) => cmt.author === urlAuthor);
        if (targetComment && targetComment.text) {
          const text = targetComment.text.trim();
          if (!seenPostTexts.has(text)) {
            seenPostTexts.add(text);
            const logLine = `[TƯ LIỆU SỐ ${uniqueIndex}] (Bình Luận) [${targetComment.author}]: "${targetComment.text}"`;
            console.log(logLine);
            aiInputContext += logLine + '\n\n';
            uniqueIndex++;
          }
        }
      }
    });
    console.log('================================================================\n');

    logger.log('🤖 BƯỚC 2: Đẩy tư liệu sang Hugging Face dựng kịch bản có phân vai cấu trúc...');

    const promptInstructions = `
Bạn là một đạo diễn kiêm biên kịch xuất sắc cho kênh TikTok "Góc Nhìn Sự Nghiệp" (thể loại Podcast/Serious Advice sâu sắc).
Nhiệm vụ của bạn là biến danh sách các tư liệu thô ở trên thành một kịch bản video hoàn chỉnh thông qua các thẻ khối <CHUNK>.

⚠️ QUY TẮC PHÂN VAI VÀ GIỮ NGUYÊN VĂN PHONG (BẮT BUỘC):
1. TUYỆT ĐỐI KHÔNG nhắc đến các tên nick, ID cá nhân (elisee.ph, austindox...) trong lời thoại.
2. Đối với các thẻ type="post" và type="comment" (Đại diện cho Card hiển thị trên màn hình): Bạn BẮT BUỘC phải giữ nguyên văn phong NGÔI THỨ NHẤT ("Mình", "Tôi", "Anh", "Chị") y hệt như tư liệu gốc. Hãy cô đọng, gọt giũa lại cho súc tích, thâm thúy nhưng phải là lời tự sự TRỰC TIẾP của nhân vật đó, không được viết kiểu tóm tắt hay kể hộ ở ngôi thứ ba.
3. Đối với các thẻ type="narration" (Lời của người dẫn chuyện/Biên kịch): Đây MỚI LÀ NƠI bạn dùng giọng ngôi thứ ba để dẫn dắt, kết nối hoặc phân tích chuyên sâu (Ví dụ: "Hãy xem lời tâm sự của một bạn trẻ...", "Rõ ràng bài học ở đây là...").

CẤU TRÚC ĐAN XEN THEO TIẾN TRÌNH KỂ CHUYỆN:
- Đoạn 1 (type="narration"): Đặt vấn đề bằng một câu Hook nhức nhối để giữ chân người xem (Không hiện Card).
- Đoạn 2 (type="narration"): Câu dẫn dắt giới thiệu câu chuyện.
- Đoạn 3 (type="post"): Lời tự sự trực tiếp của bài gốc (Xưng "Mình", "Tôi").
- Đoạn 4 (type="narration"): Lời bình luận ngắn của biên kịch để chuyển mạch sang cụm giải pháp tài chính.
- Đoạn 5 & 6 (Liên tiếp các thẻ type="comment"): Các góc nhìn thực tế từ các bình luận (Giữ văn phong NGÔI THỨ NHẤT "Mình", "Tôi").
- Đoạn 7 (type="narration"): PHÂN TÍCH CHUYÊN SÂU cụm giải pháp trên bằng góc nhìn của người dẫn chuyện để đúc kết bản chất vấn đề.
- Đoạn 8 & 9 (Liên tiếp các thẻ type="comment"): Các tư duy đường dài tiếp theo (Vẫn giữ văn phong NGÔI THỨ NHẤT "Mình", "Tôi").
- Đoạn 10 (type="narration"): PHÂN TÍCH CHUYÊN SÂU cụm tư duy này, lồng ghép thực tế về áp lực/stress để tạo tính phản biện.
- Đoạn 11 (type="narration"): KẾT BÀI bằng một lời khuyên triết lý, đúc kết tư duy đắt giá làm thông suốt tư tưởng người nghe.

QUY ĐỊNH THUỘC TÍNH THẺ CHUNK Y HỆT TRƯỚC ĐÓ:
<CHUNK type="post|comment|narration" author="Tên tác giả nếu có" keyword="Từ khóa tiếng Anh tìm video nền">Nội dung lời thoại</CHUNK>

Hãy xuất kịch bản đỉnh cao ngay bây giờ:`;

    const fullPrompt = `${aiInputContext}\n===\n${promptInstructions}`;
    const rawScriptOutput = await aiService.askHuggingFace(fullPrompt);

    console.log('================================================================');
    console.log('🔥 KẾT QUẢ KỊCH BẢN <CHUNK> ĐẦU RA TỪ AI');
    console.log('================================================================');
    console.log(rawScriptOutput);
    console.log('================================================================\n');

    expect(rawScriptOutput).toBeDefined();

    logger.log('🎙️ BƯỚC 3: MÔ PHỎNG HẬU KỲ ÂM THANH (AUDIO WORKFLOW)...');
    
    const chunks: any[] = [];
    const regex = /<CHUNK\s+type="(.*?)"(.*?)(?:\s+keyword="(.*?)")?>([\s\S]*?)<\/CHUNK>/g;
    let match;
    
    while ((match = regex.exec(rawScriptOutput)) !== null) {
      chunks.push({
        type: match[1],
        keyword: match[3] || 'none',
        text: match[4].trim()
      });
    }

    console.log('================================================================');
    console.log('🔮 [LOG MÔ PHỎNG HẬU KỲ] - PHÂN VAI GIỌNG ĐỌC & ĐỊNH HƯỚNG VIDEO NỀN');
    console.log('================================================================');
    
    expect(chunks.length).toBeGreaterThan(0);

    chunks.forEach((chunk, index) => {
      console.log(`\n👉 PHÂN ĐOẠN SỐ ${index + 1}:`);
      console.log(`   - Nội dung lồng tiếng: "${chunk.text}"`);
      
      if (chunk.type === 'narration') {
        console.log(`   - 🎙️ Giọng đọc: [VIETNAMESE_MALE_NEWS] (Giọng nam Podcast trầm ấm, chuyên nghiệp, ẩn Card)`);
      } else if (chunk.type === 'post') {
        console.log(`   - 🎙️ Giọng đọc: [VIETNAMESE_FEMALE_SAD] (Giọng nữ tự sự, cảm xúc, HIỆN CARD BÀI GỐC)`);
      } else {
        console.log(`   - 🎙️ Giọng đọc: [VIETNAMESE_MALE_NARRATOR] (Giọng nhân vật đóng góp ý kiến, HIỆN CARD COMMENT)`);
      }

      console.log(`   - 🎬 Video nền (Giphy keyword): '${chunk.keyword}'`);
      
      const estimatedDuration = Math.ceil(chunk.text.length / 4);
      console.log(`   - ⏱️ Thời lượng ước tính: ~${estimatedDuration} giây`);
    });

    console.log('\n----------------------------------------------------------------');
    console.log('🔤 [LOG MÔ PHỎNG WHISPER] - CHẠY KHỚP TIẾN TRÌNH KARAOKE (MOCK TIMESTAMPS)');
    console.log('----------------------------------------------------------------');
    
    if (chunks.length > 0) {
      console.log(`1\n00:00:01,000 --> 00:00:04,500\n${chunks[0].text.substring(0, 30)}...`);
      console.log(`\n2\n00:00:04,600 --> 00:00:09,200\n${chunks[1] ? chunks[1].text.substring(0, 30) : '...'}...`);
    }
    
    console.log('================================================================\n');
    logger.log('✅ KIỂM TRA TOÀN BỘ LUỒNG HẬU KỲ ÂM THANH HOÀN TẤT VÀ THÀNH CÔNG!');
  }, 120000);
});