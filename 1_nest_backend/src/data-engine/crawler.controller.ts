import {
  Controller,
  Injectable,
  Get,
  Post,
  Param,
  Body,
  Headers,
  Query,
  BadRequestException,
  ConflictException,
  ForbiddenException,
} from '@nestjs/common';
import { DataStudioService } from './data.controller';
import { ScraperService } from '../modules/core/scraper/scraper.service';
import { PublicCrawlerConsumer } from './crawler-consumer';
import { GoldShadowEngine } from './gold-shadow';
import { DISCOVERY_TOPICS, GOLD_V2, topic } from './gold-v2';
@Injectable()
export class CrawlerStudioService {
  readonly consumer: PublicCrawlerConsumer;
  readonly shadow: GoldShadowEngine;
  constructor(
    private data: DataStudioService,
    scraper: ScraperService,
  ) {
    this.consumer = new PublicCrawlerConsumer(data.engine, scraper);
    this.shadow = new GoldShadowEngine(data.engine);
  }
  start(body: unknown) {
    return this.data.studio.withControlledCollection(() =>
      this.consumer.start(body),
    );
  }
  resume(id: string) {
    return this.data.studio.withControlledCollection(() =>
      this.consumer.resume(id),
    );
  }
  evaluate(body:any) {
    return this.data.studio.withControlledCollection(()=>this.shadow.evaluate(body?.postId,body?.evaluationId,topic(body?.topic)));
  }
  feedback(id:string,body:any) {
    return this.data.studio.withControlledCollection(()=>this.shadow.feedback(id,body));
  }
}
@Controller('api/studio/data/crawler')
export class CrawlerController {
  constructor(private service: CrawlerStudioService) {}
  private origin(o?: string) {
    if (o && !/^http:\/\/(localhost|127\.0\.0\.1):\d+$/.test(o))
      throw new ForbiddenException('Local Studio operation required');
  }
  private async call<T>(fn: () => Promise<T>) {
    try {
      return await fn();
    } catch (e: any) {
      if (e instanceof ConflictException)
        throw new ConflictException('CRAWLER_RESOURCE_BUSY');
      const code = /^CRAWLER_[A-Z0-9_]+$/.test(e.message || '')
        ? e.message
        : 'CRAWLER_OPERATION_FAILED';
      if (/BUSY|CONFLICT|STALE_REVISION/.test(code)) throw new ConflictException(code);
      throw new BadRequestException(code);
    }
  }
  @Get('runs') list() {
    return this.call(() => this.service.consumer.list());
  }
  @Get('options') options() {
    return {topics:DISCOVERY_TOPICS,defaultLimit:2,maxLimit:2,browserWorkers:1,schedulerEnabled:false,goldVersion:GOLD_V2.version};
  }
  @Get('quality') quality(@Query('topic') t?:string,@Query('page') p?:string,@Query('bucket') b?:string) {
    return this.call(()=>this.service.shadow.list(t,Number(p||0),b));
  }
  @Get('quality/metrics') metrics(@Query('topic') t?:string) {
    return this.call(()=>this.service.shadow.metrics(t));
  }
  @Get('quality/:id') shadow(@Param('id') id:string) {
    return this.call(async()=>({snapshot:await this.service.shadow.get(id),feedback:await this.service.shadow.feedbackHistory(id)}));
  }
  @Post('quality/evaluate') evaluate(@Body() b:any,@Headers('origin') o?:string) {
    this.origin(o);
    return this.call(()=>this.service.evaluate(b));
  }
  @Post('quality/:id/feedback') feedback(@Param('id') id:string,@Body() b:any,@Headers('origin') o?:string) {
    this.origin(o);
    return this.call(()=>this.service.feedback(id,b));
  }
  @Get('runs/:id') get(@Param('id') id: string) {
    return this.call(() => this.service.consumer.get(id));
  }
  @Get('runs/:id/report') report(@Param('id') id: string) {
    return this.call(() => this.service.consumer.report(id));
  }
  @Post('runs') start(@Body() b: any, @Headers('origin') o?: string) {
    this.origin(o);
    return this.call(() => this.service.start(b));
  }
  @Post('runs/:id/resume') resume(
    @Param('id') id: string,
    @Headers('origin') o?: string,
  ) {
    this.origin(o);
    return this.call(() => this.service.resume(id));
  }
  @Get('schedule') schedule() {
    return {
      legacyCron: '0 */15 * * * *',
      enabled: false,
      automaticTriggerSupported: false,
      reason:
        'Pilot and explicit scheduling approval required; legacy Hunter/Discord/Prisma are not imported',
    };
  }
}
