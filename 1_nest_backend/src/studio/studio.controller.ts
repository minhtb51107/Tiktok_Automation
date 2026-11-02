import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Put,
  Res,
  Headers,
  Query,
  ForbiddenException,
  UseInterceptors,
  UploadedFile,
  Delete,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import * as path from 'path';
import { StudioService } from './studio.service';

@Controller()
export class StudioController {
  constructor(private readonly studio: StudioService) {}
  @Get('api/studio/sessions/:id/render') renderInfo(@Param('id') id:string){return this.studio.renderInfo(id);}
  @Get('api/studio/sessions/:id/renders/:jobId/manifest') renderManifest(@Param('id') id:string,@Param('jobId') job:string){return this.studio.renders.load(id,job);}
  @Get('api/studio/sessions/:id/renders/:jobId/video') async renderVideo(@Param('id') id:string,@Param('jobId') job:string,@Query('download') download:string,@Res() res:Response){
    const file=await this.studio.renders.output(id,job);
    res.setHeader('X-Content-Type-Options','nosniff');
    if(download==='1')res.attachment(`studio-${job}.mp4`);
    return res.sendFile(file,{dotfiles:'allow'});
  }
  @Get('api/studio/public-assets') publicInventory() {
    return this.studio.publicAssets.inventory();
  }
  @Get('api/studio/public-assets/:assetId/info') assetInfo(@Param('assetId') id:string){return this.studio.publicAssets.resolve(id);}
  @Get('api/studio/public-assets/:assetId') async publicAsset(
    @Param('assetId') id: string,
    @Res() res: Response,
  ) {
    const { file } = await this.studio.publicAssets.file(id);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    return res.sendFile(file);
  }
  @Post('api/studio/sessions/:id/topic/:itemId') topic(
    @Param('id') id: string,
    @Param('itemId') item: string,
    @Body() body: any,
    @Headers('origin') origin?: string,
  ) {
    this.check(origin);
    return this.studio.mapTopic(id, item, body);
  }
  @Delete('api/studio/sessions/:id/media/:assetId') deleteMedia(
    @Param('id') id: string,
    @Param('assetId') assetId: string,
    @Body() body: any,
    @Headers('origin') origin?: string,
  ) {
    this.check(origin);
    return this.studio.deleteMedia(id, assetId, body);
  }
  @Get('api/studio/sessions/:id/jobs') jobs(@Param('id') id: string) {
    return this.studio.jobs.list(id);
  }
  @Post('api/studio/sessions/:id/jobs') job(
    @Param('id') id: string,
    @Body() body: any,
    @Headers('origin') origin?: string,
  ) {
    this.check(origin);
    return this.studio.startJob(id, body);
  }
  @Get('api/studio/jobs/:jobId') getJob(@Param('jobId') id: string) {
    return this.studio.jobs.load(id);
  }
  @Post('api/studio/jobs/:jobId/cancel') cancelJob(
    @Param('jobId') id: string,
    @Headers('origin') origin?: string,
  ) {
    this.check(origin);
    return this.studio.jobs.cancel(id);
  }
  @Get('api/studio/sessions/:id/editor') editor(@Param('id') id: string) {
    return this.studio.editor(id);
  }
  @Put('api/studio/sessions/:id/editor') saveEditor(
    @Param('id') id: string,
    @Body() body: any,
    @Headers('origin') origin?: string,
  ) {
    this.check(origin);
    return this.studio.saveEditor(id, body);
  }
  @Post('api/studio/sessions/:id/editor/prepare') prepareEditor(
    @Param('id') id: string,
    @Body() body: any,
    @Headers('origin') origin?: string,
  ) {
    this.check(origin);
    return this.studio.preparePreview(id, body.revision);
  }
  @Get('api/studio/sessions/:id/editor/preview') preview(
    @Param('id') id: string,
  ) {
    return this.studio.preview(id);
  }
  @Post('api/studio/sessions/:id/media')
  @UseInterceptors(
    FileInterceptor('file', {
      limits: { fileSize: 50 * 1024 * 1024, files: 1 },
    }),
  )
  upload(
    @Param('id') id: string,
    @Body() body: any,
    @UploadedFile() file: any,
    @Headers('origin') origin?: string,
  ) {
    this.check(origin);
    return this.studio.uploadMediaJob(id, file, Number(body.revision),typeof body.requestId==='string'?body.requestId.slice(0,100):undefined,body.category||'UPLOADS');
  }
  @Put('api/studio/sessions/:id/media/:assetId/category') category(@Param('id') id:string,@Param('assetId') asset:string,@Body() body:any,@Headers('origin') origin?:string){this.check(origin);return this.studio.categoryMedia(id,asset,body);}
  @Get('api/studio/sessions/:id/media/:assetId') async media(
    @Param('id') id: string,
    @Param('assetId') assetId: string,
    @Res() res: Response,
  ) {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    return res.sendFile(await this.studio.mediaFile(id, assetId), {
      dotfiles: 'allow',
    });
  }
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
  @Get('api/studio/sessions/:id/report') report(
    @Param('id') id: string,
    @Query('stage') stage?: string,
  ) {
    return this.studio.report(id, stage);
  }
  @Post('api/studio/sessions/:id/script/:itemId/propose') propose(
    @Param('id') id: string,
    @Param('itemId') itemId: string,
    @Body() body: any,
    @Headers('origin') origin?: string,
  ) {
    this.check(origin);
    return this.studio.propose(
      id,
      itemId,
      body?.revision,
      body?.mode || 'LIVE',
    );
  }
  @Get('api/studio/sessions/:id/normalization-quality') quality(
    @Param('id') id: string,
  ) {
    return this.studio.normalizationQuality(id);
  }
  @Post('api/studio/sessions/:id/voice-runtime') runtime(
    @Param('id') id: string,
    @Headers('origin') origin?: string,
  ) {
    this.check(origin);
    return this.studio.runtime(id);
  }
  @Post('api/studio/sessions/:id/voice/:itemId') voice(
    @Param('id') id: string,
    @Param('itemId') itemId: string,
    @Body() body: any,
    @Headers('origin') origin?: string,
  ) {
    this.check(origin);
    return this.studio.voiceAction(id, itemId, body);
  }
  @Post('api/studio/sessions/:id/voice-batch') voiceBatch(
    @Param('id') id: string,
    @Body() body: any,
    @Headers('origin') origin?: string,
  ) {
    this.check(origin);
    return this.studio.voiceBatch(id, body);
  }
  @Post('api/studio/sessions/:id/script/propose-offline-all') proposeAll(
    @Param('id') id: string,
    @Body() body: any,
    @Headers('origin') origin?: string,
  ) {
    this.check(origin);
    return this.studio.proposeOfflineAll(id, body?.revision);
  }
  @Get('api/studio/sessions/:id/audio/:assetId') async audio(
    @Param('id') id: string,
    @Param('assetId') assetId: string,
    @Res() response: Response,
  ) {
    // The validated path lives under the dot-directory .studio-data.
    return response.sendFile(await this.studio.audioFile(id, assetId), {
      dotfiles: 'allow',
    });
  }
  @Get('api/studio/sessions/:id/voice-gc-preview') gc(@Param('id') id: string) {
    return this.studio.gcPreview(id);
  }
  @Post('api/studio/sessions/:id/script/decision') decide(
    @Param('id') id: string,
    @Body() body: any,
    @Headers('origin') origin?: string,
  ) {
    this.check(origin);
    return this.studio.decide(id, body?.runId, body?.revision, body?.action);
  }
  @Post('api/studio/sessions/:id/metadata/:itemId') metadata(
    @Param('id') id: string,
    @Param('itemId') itemId: string,
    @Body() body: any,
    @Headers('origin') origin?: string,
  ) {
    this.check(origin);
    return this.studio.refreshMetadata(id, itemId, body?.revision);
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
