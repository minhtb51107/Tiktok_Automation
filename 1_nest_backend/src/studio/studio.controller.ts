import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Put,
  Res,
  Headers,
  ForbiddenException,
} from '@nestjs/common';
import type { Response } from 'express';
import * as path from 'path';
import { StudioService } from './studio.service';

@Controller()
export class StudioController {
  constructor(private readonly studio: StudioService) {}
  private check(origin?: string) {
    if (origin && !/^http:\/\/(127\.0\.0\.1|localhost):\d+$/.test(origin))
      throw new ForbiddenException('Local origin required');
  }
  @Get('studio') page(@Res() res: Response) {
    return res.sendFile(path.resolve('../2_Remotion_Video/studio/index.html'));
  }
  @Get('studio/app.js') js(@Res() res: Response) {
    return res.sendFile(path.resolve('../2_Remotion_Video/studio-dist/app.js'));
  }
  @Get('studio/app.css') css(@Res() res: Response) {
    return res.sendFile(
      path.resolve('../2_Remotion_Video/studio-dist/app.css'),
    );
  }
  @Get('api/studio/sessions') list() {
    return this.studio.list();
  }
  @Post('api/studio/sessions') create(@Headers('origin') origin?: string) {
    this.check(origin);
    return this.studio.create();
  }
  @Get('api/studio/sessions/:id') load(@Param('id') id: string) {
    return this.studio.load(id);
  }
  @Get('api/studio/sessions/:id/report') report(@Param('id') id: string) {
    return this.studio.report(id);
  }
  @Post('api/studio/sessions/:id/exact-copy') exactCopy(
    @Param('id') id: string,
    @Headers('origin') origin?: string,
  ) {
    this.check(origin);
    return this.studio.exactCopy(id);
  }
  @Put('api/studio/sessions/:id') save(
    @Param('id') id: string,
    @Body() body: unknown,
    @Headers('origin') origin?: string,
  ) {
    this.check(origin);
    return this.studio.mutate(id, body);
  }
  @Post('api/studio/sessions/:id/fetch') fetch(
    @Param('id') id: string,
    @Body() body: unknown,
    @Headers('origin') origin?: string,
  ) {
    this.check(origin);
    return this.studio.mutate(id, body, true);
  }
}
