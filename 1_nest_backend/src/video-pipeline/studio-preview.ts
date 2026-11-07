import {validateRange} from './editing';
import type { StudioSession } from '../studio/studio.contracts';
import type { LibraryAsset } from '../studio/public-assets';
import type { StoryboardScene, VideoProject } from './contracts';
import { buildVideoTimeline } from './timeline-engine';
import { createRemotionPreviewRequest } from './preview-adapter';
import { defaultBgm, cardPages, normalizeVisual } from './scene-visual';
import { editorSettings } from './editor-state';
export function buildStudioPreview(
  s: StudioSession,
  library: LibraryAsset[] = [],
) {
  const project: VideoProject = JSON.parse(JSON.stringify(s.project));
  project.storyboard = [];
  project.audioAssets = [];
  project.mediaAssets = [...(s.studioMedia || []).filter(a=>a.kind!=='AUDIO')] as any;
  project.backgroundTracks = s.editor?.backgroundTracks ?? [];
  for(const a of (s.studioMedia||[]).filter(a=>a.kind==='AUDIO'))project.audioAssets.push({id:a.id,uri:a.uri,role:a.category==='BGM'?'BGM':'SFX',durationMs:a.durationMs!,durationSource:'MEASURED',availability:'AVAILABLE'});
  for (const a of library)
    if (a.kind !== 'AUDIO' && a.kind !== 'OTHER')
      project.mediaAssets.push({
        id: a.id,
        uri: a.uri,
        kind: a.kind,
        availability: 'AVAILABLE',
        durationMs: a.durationMs,
        width: a.width,
        height: a.height,
      });
  for (const a of library.filter((a) => a.kind === 'AUDIO'))
    project.audioAssets.push({
      id: a.id,
      uri: a.uri,
      role: a.category === 'BGM' ? 'BGM' : 'SFX',
      durationMs: a.durationMs!,
      durationSource: 'MEASURED',
      availability: 'AVAILABLE',
    });
  project.backgroundMusic = s.editor?.backgroundMusic ?? defaultBgm();
  project.editorSettings = editorSettings(s);
  const warnings: string[] = [],
    missingAudioItemIds: string[] = [];
  for (const x of editorSettings(s).scenes.filter((x) => x.enabled)) {
    const i = s.items.find((i) => i.id === x.itemId)!;
    const audio = s.voiceAssets
      ?.slice()
      .reverse()
      .find(
        (a) =>
          a.itemId === i.id &&
          a.status !== 'STALE' &&
          a.spokenText === i.spokenText &&
          a.voice === i.voiceSettings?.voice &&
          a.speed === i.voiceSettings?.speed &&
          Number.isFinite(a.durationMs) &&
          a.durationMs > 0 &&
          ((i.spokenApproval?.valid && i.spokenApproval.textHash === a.textHash) || a.purpose === 'DRAFT'),
      );
    if (audio) {
      project.audioAssets.push({
        id: audio.id,
        role: 'NARRATION',
        uri: audio.uri,
        durationMs: audio.durationMs,
        durationSource: audio.durationEvidence==='SYNTHETIC_FIXTURE'?'FIXTURE':'MEASURED',
        availability: 'AVAILABLE',
        approvalStatus: audio.status === 'APPROVED' ? 'APPROVED' : 'PENDING',
        voice: { provider: 'KOKORO', voiceId: audio.voice, language: 'vi' },
      });
      if (audio.status !== 'APPROVED')
        warnings.push(
          `${i.id}: generated audio is for preview; audio approval is still required before export.`,
        );
    } else {
      missingAudioItemIds.push(i.id);
      warnings.push(
        `${i.id}: no matching approved-spoken audio. Visual-only preview uses explicit ${x.silentDurationMs}ms; narration is not estimated.`,
      );
    }
    const meta = i.metadata;
    const sourceMedia = (meta?.media || []).map((m, index) => ({
      id: `source-${i.id}-${index}`,
      kind: m.kind,
      uri: i.localSourceMedia?.find(a=>a.sourceUrl===m.url&&a.status==='DOWNLOADED'&&/^\/api\/studio\/data\/conversations\/media\/[a-f0-9]{64}$/.test(a.localUri||''))?.localUri || m.url,
      availability: 'AVAILABLE' as const,
      width:i.localSourceMedia?.find(a=>a.sourceUrl===m.url)?.width??undefined,
      height:i.localSourceMedia?.find(a=>a.sourceUrl===m.url)?.height??undefined,
    }));
    project.mediaAssets.push(...sourceMedia);
    const scene: StoryboardScene = {
      ...(i.editorial?{editorial:{kind:i.editorial.kind,stage:i.editorial.stage}}:{}),
      visual: {
        ...normalizeVisual(x.visual),
        backgroundId: x.visual?.backgroundId || s.editor?.backgroundId || null,
      },
      id: i.id,
      order: project.storyboard.length,
      sourceReferences: [i.sourceReference],
      displayText: i.displayText,
      narrationText: audio ? i.spokenText : '',
      voice: {
        provider: 'KOKORO',
        voiceId: i.voiceSettings?.voice || '',
        language: 'vi',
      },
      audioAssetId: audio?.id,
      mediaAssetIds: [
        ...x.mediaAssetIds,
        ...(x.visual?.meme.enabled && x.visual.meme.assetId
          ? [x.visual.meme.assetId]
          : []),
        ...sourceMedia.filter((m) => m.kind !== 'VIDEO').map((m) => m.id),
      ],
      sfxAssetIds:
        x.visual?.sfx.enabled && x.visual.sfx.assetId
          ? [x.visual.sfx.assetId]
          : [],
      sfxLayer:
        x.visual?.sfx.enabled && x.visual.sfx.assetId
          ? {
              assetId: x.visual.sfx.assetId,
              startMs: x.visual.sfx.startMs,
              volume: x.visual.sfx.volume,
              durationMs:x.visual.sfx.durationMs, sourceInMs:x.visual.sfx.sourceInMs,
            }
          : undefined,
      // Scene-level captions follow measured narration bounds. No word alignment is claimed.
      subtitles: audio && x.visual?.subtitlesEnabled===true ? [{id:`caption-${i.id}`,text:i.spokenText,startMs:0,endMs:audio.durationMs}] : [],
      timing: {
        paddingBeforeMs: x.paddingBeforeMs,
        paddingAfterMs: x.paddingAfterMs,
        ...(!audio ? { manualSceneDurationMs: x.silentDurationMs } : {}),
      },
      styleProperties: {
        style: 'SERIOUS',
        template: 'STORY_CARD',
        cardMode: i.editorial?.kind==='COMMENTARY'?'NARRATION':i.sourceReference.entityType === 'POST' ? 'POST' : 'COMMENT',
        tone: 'REFLECTIVE',
      },
      manualOverride: {
        lockedFields: [
          'SOURCE_REFERENCES',
          ...(i.manualLocks.includes('DISPLAY_TEXT')
            ? ['DISPLAY_TEXT' as const]
            : []),
          ...(i.manualLocks.includes('NARRATION_TEXT')
            ? ['NARRATION_TEXT' as const]
            : []),
        ],
        revision: i.revision,
        lastEditedBy: 'USER',
      },
      threadsCard: {
        topic: i.contentMapping?.topic ?? meta?.topic ?? null,
        countLabels: Object.fromEntries(
          ['likeCount', 'replyCount', 'repostCount', 'shareCount'].map(
            (k, n) => [
              ['likes', 'replies', 'reposts', 'shares'][n],
              meta?.fields?.[k]?.raw ?? null,
            ],
          ),
        ),
        author: meta?.author || i.author.displayName,
        handle: meta?.handle ?? i.author.handle ?? null,
        avatarUrl: s.sourceImages?.[i.id]?.status==='READY' && s.sourceImages[i.id].sourceUrl===(meta?.avatar??i.author.avatarUrl)
          ? s.sourceImages[i.id].uri : meta?.avatar ?? i.author.avatarUrl ?? null,
        createdAt: meta?.createdAt ?? null,
        dateLabel: meta?.fields?.createdAt?.raw ?? null,
        sourceUrl: i.sourceUrl,
        counts: {
          likes: meta?.likeCount ?? null,
          replies: meta?.replyCount ?? null,
          reposts: meta?.repostCount ?? null,
          shares: meta?.shareCount ?? null,
        },
        fieldStates: Object.fromEntries(
          Object.entries(meta?.fields || {}).map(([k, v]) => [k, v.status]),
        ),
      },
    };
    if(i.editorial?.kind==='COMMENTARY')delete scene.threadsCard;
    const pages = cardPages(
      scene.displayText,
      scene.visual!,
      sourceMedia.filter(m => m.kind !== 'VIDEO').length,
      sourceMedia.length?Math.min(700,Math.max(...sourceMedia.map(m=>m.width&&m.height?(scene.visual!.card.width-2*scene.visual!.card.padding)*scene.visual!.card.scale/sourceMedia.length*m.height/m.width:180))):0,
    );
    if (pages.pages.length > 1)
      warnings.push(
        `${i.id}: ${pages.pages.length} visual pages; narration continues without word-level alignment.`,
      );
    if (pages.invalid) throw new Error('Card layout has no space for text');
    if (
      scene.visual!.meme.enabled &&
      scene.visual!.meme.y !== null &&
      scene.visual!.meme.y <
        scene.visual!.card.y + pages.height + scene.visual!.meme.gap
    )
      throw new Error(
        'Meme overlaps the full card; use Auto Y or move it down',
      );
    if (i.displayText.length > 1800)
      warnings.push(
        `${i.id}: long display text may need manual shortening or pagination before export.`,
      );
    if (sourceMedia.some((m) => m.kind === 'VIDEO'))
      warnings.push(
        `${i.id}: source video retained as a reference; video attachment playback is not enabled in this MVP.`,
      );
    project.storyboard.push(scene);
  }
  if (!project.storyboard.length)
    throw new Error('Enable at least one selected scene');
  project.timeline = buildVideoTimeline({
    projectId: s.id,
    style: 'SERIOUS',
    fps: 30,
    width: 1080,
    height: 1920,
    introDurationMs: 0,
    outroDurationMs: 0,
    scenes: project.storyboard,
    audioAssets: project.audioAssets,
    mediaAssets: project.mediaAssets,
  });
  for(const c of project.backgroundTracks||[]){const a=project.mediaAssets.find(a=>a.id===c.assetId);if(!a)throw Error('Background asset missing');validateRange(c,a.durationMs);if(c.offsetMs!==undefined&&(!Number.isInteger(c.offsetMs)||c.offsetMs<0))throw Error('Invalid background phase');}
  for(const t of project.timeline.scenes){const v=t.scene.visual!;const audio=project.audioAssets.find(a=>a.id===t.scene.audioAssetId);if(audio&&((v.voiceSourceInMs||0)>=audio.durationMs||(v.voiceStartMs||0)>=(t.endFrame-(t.audioStartFrame||t.startFrame))*1000/project.timeline.fps))throw Error('Voice clip starts outside measured audio/scene');const fx=t.scene.sfxLayer;if(fx){const a=project.audioAssets.find(a=>a.id===fx.assetId);if(!a||!a.durationMs||(fx.sourceInMs||0)>=a.durationMs)throw Error('SFX source in exceeds measured duration');}}
  if(project.backgroundMusic?.enabled){const b=project.backgroundMusic,a=project.audioAssets.find(a=>a.id===b.assetId);if(!a||(b.sourceInMs||0)>=a.durationMs)throw Error('BGM source in exceeds measured duration');}
  return {
    project,
    preview: {
      revision: s.revision,
      request: createRemotionPreviewRequest(project),
      warnings,
      missingAudioItemIds,
    },
  };
}
