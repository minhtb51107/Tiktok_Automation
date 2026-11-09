import {
  Injectable,
  Controller,
  Get,
  Post,
  Body,
  Param,
  Headers,
  Req,
  Res,
  BadRequestException,
  ForbiddenException,
  Query,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { DataStudioService } from '../data-engine/data.controller';
import { ThreadsAuth } from './auth';
import { ThreadsCollector } from './collector';
import { DiscoveryScheduler } from './scheduler';
import { redirectUrl, threadsConfig } from './config';
import { OAuthFailure } from './oauth-diagnostics';
@Injectable()
export class ThreadsDiscoveryService {
  readonly auth = new ThreadsAuth();
  readonly collector: ThreadsCollector;
  readonly scheduler: DiscoveryScheduler;
  constructor(private data: DataStudioService) {
    this.collector = new ThreadsCollector(data.engine, this.auth);
    this.scheduler = new DiscoveryScheduler(this.collector);
  }
  start(body:any){return this.data.studio.withControlledCollection(()=>this.collector.start(body));}
  resume(id:string){return this.data.studio.withControlledCollection(()=>this.collector.resume(id));}
}
@Controller('api/studio/threads')
export class ThreadsController {
  constructor(private svc: ThreadsDiscoveryService) {}
  private origin(o?: string) {
    if (o && !/^http:\/\/(127\.0\.0\.1|localhost):\d+$/.test(o))
      throw new ForbiddenException('Local Studio operation required');
  }
  private async call<T>(fn: () => Promise<T>) {
    try {
      return await fn();
    } catch (e) {
      throw new BadRequestException((e as Error).message);
    }
  }
  @Get('auth/status') status() {
    return this.call(() => this.svc.auth.status());
  }
  @Get('auth/diagnostics') diagnostics() {
    return this.call(() => this.svc.auth.store.read('auth/last-attempt.json'));
  }
  @Post('auth/recover') recover(@Headers('origin') o?: string) {
    this.origin(o);
    if (this.svc.collector.isActive())
      throw new BadRequestException('COLLECTOR_BUSY');
    return this.call(() => this.svc.auth.recover());
  }
  @Post('auth/verify') verify(@Headers('origin') o?: string) {
    this.origin(o);
    if (this.svc.collector.isActive())
      throw new BadRequestException('COLLECTOR_BUSY');
    return this.call(() => this.svc.auth.verify());
  }
  @Get('oauth/login') async login(@Req() req: Request, @Res() res: Response) {
    try {
      const out = await this.svc.auth.begin(req.headers.host || '');
      res.cookie('studio_threads_state', out.binding, {
        httpOnly: true,
        secure: true,
        sameSite: 'lax',
        maxAge: 600000,
        path: '/api/studio/threads/oauth',
      });
      res.setHeader('Cache-Control', 'no-store');
      res.setHeader('Referrer-Policy', 'no-referrer');
      return res.redirect(out.url);
    } catch {
      return res
        .status(400)
        .send(
          'BLOCKED_AUTH: configure app credentials and registered HTTPS callback, then open login on that HTTPS domain.',
        );
    }
  }
  @Get('oauth/callback') async callback(
    @Query('code') code: string,
    @Query('state') state: string,
    @Req() req: Request,
    @Res() res: Response,
  ) {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.clearCookie('studio_threads_state', {
      secure: true,
      sameSite: 'lax',
      path: '/api/studio/threads/oauth',
    });
    const cookie =
      String(req.headers.cookie || '').match(
        /(?:^|;)\s*studio_threads_state=([a-f0-9]{64})/,
      )?.[1] || '';
    try {
      if (req.headers.host !== redirectUrl(threadsConfig().redirectUri).host)
        throw Error('Host mismatch');
      if (this.svc.collector.isActive()) throw Error('Collector busy');
      const out = await this.svc.auth.callback(code, state, cookie);
      return res.send(
        'Threads authorization processed: ' +
          out.status +
          '. Close this window and check the local auth/status endpoint. No collection or publishing was started.',
      );
    } catch (e) {
      return res
        .status(400)
        .send(
          e instanceof OAuthFailure
            ? e.message +
                '. No credentials are returned. Inspect local /api/studio/threads/auth/diagnostics.'
            : 'BLOCKED_AUTH: OAUTH_CALLBACK_REJECTED. No token is returned. Inspect the local diagnostics endpoint before starting a new login.',
        );
    }
  }
  @Get('collector/runs') runs() {
    return this.call(() => this.svc.collector.list());
  }
  @Get('collector/runs/:id') run(@Param('id') id: string) {
    return this.call(() => this.svc.collector.get(id));
  }
  @Post('collector/runs') start(@Body() b: any, @Headers('origin') o?: string) {
    this.origin(o);
    return this.call(() => this.svc.start(b));
  }
  @Post('collector/runs/:id/resume') resume(
    @Param('id') id: string,
    @Headers('origin') o?: string,
  ) {
    this.origin(o);
    return this.call(() => this.svc.resume(id));
  }
  @Get('scheduler') scheduler() {
    return this.call(() => this.svc.scheduler.status());
  }
  @Post('scheduler/configure') configure(
    @Body() b: any,
    @Headers('origin') o?: string,
  ) {
    this.origin(o);
    return this.call(() => this.svc.scheduler.configure(b));
  }
  @Post('scheduler/pause') pause(@Headers('origin') o?: string) {
    this.origin(o);
    return this.call(() => this.svc.scheduler.pause());
  }
  @Post('scheduler/resume') unpause(@Headers('origin') o?: string) {
    this.origin(o);
    return this.call(() => this.svc.scheduler.resume());
  }
  @Post('scheduler/acknowledge-block') ack(@Headers('origin') o?: string) {
    this.origin(o);
    return this.call(() => this.svc.scheduler.acknowledgeBlock());
  }
  @Post('scheduler/tick') tick(@Headers('origin') o?: string) {
    this.origin(o);
    return this.call(() => this.svc.scheduler.tick());
  }
}
