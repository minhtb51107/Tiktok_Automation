import { useEffect, useState } from "react";
import type { SceneVisual } from "../../../1_nest_backend/src/video-pipeline/scene-visual";
import { cardPages } from "../../../1_nest_backend/src/video-pipeline/scene-visual";
export function CanvasTransform({
  object,
  visual,
  text,
  sceneId,
  frame,
  width,
  playing,
  start,
  update,
  finish,
}: {
  object: string;
  visual: SceneVisual;
  text: string;
  sceneId: string;
  frame: number;
  width: number;
  playing: () => boolean;
  start: () => void;
  update: (v: SceneVisual) => void;
  finish: () => void;
}) {
  const [box, setBox] = useState<{
      x: number;
      y: number;
      w: number;
      h: number;
    } | null>(null),
    [guide, setGuide] = useState(false);
  useEffect(() => {
    const raf = requestAnimationFrame(() => {
      const card = document.querySelector(
          `[data-testid="threads-video-card"][data-scene-id="${sceneId}"]`,
        ),
        root = card?.closest(".preview-surface"),
        e =
          object === "CARD"
            ? card
            : root?.querySelector("[data-testid=scene-meme]");
      if (!e || !root || getComputedStyle(e).display === "none") {
        setBox(null);
        return;
      }
      const b = e.getBoundingClientRect(),
        r = root.getBoundingClientRect(),
        scale = r.width / 1080;
      setBox({
        x: (b.x - r.x) / scale,
        y: (b.y - r.y) / scale,
        w: b.width / scale,
        h: b.height / scale,
      });
    });
    return () => cancelAnimationFrame(raf);
  }, [object, visual, sceneId, frame, width, text]);
  if (!box || !["CARD", "MEME"].includes(object)) return null;
  const down = (e: React.PointerEvent, resize: boolean) => {
    if (playing()) return;
    e.preventDefault();
    e.stopPropagation();
    const sx = e.clientX,
      sy = e.clientY,
      original = structuredClone(visual),
      b = { ...box },
      scale = width / 1080;
    start();
    e.currentTarget.setPointerCapture(e.pointerId);
    const move = (event: PointerEvent) => {
      const dx = (event.clientX - sx) / scale,
        dy = (event.clientY - sy) / scale,
        v = structuredClone(original);
      let x = b.x + dx,
        y = b.y + dy,
        w = b.w,
        h = b.h;
      if (resize) {
        w = Math.max(
          object === "CARD" ? 240 : 80,
          Math.min(1080 - b.x, b.w + dx),
        );
        if (object === "CARD") {
          v.card.width = w / v.card.scale;
          v.card.width = Math.max(v.card.padding * 2 + 101, v.card.width);
        } else {
          h =
            original.meme.lockAspect === false
              ? Math.max(60, Math.min(1920 - b.y, b.h + dy))
              : (w * b.h) / b.w;
          if (h > 1920 - b.y) {
            h = 1920 - b.y;
            w = (h * b.w) / b.h;
          }
          v.meme.width = Math.round(w);
          v.meme.height = Math.round(h);
        }
      } else {
        x = Math.max(0, Math.min(1080 - b.w, x));
        const center = Math.abs(x + b.w / 2 - 540) < 14;
        if (center) x = (1080 - b.w) / 2;
        setGuide(center);
        if (object === "CARD") {
          y = Math.max(
            0,
            Math.min(
              1500,
              1920 -
                b.h -
                (original.meme.enabled
                  ? original.meme.height + original.meme.gap
                  : 0) -
                30,
              y,
            ),
          );
          v.card.x = Math.round(x);
          v.card.y = Math.round(y);
        } else {
          const min =
            original.card.y +
            cardPages(text, original).height +
            original.meme.gap;
          y = Math.max(min, Math.min(1920 - b.h, y));
          v.meme.x = Math.round(x);
          v.meme.y = Math.round(y);
        }
      }
      update(v);
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
      setGuide(false);
      finish();
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
  };
  return (
    <div
      className="canvas-transform"
      style={{ position: "absolute", inset: 0, pointerEvents: "none" }}
    >
      {guide && <i className="canvas-center-guide" />}
      <div
        data-testid="canvas-selection"
        data-object={object}
        style={{
          position: "absolute",
          left: (box.x / 1080) * 100 + "%",
          top: (box.y / 1920) * 100 + "%",
          width: (box.w / 1080) * 100 + "%",
          height: (box.h / 1920) * 100 + "%",
          border: "1px solid #b9a5ff",
          pointerEvents: "auto",
          cursor: "move",
          touchAction: "none",
        }}
        onPointerDown={(e) => down(e, false)}
      >
        <span className="selection-label">
          {object} · drag / resize · center snap
        </span>
        <button
          aria-label="Resize selected object"
          className="canvas-resize"
          onPointerDown={(e) => down(e, true)}
        />
      </div>
    </div>
  );
}
