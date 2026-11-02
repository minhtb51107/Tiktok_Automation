import {DataController,DataStudioService} from '../data-engine/data.controller';
import { Module } from '@nestjs/common';
import { StudioController } from './studio.controller';
import { StudioService } from './studio.service';
import { ScraperService } from '../modules/core/scraper/scraper.service';
import {PublishingService} from './publishing.service';
import {PublishingController} from './publishing.controller';

@Module({
  controllers: [StudioController,PublishingController,DataController],
  providers: [StudioService, ScraperService,PublishingService,DataStudioService],
})
export class StudioModule {}
