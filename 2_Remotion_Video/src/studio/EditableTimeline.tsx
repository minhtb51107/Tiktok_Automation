import { useState } from "react";
import type { VideoProject } from "../../../1_nest_backend/src/video-pipeline/contracts";
import type { EditorClip, EditorObject } from "./editor-timeline";
export function EditableTimeline({
  project,
  clips,
  frame,
  playing,
  seek,
  select,
  start,
  move,
  finish,
  remove,
  drop,
}: {
  project?: VideoProject;
  clips: EditorClip[];
  frame: number;
  playing: () => boolean;
  seek: (n: number) => void;
  select: (c: EditorClip) => void;
  start: () => void;
  move: (c: EditorClip, a: number, b: number, trim: boolean) => void;
  finish: () => void;
  remove: (c: EditorClip) => void;
  drop: (id: string, role: EditorObject,atFrame?:number) => void;
}) {
  const [zoom, setZoom] = useState(1),
    [chosen, setChosen] = useState<EditorClip | null>(null),
    [hint, setHint] = useState(
      "Click / drag clip · edge = trim · ruler = seek",
    );
  const t = project?.timeline,
    fps = t?.fps || 30,
    total = t?.totalFrames || 1;
  const pointer = (
    e: React.PointerEvent,
    c: EditorClip,
    mode: "MOVE" | "LEFT" | "RIGHT",
  ) => {
    if (playing() || c.missing) return;
    e.preventDefault();
    e.stopPropagation();
    select(c);
    setChosen(c);
    start();
    const lane = e.currentTarget.closest(".track-lane")!,
      r = lane.getBoundingClientRect(),
      x = e.clientX,
      scene = t?.scenes.find((s) => s.scene.id === c.sceneId);
    const min = scene
        ? c.object === "VOICE"
          ? (scene.audioStartFrame ?? scene.contentStartFrame)
          : scene.startFrame
        : 0,
      max = scene?.endFrame ?? total;
    const points = [
      0,
      total,
      ...(t?.scenes.flatMap((s) => [s.startFrame, s.endFrame]) || []),
      ...clips.filter((x) => x.id !== c.id).flatMap((x) => [x.start, x.end]),
    ];
    const snap = (n: number) => {
      const nearest = points.reduce(
        (a, b) => (Math.abs(n - b) < Math.abs(n - a) ? b : a),
        n,
      );
      return Math.abs(nearest - n) < Math.max(1, (total / r.width) * 8)
        ? nearest
        : n;
    };
    const drag = (p: PointerEvent) => {
      const delta = Math.round(((p.clientX - x) / r.width) * total);
      let a = c.start,
        b = c.end;
      if (mode === "MOVE") {
        a = Math.max(
          min,
          Math.min(max - (c.end - c.start), snap(c.start + delta)),
        );
        b = a + c.end - c.start;
      } else if (mode === "LEFT")
        a = Math.max(min, Math.min(c.end - 1, snap(c.start + delta)));
      else b = Math.max(c.start + 1, Math.min(max, snap(c.end + delta)));
      move(c, a, b, mode === "LEFT");
      setHint(
        `${c.object}: ${(a / fps).toFixed(3)} → ${(b / fps).toFixed(3)}s · ${((b - a) / fps).toFixed(3)}s`,
      );
    };
    const up = () => {
      window.removeEventListener("pointermove", drag);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
      finish();
    };
    window.addEventListener("pointermove", drag);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
  };
  const seekDown = (e: React.PointerEvent) => {
    if ((e.target as Element).closest("[data-clip-object]")) return;
    e.preventDefault();
    const r = e.currentTarget.getBoundingClientRect();
    const change = (p: { clientX: number }) =>
      seek(
        Math.round(
          Math.max(0, Math.min(1, (p.clientX - r.left) / r.width)) *
            (total - 1),
        ),
      );
    change(e);
    const up = () => {
      window.removeEventListener("pointermove", change);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", change);
    window.addEventListener("pointerup", up);
  };
  return (
    <section className="editor-tracks">
      <div className="timeline-header">
        <strong>Timeline</strong>
        <span>
          {(total / fps).toFixed(3)}s · {hint}
        </span>
        <label>
          Zoom{" "}
          <input
            aria-label="Timeline zoom"
            type="range"
            min={1}
            max={6}
            step={0.25}
            value={zoom}
            onChange={(e) => setZoom(Number(e.target.value))}
          />
        </label>
        <button
          disabled={!chosen}
          onClick={() => {
            if (chosen) remove(chosen);
            setChosen(null);
          }}
        >
          Delete clip
        </button>
      </div>
      <div
        className="tracks-scroll"
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault();
          try {
            const a = JSON.parse(
              e.dataTransfer.getData("application/studio-asset"),
            );
            if(!['MEME','BACKGROUND','SFX','BGM'].includes(a.role))return;
            const lane=(e.target as Element).closest('.track-lane');
            if(lane&&lane.getAttribute('data-track')!==a.role)return;
            const rect=lane?.getBoundingClientRect(),at=rect?Math.max(0,Math.min(total-2,Math.round((e.clientX-rect.left)/rect.width*total))):frame;
            drop(a.id, a.role,at);
          } catch {}
        }}
      >
        <div style={{ width: zoom * 100 + "%", minWidth: 600 }}>
          <div className="timeline-ruler">
            <span>TRACK</span>
            <div onPointerDown={seekDown}>
              {Array.from({ length: 9 }, (_, i) => (
                <span key={i} style={{ left: (i / 8) * 100 + "%" }}>
                  {(((total / fps) * i) / 8).toFixed(1)}s
                </span>
              ))}
            </div>
          </div>
          {(
            [
              "CARD",
              "MEME",
              "VOICE",
              "SFX",
              "BGM",
              "BACKGROUND",
            ] as EditorObject[]
          ).map((o) => (
            <div className="timeline-row" key={o}>
              <span className="track-label">
                {
                  {
                    CARD: "Threads",
                    MEME: "Meme / GIF",
                    VOICE: "Voice",
                    SFX: "SFX",
                    BGM: "BGM",
                    BACKGROUND: "Background",
                  }[o]
                }
              </span>
              <div
                className="track-lane"
                data-track={o}
                onPointerDown={seekDown}
              >
                {t?.scenes.map((s) => (
                  <i
                    key={s.scene.id}
                    className="scene-boundary"
                    style={{ left: (s.startFrame / total) * 100 + "%" }}
                  />
                ))}
                {clips
                  .filter((c) => c.object === o)
                  .map((c) => (
                    <div
                      role="button"
                      tabIndex={0}
                      key={c.id}
                      data-clip-object={o}
                      data-clip-id={c.id}
                      data-clip-scene={c.sceneId || ""}
                      data-start={c.start}
                      data-end={c.end}
                      title={`${c.label} ${(c.start / fps).toFixed(3)}–${(c.end / fps).toFixed(3)}s`}
                      className={`timeline-clip ${o.toLowerCase()} ${c.missing ? "missing" : ""} ${chosen?.id === c.id ? "clip-selected" : ""}`}
                      style={{
                        left: (c.start / total) * 100 + "%",
                        width: ((c.end - c.start) / total) * 100 + "%",
                        touchAction: "none",
                      }}
                      onPointerDown={(e) => pointer(e, c, "MOVE")}
                      onClick={() => {
                        setChosen(c);
                        select(c);
                      }}
                    >
                      <span
                        data-trim="LEFT"
                        className="trim-left"
                        onPointerDown={(e) => pointer(e, c, "LEFT")}
                      />
                      {c.label}
                      <span
                        data-trim="RIGHT"
                        className="trim-right"
                        onPointerDown={(e) => pointer(e, c, "RIGHT")}
                      />
                    </div>
                  ))}
                <i
                  className="playhead"
                  style={{ left: (frame / total) * 100 + "%" }}
                />
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
