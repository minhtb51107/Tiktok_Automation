import {
  Controller,
  Injectable,
  Get,
  Post,
  Param,
  Body,
  Headers,
  BadRequestException,
  ConflictException,
  ForbiddenException,
} from '@nestjs/common';
import { DataStudioService } from './data.controller';
import { ScraperService } from '../modules/core/scraper/scraper.service';
import { PublicCrawlerConsumer } from './crawler-consumer';
@Injectable()
export class CrawlerStudioService {
  readonly consumer: PublicCrawlerConsumer;
  constructor(
    private data: DataStudioService,
    scraper: ScraperService,
  ) {
    this.consumer = new PublicCrawlerConsumer(data.engine, scraper);
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
      if (/BUSY|CONFLICT/.test(code)) throw new ConflictException(code);
      throw new BadRequestException(code);
    }
  }
  @Get('runs') list() {
    return this.call(() => this.service.consumer.list());
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
