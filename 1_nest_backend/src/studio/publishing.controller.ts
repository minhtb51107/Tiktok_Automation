import {
  Controller,
  Get,
  Post,
  Put,
  Param,
  Body,
  Headers,
  Req,
  Res,
  Query,
  ForbiddenException,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { PublishingService } from './publishing.service';
@Controller('api/studio')
export class PublishingController {
  constructor(private publishing: PublishingService) {}
  private origin(origin?: string) {
    let configured = '';
    try {
      configured = new URL(process.env.TIKTOK_REDIRECT_URI || '').origin;
    } catch {}
    if (
      origin &&
      !/^http:\/\/(localhost|127\.0\.0\.1):\d+$/.test(origin) &&
      origin !== configured
    )
      throw new ForbiddenException('Trusted Studio origin required');
  }
  @Get('tiktok/config') config() {
    return this.publishing.config();
  }
  @Get('tiktok/accounts') accounts() {
    return this.publishing.accounts();
  }
  @Post('tiktok/mock-accounts') mock(
    @Body() b: any,
    @Headers('origin') o?: string,
  ) {
    this.origin(o);
    return this.publishing.createMock(b);
  }
  @Post('tiktok/accounts/:id/creator-info') creator(
    @Param('id') id: string,
    @Headers('origin') o?: string,
  ) {
    this.origin(o);
    return this.publishing.creator(id);
  }
  @Post('tiktok/accounts/:id/:action') action(
    @Param('id') id: string,
    @Param('action') action: string,
    @Headers('origin') o?: string,
  ) {
    this.origin(o);
    return this.publishing.accountAction(id, action);
  }
  @Post('tiktok/oauth/start') async start(
    @Body() b: any,
    @Headers('origin') o: string,
    @Res() res: Response,
  ) {
    this.origin(o);
    const out = await this.publishing.beginOAuth(b, o);
    res.cookie('studio_tiktok_state', out.binding, {
      httpOnly: true,
      sameSite: 'lax',
      secure: true,
      maxAge: 600000,
      path: '/api/studio/tiktok/oauth',
    });
    return res.json({ success: true, data: { url: out.url } });
  }
  @Get('tiktok/oauth/callback') async callback(
    @Query('code') code: string,
    @Query('state') state: string,
    @Req() req: Request,
    @Res() res: Response,
  ) {
    const binding =
      String(req.headers.cookie || '').match(
        /(?:^|;)\s*studio_tiktok_state=([a-f0-9]+)/,
      )?.[1] || '';
    try {
      const out = await this.publishing.callback(code, state, binding);
      res.clearCookie('studio_tiktok_state', {
        path: '/api/studio/tiktok/oauth',
      });
      return res.redirect('/studio?session=' + out.sessionId + '&step=Publish');
    } catch {
      res.clearCookie('studio_tiktok_state', {
        path: '/api/studio/tiktok/oauth',
      });
      return res
        .status(400)
        .send(
          'BLOCKED_AUTH: OAuth failed or expired. Return to Studio and reconnect.',
        );
    }
  }
  @Get('sessions/:id/publishing') overview(@Param('id') id: string) {
    return this.publishing.overview(id);
  }
  @Put('sessions/:id/publishing/draft') draft(
    @Param('id') id: string,
    @Body() b: any,
    @Headers('origin') o?: string,
  ) {
    this.origin(o);
    return this.publishing.saveDraft(id, b);
  }
  @Post('sessions/:id/publishing/rights') rights(
    @Param('id') id: string,
    @Body() b: any,
    @Headers('origin') o?: string,
  ) {
    this.origin(o);
    return this.publishing.rights(id, b);
  }
  @Post('sessions/:id/publishing/validate') validate(
    @Param('id') id: string,
    @Body() b: any,
    @Headers('origin') o?: string,
  ) {
    this.origin(o);
    return this.publishing.validate(id, b);
  }
  @Post('sessions/:id/publishing/consent') consent(
    @Param('id') id: string,
    @Body() b: any,
    @Headers('origin') o?: string,
  ) {
    this.origin(o);
    return this.publishing.consent(id, b);
  }
  @Post('sessions/:id/publishing/submit') submit(
    @Param('id') id: string,
    @Body() b: any,
    @Headers('origin') o?: string,
  ) {
    this.origin(o);
    return this.publishing.submit(id, b);
  }
  @Get('sessions/:id/publishing/jobs/:jobId') status(
    @Param('id') id: string,
    @Param('jobId') job: string,
  ) {
    return this.publishing.status(id, job);
  }
}
