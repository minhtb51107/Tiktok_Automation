import {Controller,Get,Post,Param,Body,Headers,Injectable,ForbiddenException,BadRequestException,ConflictException} from '@nestjs/common';
import {ConversationStudioService} from './conversation.controller';import {DataStudioService} from './data.controller';
import {EditorialEngine} from './editorial-engine';import {estimatedDuration,measuredDuration} from './editorial-feasibility';
import {textHash} from '../studio/kokoro-runtime';
import type {AudioAsset} from '../video-pipeline/contracts';
@Injectable()
export class EditorialStudioService{
 readonly engine:EditorialEngine;
 constructor(readonly conversations:ConversationStudioService,readonly data:DataStudioService){this.engine=new EditorialEngine(conversations.engine);}
 create(b:any){return this.data.studio.withControlledCollection(()=>this.engine.create(b));}
 save(id:string,b:any){return this.data.studio.withControlledCollection(()=>this.engine.save(id,b));}
 project(id:string,b:any){return this.data.studio.withControlledCollection(()=>this.engine.handoff(id,b,(input,snapshot)=>this.data.production.start(input,snapshot)));}
 async duration(id:string){const s=await this.data.studio.load(id),timeline=s.project.timeline;
  const enabled=s.editor?.scenes.filter(x=>x.enabled).map(x=>x.itemId)??s.items.filter(i=>i.selected).sort((a,b)=>a.order-b.order).map(i=>i.id);
  const valid=timeline&&timeline.scenes.length===enabled.length&&timeline.scenes.every((t,index)=>{const i=s.items.find(i=>i.id===t.scene.id);return i&&enabled[index]===i.id&&i.spokenText===t.scene.narrationText&&i.displayText===t.scene.displayText;});
  const assets:AudioAsset[]=(s.voiceAssets||[]).filter(a=>{const i=s.items.find(i=>i.id===a.itemId);return i&&a.status!=='STALE'&&a.textHash===textHash(i.spokenText)&&a.spokenText===i.spokenText&&a.voice===i.voiceSettings?.voice&&a.speed===i.voiceSettings?.speed;}).map(a=>({id:a.id,role:'NARRATION',uri:a.uri,durationMs:a.durationMs,durationSource:a.durationEvidence==='SYNTHETIC_FIXTURE'?'FIXTURE':'MEASURED',availability:'AVAILABLE'}));
  const assessment=measuredDuration(valid?timeline:undefined,assets);
  if(s.items.some(i=>enabled.includes(i.id)&&i.voiceSettings&&(i.voiceSettings.speed<0.8||i.voiceSettings.speed>1.4))&&assessment.durationGatePassed){assessment.durationGatePassed=false;assessment.status='INVALID_NARRATION_COVERAGE';assessment.warnings.push('Unusual narration speed requires editorial review; cannot manufacture duration.');}
  const estimates=s.items.filter(i=>enabled.includes(i.id)).map(i=>estimatedDuration(i.spokenText,i.voiceSettings?.speed??1.2));
  const estimated={...estimatedDuration(''),minimumSeconds:estimates.reduce((n,x)=>n+x.minimumSeconds,0),maximumSeconds:estimates.reduce((n,x)=>n+x.maximumSeconds,0),tokens:estimates.reduce((n,x)=>n+x.tokens,0),readingSpeed:'PER_SCENE_SETTINGS'};
  return {sessionId:id,revision:s.revision,estimated,measured:assessment,scriptStatus:s.project.editorialApproval?.status==='APPROVED'?'APPROVED':'DRAFT',publishingAllowed:false};
 }
}
@Controller('api/studio/data/editorial')
export class EditorialController{
 constructor(private service:EditorialStudioService){}
 private origin(o?:string){if(o&&!/^http:\/\/(127\.0\.0\.1|localhost):\d+$/.test(o))throw new ForbiddenException('Local Studio operation required');}
 private async call<T>(fn:()=>Promise<T>){try{return await fn();}catch(e:any){const m=/^(?:EDITORIAL|PRODUCTION|STALE_REVISION|IDEMPOTENCY)[A-Z0-9_]*$/.test(e.message||'')?e.message:'EDITORIAL_OPERATION_FAILED';if(/STALE|CONFLICT|BUSY/.test(m)||e instanceof ConflictException)throw new ConflictException(m);throw new BadRequestException(m);}}
 @Get('plans') list(){return this.call(()=>this.service.engine.list());}
 @Get('plans/:id') get(@Param('id') id:string){return this.call(()=>this.service.engine.get(id));}
 @Post('plans') create(@Body() b:any,@Headers('origin') o?:string){this.origin(o);return this.call(()=>this.service.create(b));}
 @Post('plans/:id') save(@Param('id') id:string,@Body() b:any,@Headers('origin') o?:string){this.origin(o);return this.call(()=>this.service.save(id,b));}
 @Post('plans/:id/project') project(@Param('id') id:string,@Body() b:any,@Headers('origin') o?:string){this.origin(o);return this.call(()=>this.service.project(id,b));}
 @Get('sessions/:id/duration') duration(@Param('id') id:string){return this.call(()=>this.service.duration(id));}
 @Post('sessions/:id/approve-script') approve(@Param('id') id:string,@Body() b:any,@Headers('origin') o?:string){this.origin(o);return this.call(()=>this.service.data.studio.approveEditorialScript(id,b));}
}
