import { sessionReadiness } from './session-readiness';
import { cleanSourceProjection } from './source-quality';
import { classifyContext } from './context-classification';
import { assertNoLocalProbe } from './local-probe-lease';
import { ttsFailureCategory, LocalTtsExecution } from './tts-resource-policy';
import { localOcr, imageNarration } from './media-ocr';
import { conversationMediaFile } from '../data-engine/conversation-media';
import {
  validatePronunciations,
  SPEECH_DICTIONARY_VERSION,
} from './speech-dictionary';
import { prepareTtsInput } from './speech-normalizer';
import { SPEECH_POLICY_VERSION } from './speech-rules';
import { editorialScriptHash } from '../data-engine/editorial-script-state';
import { uploadSignature, probeUpload, validCategory } from './uploaded-media';
import { replaceFile } from './atomic-file';
import { cacheSourceImage, isPlaceholderAvatarUrl } from './source-images';
import { RenderStore } from './render-store';
import {
  renderValidation,
  validateRenderRequest,
  snapshotHash,
  renderBackground,
} from './render-policy';
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
import { normalizeText, normalizationProviderConfig } from './normalization';
import { scriptReport } from './script-report';
import {
  offlineNormalize,
  qualityCases,
  realQualityCases,
} from './offline-normalization';
import { KokoroRuntime, textHash, resolveStudioDataRoot } from './kokoro-runtime';
import { analyzeWavBuffer, buildSceneTtsDiagnostic } from './tts-diagnostics';
import { voiceReport } from './voice-report';
import { StudioJobs, ProgressSink } from './progress';
import { PublicAssets, seriousDraftAssets } from './public-assets';
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
import type {
  ThreadCollection,
  ConversationReview,
  VerifiedReply,
} from '../data-engine/conversation-contracts';
import { observedContextViews } from '../data-engine/conversation-context';
import { canonicalPost } from '../data-engine/conversation-identity';
import { editorialSession } from '../data-engine/editorial-adapter';
import type { EditorialPlan } from '../data-engine/editorial-contracts';
import { defaultBgm } from '../video-pipeline/scene-visual';

export function threadsUrl(value: unknown): string {
  return validateThreadsUrl(value);
}
@Injectable()
export class StudioService {
  async mediaOcr(id: string, itemId: string, sha: string, body: any) {
    return this.exclusive(async () => {
      const s = await this.load(id);
      if (s.revision !== body?.revision)
        throw new ConflictException('STALE_REVISION');
      const item = s.items.find((i) => i.id === itemId),
        asset = item?.localSourceMedia?.find(
          (a) => a.sha256 === sha && a.status === 'DOWNLOADED',
        );
      if (!item || !asset)
        throw new BadRequestException(
          'OCR requires a cached image belonging to this item',
        );
      item.mediaOcr ??= {};
      const old = item.mediaOcr[sha];
      if (body.action === 'OCR') {
        if (!old)
          item.mediaOcr[sha] = await localOcr(
            await conversationMediaFile(sha),
            sha,
            asset.sourceUrl,
          );
      } else if (body.action === 'SAVE') {
        if (!old || old.revision !== body.ocrRevision)
          throw new ConflictException('OCR_STALE_REVISION');
        if (
          typeof body.text !== 'string' ||
          body.text.length > 20000 ||
          typeof body.summary !== 'string' ||
          body.summary.length > 10000 ||
          !['READ_FULL', 'SUMMARIZE', 'SKIP'].includes(body.mode) ||
          body.confirmReview !== true ||
          !['USER', 'AGENT_VISUAL'].includes(body.reviewer)
        )
          throw new BadRequestException('Review OCR text and mode explicitly');
        item.mediaOcr[sha] = {
          ...old,
          correctedText: body.text,
          summaryText: body.summary,
          mode: body.mode,
          review: 'REVIEWED',
          reviewer: body.reviewer,
          revision: old.revision + 1,
        };
      } else if (body.action === 'APPLY') {
        if (!old || old.revision !== body.ocrRevision)
          throw new ConflictException('OCR_STALE_REVISION');
        if (
          item.mediaNarrationAppliedHash &&
          item.mediaNarrationAppliedHash !== textHash(item.spokenText)
        )
          throw new ConflictException(
            'Narration manually changed; preserve edits before rebuilding image narration',
          );
        if (
          item.manualLocks.includes('NARRATION_TEXT') &&
          body.confirmReplaceLocked !== true
        )
          throw new ConflictException(
            'Narration locked; explicit replacement required',
          );
        const parts = imageNarration(
          item.mediaOcr,
          item
            .localSourceMedia!.map((a) => a.sha256)
            .filter((h): h is string => !!h),
        );
        item.mediaNarrationBaseText ??= item.spokenText;
        item.spokenText = [item.mediaNarrationBaseText, ...parts]
          .filter(Boolean)
          .join('\n\n');
        item.mediaNarrationAppliedHash = textHash(item.spokenText);
        item.mediaNarrationApplied = item
          .localSourceMedia!.map((a) =>
            a.sha256 ? item.mediaOcr![a.sha256] : undefined,
          )
          .filter((o) => o?.review === 'REVIEWED' && o.mode !== 'SKIP')
          .map((o) => ({
            imageHash: o!.imageHash,
            sourceUrl: o!.sourceUrl,
            mode: o!.mode as 'READ_FULL' | 'SUMMARIZE',
            reviewer: o!.reviewer,
            ocrRevision: o!.revision,
            text: o!.mode === 'SUMMARIZE' ? o!.summaryText : o!.correctedText,
          }));
      } else throw new BadRequestException('Unknown OCR action');
      item.revision++;
      return this.persist(s);
    });
  }
  readonly renders = new RenderStore();
  async readiness(id: string) {
    return sessionReadiness(await this.load(id), this.root);
  }
  async saveRights(id: string, body: any) {
    return this.exclusive(async () => {
      const s = await this.load(id);
      if (s.revision !== body.revision)
        throw new ConflictException(
          'Session changed before rights declaration',
        );
      if (
        typeof body.assetId !== 'string' ||
        body.assetId.length > 160 ||
        !['UNKNOWN', 'OWNED', 'LICENSED', 'PERMISSION'].includes(body.status) ||
        typeof body.evidence !== 'string' ||
        body.evidence.length > 2000 ||
        (body.status !== 'UNKNOWN' && !body.evidence.trim())
      )
        throw new BadRequestException(
          'Rights need an explicit status and evidence reference',
        );
      s.mediaRights ??= {};
      s.mediaRights[body.assetId] = {
        status: body.status,
        evidence: body.evidence,
        at: new Date().toISOString(),
      };
      return this.persist(s);
    });
  }
  private async ensureCachedAvatars(s: StudioSession, forceAll = false) {
    s.sourceImages ??= {};
    for (const i of s.items.filter((i) => i.selected)) {
      const customUrl = [
        i.author.avatarUrl,
        i.metadata?.avatar,
        i.rawExtraction?.avatar,
      ].find(
        (u) =>
          typeof u === 'string' && !!u.trim() && !isPlaceholderAvatarUrl(u),
      );
      const url =
        customUrl ??
        i.metadata?.avatar ??
        i.rawExtraction?.avatar ??
        i.author.avatarUrl;
      if (!url) continue;
      if (isPlaceholderAvatarUrl(url)) {
        s.sourceImages[i.id] = {
          itemId: i.id,
          sourceUrl: url,
          status: 'UNAVAILABLE',
          uri: null,
          error: 'AVATAR_UNAVAILABLE: generic static placeholder sprite',
          provenance: 'PUBLIC_CDN',
          checkedAt: new Date().toISOString(),
        };
        continue;
      }
      let supportedCdn = false;
      try {
        const parsed = new URL(url);
        supportedCdn =
          parsed.protocol === 'https:' &&
          /(^|\.)(cdninstagram\.com|fbcdn\.net)$/i.test(parsed.hostname);
      } catch {}
      if (!supportedCdn && !forceAll) continue;
      const old = s.sourceImages[i.id];
      if (
        old?.status === 'READY' &&
        old.sourceUrl === url &&
        old.fileName &&
        (
          await fs
            .stat(path.join(this.root, 'source-images', s.id, old.fileName))
            .catch(() => null)
        )?.size
      )
        continue;
      await this.tick('Caching original avatar: ' + i.author.displayName);
      s.sourceImages[i.id] = await cacheSourceImage(
        s.id,
        i.id,
        url,
        path.join(this.root, 'source-images'),
      );
    }
  }
  async cacheAvatars(id: string, revision: number) {
    return this.exclusive(async () => {
      const s = await this.load(id);
      if (s.revision !== revision)
        throw new ConflictException('Session changed');
      await this.ensureCachedAvatars(s, true);
      return this.persist(s);
    });
  }
  private async adoptCachedAvatars(s: StudioSession) {
    const selected = s.items.filter((item) => item.selected);
    if (!selected.length) return false;
    const sources = new Map<
      string,
      {
        sessionId: string;
        image: NonNullable<StudioSession['sourceImages']>[string];
      }[]
    >();
    const handlesBySha = new Map<string, Set<string>>();
    const defaultByIdentity = new Map<string, string>();
    for (const name of await fs.readdir(this.root)) {
      if (!/^[a-f0-9-]{36}\.json$/.test(name) || name === s.id + '.json')
        continue;
      const prior = await this.load(name.slice(0, -5)).catch(() => null);
      if (!prior) continue;
      for (const item of prior.items) {
        const identity = canonicalPost(item.sourceUrl);
        const handle = item.author.handle?.toLowerCase();
        if (!identity || !handle) continue;
        const key = identity.id + ':' + handle;
        const observedUrls = [
          item.author.avatarUrl,
          item.metadata?.avatar,
          item.rawExtraction?.avatar,
          prior.sourceImages?.[item.id]?.sourceUrl,
        ].filter((u): u is string => typeof u === 'string' && !!u.trim());
        const defaultUrl = observedUrls.find((u) => isPlaceholderAvatarUrl(u));
        if (defaultUrl && !defaultByIdentity.has(key)) {
          defaultByIdentity.set(key, defaultUrl);
        }
        const image = prior.sourceImages?.[item.id];
        const customUrl = observedUrls.find((u) => !isPlaceholderAvatarUrl(u));
        if (
          image?.status !== 'READY' ||
          image.provenance !== 'PUBLIC_CDN' ||
          isPlaceholderAvatarUrl(image.sourceUrl) ||
          image.sourceUrl !== customUrl ||
          !/^[a-f0-9]{64}$/.test(image.sha256 || '') ||
          !new RegExp(
            '^' + image.sha256 + '\\.(?:png|jpe?g|webp|gif)$',
          ).test(image.fileName || '')
        )
          continue;
        const shaHandles = handlesBySha.get(image.sha256!) ?? new Set<string>();
        shaHandles.add(handle);
        handlesBySha.set(image.sha256!, shaHandles);
        const candidates = sources.get(key) ?? [];
        candidates.push({ sessionId: name.slice(0, -5), image });
        sources.set(key, candidates);
      }
    }
    let changed = false;
    for (const item of selected) {
      const current = s.sourceImages?.[item.id];
      if (
        current?.status === 'READY' &&
        (isPlaceholderAvatarUrl(current.sourceUrl) ||
          (current.sha256 &&
            (handlesBySha.get(current.sha256)?.size ?? 0) > 1))
      ) {
        s.sourceImages![item.id] = {
          itemId: item.id,
          sourceUrl: current.sourceUrl,
          status: 'UNAVAILABLE',
          uri: null,
          error: 'AVATAR_UNAVAILABLE: generic static placeholder sprite',
          provenance: 'PUBLIC_CDN',
          checkedAt: new Date().toISOString(),
        };
        if (
          item.metadata?.avatar &&
          !isPlaceholderAvatarUrl(item.metadata.avatar)
        ) {
          item.metadata.avatar = current.sourceUrl;
        }
        changed = true;
      }
    }
    const pending = selected.filter(
      (item) => s.sourceImages?.[item.id]?.status !== 'READY',
    );
    for (const item of pending) {
      const identity = canonicalPost(item.sourceUrl);
      const handle = item.author.handle?.toLowerCase();
      const key = identity?.id + ':' + handle;
      const customAvatar =
        [
          item.author.avatarUrl,
          item.metadata?.avatar,
          item.rawExtraction?.avatar,
        ].find(
          (u) =>
            typeof u === 'string' && !!u.trim() && !isPlaceholderAvatarUrl(u),
        ) ?? null;
      const candidates = (sources.get(key) || []).filter(
        (candidate) =>
          (!customAvatar || candidate.image.sourceUrl === customAvatar) &&
          handlesBySha.get(candidate.image.sha256!)?.size === 1,
      );
      let adopted = false;
      if (
        new Set(candidates.map((candidate) => candidate.image.sha256)).size ===
        1
      ) {
        for (const { sessionId, image } of candidates) {
          const source = path.join(
            this.root,
            'source-images',
            sessionId,
            image.fileName!,
          );
          const stat = await fs.lstat(source).catch(() => null);
          if (!stat?.isFile() || !stat.size || stat.size > 10 * 1024 * 1024)
            continue;
          const bytes = await fs.readFile(source);
          if (createHash('sha256').update(bytes).digest('hex') !== image.sha256)
            continue;
          const dir = path.join(this.root, 'source-images', s.id);
          await fs.mkdir(dir, { recursive: true });
          const target = path.join(dir, image.fileName!);
          await fs.writeFile(target, bytes, { flag: 'wx' }).catch((error) => {
            if (error.code !== 'EEXIST') throw error;
          });
          if (
            createHash('sha256')
              .update(await fs.readFile(target))
              .digest('hex') !== image.sha256
          )
            continue;
          s.sourceImages ??= {};
          s.sourceImages[item.id] = {
            ...image,
            itemId: item.id,
            uri: `/api/studio/sessions/${s.id}/source-images/${image.sha256}`,
          };
          item.author.avatarUrl = image.sourceUrl;
          if (
            item.metadata &&
            (!item.metadata.avatar ||
              isPlaceholderAvatarUrl(item.metadata.avatar))
          ) {
            item.metadata.avatar = image.sourceUrl;
          }
          changed = true;
          adopted = true;
          break;
        }
      }
      if (
        !adopted &&
        ![
          item.author.avatarUrl,
          item.metadata?.avatar,
          item.rawExtraction?.avatar,
        ].some((u) => typeof u === 'string' && !!u.trim())
      ) {
        const defaultUrl = defaultByIdentity.get(key);
        if (defaultUrl) {
          item.author.avatarUrl = defaultUrl;
          changed = true;
        }
      }
    }
    return changed;
  }

  restoreOperatorAvatars(id: string, revision: number) {
    return this.exclusive(async () => {
      const s = await this.load(id);
      if (s.revision !== revision) throw new ConflictException('STALE_REVISION');
      if (!await this.adoptCachedAvatars(s)) return s;
      delete s.project.timeline;
      return this.persist(s);
    });
  }
  async sourceImageFile(id: string, sha: string) {
    if (!/^[a-f0-9]{64}$/.test(sha))
      throw new BadRequestException('Invalid image hash');
    const s = await this.load(id),
      a = Object.values(s.sourceImages || {}).find(
        (a) => a.status === 'READY' && a.sha256 === sha,
      );
    if (!a?.fileName || path.basename(a.fileName) !== a.fileName)
      throw new BadRequestException('Unknown session avatar');
    return path.join(this.root, 'source-images', id, a.fileName);
  }
  async renderInfo(id: string) {
    const s = await this.load(id),
      preview = await this.preview(id);
    return {
      revision: s.revision,
      title: s.title,
      request: preview.request,
      validation: renderValidation(s, preview.request.inputProps),
      renders: await this.renders.list(id),
    };
  }
  private async renderJob(
    id: string,
    input: RenderRequest,
    tick: ProgressSink,
    jobId: string,
    operatorGate?: (session: StudioSession, props: ReturnType<typeof renderBackground>) => Promise<void>,
  ) {
    return this.exclusive(async () => {
      assertNoLocalProbe();
      const s = await this.load(id);
      if (s.revision !== input.revision)
        throw new ConflictException(
          'Project changed; reload Render before exporting',
        );
      if (!operatorGate) await this.ensureCachedAvatars(s);
      const built = prepareEditor(s, await this.visualAssets(s)),
        props = renderBackground(
          built.preview.request.inputProps,
          input.backgroundMode,
        );
      const range = validateRenderRequest(input, props),
        validation = renderValidation(s, props);
      await operatorGate?.(s, props);
      if (
        validation.blockers.length ||
        (input.mode === 'FINAL' && validation.finalBlockers.length)
      )
        throw new BadRequestException(
          [
            ...validation.blockers,
            ...(input.mode === 'FINAL' ? validation.finalBlockers : []),
          ].join('; '),
        );
      await this.voice.closeAndWait();
      const candidates = [
        process.env.STUDIO_BROWSER,
        'C:/Program Files/Google/Chrome/Application/chrome.exe',
        'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
        'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
      ].filter(Boolean) as string[];
      let browserExecutable = '';
      for (const f of candidates)
        if ((await fs.stat(f).catch(() => null))?.isFile()) {
          browserExecutable = f;
          break;
        }
      if (!browserExecutable)
        throw new BadRequestException(
          'BLOCKED_RUNTIME: install/configure an existing browser; no automatic download',
        );
      const disk = await fs.statfs(this.root);
      if (disk.bavail * disk.bsize < 3 * 1024 ** 3)
        throw new BadRequestException('Less than 3 GiB free on project drive');
      const is1080 = input.preset !== '720P';
      const targetFps =
        input.preset === '1080P60' ? 60 : (input.fps ?? props.timeline.fps);
      const fpsScale = targetFps / props.timeline.fps;
      const outputRange: [number, number] = [
        Math.round(range[0] * fpsScale),
        Math.round((range[1] + 1) * fpsScale) - 1,
      ];
      const manifest: RenderManifest = {
        schemaVersion: 1,
        backgroundMode: input.backgroundMode || 'SAVED',
        jobId,
        sessionId: id,
        projectId: s.project.id,
        revision: s.revision,
        timelineHash: snapshotHash(props.timeline),
        previewHash: snapshotHash(props),
        mode: input.mode,
        publishable: false,
        status: 'QUEUED',
        width: is1080 ? 1080 : 720,
        height: is1080 ? 1920 : 1280,
        fps: targetFps,
        totalFrames: Math.round(props.timeline.totalFrames * fpsScale),
        frameRange: outputRange,
        expectedDurationSeconds: (range[1] - range[0] + 1) / props.timeline.fps,
        sceneCount: props.timeline.scenes.length,
        codec: 'h264',
        audioCodec: 'aac',
        pixelFormat: 'yuv420p',
        concurrency: 1,
        startedAt: new Date().toISOString(),
        completedAt: null,
        bytes: null,
        warnings: [
          ...built.preview.warnings,
          ...validation.warnings,
          ...(input.mode === 'DRAFT'
            ? [
                'DRAFT: not approved for publishing',
                ...validation.finalBlockers,
              ]
            : []),
        ],
        error: null,
        metrics: {},
      };
      const result = await this.renders.run(
        {
          props,
          manifest,
          browserExecutable,
          appOrigin: `http://127.0.0.1:${process.env.PORT || 3000}`,
        },
        this.jobs,
        tick,
      );
      return { revision: s.revision, warnings: result.warnings };
    });
  }
  runOperatorDraft(
    id: string, revision: number, requestId: string, tick: ProgressSink, jobId: string,
    gate: NonNullable<Parameters<StudioService['renderJob']>[4]>,
  ) {
    return this.renderJob(id, {revision, requestId, mode: 'DRAFT', preset: '720P', backgroundMode: 'SAVED'}, tick, jobId, gate);
  }
  readonly publicAssets = new PublicAssets();
  /**
   * Selects only the known local SERIOUS DRAFT assets. Local availability is
   * not a publishing-rights declaration; both assets remain UNKNOWN there.
   */
  async applyAutomaticSeriousAssets(id: string, revision: number, gameplay?: 'PRESET' | 'OFF') {
    return this.exclusive(async () => {
      const s = await this.load(id);
      if (s.revision !== revision)
        throw new ConflictException(
          'Session changed before automatic media selection.',
        );
      if (s.project.style !== 'SERIOUS') return s;
      const configured = (process.env.STUDIO_SERIOUS_GAMEPLAY_ASSET_IDS || '').split(',').map(id => id.trim()).filter(Boolean);
      const selected = seriousDraftAssets(await this.publicAssets.inventory(), [...new Set(configured)]);
      const settings = editorSettings(s);
      const appliedAssetIds = new Set<string>();
      let changed = false;
      if (gameplay === 'OFF' && settings.automaticGameplay !== 'OFF') {
        settings.automaticGameplay = 'OFF';
        changed = true;
      } else if (gameplay === 'PRESET' && settings.automaticGameplay === 'OFF') {
        delete settings.automaticGameplay;
        changed = true;
      }
      let chosen: Awaited<ReturnType<PublicAssets['resolve']>> | undefined;
      if (
        settings.automaticGameplay !== 'OFF' && !settings.backgroundTracks?.length &&
        !settings.backgroundId && !settings.scenes.some(scene => scene.visual?.backgroundId)
      ) {
        for (const candidate of selected.gameplay) {
          const asset = await this.publicAssets.resolve(candidate.id).catch(() => null);
          if (asset?.durationMs >= 34 && asset.width > 0 && asset.height > 0) {
            chosen = asset;
            break;
          }
        }
        if (!chosen) throw new BadRequestException('GAMEPLAY_ASSET_UNAVAILABLE');
        settings.backgroundTracks = [
          {
            id: 'bg-threads-gameplay',
            assetId: chosen.id,
            startMs: 0,
            durationMs: chosen.durationMs,
            sourceInMs: 0,
            sourceOutMs: chosen.durationMs,
            loop: true,
            enabled: true,
            autoFitTimeline: true,
          },
        ];
        appliedAssetIds.add(chosen.id);
        changed = true;
      }
      if (selected.bgm && !settings.backgroundMusic?.assetId) {
        settings.backgroundMusic = {
          ...defaultBgm(),
          assetId: selected.bgm.id,
          enabled: true,
        };
        appliedAssetIds.add(selected.bgm.id);
        changed = true;
      }
      for (const asset of [chosen, selected.bgm]) {
        if (!asset || !appliedAssetIds.has(asset.id)) continue;
        s.mediaRights ??= {};
        if (!s.mediaRights[asset.id]) {
          s.mediaRights[asset.id] = {
            status: 'UNKNOWN',
            evidence:
              'User-provided local asset available for internal DRAFT only; publishing/commercial rights are not asserted.',
            at: new Date().toISOString(),
          };
          changed = true;
        }
      }
      if (!changed) return s;
      s.editor = settings;
      delete s.project.timeline;
      return this.persist(s);
    });
  }
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
    for (const c of s.editor?.backgroundTracks || [])
      if (c.assetId.startsWith('pub-')) ids.add(c.assetId);
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
          x.visual?.backgroundId === assetId ||
          x.visual?.sfx.assetId === assetId,
      );
      if (
        s.items.some(
          (i) =>
            i.mediaReferences.includes(a.uri) ||
            i.metadata?.media.some((m) => m.url === a.uri),
        ) ||
        s.project.posts.some((p) => p.mediaAssetIds.includes(assetId)) ||
        s.project.comments.some((c) => c.mediaAssetIds.includes(assetId))
      )
        throw new ConflictException(
          'Asset is still referenced by source content',
        );
      for (const row of await this.list())
        if (row.id !== id) {
          const other = await this.load(row.id);
          if (
            JSON.stringify({
              items: other.items,
              project: other.project,
              editor: other.editor,
            }).includes(a.uri)
          )
            throw new ConflictException(
              'Asset is referenced by another session; deletion refused',
            );
        }
      if (
        refs.length ||
        s.project.backgroundTracks?.some((c) => c.assetId === assetId) ||
        s.project.backgroundMusic?.assetId === assetId ||
        s.project.storyboard.some((x) => x.sfxLayer?.assetId === assetId) ||
        s.editor?.backgroundId === assetId ||
        s.editor?.backgroundMusic?.assetId === assetId ||
        s.editor?.backgroundTracks?.some((c) => c.assetId === assetId) ||
        s.project.storyboard.some(
          (x) =>
            x.mediaAssetIds.includes(assetId) ||
            x.visual?.backgroundId === assetId ||
            x.visual?.meme.assetId === assetId,
        )
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
      async (tick, jobId) => {
        if (operation === 'render')
          return this.renderJob(id, input, tick, jobId);
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
        await this.visualAssets({ ...s, editor: body.settings }),
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
  async preparePreview(id: string, revision: number, cachedAvatarsOnly = false) {
    return this.exclusive(async () => {
      const s = await this.load(id);
      if (s.revision !== revision)
        throw new ConflictException(
          'Project changed; reopen before preparing preview',
        );
      if (cachedAvatarsOnly) await this.adoptCachedAvatars(s);
      else await this.ensureCachedAvatars(s);
      await this.tick('Building deterministic timeline');
      const built = prepareEditor(s, await this.visualAssets(s));
      for (const a of built.project.audioAssets)
        if (
          (
            await fs.stat(
              a.id.startsWith('pub-')
                ? (await this.publicAssets.file(a.id)).file
                : a.id.startsWith('media-')
                  ? await this.mediaFile(id, a.id)
                  : await this.audioFile(id, a.id),
            )
          ).size === 0
        )
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
      const duplicate = s.studioMedia?.find((a) => a.id === assetId);
      if (duplicate && duplicate.category !== category) {
        if (JSON.stringify(s.editor).includes(assetId))
          throw new ConflictException(
            'Existing file is referenced in another category; remove it from timeline before recategorizing',
          );
        duplicate.category = category as any;
      }
      if (!duplicate) {
        const dir = path.join(this.root, 'media', id);
        await fs.mkdir(dir, { recursive: true });
        const fileName = hash + '.' + info.extension;
        await fs
          .writeFile(path.join(dir, fileName), file.buffer, { flag: 'wx' })
          .catch((e) => {
            if (e.code !== 'EEXIST') throw e;
          });
        const measured = await probeUpload(path.join(dir, fileName), info.kind);
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
    requestId?: string,
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
        requestId,
        category,
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
  async categoryMedia(id: string, assetId: string, body: any) {
    return this.exclusive(async () => {
      const s = await this.load(id);
      if (s.revision !== body.revision)
        throw new ConflictException('Project changed');
      const a = s.studioMedia?.find((a) => a.id === assetId);
      if (!a || !validCategory(body.category, a.kind))
        throw new BadRequestException('Invalid uploaded category');
      if (JSON.stringify(s.editor).includes(assetId))
        throw new ConflictException(
          'Remove from timeline before changing category',
        );
      a.category = body.category;
      return this.persist(s);
    });
  }
  async mediaFile(id: string, assetId: string) {
    const s = await this.load(id),
      asset = s.studioMedia?.find((a) => a.id === assetId);
    if (
      !asset ||
      !/^[a-f0-9]{64}\.(png|gif|jpg|webp|mp3|wav|m4a|ogg|mp4|webm)$/.test(
        asset.fileName,
      )
    )
      throw new BadRequestException('Unknown local media');
    return path.join(this.root, 'media', id, asset.fileName);
  }
  private root = process.env.STUDIO_DATA_ROOT
    ? path.resolve(process.env.STUDIO_DATA_ROOT)
    : path.resolve(process.cwd(), '.studio-data');
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
  /** Materializes a reviewed editorial DRAFT into the same Source project. No approval, TTS or render is implied. */
  async applyEditorialDraft(id: string, revision: number, plan: EditorialPlan) {
    return this.exclusive(async () => {
      const session = await this.load(id);
      if (session.revision !== revision)
        throw new ConflictException(
          'Session changed. Reopen before applying Script DRAFT.',
        );
      const priorPlan = session.project.editorialPlan;
      if (priorPlan?.id === plan.id && priorPlan.revision === plan.revision)
        return session;
      const materialized = editorialSession(session, structuredClone(plan));
      return this.persist(materialized);
    });
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
    if (
      s.project.editorialApproval &&
      s.project.editorialApproval.scriptHash !== editorialScriptHash(s)
    )
      s.project.editorialApproval.status = 'STALE';
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
        (!!a.ttsInputHash &&
          a.ttsInputHash !==
            prepareTtsInput(item.spokenText, item.pronunciationOverrides)
              .ttsInputHash) ||
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
            durationSource:
              a.durationEvidence === 'SYNTHETIC_FIXTURE'
                ? ('FIXTURE' as const)
                : ('MEASURED' as const),
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
  private async exclusive<T>(fn: () => Promise<T>, leaseToken?: string) {
    assertNoLocalProbe(leaseToken);
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
  async withControlledCollection<T>(fn: () => Promise<T>) {
    return this.exclusive(async () => {
      assertNoLocalProbe();
      this.voice.close();
      return fn();
    });
  }
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
  /** Explicit human-triggered DRAFT bridge. It never changes data-quality, rights or production approval. */
  async createConversationDraft(
    collection: ThreadCollection,
    review: ConversationReview,
    requestId?: string,
    cachedAvatarsOnly = false,
  ) {
    return this.exclusive(async () => {
      const root = collection.root,
        derivedFrom = 'conversation:' + review.collectionId,
        selectedObserved = new Set(review.selectedObservedUrls || []),
        selectedReplies = new Set(review.selectedReplyIds),
        expectedSelectedUrls = [
          ...new Set(
            [
              canonicalPost(root.url)?.url ?? root.url,
              ...Array.from(selectedObserved, (u) => canonicalPost(u)?.url ?? u),
              ...collection.replies
                .filter((r) => selectedReplies.has(r.id))
                .map((r) => canonicalPost(r.url)?.url ?? r.url),
            ].filter(Boolean),
          ),
        ].sort(),
        selectionSignature = JSON.stringify(expectedSelectedUrls);
      await fs.mkdir(this.root, { recursive: true });
      for (const f of await fs.readdir(this.root)) {
        if (!/^[a-f0-9-]{36}\.json$/.test(f)) continue;
        const existing = await this.load(f.slice(0, -5));
        if (existing.derivedFrom !== derivedFrom) continue;
        if (
          requestId &&
          existing.draftProvenance?.requestId &&
          existing.draftProvenance.requestId === requestId
        ) {
          if (
            existing.draftProvenance.reviewRevision !== review.revision ||
            existing.draftProvenance.selectionSignature !== selectionSignature
          )
            throw new ConflictException('CONVERSATION_DRAFT_IDEMPOTENCY_CONFLICT');
          return existing;
        }
        const existingRevision = existing.draftProvenance?.reviewRevision ?? 0;
        if (existingRevision !== review.revision) continue;
        const existingSelectionSignature =
          existing.draftProvenance?.selectionSignature ??
          JSON.stringify(
            [
              ...new Set(
                existing.items
                  .filter((item) => item.selected)
                  .map(
                    (item) =>
                      canonicalPost(item.sourceUrl)?.url ?? item.sourceUrl,
                  )
                  .filter(Boolean),
              ),
            ].sort(),
          );
        if (existingSelectionSignature === selectionSignature) return existing;
      }
      const id = randomUUID();
      const project: VideoProject = {
        contractVersion: '1.0',
        id,
        style: 'SERIOUS',
        title: 'Threads Draft · @' + root.author.handle,
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
      const s: StudioSession = {
        id,
        title: project.title,
        revision: 0,
        updatedAt: '',
        status: 'IDLE',
        scope: 'TARGET_ONLY',
        errors: [],
        project,
        items: [],
      };
      const source = collection.sourceCapture?.records[0];
      const rootRaw: any = source ? { ...source, url: root.url, avatar: source.avatar ?? root.author.avatarUrl ?? null } : {
        url: root.url,
        text: root.originalText,
        bodyText: root.originalText,
        author: root.author.name ?? root.author.handle,
        handle: root.author.handle,
        avatar: root.author.avatarUrl ?? null,
        createdAt: root.publishedAt,
        type: root.itemType ?? 'UNKNOWN',
        parentReference: null,
        media: (root.attachments || []).map((a) => ({
          url: a.sourceUrl,
          kind: a.kind,
        })),
        likeCount: root.engagement.likes,
        replyCount: root.engagement.replies,
        repostCount: root.engagement.reposts,
        shareCount: root.engagement.shares,
        provenance: {
          text: root.provenance.method,
          type: 'catalog type preserved',
        },
      };
      const observed = observedContextViews(collection),
        records: any[] = [...observed.map((x) => x.raw)];
      for (const reply of collection.replies)
        if (!records.some((x) => canonicalPost(x.url)?.id === reply.id))
          records.push(this.replyRecord(reply, collection));
      this.append(s, root.url, rootRaw, records);
      s.derivedFrom = derivedFrom;
      s.draftProvenance = {
        collectionId: review.collectionId,
        reviewRevision: review.revision,
        ...(requestId ? { requestId } : {}),
        selectionSignature,
      };
      s.title = 'Threads Draft · @' + root.author.handle;
      s.project.title = s.title;
      for (const item of s.items) {
        const raw = item.order === 0 ? rootRaw : records[item.order - 1],
          own = canonicalPost(raw.url);
        item.inclusion = item.order === 0 ? 'TARGET' : 'EXPLICIT_CONTEXT';
        item.sourceUrl = own?.url ?? root.url;
        item.rawExtraction = structuredClone(raw);
        item.metadata = structuredClone(raw);
        item.originalText = raw.text;
        item.displayText = cleanSourceProjection(raw).text;
        item.spokenText = cleanSourceProjection(raw).text;
        item.author = {
          displayName: raw.author,
          ...(raw.handle ? { handle: raw.handle } : {}),
          ...(raw.avatar ? { avatarUrl: raw.avatar } : {}),
        };
        item.mediaReferences = (raw.media || []).map((m: any) => m.url);
        item.selected =
          item.order === 0 ||
          (!!own &&
            (selectedObserved.has(own.url) || selectedReplies.has(own.id)));
        if (item.order > 0) {
          const verified = collection.replies.find((r) => r.id === own?.id),
            membership = collection.membershipEvidence?.find(
              (evidence) => evidence.subjectId === own?.id,
            ),
            comment = s.project.comments.find((c) => c.id === item.id);
          item.observationEvidence = {
            level: verified ? 'PARENT_VERIFIED' : 'OBSERVED_ON_TARGET_PAGE',
            targetUrl: root.url,
            observedAt: root.provenance.observedAt,
            parentId: verified?.parentId ?? null,
            membership: membership?.status ?? 'UNKNOWN',
            membershipEvidenceType: membership?.evidenceType ?? null,
          };
          if (!verified)
            item.contextAssessment = classifyContext(raw, root.url);
          if (comment) {
            comment.relationshipStatus = verified
              ? 'PARENT_VERIFIED'
              : 'OBSERVED_ON_TARGET_PAGE';
            comment.observedTargetUrl = root.url;
            if (verified && verified.parentId !== root.id)
              comment.parentCommentId = verified.parentId;
          }
        }
      }
      s.status = 'READY';
      s.errors = [];
      if (cachedAvatarsOnly) await this.adoptCachedAvatars(s);
      else await this.ensureCachedAvatars(s);
      return this.persist(s);
    });
  }
  private replyRecord(reply: VerifiedReply, collection?: ThreadCollection): any {
    const candidates = collection?.sourceCapture?.contextCandidates || [];
    const matchedCandidate = candidates.find(
      (c) =>
        canonicalPost(c.url)?.id === reply.id &&
        c.handle?.toLowerCase() === reply.author.handle.toLowerCase(),
    );
    const rootRecord = collection?.sourceCapture?.records?.[0];
    const candidateAvatar =
      reply.author.avatarUrl ??
      matchedCandidate?.avatar ??
      (reply.author.handle === collection?.root.author.handle
        ? rootRecord?.avatar
        : null) ??
      null;
    const avatar = candidateAvatar;
    return {
      url: reply.url,
      text: reply.originalText,
      bodyText: reply.originalText,
      author: reply.author.name ?? reply.author.handle,
      handle: reply.author.handle,
      avatar,
      createdAt: reply.publishedAt,
      type: 'COMMENT',
      parentReference: reply.evidence.parentUrl,
      media: (reply.attachments || []).map((a) => ({
        url: a.sourceUrl,
        kind: a.kind,
      })),
      likeCount: reply.engagement.likes,
      replyCount: reply.engagement.replies,
      repostCount: reply.engagement.reposts,
      shareCount: reply.engagement.shares,
      provenance: { text: reply.provenance.method, type: reply.evidence.kind },
    };
  }
  /** Idempotent DATA-03 materialization. Never overwrites an existing session. */
  async approveEditorialScript(id: string, body: any) {
    return this.exclusive(async () => {
      const s = await this.load(id);
      if (s.revision !== body?.revision)
        throw new ConflictException('STALE_REVISION');
      if (
        !s.project.editorialPlan ||
        body.confirmUserReview !== true ||
        typeof body.reason !== 'string' ||
        !body.reason.trim() ||
        body.reason.length > 1000
      )
        throw new BadRequestException('EDITORIAL_USER_REVIEW_REQUIRED');
      const selected = s.items.filter((i) => i.selected);
      if (
        !selected.some(
          (i) =>
            i.editorial?.stage === 'CONTEXT' &&
            i.sourceReference.entityId ===
              s.project.editorialPlan!.bundle.collection.root.id,
        ) ||
        !selected.some((i) => i.editorial?.stage === 'DISCUSSION') ||
        !selected.some((i) => i.editorial?.kind === 'COMMENTARY') ||
        selected.some((i) => !i.spokenText.trim())
      )
        throw new BadRequestException('EDITORIAL_SCRIPT_INCOMPLETE');
      const approval = {
        scriptHash: editorialScriptHash(s),
        reason: body.reason.trim(),
        approvedAt: new Date().toISOString(),
        sessionRevision: s.revision,
      };
      s.project.editorialApproval = { ...approval, status: 'APPROVED' };
      s.project.editorialApprovalHistory = [
        ...(s.project.editorialApprovalHistory || []),
        approval,
      ];
      return this.persist(s);
    });
  }
  async ensureProductionSession(seed: StudioSession) {
    return this.exclusive(async () => {
      if (
        !seed.productionOrigin ||
        seed.project.style !== 'SERIOUS' ||
        seed.project.id !== seed.id ||
        JSON.stringify(seed.project.productionOrigin) !==
          JSON.stringify(seed.productionOrigin)
      )
        throw new BadRequestException('Invalid production seed');
      try {
        const existing = await this.load(seed.id);
        if (
          existing.productionOrigin?.jobId !== seed.productionOrigin.jobId ||
          existing.productionOrigin.snapshotHash !==
            seed.productionOrigin.snapshotHash ||
          existing.project.productionOrigin?.jobId !==
            seed.productionOrigin.jobId
        )
          throw new ConflictException('PRODUCTION_SESSION_COLLISION');
        return existing;
      } catch (e: any) {
        if (e.code !== 'ENOENT') throw e;
      }
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
        if (!Array.isArray(body.urls) || !body.urls.length)
          throw new BadRequestException(
            'Enter at least one HTTPS Threads permalink or /share/ link',
          );
        const rawEntries = body.urls
          .map((u: unknown) => String(u ?? '').trim())
          .filter(Boolean);
        if (!rawEntries.length)
          throw new BadRequestException(
            'Enter at least one HTTPS Threads permalink or /share/ link',
          );
        const seenValid = new Set<string>();
        const urls: string[] = [];
        const malformedEntries: string[] = [];
        let duplicateCount = 0;
        for (const rawEntry of rawEntries) {
          try {
            const normalized = threadsUrl(rawEntry);
            if (seenValid.has(normalized)) {
              duplicateCount++;
            } else {
              seenValid.add(normalized);
              urls.push(normalized);
            }
          } catch {
            malformedEntries.push(rawEntry);
          }
        }
        if (
          !urls.length &&
          malformedEntries.length === 1 &&
          body.allowPartialBatch !== true
        )
          throw new BadRequestException(
            'Enter an HTTPS Threads permalink or /share/ link.',
          );
        const start = Date.now();
        const resumeOnly = body.resumeOnly === true;
        if (!resumeOnly) s.errors = [];
        else
          s.errors = (s.errors || []).filter(
            (err) => !urls.some((u) => err.startsWith(u + ':') || err.includes(' ' + u + ':')),
          );
        // Close any idle Kokoro worker before launching browser extraction in batches.
        this.voice.close();
        for (const bad of malformedEntries) {
          const retrievedAt = new Date().toISOString();
          const badAttempt = {
            originalUrl: bad,
            resolvedUrl: null,
            canonicalUrl: null,
            matchedTargetId: null,
            matchMethod: 'UNVERIFIED' as const,
            contextCandidates: [],
            browserNavigations: 0,
            domCandidates: 0,
            status: 'ERROR' as const,
            elapsedMs: 0,
            retrievedAt,
            redirects: [],
            records: [],
            diagnostics: [
              {
                stage: 'validation',
                code: 'MALFORMED_THREADS_URL',
                message:
                  'Invalid HTTPS Threads permalink or /share/ link; skipped in batch',
              },
            ],
          };
          s.attempts = [
            ...(s.attempts || []).filter((x) => x.originalUrl !== bad),
            badAttempt,
          ];
          s.errors.push(
            `${bad}: Invalid HTTPS Threads permalink or /share/ link; skipped in batch`,
          );
        }
        let processedCount = 0,
          succeededCount = 0,
          failedCount = malformedEntries.length,
          skippedReadyCount = 0;
        for (const url of urls) {
          const priorAttempt = (s.attempts || []).find(
            (a) => a.originalUrl === url || a.canonicalUrl === url,
          );
          const alreadyImported =
            priorAttempt &&
            priorAttempt.status !== 'ERROR' &&
            !!priorAttempt.matchedTargetId &&
            s.items.some(
              (i) =>
                i.sourceUrl === (priorAttempt.canonicalUrl || url) ||
                canonicalPost(i.sourceUrl)?.url ===
                  canonicalPost(priorAttempt.canonicalUrl || url)?.url,
            );
          if (resumeOnly && alreadyImported) {
            skippedReadyCount++;
            succeededCount++;
            continue;
          }
          processedCount++;
          await this.tick(
            `Threads batch extraction (${processedCount}/${urls.length}): resolving exact target`,
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
              succeededCount++;
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
                  s.scope === 'WITH_CONTEXT'
                    ? attempt.contextCandidates || []
                    : [],
                );
                s.items.slice(first).forEach((item, index) => {
                  item.inclusion = index === 0 ? 'TARGET' : 'EXPLICIT_CONTEXT';
                  const raw =
                    index === 0
                      ? attempt.records[0]
                      : attempt.contextCandidates![index - 1];
                  item.observationEvidence = {
                    level: index === 0 ? 'UNKNOWN' : 'OBSERVED_ON_TARGET_PAGE',
                    targetUrl: canonical,
                    observedAt: attempt.retrievedAt,
                    parentId: null,
                  };
                  if (index > 0) {
                    const comment = s.project.comments.find(
                      (c) => c.id === item.id,
                    );
                    if (comment) {
                      comment.relationshipStatus = 'OBSERVED_ON_TARGET_PAGE';
                      comment.observedTargetUrl = canonical;
                    }
                  }
                  item.sourceUrl =
                    typeof raw.url === 'string' ? raw.url : canonical;
                  item.rawExtraction = structuredClone(raw);
                  if (index > 0)
                    item.contextAssessment = classifyContext(raw, canonical);
                  item.metadata = structuredClone(raw);
                  const cleanAvatar =
                    raw.avatar && !isPlaceholderAvatarUrl(raw.avatar)
                      ? raw.avatar
                      : null;
                  item.metadata.avatar = cleanAvatar;
                  item.author = {
                    displayName: raw.author,
                    ...(raw.handle ? { handle: raw.handle } : {}),
                    ...(cleanAvatar ? { avatarUrl: cleanAvatar } : {}),
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
            } else {
              failedCount++;
            }
            if (attempt.status === 'ERROR')
              s.errors.push(
                ...attempt.diagnostics
                  .filter((d) => d.code !== 'RESOLVED')
                  .map((d) => url + ': ' + d.message),
              );
          } catch (e) {
            failedCount++;
            s.errors.push(
              'Extraction failed for ' +
                url +
                ': ' +
                (e instanceof Error ? e.message : 'Unknown error') +
                '. Existing content is preserved.',
            );
          }
        }
        s.urlQueue = {
          submittedCount: rawEntries.length,
          uniqueValidCount: urls.length,
          duplicateCount,
          malformedCount: malformedEntries.length,
          processedCount,
          succeededCount,
          failedCount,
          skippedReadyCount,
          concurrency: 1,
          updatedAt: new Date().toISOString(),
        };
        await this.ensureCachedAvatars(s);
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
        if (!raw || typeof raw.url !== 'string' || !raw.text?.trim())
          throw new BadRequestException('Context candidate not found');
        if (!s.items.some((i) => i.sourceUrl === raw.url)) {
          const first = s.items.length;
          const target = s.items.find(
            (i) =>
              i.inclusion === 'TARGET' && i.sourceUrl === attempt!.canonicalUrl,
          );
          const post =
            target &&
            s.project.posts.find(
              (p) => p.id === target.sourceReference.entityId,
            );
          if (!target || !post)
            throw new BadRequestException(
              'Exact target must exist before adding observed context',
            );
          // append builds the existing Studio item shape; rebind the result as a draft
          // comment without claiming a technically verified parent relationship.
          this.append(s, threadsUrl(raw.url), raw, []);
          const item = s.items[first];
          item.author = {
            displayName: raw.author,
            ...(raw.handle ? { handle: raw.handle } : {}),
            ...(raw.avatar ? { avatarUrl: raw.avatar } : {}),
          };
          s.project.posts = s.project.posts.filter((p) => p.id !== item.id);
          item.sourceReference = { entityType: 'COMMENT', entityId: item.id };
          item.observationEvidence = {
            level: 'OBSERVED_ON_TARGET_PAGE',
            targetUrl: target.sourceUrl,
            observedAt: attempt!.retrievedAt,
            parentId: null,
          };
          s.project.comments.push({
            id: item.id,
            sourceId: item.sourceId!,
            postId: post.id,
            author: item.author,
            text: raw.text,
            mediaAssetIds: [],
            relationshipStatus: 'OBSERVED_ON_TARGET_PAGE',
            observedTargetUrl: target.sourceUrl,
          });
          post.commentIds.push(item.id);
          item.inclusion = 'EXPLICIT_CONTEXT';
          item.rawExtraction = structuredClone(raw);
          item.contextAssessment = classifyContext(raw, target.sourceUrl);
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
          const pronunciationOverrides =
            patch.pronunciationOverrides === undefined
              ? original.pronunciationOverrides
              : validatePronunciations(patch.pronunciationOverrides);
          const changed =
            JSON.stringify(pronunciationOverrides) !==
              JSON.stringify(original.pronunciationOverrides) ||
            // Text and metadata locks are independent; previous locks survive edits.
            JSON.stringify(metadata) !== JSON.stringify(original.metadata) ||
            original.displayText !== patch.displayText ||
            original.spokenText !== patch.spokenText;
          return {
            ...original,
            pronunciationOverrides,
            metadata,
            ...(metadata
              ? {
                  author: {
                    displayName: metadata.author,
                    ...(metadata.handle ? { handle: metadata.handle } : {}),
                    ...((metadata.avatar ?? original.author.avatarUrl) &&
                    !isPlaceholderAvatarUrl(
                      metadata.avatar ?? original.author.avatarUrl,
                    )
                      ? {
                          avatarUrl: (metadata.avatar ??
                            original.author.avatarUrl)!,
                        }
                      : {}),
                  },
                  mediaReferences: metadata.media.map((m) => m.url),
                }
              : {}),
            order,
            selected: patch.selected,
            displayText: patch.displayText,
            spokenText: patch.spokenText,
            ...(original.editorial
              ? {
                  editorial: {
                    ...original.editorial,
                    kind:
                      original.editorial.kind === 'COMMENTARY'
                        ? 'COMMENTARY'
                        : (() => {
                              const verbatimCandidates = [
                                original.originalText,
                                original.rawExtraction?.text,
                              ]
                                .filter(
                                  (v): v is string =>
                                    typeof v === 'string' && !!v,
                                )
                                .flatMap((v) => [
                                  v,
                                  v
                                    .replace(/^\d{1,2}\/\d{1,2}\/\d{4}\r?\n+/, '')
                                    .trim(),
                                ]);
                              return verbatimCandidates.includes(
                                patch.displayText,
                              ) &&
                                verbatimCandidates.includes(patch.spokenText)
                                ? ('QUOTE' as const)
                                : ('PARAPHRASE' as const);
                            })(),
                  },
                }
              : {}),
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
    if (report.timing) report.timing.reportMs = generation;
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
      if (mode === 'LIVE') {
        const model = normalizationProviderConfig().model;
        const cached = s.scriptProposals
          ?.slice()
          .reverse()
          .find(
            (proposal) =>
              proposal.mode === 'LIVE' &&
              proposal.executionStatus === 'SUCCESS' &&
              proposal.itemId === item.id &&
              proposal.baseRevision === item.revision &&
              proposal.inputText === item.spokenText &&
              proposal.model === model,
          );
        if (cached) return s;
      }
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
  async voiceAction(
    id: string,
    itemId: string,
    body: any,
    execution?: LocalTtsExecution,
  ) {
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
      } else if (body.action === 'FLAG_REGENERATE') {
        item.regenerateFlagged = body.flagged !== false;
        item.regenerateFlagReason =
          typeof body.reason === 'string' && body.reason.trim()
            ? body.reason.trim()
            : null;
        if (body.regenerateNow === true && item.regenerateFlagged) {
          await this.generateItem(
            s,
            item,
            true,
            undefined,
            body.draft === true,
            execution,
          );
        }
      } else if (body.action === 'GENERATE') {
        const hasSettings = body.voice !== undefined || body.speed !== undefined;
        const runtime = hasSettings ? await this.voice.preflight() : undefined;
        if (runtime) s.voiceRuntime = runtime;
        if (hasSettings && (runtime!.status === 'READY' ||
            (runtime!.declaredVoices.length > 0 &&
             runtime!.blockers.length > 0 &&
             runtime!.blockers.every(b => b.includes('BLOCKED_RESOURCE')))))
          this.applySettings(
            s,
            item,
            body.voice ?? item.voiceSettings?.voice ?? null,
            body.speed ?? item.voiceSettings?.speed ?? VOICE_SPEED.default,
          );
        await this.generateItem(
          s,
          item,
          body.regenerate === true,
          runtime,
          body.draft === true,
          execution,
        );
      } else throw new BadRequestException('Unknown voice operation');
      return this.persist(s);
    }, execution?.leaseToken);
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
    s.voiceDefaults = { ...item.voiceSettings };
    if (typeof voice === 'string')
      s.voicePresets = { ...s.voicePresets, [voice]: { speed } };
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
    execution?: LocalTtsExecution,
  ) {
    if (!draft && item.contentMapping?.status === 'REVIEW_REQUIRED')
      throw new ConflictException(
        'Review Topic/body spoken mapping before TTS',
      );
    if (!item.spokenText.trim() || item.spokenText.length > 12000)
      throw new BadRequestException(
        'Spoken text must contain 1–12000 characters',
      );
    if (
      !draft &&
      (!item.spokenApproval?.valid ||
        item.spokenApproval.textHash !== textHash(item.spokenText))
    )
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
      if (
        s.voiceRuntime.status !== 'READY' &&
        !(
          s.voiceRuntime.blockers.length > 0 &&
          s.voiceRuntime.blockers.every((b) => b.includes('BLOCKED_RESOURCE'))
        )
      )
        throw Error('BLOCKED_RUNTIME: ' + s.voiceRuntime.blockers.join('; '));
      const settings = item.voiceSettings;
      if (!settings?.voice)
        throw Error('Select a locally available Kokoro voice');
      if (!s.voiceRuntime.declaredVoices.some(v => v.id === settings.voice))
        throw Error('Unknown Kokoro voice');
      const normalizedInput = prepareTtsInput(
        item.spokenText,
        item.pronunciationOverrides,
      );
      job.inputCharacters = normalizedInput.spokenText.length;
      job.ttsInputHash = normalizedInput.ttsInputHash;
      const normalizationVersion = normalizedInput.normalizationVersion;
      if (normalizedInput.warnings.length)
        throw Error(normalizedInput.warnings.join('; '));
      const oldAsset = this.currentAsset(s, item);
      const inputStale = oldAsset?.ttsInputHash
        ? oldAsset.ttsInputHash !== normalizedInput.ttsInputHash
        : oldAsset?.numberReadingVersion !== normalizationVersion;
      const modelStale =
        oldAsset &&
        oldAsset.modelVersion !==
          s.voiceRuntime.modelVersion + ' / ' + s.voiceRuntime.packageVersion;
      const existing =
        regenerate || inputStale || modelStale ||
        (draft && oldAsset?.durationEvidence !== 'FFPROBE') ? undefined : oldAsset;
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
          normalizedInput.spokenText,
          settings.voice,
          settings.speed,
          s.voiceRuntime,
          regenerate,
          { itemId: item.id, normalizationVersion },
          execution,
        );
        await this.tick('Saving asset');
        // Returning to cached settings reuses the existing manifest, not another ID.
        const cached =
          !regenerate &&
          s.voiceAssets?.find(
            (a) =>
              a.itemId === item.id &&
              a.textHash === textHash(item.spokenText) &&
              (!a.ttsInputHash ||
                a.ttsInputHash === normalizedInput.ttsInputHash) &&
              a.voice === settings.voice &&
              a.speed === settings.speed &&
              a.filePath === result.filePath,
          );
        if (cached) {
          cached.status = 'GENERATED';
          cached.cacheHit = true;
          cached.durationMs = result.durationMs;
          cached.durationEvidence = result.durationEvidence;
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
        let wavWaveform: ReturnType<typeof analyzeWavBuffer> | null = null;
        try {
          const absWav = path.resolve(resolveStudioDataRoot(), result.filePath);
          wavWaveform = analyzeWavBuffer(await fs.readFile(absWav));
        } catch {}
        const chunkMeta = Array.isArray(result.synthesisMetrics?.chunkSamples)
          ? (result.synthesisMetrics!.chunkSamples as any[])
          : undefined;
        const ttsDiagnostics = buildSceneTtsDiagnostic({
          itemId: item.id,
          originalText: item.originalText,
          displayText: item.displayText,
          spokenText: item.spokenText,
          ttsInputText: normalizedInput.spokenText,
          normalizationVersion,
          ttsChanges: normalizedInput.changes,
          chunkSamples: chunkMeta,
          waveform: wavWaveform,
          wavDurationMs: result.durationMs,
        });
        item.regenerateFlagged = false;
        item.regenerateFlagReason = null;
        s.voiceAssets = [
          ...(s.voiceAssets || []),
          {
            id: assetId,
            purpose: draft ? 'DRAFT' : 'APPROVED_TEXT',
            itemId: item.id,
            itemRevision: item.revision,
            textHash: textHash(item.spokenText),
            spokenText: item.spokenText,
            ttsInputText: normalizedInput.spokenText,
            ttsInputHash: normalizedInput.ttsInputHash,
            numberReadingVersion: normalizationVersion,
            voice: settings.voice,
            speed: settings.speed,
            model: s.voiceRuntime.model || 'Kokoro',
            modelVersion:
              s.voiceRuntime.modelVersion +
              ' / ' +
              s.voiceRuntime.packageVersion,
            cacheKey: result.cacheKey,
            durationMs: result.durationMs,
            durationEvidence: result.durationEvidence,
            filePath: result.filePath,
            uri: `/api/studio/sessions/${s.id}/audio/${assetId}`,
            createdAt: new Date().toISOString(),
            approvedAt: null,
            status: 'GENERATED',
            cacheHit: result.cacheHit,
            baseCacheHit: result.baseCacheHit,
            synthesisPerformed: result.synthesisPerformed,
            synthesisMetrics: result.synthesisMetrics,
            ttsDiagnostics,
          },
        ];
        job.assetId = assetId;
        job.status = 'GENERATED';
      }
    } catch (e) {
      job.error = e instanceof Error ? e.message : 'TTS failed';
      job.failureCategory = ttsFailureCategory(e);
      job.status = 'ERROR';
      const diagnostic = this.voice.diagnostics?.();
      if (diagnostic && diagnostic.inputHash === job.ttsInputHash) {
        const samples = diagnostic.samples.filter((r) => r.atMs >= started);
        job.resourceDiagnostics = {
          ...diagnostic,
          workerPid: samples[samples.length - 1]?.pid ?? null,
          samples: samples.slice(-16),
        };
      }
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
        let resourceStopReason: string | null = null;
        for (const item of items) {
          await this.tick(
            'Batch audio: scene ' + (items.indexOf(item) + 1),
            items.indexOf(item),
            items.length,
          );
          if (resourceStopReason) {
            results.push({
              itemId: item.id,
              outcome: 'SKIPPED',
              reason: `Batch stopped after ${resourceStopReason}`,
            });
            continue;
          }
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
            const reason = e instanceof Error ? e.message : 'TTS failed';
            results.push({
              itemId: item.id,
              outcome: 'ERROR',
              reason,
            });
            if (reason.includes('RESOURCE_GUARD_STOP'))
              resourceStopReason = reason;
            continue;
          }
          if (job.error?.includes('RESOURCE_GUARD_STOP'))
            resourceStopReason = job.error;
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
  /**
   * Applies only deterministic, versioned speech rules for an automatic DRAFT.
   * Ambiguous tokens are retained verbatim and recorded for exception review.
   * This is not user approval and never invokes an inference provider.
   */
  async normalizeAutomaticDraft(id: string, revision: number) {
    return this.exclusive(async () => {
      const s = await this.load(id);
      if (s.revision !== revision)
        throw new ConflictException(
          'Session changed. Reopen before automatic normalization.',
        );
      for (const item of s.items.filter((row) => row.selected)) {
        const currentHash = textHash(item.spokenText);
        const currentTts = prepareTtsInput(
          item.spokenText,
          item.pronunciationOverrides,
        );
        if (
          item.automaticNormalization?.normalizationVersion ===
            currentTts.normalizationVersion &&
          item.automaticNormalization.outputHash === currentHash &&
          item.automaticNormalization.ttsInputHash === currentTts.ttsInputHash
        )
          continue;
        const run = offlineNormalize(item);
        const proposed = run.proposedSpokenText;
        if (!proposed)
          throw new BadRequestException(
            `Deterministic normalization produced no text for ${item.id}`,
          );
        const changed = proposed !== item.spokenText;
        run.approval = 'ACCEPTED';
        run.decisionSource = 'AUTOMATIC_POLICY';
        run.decidedAt = new Date().toISOString();
        run.warnings = [
          ...run.warnings,
          ...(run.ambiguousTerms.length
            ? [
                'Ambiguous tokens were retained unchanged and queued for exception review.',
              ]
            : []),
        ];
        s.scriptProposals = [...(s.scriptProposals || []), run];
        if (changed) {
          item.spokenText = proposed;
          item.revision++;
        }
        const finalTts = changed
          ? prepareTtsInput(item.spokenText, item.pronunciationOverrides)
          : currentTts;
        item.automaticNormalization = {
          policyVersion: SPEECH_POLICY_VERSION,
          dictionaryVersion: SPEECH_DICTIONARY_VERSION,
          normalizationVersion: finalTts.normalizationVersion,
          inputHash: currentHash,
          outputHash: textHash(item.spokenText),
          ttsInputHash: finalTts.ttsInputHash,
          appliedAt: run.decidedAt,
          changed,
          normalizationChanges: run.normalization?.changes || [],
          ambiguousTerms: [
            ...new Set(run.ambiguousTerms.map((term) => term.term)),
          ],
        };
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
        run.decisionSource = 'USER';
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
    return this.mutate(
      created.id,
      { revision: created.revision, urls, scope: 'TARGET_ONLY' },
      true,
    );
  }
  async listSavedCollections() {
    const dir = path.join(this.root, 'data-engine', 'thread-collections');
    const files = await fs.readdir(dir).catch(() => [] as string[]);
    const out: Array<{
      id: string;
      rootUrl: string;
      authorHandle: string;
      textPreview: string;
      verifiedReplyCount: number;
      observedCardCount: number;
      collectedAt: string;
    }> = [];
    for (const f of files) {
      if (!/^[a-f0-9]{64}\.json$/.test(f)) continue;
      try {
        const parsed = JSON.parse(await fs.readFile(path.join(dir, f), 'utf8'));
        const raw: ThreadCollection = parsed?.collection ?? parsed;
        if (!raw?.root?.url) continue;
        out.push({
          id: parsed?.id || f.slice(0, -5),
          rootUrl: raw.root.url,
          authorHandle: raw.root.author.handle,
          textPreview: (raw.root.originalText || '').slice(0, 140),
          verifiedReplyCount: Array.isArray(raw.replies) ? raw.replies.length : 0,
          observedCardCount: Array.isArray(raw.sourceCapture?.contextCandidates)
            ? raw.sourceCapture!.contextCandidates!.length
            : 0,
          collectedAt: raw.root.provenance?.observedAt || '',
        });
      } catch {}
    }
    return out.sort((a, b) => b.collectedAt.localeCompare(a.collectedAt));
  }
  async importCollectionItems(
    id: string,
    body: {
      revision: number;
      collectionId: string;
      replyIds?: string[];
      observedUrls?: string[];
      includeAllVerified?: boolean;
    },
  ) {
    return this.exclusive(async () => {
      const s = await this.load(id);
      if (s.revision !== body?.revision)
        throw new ConflictException(
          'Session changed. Reopen before importing collection items.',
        );
      if (
        typeof body?.collectionId !== 'string' ||
        !/^[a-f0-9]{64}$/.test(body.collectionId)
      )
        throw new BadRequestException('Invalid ThreadCollection ID');
      const file = path.join(
        this.root,
        'data-engine',
        'thread-collections',
        body.collectionId + '.json',
      );
      let collection: ThreadCollection;
      try {
        const parsed = JSON.parse(await fs.readFile(file, 'utf8'));
        collection = parsed?.collection ?? parsed;
      } catch {
        throw new BadRequestException('ThreadCollection not found on disk');
      }
      const root = collection.root;
      const source = collection.sourceCapture?.records?.[0];
      const rootRaw: any = source ?? {
        url: root.url,
        text: root.originalText,
        bodyText: root.originalText,
        author: root.author.name ?? root.author.handle,
        handle: root.author.handle,
        avatar:
          root.author.avatarUrl && !isPlaceholderAvatarUrl(root.author.avatarUrl)
            ? root.author.avatarUrl
            : null,
        createdAt: root.publishedAt,
        type: root.itemType ?? 'POST',
        parentReference: null,
        media: (root.attachments || []).map((a) => ({
          url: a.sourceUrl,
          kind: a.kind,
        })),
        likeCount: root.engagement.likes,
        replyCount: root.engagement.replies,
        repostCount: root.engagement.reposts,
        shareCount: root.engagement.shares,
        provenance: {
          text: root.provenance.method,
          type: 'catalog type preserved',
        },
      };
      const wantReplies =
        body.includeAllVerified === true
          ? new Set(collection.replies.map((r) => r.id))
          : new Set(Array.isArray(body.replyIds) ? body.replyIds : collection.replies.map((r) => r.id));
      const wantObserved = new Set(
        Array.isArray(body.observedUrls) ? body.observedUrls : [],
      );
      const observed = observedContextViews(collection);
      const selectedRecords: any[] = [];
      for (const reply of collection.replies) {
        if (!wantReplies.has(reply.id)) continue;
        selectedRecords.push(this.replyRecord(reply, collection));
      }
      for (const obs of observed) {
        const rawUrl = String(obs.raw.url || '');
        const canonical = canonicalPost(rawUrl)?.url ?? rawUrl;
        if (!wantObserved.has(canonical) && !wantObserved.has(rawUrl))
          continue;
        if (
          !selectedRecords.some(
            (r) => canonicalPost(r.url)?.url === canonical,
          )
        )
          selectedRecords.push(obs.raw);
      }
      const existingUrls = new Set(
        s.items.map((i) => canonicalPost(i.sourceUrl)?.url ?? i.sourceUrl),
      );
      const rootCanonical = canonicalPost(root.url)?.url ?? root.url;
      const newComments = selectedRecords.filter(
        (r) => !existingUrls.has(canonicalPost(r.url)?.url ?? r.url),
      );
      const firstIndex = s.items.length;
      if (!existingUrls.has(rootCanonical)) {
        this.append(s, rootCanonical, rootRaw, newComments);
      } else if (newComments.length) {
        const target =
          s.items.find(
            (i) =>
              (canonicalPost(i.sourceUrl)?.url ?? i.sourceUrl) === rootCanonical,
          ) ?? s.items[0];
        const post =
          s.project.posts.find(
            (p) => p.id === target?.sourceReference.entityId,
          ) ?? s.project.posts[0];
        for (const raw of newComments) {
          const itemIdx = s.items.length;
          this.append(s, canonicalPost(raw.url)?.url ?? rootCanonical, raw, []);
          const item = s.items[itemIdx];
          if (post && item) {
            s.project.posts = s.project.posts.filter((p) => p.id !== item.id);
            item.sourceReference = { entityType: 'COMMENT', entityId: item.id };
            s.project.comments.push({
              id: item.id,
              sourceId: item.sourceId!,
              postId: post.id,
              author: item.author,
              text: raw.text,
              mediaAssetIds: [],
              relationshipStatus: 'OBSERVED_ON_TARGET_PAGE',
              observedTargetUrl: rootCanonical,
            });
            post.commentIds.push(item.id);
          }
        }
      }
      const rawSequence = !existingUrls.has(rootCanonical)
        ? [rootRaw, ...newComments]
        : newComments;
      s.items.slice(firstIndex).forEach((item, idx) => {
        const raw = rawSequence[idx];
        if (!raw) return;
        const own = canonicalPost(raw.url);
        const isRootItem = !existingUrls.has(rootCanonical) && idx === 0;
        item.inclusion = isRootItem ? 'TARGET' : 'EXPLICIT_CONTEXT';
        item.sourceUrl = own?.url ?? rootCanonical;
        const cleanAvatar =
          raw.avatar && !isPlaceholderAvatarUrl(raw.avatar) ? raw.avatar : null;
        raw.avatar = cleanAvatar;
        item.rawExtraction = structuredClone(raw);
        item.metadata = structuredClone(raw);
        item.originalText = raw.text;
        item.displayText = cleanSourceProjection(raw).text;
        item.spokenText = cleanSourceProjection(raw).text;
        item.author = {
          displayName: raw.author,
          ...(raw.handle ? { handle: raw.handle } : {}),
          ...(cleanAvatar ? { avatarUrl: cleanAvatar } : {}),
        };
        item.mediaReferences = (raw.media || []).map((m: any) => m.url);
        item.selected = true;
        if (!isRootItem) {
          const verified = collection.replies.find((r) => r.id === own?.id),
            membership = collection.membershipEvidence?.find(
              (ev) => ev.subjectId === own?.id,
            );
          item.observationEvidence = {
            level: verified ? 'PARENT_VERIFIED' : 'OBSERVED_ON_TARGET_PAGE',
            targetUrl: rootCanonical,
            observedAt: root.provenance.observedAt,
            parentId: verified?.parentId ?? null,
            membership: membership?.status ?? 'UNKNOWN',
            membershipEvidenceType: membership?.evidenceType ?? null,
          };
        }
      });
      s.status = 'READY';
      await this.ensureCachedAvatars(s);
      return this.persist(s);
    });
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
        spokenText: cleanSourceProjection(raw).text,
        displayText: cleanSourceProjection(raw).text,
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
        ...(s.voiceDefaults ? { voiceSettings: { ...s.voiceDefaults } } : {}),
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
          relationshipStatus: 'UNKNOWN',
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
