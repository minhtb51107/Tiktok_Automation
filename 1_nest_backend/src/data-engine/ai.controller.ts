import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  ForbiddenException,
  Get,
  Headers,
  Injectable,
  Param,
  Post,
} from '@nestjs/common';
import { DataStudioService } from './data.controller';
import { ConversationStudioService } from './conversation.controller';
import { AiContentEvaluator, AiResearchAgent } from './ai-content';
import { HuggingFaceContentProvider } from './ai-provider';

@Injectable()
export class AiContentStudioService {
  readonly provider = new HuggingFaceContentProvider();
  readonly evaluator: AiContentEvaluator;
  readonly agent: AiResearchAgent;
  constructor(
    readonly data: DataStudioService,
    readonly conversations: ConversationStudioService,
  ) {
    this.evaluator = new AiContentEvaluator(data.engine, this.provider);
    this.agent = new AiResearchAgent(
      data.engine,
      conversations.engine,
      this.evaluator,
      this.provider,
    );
  }
  status() {
    return {
      version: 'ai-content/1',
      provider: 'HUGGING_FACE',
      config: this.provider.config(),
      liveCalls: 'EXPLICIT_ONLY',
      automaticFallback: false,
      toolMode: 'DETERMINISTIC_ORCHESTRATION_V1',
      approvals: 'UNCHANGED',
      scheduler: 'OFF',
    };
  }
  async health() {
    const start = Date.now();
    try {
      const response = await this.provider.completeJson({
        system: 'Return exactly one JSON object with boolean key ok. No prose.',
        input: { task: 'health_check' },
        maxTokens: 24,
        temperature: 0,
      });
      const parsed = JSON.parse(
        response.content
          .trim()
          .replace(/^```(?:json)?\s*/i, '')
          .replace(/\s*```$/, ''),
      );
      if (parsed?.ok !== true) throw Error('AI_HEALTH_SCHEMA_INVALID');
      return {
        status: 'READY',
        provider: response.provider,
        model: response.model,
        route: response.providerRoute,
        latencyMs: response.latencyMs,
        usage: response.usage,
        estimatedCostUsd: response.usage.estimatedCostUsd,
        checkedAt: new Date().toISOString(),
      };
    } catch (e: any) {
      return {
        status:
          e.message === 'AI_BLOCKED_BILLING'
            ? 'BLOCKED_BILLING'
            : e.message === 'AI_BLOCKED_AUTH'
              ? 'BLOCKED_AUTH'
              : e.message === 'AI_RATE_LIMITED'
                ? 'RATE_LIMITED'
                : 'FAILED',
        provider: 'HUGGING_FACE',
        model: this.provider.config().model,
        route: this.provider.config().provider,
        latencyMs: Date.now() - start,
        usage: null,
        estimatedCostUsd: null,
        error: /^AI_[A-Z0-9_]+$/.test(e.message)
          ? e.message
          : 'AI_HEALTH_FAILED',
        checkedAt: new Date().toISOString(),
      };
    }
  }
  async evaluate(id: string, body: any) {
    if (!body || body.confirmLive !== true || body.style !== 'SERIOUS')
      throw Error(
        body?.style === 'FUNNY'
          ? 'AI_FUNNY_LEGACY_DISABLED'
          : 'AI_EXPLICIT_LIVE_CONFIRMATION_REQUIRED',
      );
    const record = await this.conversations.engine.collection(id);
    return this.evaluator.evaluate({
      collectionId: id,
      collection: record.collection,
      style: body.style,
      heuristic: record.evaluation,
    });
  }
}

@Controller('api/studio/data/ai')
export class AiContentController {
  constructor(private service: AiContentStudioService) {}
  private origin(value?: string) {
    if (value && !/^http:\/\/(127\.0\.0\.1|localhost):\d+$/.test(value))
      throw new ForbiddenException('AI_LOCAL_STUDIO_ONLY');
  }
  private async call<T>(fn: () => Promise<T>) {
    try {
      return await fn();
    } catch (e: any) {
      const code = /^AI_[A-Z0-9_]+$/.test(e.message || '')
        ? e.message
        : 'AI_OPERATION_FAILED';
      if (/CONFLICT|BUDGET/.test(code)) throw new ConflictException(code);
      throw new BadRequestException(code);
    }
  }
  @Get('status') status() {
    return this.service.status();
  }
  @Post('health') health(
    @Body() body: any,
    @Headers('origin') origin?: string,
  ) {
    this.origin(origin);
    if (body?.confirmLive !== true)
      throw new BadRequestException('AI_EXPLICIT_LIVE_CONFIRMATION_REQUIRED');
    return this.call(() => this.service.health());
  }
  @Get('assessments') assessments() {
    return this.call(() => this.service.evaluator.list());
  }
  @Get('assessments/:id') assessment(@Param('id') id: string) {
    return this.call(() => this.service.evaluator.get(id));
  }
  @Post('collections/:id/evaluate') evaluate(
    @Param('id') id: string,
    @Body() body: any,
    @Headers('origin') origin?: string,
  ) {
    this.origin(origin);
    return this.call(() => this.service.evaluate(id, body));
  }
  @Get('agent/runs') runs() {
    return this.call(() => this.service.agent.list());
  }
  @Get('agent/runs/:id') run(@Param('id') id: string) {
    return this.call(() => this.service.agent.get(id));
  }
  @Post('agent/runs') agent(
    @Body() body: any,
    @Headers('origin') origin?: string,
  ) {
    this.origin(origin);
    if (body?.confirmLive !== true)
      throw new BadRequestException('AI_EXPLICIT_LIVE_CONFIRMATION_REQUIRED');
    return this.call(() => this.service.agent.run(body));
  }
  @Post('agent/runs/:id/cancel') cancel(
    @Param('id') id: string,
    @Headers('origin') origin?: string,
  ) {
    this.origin(origin);
    return this.call(() => this.service.agent.cancel(id));
  }
}
