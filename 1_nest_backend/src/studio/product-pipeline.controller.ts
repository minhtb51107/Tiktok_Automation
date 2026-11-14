import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Headers,
  Param,
  Post,
} from '@nestjs/common';
import { ProductPipelineService } from './product-pipeline';

@Controller('api/studio/product-jobs')
export class ProductPipelineController {
  constructor(readonly pipeline: ProductPipelineService) {}
  private origin(origin?: string) {
    if (origin && !/^http:\/\/(127\.0\.0\.1|localhost):\d+$/.test(origin))
      throw new BadRequestException('Local Studio operation required');
  }
  @Get()
  list() {
    return this.pipeline.list();
  }
  @Get(':id')
  get(@Param('id') id: string) {
    return this.pipeline.get(id);
  }
  @Post()
  start(@Body() body: any, @Headers('origin') origin?: string) {
    this.origin(origin);
    return this.pipeline.start(body?.sourceUrl);
  }
  @Post(':id/apply-review')
  applyReview(
    @Param('id') id: string,
    @Body() body: any,
    @Headers('origin') origin?: string,
  ) {
    this.origin(origin);
    return this.pipeline.applyReview(id, body?.revision);
  }
  @Post(':id/materialize-script')
  materializeScript(
    @Param('id') id: string,
    @Body() body: any,
    @Headers('origin') origin?: string,
  ) {
    this.origin(origin);
    return this.pipeline.materializeScript(id, body);
  }
}
