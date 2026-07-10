import { Test, TestingModule } from '@nestjs/testing';
import { ThreadsSeriousService } from './threads-serious.service';
import { ScraperService } from '../../core/scraper/scraper.service';
import { AiModule } from '../../core/ai/ai.module';
import { RemotionRunnerModule } from '../../remotion-runner/remotion-runner.module';
import { WhisperModule } from '../../whisper/whisper.module';
import { TtsService } from '../../core/tts/tts.service';
import { PrismaModule } from '../../../prisma/prisma.module';
import { Logger } from '@nestjs/common';
import { describe, beforeAll, it, expect } from '@jest/globals';
import { AiService } from '../../core/ai/ai.service';

describe('--- MÔ PHỎNG KIỂM TRA LUỒNG THREADS SERIOUS ---', () => {
let service: ThreadsSeriousService;
let scraperService: ScraperService;
let aiService: AiService;
const logger = new Logger('TestSeriousFlow');

// MẢNG CHỨA CÁC URL BÀI VIẾT LƯƠNG 50M TRÊN THREADS
const MOCK_THREADS_URLS = [
'https://www.threads.com/@elisee.ph/post/DTxXggckj6p', // Bài 1: Đóng băng 12h làm gì?
'https://www.threads.com/@austindox/post/DTx_u5eEwGm', // Bài 2: Sếp có thể bỏ thêm các link cùng chủ đề vào đây
'https://www.threads.com/@cassandrale179/post/DTyDv5Gj610',
'https://www.threads.com/@quynhgiangg/post/DTx1mh3CQdK',
'https://www.threads.com/@hoangfotu/post/DTxYk59DPX6',
'https://www.threads.com/@kaicongchua311/post/DTxgnfLEp63'
];

beforeAll(async () => {
const module: TestingModule = await Test.createTestingModule({
imports: [
PrismaModule,
AiModule,
RemotionRunnerModule,
WhisperModule,
],
providers: [
ThreadsSeriousService,
ScraperService,
TtsService,
],
}).compile();

service = module.get<ThreadsSeriousService>(ThreadsSeriousService);
scraperService = module.get<ScraperService>(ScraperService);
aiService = module.get<AiService>(AiService);
});

it('MÔ PHỎNG THỰC TẾ: HUGGING FACE TÁCH BIỆT CARD GỐC VÀ LỜI AI ĐỌC', async () => {
logger.log(`================================================================`);
logger.log(`🚀 BƯỚC 1: Tiến hành cào dữ liệu từ các URL bài viết...`);
logger.log(`================================================================`);

const scrapedResults = await Promise.all(
MOCK_THREADS_URLS.map(async (url) => {
try {
return await scraperService.scrapeThreadsUrl(url);
} catch (err: any) {
logger.error(`Lỗi cào URL ${url}: ${err.message}`);
return null;
}
})
);

const validData = scrapedResults.filter((item): item is NonNullable<typeof item> => !!item);
// Giả lập gom thêm dữ liệu mẫu từ các nguồn khác để AI có tư liệu xào nấu đa dạng đúng thực tế
const compiledData = [
...validData,
{
post: {
author: "austindox",
text: "Hồi mình còn làm văn phòng 9-5 (từ 2016 - 2021) thu nhập của mình hàng tháng là 80 - 120M. Thì sẽ có 3 nguồn: (1) làm office cho trang tin điện tử ~12-16M/agency ~15-20M cứng (2) viết bài freelance cho các báo nhận tầm 8 bài ~15M (3) nhận booking PR trên Blog cá nhân ~50-70M. Mình mất tầm 2 năm để đạt được mức này vì may mắn + có career path rõ ràng."
}
}
];

logger.log(`================================================================`);
logger.log(`🤖 BƯỚC 2: Đẩy sang Hugging Face bóc tách cấu trúc JSON...`);
logger.log(`================================================================`);

// Gộp toàn bộ bài viết gốc làm tư liệu thô cho AI
let aiInputContext = `DƯỚI ĐÂY LÀ NỘI DUNG CÁC BÀI VIẾT GỐC CÀO ĐƯỢC:\n\n`;
compiledData.forEach((data, index) => {
aiInputContext += `[BÀI VIẾT SỐ ${index + 1}]\nTác giả: ${data.post.author}\nNội dung gốc: "${data.post.text}"\n\n`;
});

const promptInstructions = `
Bạn là một chuyên gia biên kịch video TikTok. Nhiệm vụ của bạn là đọc các bài viết gốc ở trên, giữ nguyên thông tin gốc để làm Card, nhưng phải VIẾT LẠI một lời thoại ngắn gọn, cô đọng và thâm thúy nhất (aiVoiceoverText) để AI đọc thành tiếng (Voiceover).

⚠️ YÊU CẦU BẮT BUỘC: Bạn chỉ được trả về DUY NHẤT một Object JSON hợp lệ. Không giải thích, không bọc trong ký tự markdown \`\`\`json.

ĐỊNH DẠNG JSON PHẢI CHÍNH XÁC NHƯ SAU:
{
"songTitle": "Tiêu đề tuyển tập tổng hợp",
"chunks": [
{
"commentInfo": {
"author": "Tên tác giả gốc của bài viết đó",
"text": "BẮT BUỘC GIỮ NGUYÊN TOÀN BỘ nội dung gốc không được cắt bớt của bài viết đó để làm Card"
},
"aiVoiceoverText": "Lời thoại ngắn gọn, cốt lõi, thâm thúy do bạn tự biên soạn dựa trên bài viết đó để AI đọc",
"gifKeyword": "Từ khóa tiếng Anh ngắn gọn phù hợp để tìm video nền (ví dụ: 'stress', 'money', 'office')"
}
]
}
`;

const fullPrompt = `${aiInputContext}\n===\n${promptInstructions}`;

// Gọi Hugging Face xử lý dữ liệu và ép kiểu 'data' để nhận JSON sạch
const rawScriptOutput = await aiService.askHuggingFace(fullPrompt);

console.log('\n🔥 [KẾT QUẢ THỰC TẾ TRẢ VỀ TỪ HUGGING FACEHub]:');
console.log(rawScriptOutput);

// Kiểm tra tính hợp lệ của cấu trúc JSON trả về
expect(rawScriptOutput).toBeDefined();
expect(rawScriptOutput).toContain('aiVoiceoverText');
expect(rawScriptOutput).toContain('commentInfo');

logger.log(`================================================================`);
logger.log(`✅ TEST THÀNH CÔNG! ĐÃ XÁC THỰC CẤU TRÚC ĐÚNG Ý SẾP.`);
logger.log(`================================================================`);
}, 120000);
});