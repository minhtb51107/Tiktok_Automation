import { Module } from '@nestjs/common';
import { ScraperService } from './scraper.service';

@Module({
  providers: [ScraperService],
  exports: [ScraperService], // 👈 Bắt buộc phải có dòng này để module khác dùng được
})
export class ScraperModule {}