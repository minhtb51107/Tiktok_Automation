import { Module } from '@nestjs/common';
import { StudioController } from './studio.controller';
import { StudioService } from './studio.service';
import { ScraperService } from '../modules/core/scraper/scraper.service';
import {PublishingService} from './publishing.service';
import {PublishingController} from './publishing.controller';

@Module({
  controllers: [StudioController,PublishingController],
  providers: [StudioService, ScraperService,PublishingService],
})
export class StudioModule {}
