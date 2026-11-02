import {
  Controller,
  Get,
  Post,
  Param,
  Query,
  Body,
  Headers,
  Injectable,
  BadRequestException,
  ConflictException,
  ForbiddenException,
} from '@nestjs/common';
import { StudioService } from '../studio/studio.service';
import { DataEngine } from './engine';
import { savedSessionInputs } from './studio-adapter';
import { ProductionConsumer } from './production-consumer';
@Injectable()
export class DataStudioService {
  readonly engine = new DataEngine();
  readonly production: ProductionConsumer;
  constructor(readonly studio: StudioService) { this.production = new ProductionConsumer(this.engine,studio); }
  async importSession(id: string) {
    const s = await this.studio.load(id);
    return this.engine.import(savedSessionInputs(s));
  }
}
@Controller('api/studio/data')
export class DataController {
  constructor(private data: DataStudioService) {}
  private origin(o?: string) {
    if (o && !/^http:\/\/(localhost|127\.0\.0\.1):\d+$/.test(o))
      throw new ForbiddenException('Local Studio origin required');
  }
  private async call<T>(fn: () => Promise<T>) {
    try {
      return await fn();
    } catch (e) {
      const message = (e as Error).message;
      if (message === 'STALE_REVISION' || /CONFLICT|COLLISION/.test(message)) throw new ConflictException(message);
      throw new BadRequestException(message);
    }
  }
  @Get() list(@Query('state') state?: string, @Query('page') page?: string) {
    return this.call(() => this.data.engine.catalog(state, Number(page || 0)));
  }
  @Get('production/ready') ready(@Query('page') page?:string){return this.call(()=>this.data.production.ready(Number(page||0)));}
  @Get('production/jobs') jobs(){return this.call(async()=> (await this.data.production.list()).map(({snapshot,...job})=>({...job,source:{sourceUrl:snapshot.bronze.sourceUrl,author:snapshot.bronze.author,bronzeId:snapshot.bronze.id,evaluationId:snapshot.evaluation.id}})));}
  @Get('production/jobs/:id') job(@Param('id') id:string){return this.call(()=>this.data.production.get(id));}
  @Get('production/jobs/:id/readiness') readiness(@Param('id') id:string){return this.call(()=>this.data.production.readiness(id));}
  @Post('production/jobs') createProject(@Body() b:any,@Headers('origin') o?:string){this.origin(o);return this.call(()=>this.data.production.start(b));}
  @Post('production/jobs/:id/resume') resumeProject(@Param('id') id:string,@Headers('origin') o?:string){this.origin(o);return this.call(()=>this.data.production.resume(id));}
  @Get('posts/:id') detail(@Param('id') id: string) {
    return this.call(() => this.data.engine.detail(id));
  }
  @Get('posts/:id/observations/:bronze') observation(
    @Param('id') id: string,
    @Param('bronze') b: string,
  ) {
    return this.call(() => this.data.engine.observation(id, b));
  }
  @Get('posts/:id/evaluations/:evaluation') history(
    @Param('id') id: string,
    @Param('evaluation') e: string,
  ) {
    return this.call(() => this.data.engine.history(id, e));
  }
  @Get('posts/:id/production-input') production(@Param('id') id: string) {
    return this.call(() => this.data.engine.productionInput(id));
  }
  @Post('import-session') import(
    @Body() b: { sessionId: string },
    @Headers('origin') o?: string,
  ) {
    this.origin(o);
    return this.call(() => this.data.importSession(b.sessionId));
  }
  @Post('runs/:id/resume') resume(
    @Param('id') id: string,
    @Headers('origin') o?: string,
  ) {
    this.origin(o);
    return this.call(() => this.data.engine.resume(id));
  }
  @Post('posts/:id/review') review(
    @Param('id') id: string,
    @Body() b: any,
    @Headers('origin') o?: string,
  ) {
    this.origin(o);
    return this.call(() =>
      this.data.engine.review(
        id,
        b.revision,
        b.decision,
        b.reason,
        b.confirmedType,
      ),
    );
  }
  @Post('posts/:id/enqueue') enqueue(
    @Param('id') id: string,
    @Body() b: any,
    @Headers('origin') o?: string,
  ) {
    this.origin(o);
    return this.call(() => this.data.engine.enqueue(id, b.revision));
  }
}
