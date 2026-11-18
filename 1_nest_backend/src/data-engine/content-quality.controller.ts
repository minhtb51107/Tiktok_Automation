import {Controller,Get,Post,Param,Body,Headers,Injectable,ForbiddenException,BadRequestException,ConflictException} from '@nestjs/common';
import { DataStudioService } from './data.controller';
import { ContentDiscovery } from './content-discovery';
import { discoverConversations,enrichConversation } from './conversation-public';
import { CONTENT_SELECTION } from './content-selection';
import { ConversationStudioService } from './conversation.controller';
@Injectable()
export class ContentQualityService {
  readonly engine:ContentDiscovery;
  constructor(readonly data:DataStudioService,readonly conversations:ConversationStudioService){this.engine=new ContentDiscovery(data.engine,{execution:'LIVE',discover:(keyword,audit,limit)=>discoverConversations(keyword,audit,limit),enrich:(url,audit,budget)=>enrichConversation(url,audit,undefined,budget?.maxDurationMs??180000,budget)})}
  live(body:any,origin?:string){if(origin&&!/^http:\/\/(127\.0\.0\.1|localhost):\d+$/.test(origin)||process.env.STUDIO_DATA_QUALITY_LIVE_ENABLED!=='1'||body?.liveApproved!==true)throw new ForbiddenException('QUALITY_LIVE_APPROVAL_REQUIRED')}
  search(body:any,origin?:string){this.live(body,origin);return this.data.studio.withControlledCollection(()=>this.engine.search(body))}
  async collect(id:string,body:any,origin?:string){this.live(body,origin);return this.data.studio.withControlledCollection(async()=>{const collected=await this.engine.collectSearch(id,body?.url,body?.collectionBudget),existingId=collected.run.conversationIds[collected.collection.root.url];if(existingId)return{search:collected.run,conversationRunId:null,collectionId:existingId};const reqId=typeof body?.requestId==='string'&&/^[\w-]{1,100}$/.test(body.requestId)?body.requestId:`search-${id.slice(0,16)}-${collected.collection.root.id}`,conversation=await this.conversations.engine.importCollection(collected.collection,reqId),result=conversation.results.find(x=>x.url===collected.collection.root.url);if(!result)throw Error('QUALITY_CONVERSATION_IMPORT_FAILED');await this.engine.linkSearchConversation(id,collected.collection.root.url,result.collectionId);return{search:await this.engine.getSearch(id),conversationRunId:conversation.id,collectionId:result.collectionId}})}
}
@Controller('api/studio/data/content-quality')
export class ContentQualityController {
  constructor(private service:ContentQualityService){}
  private async call<T>(fn:()=>Promise<T>){try{return await fn()}catch(e){if(e instanceof ForbiddenException)throw e;const code=e instanceof Error&&/^QUALITY_[A-Z0-9_]+$/.test(e.message)?e.message:'QUALITY_OPERATION_FAILED';if(/CONFLICT|BUSY/.test(code))throw new ConflictException(code);throw new BadRequestException(code)}}
  @Get('options') options(){return {selection:CONTENT_SELECTION,liveEnabled:process.env.STUDIO_DATA_QUALITY_LIVE_ENABLED==='1',maxPosts:50,maxEnrich:10,browserWorkers:1,scheduler:false,approval:'EXPLICIT_BATCH_DRAFT',estimatedDurationIsAuthoritative:false}}
  @Get('runs') list(){return this.call(()=>this.service.engine.list())}
  @Get('runs/:id') get(@Param('id') id:string){return this.call(()=>this.service.engine.get(id))}
  @Post('runs') start(@Body() b:any,@Headers('origin') o?:string){this.service.live(b,o);return this.call(()=>this.service.data.studio.withControlledCollection(()=>this.service.engine.start(b)))}
  @Post('runs/:id/resume') resume(@Param('id') id:string,@Body() b:any,@Headers('origin') o?:string){this.service.live(b,o);return this.call(()=>this.service.data.studio.withControlledCollection(()=>this.service.engine.resume(id)))}
  @Get('searches') searches(){return this.call(()=>this.service.engine.listSearches())}
  @Get('searches/:id') search(@Param('id') id:string){return this.call(()=>this.service.engine.getSearch(id))}
  @Post('searches') startSearch(@Body() b:any,@Headers('origin') o?:string){return this.call(()=>this.service.search(b,o))}
  @Post('searches/:id/collect') collect(@Param('id') id:string,@Body() b:any,@Headers('origin') o?:string){return this.call(()=>this.service.collect(id,b,o))}
}
