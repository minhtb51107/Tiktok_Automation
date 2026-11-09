import {Controller,Get,Post,Param,Body,Headers,Injectable,ForbiddenException,BadRequestException,ConflictException} from '@nestjs/common';
import { DataStudioService } from './data.controller';
import { ContentDiscovery } from './content-discovery';
import { discoverConversations,enrichConversation } from './conversation-public';
import { CONTENT_SELECTION } from './content-selection';
@Injectable()
export class ContentQualityService {
  readonly engine:ContentDiscovery;
  constructor(readonly data:DataStudioService){this.engine=new ContentDiscovery(data.engine,{execution:'LIVE',discover:discoverConversations,enrich:enrichConversation})}
  live(body:any,origin?:string){if(origin&&!/^http:\/\/(127\.0\.0\.1|localhost):\d+$/.test(origin)||process.env.STUDIO_DATA_QUALITY_LIVE_ENABLED!=='1'||body?.liveApproved!==true)throw new ForbiddenException('QUALITY_LIVE_APPROVAL_REQUIRED')}
}
@Controller('api/studio/data/content-quality')
export class ContentQualityController {
  constructor(private service:ContentQualityService){}
  private async call<T>(fn:()=>Promise<T>){try{return await fn()}catch(e){const code=e instanceof Error&&/^QUALITY_[A-Z0-9_]+$/.test(e.message)?e.message:'QUALITY_OPERATION_FAILED';if(/CONFLICT|BUSY/.test(code))throw new ConflictException(code);throw new BadRequestException(code)}}
  @Get('options') options(){return {selection:CONTENT_SELECTION,liveEnabled:process.env.STUDIO_DATA_QUALITY_LIVE_ENABLED==='1',maxPosts:50,browserWorkers:1,scheduler:false,approval:'MANUAL',estimatedDurationIsAuthoritative:false}}
  @Get('runs') list(){return this.call(()=>this.service.engine.list())}
  @Get('runs/:id') get(@Param('id') id:string){return this.call(()=>this.service.engine.get(id))}
  @Post('runs') start(@Body() b:any,@Headers('origin') o?:string){this.service.live(b,o);return this.call(()=>this.service.data.studio.withControlledCollection(()=>this.service.engine.start(b)))}
  @Post('runs/:id/resume') resume(@Param('id') id:string,@Body() b:any,@Headers('origin') o?:string){this.service.live(b,o);return this.call(()=>this.service.data.studio.withControlledCollection(()=>this.service.engine.resume(id)))}
}
