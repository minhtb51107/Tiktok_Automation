import { BadRequestException } from '@nestjs/common';
import { createHash } from 'crypto';
import { canonicalPost } from '../data-engine/conversation-identity';
import { offlineNormalize } from './offline-normalization';
import { cleanSourceProjection } from './source-quality';
import { isPlaceholderAvatarUrl } from './source-images';
import { prepareTtsInput } from './speech-normalizer';
import { spokenAmbiguities } from './voice-settings';
import type { StudioSession, StudioItem } from './studio.contracts';
import type { VideoPreviewProps } from '../video-pipeline/contracts';

export const PRODUCTION_CONTRACT = 'SERIOUS/VERBATIM_THREADS/1';

export function avatarState(item: StudioItem) {
  const observed = item.rawExtraction?.avatar;
  const candidates = [
    item.author.avatarUrl,
    item.metadata?.avatar,
    observed,
  ].filter((u): u is string => typeof u === 'string' && !!u.trim());
  if (!candidates.length) return 'AVATAR_UNAVAILABLE';
  if (candidates.some((u) => !isPlaceholderAvatarUrl(u)))
    return 'CUSTOM_AVATAR';
  return 'DEFAULT_AVATAR';
}

export function currentNarration(session: StudioSession, item: StudioItem) {
  const hash = prepareTtsInput(item.spokenText, item.pronunciationOverrides).ttsInputHash;
  return session.voiceAssets?.filter(asset =>
    asset.itemId === item.id && asset.status !== 'STALE' &&
    asset.durationEvidence === 'FFPROBE' && asset.durationMs > 0 &&
    asset.voice === item.voiceSettings?.voice && asset.speed === item.voiceSettings?.speed &&
    asset.ttsInputHash === hash &&
    asset.textHash === createHash('sha256').update(item.spokenText).digest('hex'),
  ).slice(-1)[0];
}

export function verbatimNarration(item: StudioItem) {
  return item.spokenText === item.displayText ||
    item.spokenText === offlineNormalize({ ...item, spokenText: item.displayText }).proposedSpokenText;
}

export function sourceBlockers(session: StudioSession) {
  const items = session.items.filter(item => item.selected);
  const roots = items.filter(item => item.sourceReference.entityType === 'POST');
  const root = roots[0];
  const rootUrl = canonicalPost(root?.sourceUrl || '')?.url;
  const failures: string[] = [];
  if (session.project.style !== 'SERIOUS') failures.push('STYLE_NOT_SERIOUS');
  if (roots.length !== 1 || !rootUrl) failures.push('EXACTLY_ONE_THREADS_ROOT_REQUIRED');
  const seen = new Set<string>();
  const seenBodies = new Set<string>();
  for (const item of items) {
    const url = canonicalPost(item.sourceUrl)?.url;
    const raw = item.rawExtraction;
    if (!url || seen.has(url) || !raw || canonicalPost(raw.url)?.url !== url ||
        !raw.text.trim() || raw.text !== item.originalText ||
        !item.author.handle || item.author.handle !== raw.handle ||
        item.displayText !== cleanSourceProjection(raw).text)
      failures.push('SOURCE_PROJECTION_MISMATCH:' + item.id);
    if (url) seen.add(url);
    const body = item.displayText.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
    if (!body || seenBodies.has(body)) failures.push('EMPTY_OR_DUPLICATE_BODY:' + item.id);
    seenBodies.add(body);
    if (item !== root && (item.sourceReference.entityType !== 'COMMENT' ||
        item.observationEvidence?.level !== 'PARENT_VERIFIED' ||
        canonicalPost(item.observationEvidence.targetUrl)?.url !== rootUrl))
      failures.push('VERIFIED_REPLY_REQUIRED:' + item.id);
    if ((item.editorial && (item.editorial.kind !== 'QUOTE' ||
        !['CONTEXT', 'DISCUSSION'].includes(item.editorial.stage))) ||
        item.mediaNarrationApplied?.length || !verbatimNarration(item))
      failures.push('EDITORIAL_SCENE_NOT_VERBATIM:' + item.id);
  }
  return failures;
}

export function assertRenderable(session: StudioSession, props: VideoPreviewProps) {
  const failures = sourceBlockers(session);
  const items = session.items.filter(item => item.selected);
  const timeline = props.timeline;
  if (timeline.introDurationInFrames || timeline.outroDurationInFrames)
    failures.push('INTRO_OUTRO_FORBIDDEN');
  if (timeline.scenes.length !== items.length ||
      new Set(timeline.scenes.map(row => row.scene.id)).size !== items.length)
    failures.push('TIMELINE_SELECTION_MISMATCH');
  for (const row of timeline.scenes) {
    const scene = row.scene;
    const item = items.find(item => item.id === scene.id);
    if (scene.subtitles.length || row.subtitles.length ||
        scene.visual?.subtitlesEnabled) failures.push('SUBTITLES_FORBIDDEN');
    if (!item || scene.displayText !== item.displayText ||
        scene.narrationText !== item.spokenText ||
        scene.sourceReferences.length !== 1 ||
        scene.sourceReferences[0].entityId !== item.sourceReference.entityId ||
        scene.sourceReferences[0].entityType !== item.sourceReference.entityType ||
        scene.styleProperties.style !== 'SERIOUS' ||
        scene.styleProperties.cardMode === 'NARRATION') {
      failures.push('UNAUTHORIZED_SCENE:' + scene.id);
      continue;
    }
    const audio = currentNarration(session, item);
    if (!audio || scene.audioAssetId !== audio.id || row.audioDurationMs !== audio.durationMs)
      failures.push('CURRENT_MEASURED_AUDIO_REQUIRED:' + item.id);
  }
  if ([...props.audioAssets, ...props.mediaAssets].some(asset =>
    asset.availability !== 'AVAILABLE' || !asset.uri.startsWith('/api/studio/')))
    failures.push('LOCAL_MEDIA_REQUIRED');
  for (const item of items) {
    const norm = item.automaticNormalization;
    if (!norm || norm.ttsInputHash !== prepareTtsInput(item.spokenText, item.pronunciationOverrides).ttsInputHash)
      failures.push('NORMALIZATION_REQUIRED:' + item.id);
    if (spokenAmbiguities(item.spokenText, item.pronunciationOverrides).length ||
        norm?.ambiguousTerms.some(term => !Object.keys(item.pronunciationOverrides || {}).some(key => key.toLowerCase() === term.toLowerCase())))
      failures.push('PRONUNCIATION_REVIEW_REQUIRED:' + item.id);
  }
  if (failures.length) throw new BadRequestException(failures.join('; '));
}
