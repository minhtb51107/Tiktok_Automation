import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  Param,
  Patch,
  Post,
  Req,
} from '@nestjs/common';
import { createHash, timingSafeEqual } from 'crypto';
import type { Request } from 'express';
import { AutomationService } from './automation.service';

@Controller('api/studio/automation')
export class AutomationController {
  constructor(readonly automation: AutomationService) {}
  private authorize(req: Request) {
    const configured = process.env.STUDIO_AUTOMATION_TOKEN ?? '';
    const hash = (text: string) => createHash('sha256').update(text).digest();
    if (
      process.env.STUDIO_OPERATOR_ONLY === '1' ||
      configured.length < 32 ||
      !['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(
        req.socket.remoteAddress ?? '',
      ) ||
      !timingSafeEqual(
        hash(req.get('authorization') ?? ''),
        hash('Bearer ' + configured),
      )
    )
      throw new ForbiddenException('AUTHORIZATION_REQUIRED');
  }
  @Get('status') status(@Req() req: Request) {
    this.authorize(req);
    return this.automation.status();
  }
  @Get('policy') policy(@Req() req: Request) {
    this.authorize(req);
    return this.automation.policy();
  }
  @Patch('policy') patch(@Req() req: Request, @Body() body: any) {
    this.authorize(req);
    return this.automation.configure(body, 'PATCH');
  }
  @Post('start') start(@Req() req: Request, @Body() body: any) {
    this.authorize(req);
    return this.automation.configure(body, 'START');
  }
  @Post('stop') stop(@Req() req: Request, @Body() body: any) {
    this.authorize(req);
    return this.automation.configure(body, 'STOP');
  }
  @Get('videos') videos(@Req() req: Request) {
    this.authorize(req);
    return this.automation.videos();
  }
  @Get('videos/:id') video(@Req() req: Request, @Param('id') id: string) {
    this.authorize(req);
    return this.automation.review.video(id);
  }
  @Post('videos/:id/approve') approve(
    @Req() req: Request,
    @Param('id') id: string,
    @Body() body: any,
  ) {
    this.authorize(req);
    return this.automation.decide(id, body, 'APPROVED');
  }
  @Post('videos/:id/reject') reject(
    @Req() req: Request,
    @Param('id') id: string,
    @Body() body: any,
  ) {
    this.authorize(req);
    return this.automation.decide(id, body, 'REJECTED');
  }
  @Post('videos/:id/revise') revise(
    @Req() req: Request,
    @Param('id') id: string,
    @Body() body: any,
  ) {
    this.authorize(req);
    return this.automation.revise(id, body);
  }
  @Get('reviews') reviews(@Req() req: Request) {
    this.authorize(req);
    return this.automation.reviews();
  }
  @Post('reviews/:id/resolve') resolve(
    @Req() req: Request,
    @Param('id') id: string,
    @Body() body: any,
  ) {
    this.authorize(req);
    return this.automation.resolve(id, body);
  }
  @Get('report') report(@Req() req: Request) {
    this.authorize(req);
    return this.automation.report();
  }
  @Get('videos/:id/versions/:version/artifact') artifact(
    @Req() req: Request,
    @Param('id') id: string,
    @Param('version') version: string,
  ) {
    this.authorize(req);
    return this.automation.artifact(id, Number(version));
  }
}
