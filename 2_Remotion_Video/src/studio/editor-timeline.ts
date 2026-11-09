import {frameRange} from '../../../1_nest_backend/src/video-pipeline/editing';
import type { VideoProject } from "../../../1_nest_backend/src/video-pipeline/contracts";
export type EditorObject =
  | "CARD"
  | "MEME"
  | "BACKGROUND"
  | "VOICE"
  | "SFX"
  | "BGM";
export interface EditorClip {
  id: string;
  sceneId: string | null;
  object: EditorObject;
  start: number;
  end: number;
  label: string;
  missing?: boolean;
  muted?: boolean;
}
export function editorClips(project: VideoProject): EditorClip[] {
  const t = project.timeline;
  if (!t) return [];
  const f = (ms: number) => Math.ceil((ms * t.fps) / 1000),
    clips: EditorClip[] = [];
  for (const s of t.scenes) {
    const v = s.scene.visual;
    const add = (
      object: EditorObject,
      start: number,
      end: number,
      label: string,
      missing = false,
      muted = false,
    ) => {
      start = Math.max(s.startFrame, start);
      end = Math.min(s.endFrame, end);
      if (end > start)
        clips.push({
          id: s.scene.id + "-" + object.toLowerCase(),
          sceneId: s.scene.id,
          object,
          start,
          end,
          label,
          missing,
          muted,
        });
    };
    if (v?.card.enabled !== false)
      add(
        "CARD",
        s.startFrame + f(v?.card.startMs || 0),
        s.startFrame +
          f((v?.card.startMs || 0) + (v?.card.durationMs ?? s.sceneDurationMs)),
        s.scene.threadsCard?.handle || "Threads",
      );
    if (v?.backgroundId && !project.backgroundTracks?.some((c) => c.enabled))
      add("BACKGROUND", s.startFrame, s.endFrame, "Scene BG");
    if (v?.meme.enabled && v.meme.assetId)
      add(
        "MEME",
        s.startFrame + f(v.meme.startMs),
        s.startFrame + f(v.meme.startMs + v.meme.durationMs),
        "Meme / GIF",
      );
    const audio = project.audioAssets.find(
        (a) => a.id === s.scene.audioAssetId,
      ),
      voiceStart =
        (s.audioStartFrame ?? s.contentStartFrame) + f(v?.voiceStartMs || 0);
    if (v?.voiceEnabled !== false)
      add(
        "VOICE",
        voiceStart,
        voiceStart +
          f(
            audio
              ? Math.min(
                  audio.durationMs - (v?.voiceSourceInMs || 0),
                  v?.voiceDurationMs ?? 86400000,
                )
              : ((s.contentEndFrame - s.contentStartFrame) * 1000) / t.fps,
          ),
        audio ? "Narration" : "Missing voice",
        !audio,
        false,
      );
    if (s.scene.sfxLayer) {
      const l = s.scene.sfxLayer,
        a = project.audioAssets.find((a) => a.id === l.assetId);
      add(
        "SFX",
        s.startFrame + f(l.startMs),
        s.startFrame +
          f(
            l.startMs +
              Math.min(
                (a?.durationMs || 0) - (l.sourceInMs || 0),
                l.durationMs ?? 86400000,
              ),
          ),
        "SFX",
      );
    }
  }
  for (const c of project.backgroundTracks || [])
    if (c.enabled)
      clips.push({
        id: c.id,
        sceneId: null,
        object: "BACKGROUND",
        start: frameRange(c.startMs,c.durationMs,t.fps).start,
        end: Math.min(t.totalFrames,frameRange(c.startMs,c.durationMs,t.fps).end),
        label: "Global background",
      });
  const b = project.backgroundMusic;
  if (b?.enabled && b.assetId)
    clips.push({
      id: "project-bgm",
      sceneId: null,
      object: "BGM",
      start: f(b.startMs),
      end: Math.min(
        t.totalFrames,
        f(b.startMs + (b.durationMs ?? t.totalDurationMs)),
      ),
      label: "Global BGM",
    });
  return clips.filter((c) => c.end > c.start);
}
