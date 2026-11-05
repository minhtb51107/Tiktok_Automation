import { hash } from './rules';
import { canonicalPost } from './conversation-evidence';
import type {
  ThreadCollection,
  ConversationEvaluation,
} from './conversation-contracts';
import type {
  EditorialSection,
  Feasibility,
  DurationAssessment,
} from './editorial-contracts';
import type { VideoTimeline, AudioAsset } from '../video-pipeline/contracts';
export const EDITORIAL_CONFIG = Object.freeze({
  version: 'feasibility/1',
  defaultReadingSpeed:1.2,
  tokensPerMinute: { slow: 160, fast: 220 },
  minimumSourceTokens: 65,
  minimumNarrationRatio: 0.75,
  minReleaseSeconds: 60,
  targetSeconds: [70, 100] as [70, 100],
});
const words = (s: string) => (s.match(/[\p{L}\p{N}]+/gu) || []).length;
export function estimatedDuration(text: string, readingSpeed: number = EDITORIAL_CONFIG.defaultReadingSpeed) {
  if (!Number.isFinite(readingSpeed) || readingSpeed < 0.5 || readingSpeed > 3)
    throw Error('EDITORIAL_INVALID_READING_SPEED');
  const tokens = words(text);
  return {
    source: 'ESTIMATED' as const,
    minimumSeconds: Math.round(
      (tokens / (EDITORIAL_CONFIG.tokensPerMinute.fast * readingSpeed)) * 60,
    ),
    maximumSeconds: Math.round(
      (tokens / (EDITORIAL_CONFIG.tokensPerMinute.slow * readingSpeed)) * 60,
    ),
    tokens,
    targetSeconds: EDITORIAL_CONFIG.targetSeconds,
    authoritative: false as const,
  };
}
/** Verifies the complete selected parent chain, even if intermediate parents were not selected for narration. */
export function selectedReplies(c: ThreadCollection, ids: string[]) {
  const root = canonicalPost(c.root.url);
  if (!root || root.id !== c.root.id || root.handle !== c.root.author.handle)
    throw Error('EDITORIAL_ROOT_UNVERIFIED');
  if (new Set(ids).size !== ids.length)
    throw Error('EDITORIAL_DUPLICATE_SELECTION');
  return ids.map((id) => {
    const r = c.replies.find((x) => x.id === id);
    if (!r) throw Error('EDITORIAL_UNVERIFIED_SELECTION');
    const visited = new Set<string>();
    let child = r;
    while (true) {
      const own = canonicalPost(child.url),
        parent = canonicalPost(child.evidence.parentUrl);
      if (
        visited.has(child.id) ||
        child.extractionStatus !== 'VERIFIED' ||
        !own ||
        own.id !== child.id ||
        own.handle !== child.author.handle ||
        child.rootId !== root.id ||
        child.provenance.synthetic !== c.root.provenance.synthetic ||
        canonicalPost(child.evidence.subjectUrl)?.url !== own.url ||
        canonicalPost(child.evidence.documentUrl)?.url !== root.url ||
        !child.evidence.documentHash ||
        !['JSON_LD_COMMENT', 'JSON_LD_PARENT_ITEM'].includes(
          child.evidence.kind,
        ) ||
        parent?.id !== child.parentId
      )
        throw Error('EDITORIAL_RELATIONSHIP_UNVERIFIED');
      visited.add(child.id);
      if (child.parentId === root.id) {
        if (parent.url !== root.url) throw Error('EDITORIAL_WRONG_PARENT');
        break;
      }
      const p = c.replies.find((x) => x.id === child.parentId);
      if (!p || p.url !== parent.url) throw Error('EDITORIAL_MISSING_PARENT');
      child = p;
    }
    return r;
  });
}
export function feasibility(
  c: ThreadCollection,
  q: ConversationEvaluation,
  ids: string[],
  sections?: EditorialSection[],
  humanLabels: Record<string, string> = {},
): Feasibility {
  const replies = selectedReplies(c, ids),
    substantive = replies.filter(
      (r) =>
        (humanLabels[r.id] ||
          q.replyQuality.find((x) => x.replyId === r.id)?.label) ===
        'SUBSTANTIVE',
    );
  const sourceText = [
      c.root.originalText,
      ...substantive.map((r) => r.originalText),
    ].join('\n'),
    narration = sections?.map((s) => s.narrationText).join('\n') ?? sourceText;
  const sourceTokens = words(sourceText),
    personal = /(tôi|mình|trải nghiệm|khó|nhưng|vì|câu hỏi|vấn đề)/iu.test(
      sourceText,
    ),
    commentary =
      sections?.filter(
        (s) => s.kind === 'COMMENTARY' && s.narrationText.trim(),
      ) || [];
  const missing: string[] = [],
    reasons: string[] = [];
  if (!replies.length) missing.push('SELECT_VERIFIED_REPLY');
  if (!substantive.length) missing.push('SUBSTANTIVE_VERIFIED_REPLY');
  if (!personal) missing.push('CLEAR_SITUATION_OR_ARGUMENT');
  if (!commentary.some((s) => s.stage === 'HOOK'))
    missing.push('ORIGINAL_HOOK');
  if (!commentary.some((s) => s.stage === 'COMMENTARY'))
    missing.push('ORIGINAL_COMMENTARY');
  if (!commentary.some((s) => s.stage === 'RESOLUTION'))
    missing.push('ORIGINAL_RESOLUTION');
  const estimate = estimatedDuration(narration);
  let status: Feasibility['status'];
  if (
    replies.some(
      (r) =>
        !humanLabels[r.id] && !q.replyQuality.some((x) => x.replyId === r.id),
    )
  ) {
    status = 'UNKNOWN';
    missing.push('REPLY_QUALITY_NOT_AVAILABLE');
    reasons.push(
      'Quality evidence missing; do not infer low quality from absence.',
    );
  } else if (
    !substantive.length &&
    replies.some(
      (r) =>
        (humanLabels[r.id] ||
          q.replyQuality.find((x) => x.replyId === r.id)?.label) ===
        'UNCERTAIN',
    )
  ) {
    status = 'NEEDS_EDITORIAL_ENRICHMENT';
    missing.push('HUMAN_REPLY_QUALITY_REVIEW');
    reasons.push('Uncertain lexical classification needs human review.');
  } else if (!replies.length || !substantive.length || sourceTokens < 25) {
    status = 'INSUFFICIENT_CONTENT';
    reasons.push(
      'Popularity cannot replace substantive discussion; do not manufacture length.',
    );
  } else if (sourceTokens < EDITORIAL_CONFIG.minimumSourceTokens || !personal) {
    status = 'NEEDS_EDITORIAL_ENRICHMENT';
    reasons.push(
      'Source context is limited; editor must determine whether meaningful analysis is possible.',
    );
  } else if (missing.length || estimate.minimumSeconds <= EDITORIAL_CONFIG.minReleaseSeconds) {
    status = 'NEEDS_EDITORIAL_ENRICHMENT';
    reasons.push(
      'Requires original editorial work or more meaningful material, not slower speech/padding.',
    );
  } else {
    status = 'READY_FOR_SCRIPT';
    reasons.push(
      'Heuristic material/structure checks pass; human factual/semantic review and measured TTS are still required.',
    );
  }
  if (
    new Set((sections || []).map((s) => s.narrationText.trim()).filter(Boolean))
      .size < (sections || []).filter((s) => s.narrationText.trim()).length
  ) {
    if(status!=='INSUFFICIENT_CONTENT'&&status!=='UNKNOWN')status = 'NEEDS_EDITORIAL_ENRICHMENT';
    missing.push('REPEATED_NARRATION');
  }
  for(const section of commentary){
    const tokens=section.narrationText.toLocaleLowerCase('vi').match(/[\p{L}\p{N}]+/gu)||[];
    if(tokens.length>=30&&new Set(tokens).size/tokens.length<0.25){
      if(status!=='INSUFFICIENT_CONTENT'&&status!=='UNKNOWN')status='NEEDS_EDITORIAL_ENRICHMENT';
      missing.push('REPETITIVE_COMMENTARY');
      reasons.push('Repeated words cannot manufacture meaningful duration; human editorial review required.');
    }
  }
  return {
    version: EDITORIAL_CONFIG.version,
    configHash: hash(EDITORIAL_CONFIG),
    status,
    reasons,
    missingEvidence: missing,
    breakdown: {
      sourceContext: {
        value: sourceTokens,
        reason: 'Tokens are a material proxy, not duration authority',
      },
      substantiveReplies: {
        value: substantive.length,
        reason: 'Verified and substantive replies only',
      },
      originalSections: {
        value: commentary.length,
        reason: 'Manual commentary is not automatically fact-checked',
      },
    },
    estimate,
  };
}
/** Uses the existing timeline, never generates timing here. A passing duration alone is not release approval. */
export function measuredDuration(
  timeline: VideoTimeline | undefined,
  assets: AudioAsset[],
): DurationAssessment {
  const base = {
    source: 'ESTIMATED' as DurationAssessment['source'],
    status: 'NOT_MEASURED' as DurationAssessment['status'],
    timelineSeconds: null as number | null,
    narrationSeconds: null as number | null,
    releaseReady: false as const,
    durationGatePassed: false,
    warnings: [
      'Content, audio, rights and human approvals remain independent.',
    ],
  };
  if (
    !timeline ||
    !timeline.scenes.length ||
    !Number.isInteger(timeline.fps) ||
    timeline.fps <= 0 ||
    !Number.isInteger(timeline.totalFrames) ||
    timeline.totalFrames <= 0
  )
    return base;
  const audio = timeline.scenes.map((s) =>
    assets.find((a) => a.id === s.scene.audioAssetId),
  );
  if (
    audio.some(
      (a) =>
        !a ||
        a.role !== 'NARRATION' ||
        a.availability !== 'AVAILABLE' ||
        !Number.isFinite(a.durationMs) ||
        a.durationMs <= 0 ||
        !['MEASURED', 'FIXTURE'].includes(a.durationSource),
    )
  )
    return base;
  const seconds = timeline.totalFrames / timeline.fps,
    narration =
      audio.reduce((n, a, index) => {
        const v = timeline.scenes[index].scene.visual;
        if (v?.voiceEnabled === false || v?.voiceVolume === 0) return n;
        const available = Math.max(
          0,
          a!.durationMs - (v?.voiceSourceInMs || 0),
        );
        return n + Math.min(available, v?.voiceDurationMs ?? available);
      }, 0) / 1000,
    fixture = audio.some((a) => a!.durationSource === 'FIXTURE');
  const result = {
    ...base,
    source: fixture ? ('FIXTURE' as const) : ('MEASURED' as const),
    timelineSeconds: seconds,
    narrationSeconds: narration,
  };
  if (seconds <= EDITORIAL_CONFIG.minReleaseSeconds || narration <= EDITORIAL_CONFIG.minReleaseSeconds)
    return { ...result, status: 'DURATION_TOO_SHORT' };
  if (
    timeline.scenes.some(
      (s, i) =>
        s.audioDurationMs !== audio[i]!.durationMs ||
        s.audioEndFrame === undefined ||
        s.audioStartFrame === undefined ||
        s.audioEndFrame > s.endFrame,
    ) ||
    narration > seconds + 0.1
  )
    return { ...result, status: 'TIMELINE_MISMATCH' };
  if (narration / seconds < EDITORIAL_CONFIG.minimumNarrationRatio)
    return { ...result, status: 'INVALID_NARRATION_COVERAGE' };
  return {
    ...result,
    status: fixture ? 'FIXTURE_CONTRACT_PASS' : 'MEASURED_DURATION_PASS',
    durationGatePassed: true,
    warnings: [
      ...result.warnings,
      'Manifest duration is not speech activity or semantic quality; human audition is required.',
      ...(seconds > 100
        ? ['Above internal 70–100s target; edit if useful, not a hard failure']
        : []),
    ],
  };
}
