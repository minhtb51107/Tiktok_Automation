import { sessionReadiness } from "./session-readiness";
import {editorialScriptHash} from '../data-engine/editorial-script-state';
import {uploadSignature,probeUpload,validCategory} from './uploaded-media';
import { replaceFile } from './atomic-file';
import { normalizeSpokenNumbers, NUMBER_READING_VERSION } from './spoken-numbers';
import { cacheSourceImage } from './source-images';
import { RenderStore } from './render-store';
import { renderValidation, validateRenderRequest, snapshotHash,renderBackground } from './render-policy';
import type { RenderRequest, RenderManifest } from './render.types';
import {
  BadRequestException,
  ConflictException,
  Injectable,
} from '@nestjs/common';
import { promises as fs } from 'fs';
import * as path from 'path';
import { randomUUID, createHash } from 'crypto';
import { execFile } from 'child_process';
import { ScraperService } from '../modules/core/scraper/scraper.service';
import type {
  VideoProject,
  SourceReference,
} from '../video-pipeline/contracts';
import type { StudioSession } from './studio.contracts';
import { sourceReport, reportMarkdown } from './stage-report';
import { normalizeText } from './normalization';
import { scriptReport } from './script-report';
import {
  offlineNormalize,
  qualityCases,
  realQualityCases,
} from './offline-normalization';
import { KokoroRuntime, textHash } from './kokoro-runtime';
import { voiceReport } from './voice-report';
import { StudioJobs, ProgressSink } from './progress';
import { PublicAssets } from './public-assets';
import { splitTopicText } from './topic-mapping';
import {
  editorSettings,
  validateEditor,
  prepareEditor,
} from './editor-adapter';
import type { EditorSettings } from './editor.types';
import {
  VOICE_SPEED,
  validVoiceSpeed,
  spokenAmbiguities,
} from './voice-settings';
import {
  extractPublicThreads,
  threadsUrl as validateThreadsUrl,
} from './public-threads';

export function threadsUrl(value: unknown): string {
  return validateThreadsUrl(value);
}
@Injectable()
export class StudioService {
  readonly renders = new RenderStore();
  async readiness(id:string){return sessionReadiness(await this.load(id),this.root); }
  async saveRights(id:string,body:any){return this.exclusive(async()=>{
    const s=await this.load(id);if(s.revision!==body.revision)throw new ConflictException('Session changed before rights declaration');
    if(typeof body.assetId!=='string'||body.assetId.length>160||!['UNKNOWN','OWNED','LICENSED','PERMISSION'].includes(body.status)||typeof body.evidence!=='string'||body.evidence.length>2000||body.status!=='UNKNOWN'&&!body.evidence.trim())throw new BadRequestException('Rights need an explicit status and evidence reference');
    s.mediaRights??={};s.mediaRights[body.assetId]={status:body.status,evidence:body.evidence,at:new Date().toISOString()};return this.persist(s);
  });}
  async cacheAvatars(id:string,revision:number) {
    return this.exclusive(async()=>{
      const s=await this.load(id);if(s.revision!==revision)throw new ConflictException('Session changed');
      s.sourceImages??={};
      for(const i of s.items.filter(i=>i.selected)){
        const url=i.metadata?.avatar??i.author.avatarUrl;
        if(!url)continue;
        const old=s.sourceImages[i.id];
        if(old?.status==='READY'&&old.sourceUrl===url&&(await fs.stat(path.join(this.root,'source-images',id,old.fileName!)).catch(()=>null))?.size)continue;
        await this.tick('Caching original avatar: '+i.author.displayName);
        s.sourceImages[i.id]=await cacheSourceImage(id,i.id,url,path.join(this.root,'source-images'));
      }
      return this.persist(s);
    });
  }
  async sourceImageFile(id:string,sha:string){
    if(!/^[a-f0-9]{64}$/.test(sha))throw new BadRequestException('Invalid image hash');
    const s=await this.load(id),a=Object.values(s.sourceImages||{}).find(a=>a.status==='READY'&&a.sha256===sha);
    if(!a?.fileName||path.basename(a.fileName)!==a.fileName)throw new BadRequestException('Unknown session avatar');
    return path.join(this.root,'source-images',id,a.fileName);
  }
  async renderInfo(id:string) {
    const s=await this.load(id),preview=await this.preview(id);
    return {revision:s.revision,title:s.title,request:preview.request,validation:renderValidation(s,preview.request.inputProps),renders:await this.renders.list(id)};
  }
  private async renderJob(id:string,input:RenderRequest,tick:ProgressSink,jobId:string) {
    return this.exclusive(async()=>{
      const s=await this.load(id);
      if(s.revision!==input.revision)throw new ConflictException('Project changed; reload Render before exporting');
      const built=prepareEditor(s,await this.visualAssets(s)),props=renderBackground(built.preview.request.inputProps,input.backgroundMode);
      const range=validateRenderRequest(input,props),validation=renderValidation(s,props);
      if(validation.blockers.length || input.mode==='FINAL'&&validation.finalBlockers.length)
        throw new BadRequestException([...validation.blockers,...(input.mode==='FINAL'?validation.finalBlockers:[])].join('; '));
      // Close an idle retained Kokoro model before starting Chromium/encoding.
      this.voice.close();
      const candidates=[process.env.STUDIO_BROWSER,'C:/Program Files/Google/Chrome/Application/chrome.exe','C:/Program Files (x86)/Google/Chrome/Application/chrome.exe','C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].filter(Boolean) as string[];
      let browserExecutable='';for(const f of candidates)if((await fs.stat(f).catch(()=>null))?.isFile()){browserExecutable=f;break;}
      if(!browserExecutable)throw new BadRequestException('BLOCKED_RUNTIME: install/configure an existing browser; no automatic download');
      const disk=await fs.statfs(this.root);if(disk.bavail*disk.bsize<3*1024**3)throw new BadRequestException('Less than 3 GiB free on project drive');
      const manifest:RenderManifest={schemaVersion:1,backgroundMode:input.backgroundMode||'SAVED',jobId,sessionId:id,projectId:s.project.id,revision:s.revision,timelineHash:snapshotHash(props.timeline),previewHash:snapshotHash(props),mode:input.mode,publishable:false,status:'QUEUED',width:input.preset==='1080P'?1080:720,height:input.preset==='1080P'?1920:1280,fps:props.timeline.fps,totalFrames:props.timeline.totalFrames,frameRange:range,expectedDurationSeconds:(range[1]-range[0]+1)/props.timeline.fps,sceneCount:props.timeline.scenes.length,codec:'h264',audioCodec:'aac',pixelFormat:'yuv420p',concurrency:1,startedAt:new Date().toISOString(),completedAt:null,bytes:null,warnings:[...built.preview.warnings,...validation.warnings,...(input.mode==='DRAFT'?['DRAFT: not approved for publishing',...validation.finalBlockers]:[])],error:null,metrics:{}};
      const result=await this.renders.run({props,manifest,browserExecutable,appOrigin:`http://127.0.0.1:${process.env.PORT||3000}`},this.jobs,tick);
      return {revision:s.revision,warnings:result.warnings};
    });
  }
  readonly publicAssets = new PublicAssets();
  private async visualAssets(s: StudioSession) {
    const ids = new Set<string>();
    const add = (id?: string | null) => {
      if (id?.startsWith('pub-')) ids.add(id);
    };
    add(s.editor?.backgroundId);
    add(s.editor?.backgroundMusic?.assetId);
    for (const x of s.editor?.scenes || []) {
      add(x.visual?.backgroundId);
      add(x.visual?.meme.assetId);
      add(x.visual?.sfx.assetId);
      x.mediaAssetIds.forEach(add);
    }
    for(const c of s.editor?.backgroundTracks||[])if(c.assetId.startsWith('pub-'))ids.add(c.assetId);
    const rows = [];
    for (const id of ids) rows.push(await this.publicAssets.resolve(id));
    return rows;
  }
  async mapTopic(id: string, itemId: string, body: any) {
    return this.exclusive(async () => {
      const s = await this.load(id);
      if (s.revision !== body.revision)
        throw new ConflictException(
          'Project changed; reopen before Topic correction',
        );
      const i = s.items.find((i) => i.id === itemId && i.selected);
      if (
        !i ||
        typeof body.topic !== 'string' ||
        body.topic.length > 200 ||
        typeof body.bodyText !== 'string' ||
        !body.bodyText.trim() ||
        body.bodyText.length > 20000
      )
        throw new BadRequestException('Invalid topic/body mapping');
      const evidence = {
        type: 'USER_CONFIRMED' as const,
        detail:
          'Explicit user-confirmed Topic/body correction on the exact source permalink',
        sourceUrl: i.sourceUrl,
      };
      i.contentMapping = {
        topic: body.topic.trim() || null,
        bodyText: body.bodyText.trim(),
        status: 'VERIFIED',
        evidence,
        includeTopicInTts: false,
      };
      i.displayText = i.contentMapping.bodyText;
      i.manualLocks = [...new Set([...i.manualLocks, 'DISPLAY_TEXT'])];
      const corrected = splitTopicText(i.spokenText, body.topic.trim());
      if (
        body.topic.trim() &&
        !corrected.matched &&
        i.spokenText
          .toLocaleLowerCase('vi')
          .includes(body.topic.trim().toLocaleLowerCase('vi'))
      )
        i.contentMapping.status = 'REVIEW_REQUIRED';
      if (body.correctSpoken === true && corrected.matched) {
        if (
          i.manualLocks.includes('NARRATION_TEXT') &&
          body.confirmLockedSpoken !== true
        )
          throw new ConflictException(
            'Spoken text is locked; explicitly confirm correction',
          );
        i.spokenText = corrected.body;
        i.manualLocks = [...new Set([...i.manualLocks, 'NARRATION_TEXT'])];
      }
      i.revision++;
      delete s.project.timeline;
      return this.persist(s);
    });
  }
  async deleteMedia(id: string, assetId: string, body: any) {
    return this.exclusive(async () => {
      const s = await this.load(id);
      if (body.revision !== s.revision)
        throw new ConflictException('Project changed before delete');
      const a = s.studioMedia?.find((a) => a.id === assetId);
      if (!a)
        throw new BadRequestException(
          'Only an uploaded asset owned by this session can be deleted',
        );
      const refs = (s.editor?.scenes || []).filter(
        (x) =>
          x.mediaAssetIds.includes(assetId) ||
          x.visual?.meme.assetId === assetId ||
          x.visual?.backgroundId === assetId || x.visual?.sfx.assetId === assetId,
      );
      if(s.items.some(i=>i.mediaReferences.includes(a.uri)||i.metadata?.media.some(m=>m.url===a.uri))||s.project.posts.some(p=>p.mediaAssetIds.includes(assetId))||s.project.comments.some(c=>c.mediaAssetIds.includes(assetId)))throw new ConflictException('Asset is still referenced by source content');
      for(const row of await this.list())if(row.id!==id){const other=await this.load(row.id);if(JSON.stringify({items:other.items,project:other.project,editor:other.editor}).includes(a.uri))throw new ConflictException('Asset is referenced by another session; deletion refused');}
      if (
        refs.length || s.project.backgroundTracks?.some(c=>c.assetId===assetId) || s.project.backgroundMusic?.assetId===assetId || s.project.storyboard.some(x=>x.sfxLayer?.assetId===assetId) ||
        s.editor?.backgroundId === assetId || s.editor?.backgroundMusic?.assetId === assetId || s.editor?.backgroundTracks?.some(c=>c.assetId===assetId) ||
        (s.project.storyboard.some(
            (x) =>
              x.mediaAssetIds.includes(assetId) ||
              x.visual?.backgroundId === assetId ||
              x.visual?.meme.assetId === assetId,
          ))
      )
        throw new ConflictException(
          'Asset is still referenced. Remove it from all scenes, save and prepare preview first.',
        );
      if (body.confirm !== true || body.sha256 !== a.sha256)
        throw new BadRequestException(
          'Physical deletion requires explicit confirmation and matching hash',
        );
      const file = await this.mediaFile(id, assetId),
        stat = await fs.lstat(file);
      if (!stat.isFile() || stat.isSymbolicLink())
        throw new BadRequestException('Unsafe uploaded file');
      const root = await fs.realpath(path.join(this.root, 'media', id)),
        real = await fs.realpath(file);
      if (!real.startsWith(root + path.sep))
        throw new BadRequestException('File is outside session media');
      if (
        createHash('sha256')
          .update(await fs.readFile(real))
          .digest('hex') !== a.sha256
      )
        throw new ConflictException('Asset hash changed; deletion refused');
      await fs.unlink(real);
      s.studioMedia = s.studioMedia!.filter((x) => x.id !== assetId);
      s.project.mediaAssets = s.project.mediaAssets.filter(
        (x) => x.id !== assetId,
      );
      return this.persist(s);
    });
  }
  readonly jobs = new StudioJobs();
  private progress?: ProgressSink;
  private async tick(step: string, completed?: number, total?: number) {
    await this.progress?.(step, completed, total);
  }
  async startJob(id: string, body: any) {
    const snapshot = await this.load(id),
      operation = body?.operation,
      input = body?.input || {};
    if (
      typeof operation !== 'string' ||
      !/^(render|fetch|voice-runtime|voice-batch|script\/propose-offline-all|editor\/prepare|voice\/[a-f0-9-]{36}|metadata\/[a-f0-9-]{36}|script\/[a-f0-9-]{36}\/propose)$/.test(
        operation,
      )
    )
      throw new BadRequestException('Unsupported Studio job operation');
    return this.jobs.submit(
      id,
      operation,
      { ...input, revision: input.revision ?? snapshot.revision },
      async (tick,jobId) => {
        if(operation==='render')return this.renderJob(id,input,tick,jobId);
        this.progress = tick;
        this.voice.onStage = (step) => {
          void tick(step).catch(() => {});
        };
        try {
          let s: StudioSession;
          let warnings: string[] = [];
          if (operation === 'fetch') s = await this.mutate(id, input, true);
          else if (operation === 'voice-runtime') s = await this.runtime(id);
          else if (operation === 'voice-batch')
            s = await this.voiceBatch(id, input);
          else if (operation === 'script/propose-offline-all')
            s = await this.proposeOfflineAll(id, input.revision);
          else if (operation.startsWith('voice/'))
            s = await this.voiceAction(id, operation.split('/')[1], input);
          else if (operation.startsWith('metadata/'))
            s = await this.refreshMetadata(
              id,
              operation.split('/')[1],
              input.revision,
            );
          else if (operation.startsWith('script/'))
            s = await this.propose(
              id,
              operation.split('/')[1],
              input.revision,
              input.mode || 'LIVE',
            );
          else {
            const prepared = await this.preparePreview(id, input.revision);
            warnings = prepared.warnings;
            s = await this.load(id);
          }
          let error: string | undefined;
          if (operation === 'fetch' && s.errors.length)
            error = s.errors.join('; ');
          if (
            operation.includes('voice') &&
            s.voiceRuntime?.status === 'BLOCKED_RUNTIME'
          )
            error = s.voiceRuntime.blockers.join('; ');
          if (
            operation.startsWith('voice/') &&
            s.voiceJobs?.slice(-1)[0]?.status === 'ERROR'
          )
            error =
              s.voiceJobs.slice(-1)[0]!.error || 'Audio generation failed';
          if (
            operation === 'voice-batch' &&
            s.voiceBatch?.results.some((r) => r.outcome === 'ERROR')
          )
            error = 'One or more scenes failed; see batch results';
          if (
            operation.startsWith('script') &&
            s.scriptProposals?.slice(-1)[0]?.error
          )
            error = s.scriptProposals.slice(-1)[0]!.error || undefined;
          return {
            revision: s.revision,
            review:
              operation === 'fetch' ||
              operation.startsWith('script') ||
              operation === 'editor/prepare' ||
              input.action === 'GENERATE' ||
              input.action === 'GENERATE_ALL',
            error,
            warnings,
          };
        } finally {
          this.progress = undefined;
          this.voice.onStage = undefined;
        }
      },
    );
  }
  async editor(id: string) {
    const s = await this.load(id);
    return {
      settings: editorSettings(s),
      media: s.studioMedia || [],
      revision: s.revision,
    };
  }
  async saveEditor(id: string, body: any) {
    return this.exclusive(async () => {
      const s = await this.load(id);
      if (s.revision !== body?.revision)
        throw new ConflictException(
          'Project changed; reopen before saving editor',
        );
      s.editor = validateEditor(
        s,
        body.settings as EditorSettings,
        await this.visualAssets({...s,editor:body.settings}),
      );
      // Display edits are manual and never touch original/spoken source content.
      if (body.displayEdits) {
        for (const [itemId, value] of Object.entries(body.displayEdits)) {
          const i = s.items.find((i) => i.id === itemId && i.selected);
          if (!i || typeof value !== 'string' || value.length > 20000)
            throw new BadRequestException('Invalid display edit');
          if (i.displayText !== value) {
            i.displayText = value;
            i.revision++;
            i.manualLocks = [...new Set([...i.manualLocks, 'DISPLAY_TEXT'])];
          }
        }
      }
      delete s.project.timeline;
      return this.persist(s);
    });
  }
  async preparePreview(id: string, revision: number) {
    return this.exclusive(async () => {
      const s = await this.load(id);
      if (s.revision !== revision)
        throw new ConflictException(
          'Project changed; reopen before preparing preview',
        );
      await this.tick('Building deterministic timeline');
      const built = prepareEditor(s, await this.visualAssets(s));
      for (const a of built.project.audioAssets)
        if ((await fs.stat(a.id.startsWith('pub-')?(await this.publicAssets.file(a.id)).file:a.id.startsWith('media-')?await this.mediaFile(id,a.id):await this.audioFile(id, a.id))).size === 0)
          throw new BadRequestException('Audio is missing or empty');
      for (const a of s.studioMedia || [])
        await fs.access(await this.mediaFile(id, a.id));
      s.project.storyboard = built.project.storyboard;
      s.project.timeline = built.project.timeline;
      s.project.editorSettings = built.project.editorSettings;
      s.project.backgroundMusic = built.project.backgroundMusic;
      s.project.backgroundTracks = built.project.backgroundTracks;
      s.project.mediaAssets = built.project.mediaAssets;
      s.project.audioAssets = built.project.audioAssets;
      s.editor = editorSettings(s);
      await this.tick('Saving preview');
      await this.persist(s);
      built.preview.revision = s.revision;
      return built.preview;
    });
  }
  async preview(id: string) {
    const s = await this.load(id);
    return prepareEditor(s, await this.visualAssets(s)).preview;
  }
  async uploadMedia(
    id: string,
    file: { buffer: Buffer; originalname: string; mimetype?: string },
    revision: number,
    category = 'UPLOADS',
  ) {
    return this.exclusive(async () => {
      const s = await this.load(id);
      if (s.revision !== revision)
        throw new ConflictException('Project changed; reopen before uploading');
      const info = uploadSignature(file, category);
      const hash = createHash('sha256').update(file.buffer).digest('hex'),
        assetId = 'media-' + hash;
      const duplicate=s.studioMedia?.find(a=>a.id===assetId);
      if(duplicate&&duplicate.category!==category){if(JSON.stringify(s.editor).includes(assetId))throw new ConflictException('Existing file is referenced in another category; remove it from timeline before recategorizing');duplicate.category=category as any;}
      if (!duplicate) {
        const dir = path.join(this.root, 'media', id);
        await fs.mkdir(dir, { recursive: true });
        const fileName = hash + '.' + info.extension;
        await fs
          .writeFile(path.join(dir, fileName), file.buffer, { flag: 'wx' })
          .catch((e) => {
            if (e.code !== 'EEXIST') throw e;
          });
        const measured = await probeUpload(path.join(dir,fileName), info.kind);
        s.studioMedia = [
          ...(s.studioMedia || []),
          {
            id: assetId,
            kind: info.kind as any,
            category: category as any,
            ...measured,
            uri: `/api/studio/sessions/${id}/media/${assetId}`,
            availability: 'AVAILABLE',
            fileName,
            bytes: file.buffer.length,
            sha256: hash,
            originalName: path
              .basename(file.originalname)
              .replace(/[^\p{L}\p{N}_. -]/gu, '_')
              .slice(0, 120),
            width: info.width ?? measured.width,
            height: info.height ?? measured.height,
            mime: info.mime,
          },
        ];
      }
      return this.persist(s);
    });
  }
  async uploadMediaJob(
    id: string,
    file: { buffer: Buffer; originalname: string; mimetype?: string },
    revision: number,
    requestId?:string,
    category = 'UPLOADS',
  ) {
    if (!file?.buffer)
      throw new BadRequestException(
        '[EMPTY_UPLOAD] Choose PNG, JPG, WEBP or GIF',
      );
    await this.load(id);
    return this.jobs.submit(
      id,
      'media/upload',
      {
        revision,
        requestId, category,
        sha256: createHash('sha256').update(file.buffer).digest('hex'),
      },
      async (tick) => {
        await tick('Validating image', 0, 1);
        const s = await this.uploadMedia(id, file, revision, category);
        await tick('Saving media manifest', 1, 1);
        return { revision: s.revision, review: true };
      },
    );
  }
  async categoryMedia(id:string,assetId:string,body:any){return this.exclusive(async()=>{const s=await this.load(id);if(s.revision!==body.revision)throw new ConflictException('Project changed');const a=s.studioMedia?.find(a=>a.id===assetId);if(!a||!validCategory(body.category,a.kind))throw new BadRequestException('Invalid uploaded category');if(JSON.stringify(s.editor).includes(assetId))throw new ConflictException('Remove from timeline before changing category');a.category=body.category;return this.persist(s);});}
  async mediaFile(id: string, assetId: string) {
    const s = await this.load(id),
      asset = s.studioMedia?.find((a) => a.id === assetId);
    if (!asset || !/^[a-f0-9]{64}\.(png|gif|jpg|webp|mp3|wav|m4a|ogg|mp4|webm)$/.test(asset.fileName))
      throw new BadRequestException('Unknown local media');
    return path.join(this.root, 'media', id, asset.fileName);
  }
  private root = path.resolve(process.cwd(), '.studio-data');
  private busy = false;
  private voice = new KokoroRuntime();
  onModuleDestroy() {
    this.voice.close();
  }
  private extract = extractPublicThreads;
  private normalize = normalizeText;
  constructor(private readonly scraper: ScraperService) {}
  private file(id: string) {
    if (!/^[a-f0-9-]{36}$/.test(id))
      throw new BadRequestException('Invalid session ID');
    return path.join(this.root, id + '.json');
  }
  async load(id: string): Promise<StudioSession> {
    return JSON.parse(await fs.readFile(this.file(id), 'utf8'));
  }
  async list() {
    await fs.mkdir(this.root, { recursive: true });
    const rows: { id: string; title: string; updatedAt: string }[] = [];
    for (const f of await fs.readdir(this.root))
      if (/^[a-f0-9-]{36}\.json$/.test(f)) {
        const s = await this.load(f.slice(0, -5));
        rows.push({ id: s.id, title: s.title, updatedAt: s.updatedAt });
      }
    return rows.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }
  private async persist(s: StudioSession) {
    if(s.project.editorialApproval&&s.project.editorialApproval.scriptHash!==editorialScriptHash(s))s.project.editorialApproval.status='STALE';
    for (const item of s.items) {
      if (
        item.spokenApproval &&
        item.spokenApproval.textHash !== textHash(item.spokenText)
      )
        item.spokenApproval.valid = false;
    }
    for (const a of s.voiceAssets || []) {
      const item = s.items.find((i) => i.id === a.itemId);
      if (
        !item ||
        a.textHash !== textHash(item.spokenText) ||
        a.voice !== item.voiceSettings?.voice ||
        a.speed !== item.voiceSettings?.speed
      )
        a.status = 'STALE';
    }
    if (
      s.project.timeline?.scenes.some((t) => {
        const item = s.items.find((i) => i.id === t.scene.id && i.selected);
        return (
          !item ||
          item.displayText !== t.scene.displayText ||
          (t.scene.audioAssetId &&
            !s.voiceAssets?.some(
              (a) => a.id === t.scene.audioAssetId && a.status !== 'STALE',
            ))
        );
      })
    )
      delete s.project.timeline;
    if (s.voiceAssets?.length) {
      const ids = new Set(s.voiceAssets.map((a) => a.id));
      const previewAudioIds = new Set(
        s.project.timeline?.scenes
          .map((t) => t.scene.audioAssetId)
          .filter(Boolean) || [],
      );
      s.project.audioAssets = [
        ...s.project.audioAssets.filter((a) => !ids.has(a.id)),
        ...s.voiceAssets
          .filter(
            (a) =>
              a.status === 'APPROVED' ||
              (a.status === 'GENERATED' && previewAudioIds.has(a.id)),
          )
          .map((a) => ({
            id: a.id,
            role: 'NARRATION' as const,
            uri: a.uri,
            durationMs: a.durationMs,
            durationSource: a.durationEvidence==='SYNTHETIC_FIXTURE'?'FIXTURE' as const:'MEASURED' as const,
            availability: 'AVAILABLE' as const,
            approvalStatus:
              a.status === 'APPROVED'
                ? ('APPROVED' as const)
                : ('PENDING' as const),
          })),
      ];
    }
    s.updatedAt = new Date().toISOString();
    s.revision++;
    const report = sourceReport(s);
    s.reports = [
      ...(s.reports || []).filter(
        (r) => r.stageName !== 'SOURCE' || r.runId !== report.runId,
      ),
      report,
    ];
    if (s.scriptProposals?.length) {
      const script = scriptReport(s);
      s.reports = [
        ...s.reports.filter(
          (r) => r.stageName !== 'SCRIPT' || r.runId !== script.runId,
        ),
        script,
      ];
    }
    if (s.voiceRuntime || s.voiceJobs?.length) {
      const report = voiceReport(s);
      s.reports = [...s.reports.filter((r) => r.stageName !== 'VOICE'), report];
    }
    await fs.mkdir(this.root, { recursive: true });
    const f = this.file(s.id);
    await fs.writeFile(f + '.tmp', JSON.stringify(s, null, 2));
    await replaceFile(f + '.tmp', f);
    return s;
  }
  private async exclusive<T>(fn: () => Promise<T>) {
    if (this.busy)
      throw new ConflictException(
        'Another source operation is running. Try again after it finishes.',
      );
    this.busy = true;
    try {
      return await fn();
    } finally {
      this.busy = false;
    }
  }
  async withControlledCollection<T>(fn:()=>Promise<T>){return this.exclusive(async()=>{this.voice.close();return fn();});}
  async create() {
    const id = randomUUID();
    const project: VideoProject = {
      contractVersion: '1.0',
      id,
      style: 'SERIOUS',
      title: 'Untitled project',
      sources: [],
      posts: [],
      comments: [],
      candidates: [],
      storyboard: [],
      audioAssets: [],
      mediaAssets: [],
      publishing: {
        title: '',
        caption: '',
        hashtags: [],
        language: 'vi',
        manualApprovalRequired: true,
      },
    };
    return this.exclusive(() =>
      this.persist({
        id,
        title: project.title,
        revision: 0,
        updatedAt: '',
        status: 'IDLE',
        scope: 'TARGET_ONLY',
        errors: [],
        project,
        items: [],
      }),
    );
  }
  /** Idempotent DATA-03 materialization. Never overwrites an existing session. */
  async approveEditorialScript(id:string,body:any){return this.exclusive(async()=>{
    const s=await this.load(id);if(s.revision!==body?.revision)throw new ConflictException('STALE_REVISION');
    if(!s.project.editorialPlan||body.confirmUserReview!==true||typeof body.reason!=='string'||!body.reason.trim()||body.reason.length>1000)throw new BadRequestException('EDITORIAL_USER_REVIEW_REQUIRED');
    const selected=s.items.filter(i=>i.selected);if(!selected.some(i=>i.editorial?.stage==='CONTEXT'&&i.sourceReference.entityId===s.project.editorialPlan!.bundle.collection.root.id)||!selected.some(i=>i.editorial?.stage==='DISCUSSION')||!selected.some(i=>i.editorial?.kind==='COMMENTARY')||selected.some(i=>!i.spokenText.trim()))throw new BadRequestException('EDITORIAL_SCRIPT_INCOMPLETE');
    const approval={scriptHash:editorialScriptHash(s),reason:body.reason.trim(),approvedAt:new Date().toISOString(),sessionRevision:s.revision};
    s.project.editorialApproval={...approval,status:'APPROVED'};s.project.editorialApprovalHistory=[...(s.project.editorialApprovalHistory||[]),approval];return this.persist(s);
  });}
  async ensureProductionSession(seed: StudioSession) {
    return this.exclusive(async()=>{
      if(!seed.productionOrigin||seed.project.style!=='SERIOUS'||seed.project.id!==seed.id||JSON.stringify(seed.project.productionOrigin)!==JSON.stringify(seed.productionOrigin))throw new BadRequestException('Invalid production seed');
      try {
        const existing=await this.load(seed.id);
        if(existing.productionOrigin?.jobId!==seed.productionOrigin.jobId||existing.productionOrigin.snapshotHash!==seed.productionOrigin.snapshotHash||existing.project.productionOrigin?.jobId!==seed.productionOrigin.jobId)throw new ConflictException('PRODUCTION_SESSION_COLLISION');
        return existing;
      }catch(e:any){if(e.code!=='ENOENT')throw e;}
      return this.persist(seed);
    });
  }
  async mutate(id: string, body: any, fetchSource = false) {
    return this.exclusive(async () => {
      const s = await this.load(id);
      if (body?.revision !== s.revision)
        throw new ConflictException(
          'Session changed. Reopen it before saving.',
        );
      if (fetchSource) {
        const startedAt = new Date().toISOString();
        if (
          body.scope !== undefined &&
          !['TARGET_ONLY', 'WITH_CONTEXT'].includes(body.scope)
        )
          throw new BadRequestException('Invalid extraction scope');
        s.scope = body.scope || s.scope || 'TARGET_ONLY';
        if (
          !Array.isArray(body.urls) ||
          !body.urls.length ||
          body.urls.length > 5
        )
          throw new BadRequestException('Enter 1–5 Threads URLs');
        const urls = [...new Set<string>(body.urls.map(threadsUrl))];
        const start = Date.now();
        s.errors = [];
        for (const url of urls) {
          await this.tick(
            'Threads extraction: resolving exact target',
            urls.indexOf(url),
            urls.length,
          );
          try {
            const attempt = await this.extract(url, s.scope);
            s.attempts = [
              ...(s.attempts || []).filter((x) => x.originalUrl !== url),
              attempt,
            ];
            if (attempt.records.length && attempt.matchedTargetId) {
              const canonical =
                attempt.canonicalUrl || attempt.resolvedUrl || url;
              if (
                !s.project.sources.some((x) => x.canonicalUrl === canonical)
              ) {
                const first = s.items.length;
                this.append(
                  s,
                  canonical,
                  attempt.records[0],
                  s.scope === 'WITH_CONTEXT' ? attempt.records.slice(1) : [],
                );
                s.items.slice(first).forEach((item, index) => {
                  item.inclusion = index === 0 ? 'TARGET' : 'EXPLICIT_CONTEXT';
                  const raw = attempt.records[index];
                  item.sourceUrl =
                    typeof raw.url === 'string' ? raw.url : canonical;
                  item.rawExtraction = structuredClone(raw);
                  item.metadata = structuredClone(raw);
                  item.author = {
                    displayName: raw.author,
                    ...(raw.handle ? { handle: raw.handle } : {}),
                    ...(raw.avatar ? { avatarUrl: raw.avatar } : {}),
                  };
                  item.mediaReferences = raw.media.map((m) => m.url);
                  const previous = s.archivedItems?.find(
                    (i) =>
                      i.sourceUrl === item.sourceUrl &&
                      i.author.displayName === raw.author,
                  );
                  if (previous) {
                    item.selected = previous.selected;
                    if (previous.manualLocks.length || previous.revision > 0) {
                      item.displayText = previous.displayText;
                      item.spokenText = previous.spokenText;
                      item.metadata = previous.metadata;
                      item.manualLocks = [...previous.manualLocks];
                      item.revision = previous.revision;
                    }
                  }
                });
              }
            }
            if (attempt.status === 'ERROR')
              s.errors.push(
                ...attempt.diagnostics
                  .filter((d) => d.code !== 'RESOLVED')
                  .map((d) => url + ': ' + d.message),
              );
          } catch (e) {
            s.errors.push(
              'Extraction failed for ' +
                url +
                ': ' +
                (e instanceof Error ? e.message : 'Unknown error') +
                '. Existing content is preserved.',
            );
          }
        }
        s.elapsedMs = Date.now() - start;
        s.sourceRun = {
          runId: randomUUID(),
          startedAt,
          completedAt: new Date().toISOString(),
          elapsedMs: s.elapsedMs,
        };
        s.status = s.errors.length
          ? 'ERROR'
          : s.attempts?.some((a) => a.status === 'PARTIAL')
            ? 'PARTIAL'
            : 'READY';
      } else if (body.addContext) {
        const attempt = s.attempts?.find(
          (a) => a.originalUrl === body.addContext.originalUrl,
        );
        const raw = attempt?.contextCandidates?.[body.addContext.index];
        if (!raw || typeof raw.url !== 'string')
          throw new BadRequestException('Context candidate not found');
        if (!s.items.some((i) => i.sourceUrl === raw.url)) {
          const first = s.items.length;
          this.append(s, threadsUrl(raw.url), raw, []);
          const item = s.items[first];
          item.inclusion = 'EXPLICIT_CONTEXT';
          item.rawExtraction = structuredClone(raw);
          item.metadata = structuredClone(raw);
          item.mediaReferences = raw.media.map((m) => m.url);
        }
      } else if (body.manual) {
        const { text, author, comments } = body.manual;
        if (
          typeof text !== 'string' ||
          !text.trim() ||
          text.length > 30000 ||
          typeof comments !== 'string' ||
          comments.length > 60000
        )
          throw new BadRequestException(
            'Provide post text and comments (one per line), within the size limit',
          );
        this.append(
          s,
          body.manual.url ? threadsUrl(body.manual.url) : '',
          {
            text,
            author:
              typeof author === 'string'
                ? author.slice(0, 150)
                : 'Manual source',
          },
          comments
            .split('\n')
            .filter((x) => x.trim())
            .map((text) => ({ text, author: 'Imported comment' })),
        );
        s.status = 'READY';
        s.errors = [];
      } else {
        if (
          typeof body.title !== 'string' ||
          !body.title.trim() ||
          body.title.length > 150 ||
          !Array.isArray(body.items) ||
          body.items.length !== s.items.length
        )
          throw new BadRequestException('Invalid project edits');
        const ids = new Set<string>();
        s.items = body.items.map((patch: any, order: number) => {
          const original = s.items.find((x) => x.id === patch.id);
          if (
            !original ||
            ids.has(patch.id) ||
            typeof patch.selected !== 'boolean' ||
            typeof patch.displayText !== 'string' ||
            typeof patch.spokenText !== 'string' ||
            patch.displayText.length > 30000 ||
            patch.spokenText.length > 30000
          )
            throw new BadRequestException('Invalid item edits');
          ids.add(patch.id);
          let metadata = original.metadata;
          if (
            patch.metadata &&
            original.metadata &&
            JSON.stringify(patch.metadata) !== JSON.stringify(original.metadata)
          ) {
            const p = patch.metadata;
            if (
              typeof p.author !== 'string' ||
              p.author.length > 150 ||
              !Array.isArray(p.media) ||
              p.media.length > 30 ||
              p.media.some(
                (m) =>
                  !m ||
                  !['IMAGE', 'VIDEO', 'GIF'].includes(m.kind) ||
                  typeof m.url !== 'string' ||
                  !/^https:\/\//.test(m.url),
              )
            )
              throw new BadRequestException('Invalid author/media metadata');
            const count = (value: unknown) =>
              typeof value === 'number' &&
              Number.isSafeInteger(value) &&
              value >= 0
                ? value
                : null;
            metadata = {
              ...original.metadata,
              author: p.author,
              handle: typeof p.handle === 'string' ? p.handle : null,
              avatar:
                typeof p.avatar === 'string' && p.avatar.startsWith('https://')
                  ? p.avatar
                  : null,
              media: p.media,
              createdAt: typeof p.createdAt === 'string' ? p.createdAt : null,
              type: ['POST', 'COMMENT', 'UNKNOWN'].includes(p.type)
                ? p.type
                : 'UNKNOWN',
              parentReference:
                typeof p.parentReference === 'string'
                  ? p.parentReference
                  : null,
              likeCount: count(p.likeCount),
              replyCount: count(p.replyCount),
              repostCount: count(p.repostCount),
              shareCount: count(p.shareCount),
              provenance: {
                ...original.metadata.provenance,
                manual: 'User correction; rawExtraction unchanged',
              },
            };
          }
          if (metadata && original.metadata && metadata !== original.metadata) {
            metadata.fields = { ...original.metadata.fields };
            for (const key of [
              'likeCount',
              'replyCount',
              'repostCount',
              'shareCount',
              'createdAt',
              'avatar',
            ] as const) {
              if (metadata[key] !== original.metadata[key])
                metadata.fields[key] = {
                  status: metadata[key] != null ? 'AVAILABLE' : 'UNAVAILABLE',
                  value: metadata[key] ?? null,
                  raw: null,
                  source: 'USER_OVERRIDE (raw observation preserved)',
                };
            }
          }
          const changed =
            // Text and metadata locks are independent; previous locks survive edits.
            JSON.stringify(metadata) !== JSON.stringify(original.metadata) ||
            original.displayText !== patch.displayText ||
            original.spokenText !== patch.spokenText;
          return {
            ...original,
            metadata,
            ...(metadata
              ? {
                  author: {
                    displayName: metadata.author,
                    ...(metadata.handle ? { handle: metadata.handle } : {}),
                  },
                  mediaReferences: metadata.media.map((m) => m.url),
                }
              : {}),
            order,
            selected: patch.selected,
            displayText: patch.displayText,
            spokenText: patch.spokenText,
            ...(original.editorial?{editorial:{...original.editorial,kind:original.editorial.kind==='QUOTE'&&(patch.spokenText!==original.originalText||patch.displayText!==original.originalText)?'PARAPHRASE' as const:original.editorial.kind}}:{}),
            revision: original.revision + (changed ? 1 : 0),
            manualLocks: [
              ...new Set([
                ...original.manualLocks,
                ...(original.displayText !== patch.displayText
                  ? ['DISPLAY_TEXT']
                  : []),
                ...(original.spokenText !== patch.spokenText
                  ? ['NARRATION_TEXT']
                  : []),
                ...(JSON.stringify(metadata) !==
                JSON.stringify(original.metadata)
                  ? ['METADATA']
                  : []),
              ]),
            ],
          };
        });
        s.title = body.title.trim();
        s.project.title = s.title;
      }
      s.project.candidates = s.items.map((i) => ({
        id: i.id,
        style: 'SERIOUS',
        sourceReferences: [i.sourceReference],
        status: i.selected ? 'SELECTED' : 'REJECTED',
        selectedBy: 'USER',
      }));
      return this.persist(s);
    });
  }
  async report(id: string, stage = 'SOURCE') {
    const started = Date.now();
    const s = await this.load(id);
    const report =
      stage === 'VOICE'
        ? voiceReport(s)
        : stage === 'SCRIPT'
          ? scriptReport(s)
          : sourceReport(s);
    const markdown = reportMarkdown(report);
    const generation = Date.now() - started;
    report.reportGenerationElapsedMs = generation;
    return {
      report,
      markdown:
        markdown +
        `\nReport generation (local read and assembly): ${generation} ms. Stage elapsed above is processing time, not report generation.`,
      reportGenerationElapsedMs: generation,
    };
  }
  async propose(id: string, itemId: string, revision: number, mode = 'LIVE') {
    return this.exclusive(async () => {
      const s = await this.load(id);
      if (s.revision !== revision)
        throw new ConflictException(
          'Session changed. Reopen before requesting AI.',
        );
      const item = s.items.find((i) => i.id === itemId && i.selected);
      if (!item) throw new BadRequestException('Selected item not found');
      if (!['LIVE', 'OFFLINE'].includes(mode))
        throw new BadRequestException('Invalid normalization mode');
      if (mode === 'LIVE' && s.aiBillingBlocked)
        throw new ConflictException(
          'BLOCKED_BILLING: use offline/manual. No provider retry attempted.',
        );
      await this.tick(
        mode === 'OFFLINE'
          ? 'Offline normalization'
          : 'AI normalization: awaiting provider',
      );
      const run =
        mode === 'OFFLINE'
          ? offlineNormalize(item)
          : await this.normalize(item);
      if (run.executionStatus === 'BLOCKED_BILLING') s.aiBillingBlocked = true;
      s.scriptProposals = [...(s.scriptProposals || []), run];
      return this.persist(s);
    });
  }
  async runtime(id: string) {
    return this.exclusive(async () => {
      const s = await this.load(id);
      await this.tick('Checking local runtime');
      s.voiceRuntime = await this.voice.preflight();
      return this.persist(s);
    });
  }
  async voiceAction(id: string, itemId: string, body: any) {
    return this.exclusive(async () => {
      const s = await this.load(id);
      if (s.revision !== body?.revision)
        throw new ConflictException(
          'Session changed. Reopen before voice action.',
        );
      const item = s.items.find((i) => i.id === itemId && i.selected);
      if (!item) throw new BadRequestException('Selected scene not found');
      if (body.action === 'APPROVE_SPOKEN') {
        if (!item.spokenText.trim())
          throw new BadRequestException('Spoken text is empty');
        item.spokenApproval = {
          textHash: textHash(item.spokenText),
          revision: item.revision,
          approvedAt: new Date().toISOString(),
          valid: true,
        };
      } else if (body.action === 'SETTINGS') {
        this.applySettings(s, item, body.voice, body.speed);
      } else if (body.action === 'APPROVE_AUDIO') {
        const a = s.voiceAssets?.find(
          (a) => a.id === body.assetId && a.itemId === item.id,
        );
        if (
          !a ||
          a.status === 'STALE' ||
          a.textHash !== textHash(item.spokenText) ||
          a.voice !== item.voiceSettings?.voice ||
          a.speed !== item.voiceSettings?.speed ||
          !item.spokenApproval?.valid
        )
          throw new ConflictException(
            'Audio is stale or spoken text is not approved',
          );
        try {
          const file = await this.audioFile(id, a.id);
          if ((await fs.stat(file)).size === 0) throw Error();
        } catch {
          a.status = 'STALE';
          const now = new Date().toISOString();
          s.voiceJobs = [
            ...(s.voiceJobs || []),
            {
              itemId: item.id,
              status: 'ERROR',
              startedAt: now,
              completedAt: now,
              elapsedMs: 0,
              error: 'Audio file is missing or empty; approval refused',
              assetId: a.id,
            },
          ];
          return this.persist(s);
        }
        a.status = 'APPROVED';
        a.approvedAt = new Date().toISOString();
      } else if (body.action === 'GENERATE') {
        if (body.voice !== undefined || body.speed !== undefined)
          this.applySettings(
            s,
            item,
            body.voice ?? item.voiceSettings?.voice ?? null,
            body.speed ?? item.voiceSettings?.speed ?? VOICE_SPEED.default,
          );
        await this.generateItem(s, item, body.regenerate === true, undefined, body.draft === true);
      } else throw new BadRequestException('Unknown voice operation');
      return this.persist(s);
    });
  }
  private applySettings(
    s: StudioSession,
    item: StudioSession['items'][number],
    voice: unknown,
    speed: unknown,
  ) {
    if (!validVoiceSpeed(speed))
      throw new BadRequestException('Speed must be 0.5–3.0 in steps of 0.05');
    if (
      voice !== null &&
      !s.voiceRuntime?.declaredVoices.some((v) => v.id === voice)
    )
      throw new BadRequestException('Unknown Kokoro voice');
    item.voiceSettings = { voice: voice as string | null, speed };
  }
  private currentAsset(s: StudioSession, item: StudioSession['items'][number]) {
    const settings = item.voiceSettings;
    return s.voiceAssets
      ?.slice()
      .reverse()
      .find(
        (a) =>
          a.itemId === item.id &&
          ['GENERATED', 'APPROVED'].includes(a.status) &&
          a.textHash === textHash(item.spokenText) &&
          a.voice === settings?.voice &&
          a.speed === settings?.speed,
      );
  }
  // Sequential by construction: callers await one item at a time under the session lock.
  private async generateItem(
    s: StudioSession,
    item: StudioSession['items'][number],
    regenerate: boolean,
    preflighted?: NonNullable<StudioSession['voiceRuntime']>,
    draft = false,
  ) {
    if (!draft && item.contentMapping?.status === 'REVIEW_REQUIRED')
      throw new ConflictException(
        'Review Topic/body spoken mapping before TTS',
      );
    if (!item.spokenText.trim() || item.spokenText.length > 12000)
      throw new BadRequestException(
        'Spoken text must contain 1–12000 characters',
      );
    if (!draft && (
      !item.spokenApproval?.valid ||
      item.spokenApproval.textHash !== textHash(item.spokenText)
    ))
      throw new ConflictException('Approve current spoken text before TTS');
    const started = Date.now(),
      startedAt = new Date().toISOString();
    const job: NonNullable<StudioSession['voiceJobs']>[number] = {
      itemId: item.id,
      status: 'ERROR',
      startedAt,
      completedAt: '',
      elapsedMs: 0,
      error: null,
    };
    s.voiceJobs = [...(s.voiceJobs || []), job];
    try {
      await this.tick('Preparing audio');
      s.voiceRuntime = preflighted || (await this.voice.preflight());
      if (s.voiceRuntime.status !== 'READY')
        throw Error('BLOCKED_RUNTIME: ' + s.voiceRuntime.blockers.join('; '));
      const settings = item.voiceSettings;
      if (!settings?.voice)
        throw Error('Select a locally available Kokoro voice');
      const normalizedInput=normalizeSpokenNumbers(item.spokenText);
      if(normalizedInput.warnings.length)throw Error(normalizedInput.warnings.join('; '));
      const oldAsset=this.currentAsset(s,item);
      const inputStale=/\d/.test(item.spokenText) && (oldAsset?.numberReadingVersion!==NUMBER_READING_VERSION || oldAsset?.ttsInputHash!==textHash(normalizedInput.text));
      const modelStale=oldAsset&&oldAsset.modelVersion!==s.voiceRuntime.modelVersion+' / '+s.voiceRuntime.packageVersion;
      const existing = regenerate || inputStale || modelStale ? undefined : oldAsset;
      let usable = false;
      if (existing) {
        try {
          usable =
            (await fs.stat(await this.audioFile(s.id, existing.id))).size > 0;
        } catch {}
      }
      if (existing && usable) {
        job.assetId = existing.id;
        job.status = existing.status === 'APPROVED' ? 'APPROVED' : 'GENERATED';
        job.reused = true;
      } else {
        const result = await this.voice.generate(
          s.id,
          normalizedInput.text,
          settings.voice,
          settings.speed,
          s.voiceRuntime,
          regenerate,
          {itemId:item.id,normalizationVersion:NUMBER_READING_VERSION},
        );
        await this.tick('Saving asset');
        // Returning to cached settings reuses the existing manifest, not another ID.
        const cached =
          !regenerate &&
          s.voiceAssets?.find(
            (a) =>
              a.itemId === item.id &&
              a.textHash === textHash(item.spokenText) &&
              a.voice === settings.voice &&
              a.speed === settings.speed &&
              a.filePath === result.filePath,
          );
        if (cached) {
          cached.status = 'GENERATED';
          cached.cacheHit = true;
          cached.durationMs = result.durationMs;
          job.assetId = cached.id;
          job.status = 'GENERATED';
          job.reused = true;
          job.completedAt = new Date().toISOString();
          job.elapsedMs = Date.now() - started;
          return job;
        }
        for (const a of s.voiceAssets || [])
          if (a.itemId === item.id) a.status = 'STALE';
        const assetId = randomUUID();
        s.voiceAssets = [
          ...(s.voiceAssets || []),
          {
            id: assetId,
            purpose: draft ? 'DRAFT' : 'APPROVED_TEXT',
            itemId: item.id,
            itemRevision: item.revision,
            textHash: textHash(item.spokenText),
            spokenText: item.spokenText,
            ttsInputText: normalizedInput.text,
            ttsInputHash: textHash(normalizedInput.text),
            numberReadingVersion: NUMBER_READING_VERSION,
            voice: settings.voice,
            speed: settings.speed,
            model: s.voiceRuntime.model || 'Kokoro',
            modelVersion:
              s.voiceRuntime.modelVersion +
              ' / ' +
              s.voiceRuntime.packageVersion,
            cacheKey: result.cacheKey,
            durationMs: result.durationMs,
            filePath: result.filePath,
            uri: `/api/studio/sessions/${s.id}/audio/${assetId}`,
            createdAt: new Date().toISOString(),
            approvedAt: null,
            status: 'GENERATED',
            cacheHit: result.cacheHit,
            baseCacheHit: result.baseCacheHit,
            synthesisPerformed: result.synthesisPerformed,
          },
        ];
        job.assetId = assetId;
        job.status = 'GENERATED';
      }
    } catch (e) {
      job.error = e instanceof Error ? e.message : 'TTS failed';
      job.status = 'ERROR';
    }
    job.completedAt = new Date().toISOString();
    job.elapsedMs = Date.now() - started;
    return job;
  }
  async voiceBatch(id: string, body: any) {
    return this.exclusive(async () => {
      const s = await this.load(id);
      if (s.revision !== body?.revision)
        throw new ConflictException(
          'Session changed. Reopen before voice action.',
        );
      const items = s.items
        .filter((i) => i.selected)
        .sort((a, b) => a.order - b.order);
      const results: NonNullable<StudioSession['voiceBatch']>['results'] = [];
      const pendingAmbiguity = (itemId: string) => {
        const p = s.scriptProposals
          ?.filter((x) => x.itemId === itemId)
          .slice(-1)[0];
        return p?.approval === 'PENDING' && p.ambiguousTerms.length > 0;
      };
      if (body.action === 'SETTINGS_ALL') {
        const chosen = body.itemIds;
        if (
          chosen !== undefined &&
          (!Array.isArray(chosen) ||
            !chosen.length ||
            chosen.some((id) => !items.some((i) => i.id === id)))
        )
          throw new BadRequestException(
            'itemIds must identify selected scenes',
          );
        for (const item of items.filter(
          (i) => !chosen || chosen.includes(i.id),
        )) {
          this.applySettings(s, item, body.voice, body.speed);
          results.push({ itemId: item.id, outcome: 'UPDATED', reason: null });
        }
      } else if (body.action === 'APPROVE_ALL_SPOKEN') {
        for (const item of items) {
          if (item.spokenApproval?.valid) {
            results.push({
              itemId: item.id,
              outcome: 'SKIPPED',
              reason: 'Already approved',
            });
          } else if (!item.spokenText.trim()) {
            results.push({
              itemId: item.id,
              outcome: 'SKIPPED',
              reason: 'Spoken text is empty',
            });
          } else if (
            pendingAmbiguity(item.id) ||
            spokenAmbiguities(item.spokenText).length
          ) {
            results.push({
              itemId: item.id,
              outcome: 'SKIPPED',
              reason:
                'Unresolved ambiguous terms in a pending proposal; review it first',
            });
          } else {
            item.spokenApproval = {
              textHash: textHash(item.spokenText),
              revision: item.revision,
              approvedAt: new Date().toISOString(),
              valid: true,
            };
            results.push({
              itemId: item.id,
              outcome: 'APPROVED',
              reason: null,
            });
          }
        }
      } else if (body.action === 'GENERATE_ALL') {
        s.voiceRuntime = await this.voice.preflight();
        const only =
          s.voiceRuntime.voices.length === 1
            ? s.voiceRuntime.voices[0].id
            : null;
        for (const item of items) {
          await this.tick(
            'Batch audio: scene ' + (items.indexOf(item) + 1),
            items.indexOf(item),
            items.length,
          );
          if (!item.spokenApproval?.valid) {
            results.push({
              itemId: item.id,
              outcome: 'SKIPPED',
              reason: 'Spoken text not approved',
            });
            continue;
          }
          try {
            this.applySettings(
              s,
              item,
              item.voiceSettings?.voice ?? only,
              item.voiceSettings?.speed ?? VOICE_SPEED.default,
            );
          } catch (e) {
            results.push({
              itemId: item.id,
              outcome: 'ERROR',
              reason: e instanceof Error ? e.message : 'Invalid settings',
            });
            continue;
          }
          if (!item.voiceSettings?.voice) {
            results.push({
              itemId: item.id,
              outcome: 'SKIPPED',
              reason: 'No voice selected',
            });
            continue;
          }
          let job;
          try {
            job = await this.generateItem(s, item, false, s.voiceRuntime);
          } catch (e) {
            results.push({
              itemId: item.id,
              outcome: 'ERROR',
              reason: e instanceof Error ? e.message : 'TTS failed',
            });
            continue;
          }
          results.push({
            itemId: item.id,
            outcome:
              job.status === 'ERROR'
                ? 'ERROR'
                : job.reused
                  ? 'REUSED'
                  : 'GENERATED',
            reason: job.error,
          });
        }
      } else throw new BadRequestException('Unknown voice batch operation');
      s.voiceBatch = {
        action: body.action,
        at: new Date().toISOString(),
        results,
      };
      return this.persist(s);
    });
  }
  async proposeOfflineAll(id: string, revision: number) {
    return this.exclusive(async () => {
      const s = await this.load(id);
      if (s.revision !== revision)
        throw new ConflictException(
          'Session changed. Reopen before requesting normalization.',
        );
      for (const item of s.items.filter((i) => i.selected)) {
        await this.tick(
          'Offline normalization: item ' + (item.order + 1),
          s.items.filter((i) => i.selected).indexOf(item),
          s.items.filter((i) => i.selected).length,
        );
        const last = s.scriptProposals
          ?.filter((p) => p.itemId === item.id)
          .slice(-1)[0];
        if (last?.approval === 'PENDING' && last.baseRevision === item.revision)
          continue;
        s.scriptProposals = [
          ...(s.scriptProposals || []),
          offlineNormalize(item),
        ];
      }
      return this.persist(s);
    });
  }
  async audioFile(id: string, assetId: string) {
    const s = await this.load(id);
    const a = s.voiceAssets?.find((a) => a.id === assetId);
    if (!a) throw new BadRequestException('Audio asset not found');
    const file = path.resolve(this.root, a.filePath);
    const prefix = path.resolve(this.root, 'audio', id, 'assets') + path.sep;
    if (!file.startsWith(prefix))
      throw new BadRequestException('Invalid audio path');
    return file;
  }
  async gcPreview(id: string) {
    await this.load(id);
    const dir = path.join(this.root, 'audio', id, 'temp');
    const orphanTemps: { name: string; ageHours: number }[] = [];
    try {
      for (const name of await fs.readdir(dir)) {
        const stat = await fs.stat(path.join(dir, name));
        if (stat.isFile() && Date.now() - stat.mtimeMs > 86400000)
          orphanTemps.push({
            name,
            ageHours: Math.floor((Date.now() - stat.mtimeMs) / 3600000),
          });
      }
    } catch {}
    return {
      dryRun: true,
      ttlHours: 24,
      orphanTemps,
      deleted: 0,
      policy:
        'Only this session temp directory; assets/approved/referenced/shared files never deleted. Cleanup is not enabled.',
    };
  }
  async normalizationQuality(id: string) {
    const s = await this.load(id);
    return {
      mode: 'OFFLINE',
      cases: qualityCases(),
      realTargetCases: realQualityCases(),
      selectedItems: s.items
        .filter((i) => i.selected)
        .map((i) => {
          const p = offlineNormalize(i);
          return {
            itemId: i.id,
            originalText: i.originalText,
            input: i.spokenText,
            actual: p.proposedSpokenText,
            labels: p.labels,
            ambiguities: p.ambiguousTerms,
            semanticDrift: 'REQUIRES_HUMAN_REVIEW',
            approval: 'NOT_APPLIED',
          };
        }),
    };
  }
  async decide(id: string, runId: string, revision: number, action: string) {
    return this.exclusive(async () => {
      const s = await this.load(id);
      if (s.revision !== revision)
        throw new ConflictException('Session changed. Reopen before deciding.');
      const run = s.scriptProposals?.find((p) => p.runId === runId);
      if (!run || run.approval !== 'PENDING')
        throw new BadRequestException('Pending proposal not found');
      const item = s.items.find((i) => i.id === run.itemId);
      if (!item) throw new BadRequestException('Item not found');
      if (action === 'ACCEPT' || action === 'ACCEPT_LOCKED') {
        if (
          item.manualLocks.includes('NARRATION_TEXT') &&
          action !== 'ACCEPT_LOCKED'
        )
          throw new ConflictException(
            'Spoken text is manually locked. Proposal is review-only; manually edit text instead.',
          );
        if (
          item.revision !== run.baseRevision ||
          item.spokenText !== run.inputText
        )
          throw new ConflictException(
            'Proposal is stale. Text changed since AI request.',
          );
        if (!run.proposedSpokenText)
          throw new BadRequestException('Proposal has no text');
        item.spokenText = run.proposedSpokenText;
        item.manualLocks = [
          ...new Set([...item.manualLocks, 'NARRATION_TEXT']),
        ];
        item.revision++;
        run.approval = 'ACCEPTED';
        run.explicitLockedTextApproval = action === 'ACCEPT_LOCKED';
      } else if (action === 'REJECT') run.approval = 'REJECTED';
      else throw new BadRequestException('Invalid approval action');
      run.decidedAt = new Date().toISOString();
      return this.persist(s);
    });
  }
  async refreshMetadata(id: string, itemId: string, revision: number) {
    return this.exclusive(async () => {
      const s = await this.load(id);
      if (s.revision !== revision)
        throw new ConflictException('Session changed. Reopen before refresh.');
      const item = s.items.find((i) => i.id === itemId);
      if (!item) throw new BadRequestException('Item not found');
      const attempt = await this.extract(
        threadsUrl(item.sourceUrl),
        'TARGET_ONLY',
      );
      if (!attempt.matchedTargetId || !attempt.records[0])
        throw new BadRequestException(
          'Metadata refresh could not verify exact target',
        );
      const record = attempt.records[0];
      item.metadataObservations = [
        ...(item.metadataObservations || []),
        { observedAt: attempt.retrievedAt, record: structuredClone(record) },
      ];
      if (!item.manualLocks.includes('METADATA')) {
        item.metadata = structuredClone(record);
        item.mediaReferences = record.media.map((m) => m.url);
        item.author = {
          displayName: record.author,
          ...(record.handle ? { handle: record.handle } : {}),
          ...(record.avatar ? { avatarUrl: record.avatar } : {}),
        };
      }
      item.revision++;
      return this.persist(s);
    });
  }
  async exactCopy(id: string) {
    const old = await this.load(id);
    const created = await this.create();
    created.title = old.title + ' — exact targets';
    created.project.title = created.title;
    created.derivedFrom = old.id;
    created.archivedItems = structuredClone(old.items);
    await this.exclusive(() => this.persist(created));
    const urls = (old.attempts || []).map((a) => a.originalUrl);
    if (!urls.length) return created;
    if (urls.length > 5)
      throw new BadRequestException('Copy supports up to five input URLs');
    return this.mutate(
      created.id,
      { revision: created.revision, urls, scope: 'TARGET_ONLY' },
      true,
    );
  }
  private append(s: StudioSession, url: string, post: any, comments: any[]) {
    const sourceId = randomUUID(),
      postId = randomUUID();
    s.project.sources.push({
      id: sourceId,
      platform: 'THREADS',
      canonicalUrl: url,
      retrievedAt: new Date().toISOString(),
      synthetic: false,
    });
    const commentIds: string[] = [];
    [post, ...comments].forEach((raw, index) => {
      if (typeof raw.text !== 'string' || !raw.text.trim()) return;
      const id = index === 0 ? postId : randomUUID();
      const author = { displayName: String(raw.author || 'Unknown') };
      const ref: SourceReference = {
        entityType: index === 0 ? 'POST' : 'COMMENT',
        entityId: id,
      };
      s.items.push({
        inclusion: 'MANUAL',
        sourceId,
        rawExtraction: {
          text: raw.text,
          author: author.displayName,
          handle: null,
          avatar: null,
          createdAt: null,
          type: 'UNKNOWN',
          parentReference: null,
          media: [],
          likeCount: null,
          replyCount: null,
          repostCount: null,
          provenance: { text: 'manual import', type: 'unavailable' },
        },
        metadata: {
          text: raw.text,
          author: author.displayName,
          handle: null,
          avatar: null,
          createdAt: null,
          type: 'UNKNOWN',
          parentReference: null,
          media: [],
          likeCount: null,
          replyCount: null,
          repostCount: null,
          provenance: { text: 'manual import', type: 'unavailable' },
        },
        id,
        sourceReference: ref,
        sourceUrl: url,
        author,
        originalText: raw.text,
        spokenText: raw.bodyText ?? raw.text,
        displayText: raw.bodyText ?? raw.text,
        ...(raw.topic && raw.topicEvidence
          ? {
              contentMapping: {
                topic: raw.topic,
                bodyText: raw.bodyText ?? raw.text,
                status: 'VERIFIED' as const,
                evidence: {
                  type: 'DOM' as const,
                  detail: 'Exact target topic link: ' + raw.topicEvidence.href,
                  sourceUrl: url,
                },
                includeTopicInTts: false,
              },
            }
          : {}),
        mediaReferences: [raw.avatar, raw.attachedImage].filter(
          (x) => typeof x === 'string' && x,
        ),
        selected: index === 0,
        order: s.items.length,
        revision: 0,
        manualLocks: [],
      });
      if (index === 0)
        s.project.posts.push({
          id,
          sourceId,
          author,
          text: raw.text,
          mediaAssetIds: [],
          commentIds,
        });
      else {
        commentIds.push(id);
        s.project.comments.push({
          id,
          sourceId,
          postId,
          author,
          text: raw.text,
          mediaAssetIds: [],
        });
      }
    });
  }
}
