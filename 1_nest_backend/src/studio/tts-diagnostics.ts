import { normalizeSpeech, type SpeechChange } from './speech-normalizer';

export interface TtsWordAlignment {
  word: string;
  phonemes: string;
  frames: number;
  durationMs: number;
  rmsDb: number;
  suspectedDrop: boolean;
}

export interface TtsChunkDiagnostic {
  index: number;
  text: string;
  transportText?: string;
  phonemes?: string;
  characters: number;
  phonemeCount?: number;
  durationMs?: number;
  trimmedLeadingSilenceMs?: number;
  trimmedTrailingSilenceMs?: number;
  boundaryPauseMs?: number;
  boundaryKind?: string;
  words?: TtsWordAlignment[];
}

export interface TtsWaveformReport {
  sampleRate: number;
  channels: number;
  durationMs: number;
  peakDb: number;
  rmsDb: number;
  leadingSilenceMs: number;
  trailingSilenceMs: number;
  internalPauses: Array<{
    startMs: number;
    endMs: number;
    durationMs: number;
  }>;
  maxPauseMs: number;
  maxInternalSilenceMs: number;
  meanPauseMs: number;
  speechRatio: number;
}

export interface TtsTimelineAlignment {
  sceneId: string;
  startFrame: number;
  endFrame: number;
  audioStartFrame: number;
  audioEndFrame: number;
  wavDurationMs: number;
  timelineAudioDurationMs: number;
  clippedMs: number;
}

export interface TtsSceneDiagnostic {
  itemId: string;
  originalText: string;
  displayText: string;
  spokenText: string;
  ttsInputText: string;
  ttsTransportText: string;
  normalizationVersion: string;
  sourceToSpokenDrops: string[];
  spokenToTtsDrops: string[];
  ttsToChunkDrops: string[];
  suspectedAcousticDrops: string[];
  chunks: TtsChunkDiagnostic[];
  waveform?: TtsWaveformReport;
  timeline?: TtsTimelineAlignment;
  status: 'CLEAN' | 'PASS' | 'WARNING_CHECK_NEEDED';
  warnings: string[];
}

export function extractSpokenTokens(text: string): string[] {
  return Array.from(
    text
      .normalize('NFC')
      .toLocaleLowerCase('vi')
      .matchAll(/[\p{L}\p{M}\p{N}]+/gu),
    (m) => m[0],
  );
}

/**
 * Pure PCM-16 WAV waveform and silence analyzer.
 * Measures leading/trailing silence, internal pauses >= 100ms below -38 dB, peak dB and RMS dB.
 */
export function analyzeWavBuffer(wavBytes: Buffer): TtsWaveformReport | undefined {
  if (
    wavBytes.length < 44 ||
    wavBytes.toString('ascii', 0, 4) !== 'RIFF' ||
    wavBytes.toString('ascii', 8, 12) !== 'WAVE'
  )
    return undefined;
  let offset = 12;
  let sampleRate = 24000;
  let channels = 1;
  let bitsPerSample = 16;
  let dataStart = -1;
  let dataLength = 0;
  while (offset + 8 <= wavBytes.length) {
    const chunkId = wavBytes.toString('ascii', offset, offset + 4);
    const chunkSize = wavBytes.readUInt32LE(offset + 4);
    if (chunkId === 'fmt ' && offset + 24 <= wavBytes.length) {
      channels = Math.max(1, wavBytes.readUInt16LE(offset + 10));
      sampleRate = Math.max(8000, wavBytes.readUInt32LE(offset + 12));
      bitsPerSample = wavBytes.readUInt16LE(offset + 22);
    } else if (chunkId === 'data') {
      dataStart = offset + 8;
      dataLength = Math.min(chunkSize, wavBytes.length - dataStart);
      break;
    }
    offset += 8 + chunkSize + (chunkSize % 2);
  }
  if (dataStart < 0 || dataLength <= 0 || bitsPerSample !== 16) return undefined;
  const bytesPerSample = 2 * channels;
  const totalFrames = Math.floor(dataLength / bytesPerSample);
  if (totalFrames <= 0) return undefined;

  const durationMs = Math.round((totalFrames * 1000) / sampleRate);
  const windowFrames = Math.max(1, Math.floor(sampleRate * 0.02)); // 20ms window
  const windowCount = Math.floor(totalFrames / windowFrames);
  let maxAbs = 0;
  let sumSqAll = 0;
  const silentWindows: boolean[] = [];

  for (let w = 0; w < windowCount; w++) {
    let winSumSq = 0;
    const baseFrame = w * windowFrames;
    for (let f = 0; f < windowFrames; f++) {
      const bytePos = dataStart + (baseFrame + f) * bytesPerSample;
      let mono = 0;
      for (let c = 0; c < channels; c++) {
        mono += wavBytes.readInt16LE(bytePos + c * 2) / 32768;
      }
      mono /= channels;
      const abs = Math.abs(mono);
      if (abs > maxAbs) maxAbs = abs;
      const sq = mono * mono;
      winSumSq += sq;
      sumSqAll += sq;
    }
    const winRms = Math.sqrt(winSumSq / windowFrames);
    const winDb = 20 * Math.log10(Math.max(winRms, 1e-7));
    silentWindows.push(winDb < -38);
  }

  const peakDb = Number((20 * Math.log10(Math.max(maxAbs, 1e-7))).toFixed(2));
  const rmsAll = Math.sqrt(sumSqAll / Math.max(1, windowCount * windowFrames));
  const rmsDb = Number((20 * Math.log10(Math.max(rmsAll, 1e-7))).toFixed(2));

  let firstVoiced = silentWindows.findIndex((s) => !s);
  if (firstVoiced < 0) firstVoiced = windowCount;
  let lastVoiced = silentWindows.length - 1;
  while (lastVoiced >= 0 && silentWindows[lastVoiced]) lastVoiced--;

  const leadingSilenceMs = firstVoiced * 20;
  const trailingSilenceMs = Math.max(
    0,
    (windowCount - 1 - Math.max(0, lastVoiced)) * 20,
  );

  const internalPauses: Array<{
    startMs: number;
    endMs: number;
    durationMs: number;
  }> = [];
  let runStart: number | null = null;
  for (let i = firstVoiced; i <= lastVoiced; i++) {
    if (silentWindows[i]) {
      if (runStart === null) runStart = i;
    } else if (runStart !== null) {
      const span = i - runStart;
      if (span >= 5) {
        // >= 100ms
        internalPauses.push({
          startMs: runStart * 20,
          endMs: i * 20,
          durationMs: span * 20,
        });
      }
      runStart = null;
    }
  }

  const maxPauseMs = internalPauses.reduce(
    (max, p) => Math.max(max, p.durationMs),
    0,
  );
  const meanPauseMs = internalPauses.length
    ? Math.round(
        internalPauses.reduce((sum, p) => sum + p.durationMs, 0) /
          internalPauses.length,
      )
    : 0;

  const voicedCount = silentWindows.filter((s) => !s).length;
  const speechRatio =
    windowCount > 0 ? Number((voicedCount / windowCount).toFixed(3)) : 0;

  return {
    sampleRate,
    channels,
    durationMs,
    peakDb,
    rmsDb,
    leadingSilenceMs,
    trailingSilenceMs,
    internalPauses,
    maxPauseMs,
    maxInternalSilenceMs: maxPauseMs,
    meanPauseMs,
    speechRatio,
  };
}

export function prepareTtsTransportPreview(text: string): string {
  return String(text || '')
    .replace(/:\s*(?:\.\.\.|…)+/g, '.')
    .replace(/\(\s*([^()]+?)\s*\)/g, ', $1, ')
    .replace(/["“”]\s*([^"“”]+?)\s*["“”]/g, ', $1, ')
    .replace(/["“”()]/g, ' ')
    .replace(/(?<=\p{L})-(?=\p{L})/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function buildSceneTtsDiagnostic(params: {
  itemId: string;
  originalText: string;
  displayText: string;
  spokenText: string;
  ttsInputText: string;
  normalizationVersion: string;
  scriptChanges?: SpeechChange[];
  ttsChanges?: SpeechChange[];
  chunkSamples?: Array<any>;
  wavBytes?: Buffer;
  waveform?: TtsWaveformReport | null;
  timelineScene?: {
    startFrame: number;
    endFrame: number;
    audioStartFrame?: number;
    audioEndFrame?: number;
    fps: number;
  };
  wavDurationMs?: number;
}): TtsSceneDiagnostic {
  const {
    itemId,
    originalText,
    displayText,
    spokenText,
    ttsInputText,
    normalizationVersion,
    scriptChanges = [],
    ttsChanges = [],
    chunkSamples = [],
    wavBytes,
    waveform: providedWaveform,
    timelineScene,
    wavDurationMs,
  } = params;

  const effectiveScriptChanges = scriptChanges.length
    ? scriptChanges
    : normalizeSpeech(displayText, { mode: 'SCRIPT' }).changes;
  const effectiveTtsChanges = ttsChanges.length
    ? ttsChanges
    : normalizeSpeech(spokenText, { mode: 'TTS' }).changes;
  const allowedChangedBefore = new Set<string>();
  for (const ch of [...effectiveScriptChanges, ...effectiveTtsChanges]) {
    for (const tok of extractSpokenTokens(ch.before)) {
      allowedChangedBefore.add(tok);
    }
  }

  const displayTokens = extractSpokenTokens(displayText);
  const spokenTokens = extractSpokenTokens(spokenText);
  const spokenSet = new Set(spokenTokens);
  const sourceToSpokenDrops = displayTokens.filter(
    (tok) =>
      !/^\d+$/.test(tok) &&
      !spokenSet.has(tok) &&
      !allowedChangedBefore.has(tok) &&
      !['tác', 'giả', 'đã', 'ghim', 'author', 'pinned'].includes(tok),
  );

  const ttsTokens = extractSpokenTokens(ttsInputText);
  const ttsSet = new Set(ttsTokens);
  const spokenToTtsDrops = spokenTokens.filter(
    (tok) =>
      !/^\d+$/.test(tok) && !ttsSet.has(tok) && !allowedChangedBefore.has(tok),
  );

  const chunks: TtsChunkDiagnostic[] = chunkSamples.map((c, idx) => ({
    index: c.index ?? idx + 1,
    text: typeof c.text === 'string' ? c.text : '',
    transportText:
      typeof c.transportText === 'string' ? c.transportText : undefined,
    phonemes: typeof c.phonemes === 'string' ? c.phonemes : undefined,
    characters: typeof c.characters === 'number' ? c.characters : (c.text || '').length,
    phonemeCount: typeof c.phonemeCount === 'number' ? c.phonemeCount : undefined,
    durationMs: typeof c.durationMs === 'number' ? c.durationMs : undefined,
    trimmedLeadingSilenceMs:
      typeof c.trimmedLeadingSilenceMs === 'number'
        ? c.trimmedLeadingSilenceMs
        : undefined,
    trimmedTrailingSilenceMs:
      typeof c.trimmedTrailingSilenceMs === 'number'
        ? c.trimmedTrailingSilenceMs
        : undefined,
    boundaryPauseMs:
      typeof c.boundaryPauseMs === 'number' ? c.boundaryPauseMs : undefined,
    boundaryKind:
      typeof c.boundaryKind === 'string' ? c.boundaryKind : undefined,
    words: Array.isArray(c.words) ? c.words : undefined,
  }));

  const chunkJoined = chunks
    .map((c) => c.transportText || c.text)
    .filter(Boolean)
    .join(' ');
  const chunkSet = new Set(extractSpokenTokens(chunkJoined));
  const ttsToChunkDrops = chunkJoined
    ? ttsTokens.filter((tok) => !chunkSet.has(tok))
    : [];

  const suspectedAcousticDrops: string[] = [];
  for (const ch of chunks) {
    for (const w of ch.words || []) {
      if (w.suspectedDrop || w.frames <= 1 || w.rmsDb < -40) {
        suspectedAcousticDrops.push(w.word);
      }
    }
  }

  const waveform =
    providedWaveform ?? (wavBytes ? analyzeWavBuffer(wavBytes) : undefined);
  const effectiveWavMs = wavDurationMs ?? waveform?.durationMs ?? 0;

  let timeline: TtsTimelineAlignment | undefined;
  if (timelineScene && effectiveWavMs > 0) {
    const fps = timelineScene.fps || 30;
    const audioStartFrame =
      timelineScene.audioStartFrame ?? timelineScene.startFrame;
    const audioEndFrame = timelineScene.audioEndFrame ?? timelineScene.endFrame;
    const timelineAudioDurationMs = Math.round(
      ((audioEndFrame - audioStartFrame) * 1000) / fps,
    );
    const clippedMs = Math.max(0, effectiveWavMs - timelineAudioDurationMs - 34);
    timeline = {
      sceneId: itemId,
      startFrame: timelineScene.startFrame,
      endFrame: timelineScene.endFrame,
      audioStartFrame,
      audioEndFrame,
      wavDurationMs: effectiveWavMs,
      timelineAudioDurationMs,
      clippedMs,
    };
  }

  const warnings: string[] = [];
  if (sourceToSpokenDrops.length)
    warnings.push(
      `Từ bị mất khi chuyển displayText → spokenText: ${sourceToSpokenDrops.join(', ')}`,
    );
  if (spokenToTtsDrops.length)
    warnings.push(
      `Từ bị mất khi chuyển spokenText → ttsInputText: ${spokenToTtsDrops.join(', ')}`,
    );
  if (ttsToChunkDrops.length)
    warnings.push(
      `Từ bị mất khi tách TTS chunks: ${ttsToChunkDrops.join(', ')}`,
    );
  if (suspectedAcousticDrops.length)
    warnings.push(
      `Từ có năng lượng âm thanh thấp / thời lượng quá ngắn trong WAV: ${suspectedAcousticDrops.join(', ')}`,
    );
  if (waveform && waveform.maxPauseMs > 480)
    warnings.push(
      `Khoảng lặng giữa câu dài (${waveform.maxPauseMs}ms); kiểm tra độ liền mạch.`,
    );
  if (timeline && timeline.clippedMs > 0)
    warnings.push(
      `Timeline cắt bớt ${timeline.clippedMs}ms cuối của WAV.`,
    );

  return {
    itemId,
    originalText,
    displayText,
    spokenText,
    ttsInputText,
    ttsTransportText: prepareTtsTransportPreview(ttsInputText),
    normalizationVersion,
    sourceToSpokenDrops,
    spokenToTtsDrops,
    ttsToChunkDrops,
    suspectedAcousticDrops,
    chunks,
    ...(waveform ? { waveform } : {}),
    ...(timeline ? { timeline } : {}),
    status: warnings.length ? 'WARNING_CHECK_NEEDED' : 'PASS',
    warnings,
  };
}
