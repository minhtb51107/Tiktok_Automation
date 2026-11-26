import {AutomationDiscordAdapter} from './automation-discord';
import {AutomationController} from './automation.controller';
import {AutomationService} from './automation.service';
import {AutomationStore} from './automation.store';
import {AutomationReviewService} from './automation-review.service';
import {StudioOperations,StudioOperationsController} from './studio-operations';
import {ContentQualityController,ContentQualityService} from '../data-engine/content-quality.controller';
import {ThreadsController,ThreadsDiscoveryService} from '../threads-api/controller';
import {EditorialController,EditorialStudioService} from '../data-engine/editorial.controller';
import {ConversationController,ConversationStudioService} from '../data-engine/conversation.controller';
import {CrawlerController,CrawlerStudioService} from '../data-engine/crawler.controller';
import {DataController,DataStudioService} from '../data-engine/data.controller';
import { Module } from '@nestjs/common';
import { StudioController } from './studio.controller';
import { StudioService } from './studio.service';
import { ScraperService } from '../modules/core/scraper/scraper.service';
import {PublishingService} from './publishing.service';
import {PublishingController} from './publishing.controller';
import {AiContentController,AiContentStudioService} from '../data-engine/ai.controller';
import {ProductPipelineController} from './product-pipeline.controller';
import {ProductPipelineService} from './product-pipeline';
import {ProductionHarness, ProductionHarnessController} from './production-harness';

@Module({
  controllers: [AutomationController,ProductionHarnessController,ProductPipelineController,AiContentController,ContentQualityController,StudioOperationsController,StudioController,PublishingController,DataController,ThreadsController,CrawlerController,ConversationController,EditorialController],
  providers: [AutomationDiscordAdapter,AutomationService,AutomationStore,AutomationReviewService,ProductionHarness,ProductPipelineService,AiContentStudioService,ContentQualityService,StudioOperations,StudioService, ScraperService,PublishingService,DataStudioService,ThreadsDiscoveryService,CrawlerStudioService,ConversationStudioService,EditorialStudioService],
})
export class StudioModule {}
