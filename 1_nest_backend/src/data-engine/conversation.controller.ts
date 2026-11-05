import {
  Controller,
  Get,
  Post,
  Param,
  Body,
  Headers,
  Injectable,
  ForbiddenException,
  BadRequestException,
  ConflictException,
} from '@nestjs/common';
import { DataStudioService } from './data.controller';
import { ConversationEngine } from './conversation-engine';
import {
  discoverConversations,
  enrichConversation,
} from './conversation-public';
@Injectable()
export class ConversationStudioService {
  readonly engine: ConversationEngine;
  constructor(readonly data: DataStudioService) {
    this.engine = new ConversationEngine(data.engine, {
      execution: 'LIVE',
      discover: discoverConversations,
      enrich: enrichConversation,
    });
  }
  live() {
    if (
      this.engine.provider.execution !== 'SYNTHETIC' &&
      process.env.STUDIO_DATA04_LIVE_ENABLED !== '1'
    )
      throw new ForbiddenException('CONVERSATION_LIVE_APPROVAL_REQUIRED');
  }
  start(body: unknown) {
    this.live();
    return this.data.studio.withControlledCollection(() =>
      this.engine.start(body),
    );
  }
  resume(id: string) {
    this.live();
    return this.data.studio.withControlledCollection(() =>
      this.engine.resume(id),
    );
  }
  feedback(id: string, body: unknown) {
    return this.data.studio.withControlledCollection(() =>
      this.engine.feedback(id, body),
    );
  }
}
@Controller('api/studio/data/conversations')
export class ConversationController {
  constructor(private service: ConversationStudioService) {}
  private origin(origin?: string) {
    if (origin && !/^http:\/\/(127\.0\.0\.1|localhost):\d+$/.test(origin))
      throw new ForbiddenException('Local Studio operation required');
  }
  private async call<T>(fn: () => Promise<T>) {
    try {
      return await fn();
    } catch (e: any) {
      if (e instanceof ForbiddenException) throw e;
      const code = /^CONVERSATION_[A-Z0-9_]+$/.test(e.message || '')
        ? e.message
        : 'CONVERSATION_OPERATION_FAILED';
      if (
        /BUSY|CONFLICT|STALE_REVISION/.test(code) ||
        e instanceof ConflictException
      )
        throw new ConflictException(code);
      throw new BadRequestException(code);
    }
  }
  @Get('options') options() {
    return {
      version: 'threads-conversation/1',
      syntheticEnabled: this.service.engine.provider.execution === 'SYNTHETIC',
      liveEnabled: process.env.STUDIO_DATA04_LIVE_ENABLED === '1',
      schedulerEnabled: false,
      maxCandidates: 6,
      maxRoots: 2,
      maxVerifiedReplies: 20,
      browserWorkers: 1,
      collectionCompleteness: 'PARTIAL_OR_UNKNOWN',
      approval:
        'Explicit LIVE pilot approval required before enabling runtime flag',
    };
  }
  @Get('runs') list() {
    return this.call(() => this.service.engine.list());
  }
  @Post('runs') start(@Body() b: unknown, @Headers('origin') o?: string) {
    this.origin(o);
    return this.call(() => this.service.start(b));
  }
  @Get('runs/:id') run(@Param('id') id: string) {
    return this.call(() => this.service.engine.get(id));
  }
  @Post('runs/:id/resume') resume(
    @Param('id') id: string,
    @Headers('origin') o?: string,
  ) {
    this.origin(o);
    return this.call(() => this.service.resume(id));
  }
  @Get('collections/:id') collection(@Param('id') id: string) {
    return this.call(async () => ({
      record: await this.service.engine.collection(id),
      review: await this.service.engine.review(id),
    }));
  }
  @Post('collections/:id/feedback') feedback(
    @Param('id') id: string,
    @Body() b: unknown,
    @Headers('origin') o?: string,
  ) {
    this.origin(o);
    return this.call(() => this.service.feedback(id, b));
  }
  @Get('collections/:id/bundle') bundle(@Param('id') id: string) {
    return this.call(() => this.service.engine.bundle(id));
  }
}
