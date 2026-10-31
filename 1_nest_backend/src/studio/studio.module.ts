import { Module } from '@nestjs/common';
import { StudioController } from './studio.controller';
import { StudioService } from './studio.service';
import { ScraperService } from '../modules/core/scraper/scraper.service';

@Module({
  controllers: [StudioController],
  providers: [StudioService, ScraperService],
})
export class StudioModule {}
