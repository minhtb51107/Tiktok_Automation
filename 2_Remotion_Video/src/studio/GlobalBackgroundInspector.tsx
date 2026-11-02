import type { BackgroundClip } from "../../../1_nest_backend/src/video-pipeline/editing";
import { autoSegment } from "../../../1_nest_backend/src/video-pipeline/editing";
export function GlobalBackgroundInspector({
  clips,
  id,
  assets,
  frameMs,
  totalMs,
  update,
  choose,
  select,
  disabled,
}: {
  disabled: boolean;
  clips: BackgroundClip[];
  id: string;
  assets: { id: string; uri: string; durationMs?: number; kind: string }[];
  frameMs: number;
  totalMs: number;
  update: (c: BackgroundClip[]) => void;
  choose: () => void;
  select: (id: string) => void;
}) {
  const c = clips.find((c) => c.id === id) || clips[0],
    a = assets.find((a) => a.id === c?.assetId);
  if (!c)
    return (
      <div className="inspector-fields">
        <h3>Global background</h3>
        <button onClick={choose}>Choose Background</button>
      </div>
    );
  const sourceMs = a?.durationMs || Math.max(c.sourceOutMs, totalMs),
    patch = (p: Partial<BackgroundClip>) =>
      update(clips.map((x) => (x.id === c.id ? { ...x, ...p } : x)));
  const number = (
    label: string,
    n: number,
    min: number,
    max: number,
    fn: (n: number) => void,
  ) => (
    <label>
      {label}
      <input
        aria-label={label}
        type="number"
        value={n}
        min={min}
        max={max}
        onChange={(e) => {
          if (e.target.value !== "")
            fn(
              Math.round(Math.max(min, Math.min(max, Number(e.target.value)))),
            );
        }}
      />
    </label>
  );
  return (
    <div className="inspector-fields" data-testid="global-background-inspector">
      <fieldset
        disabled={disabled}
        style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}
      >
        <h3>Global background</h3>
        <select
          aria-label="Background clip"
          value={c.id}
          onChange={(e) => select(e.target.value)}
        >
          {clips.map((x, n) => (
            <option value={x.id} key={x.id}>
              Clip {n + 1} · {(x.startMs / 1000).toFixed(2)}s
            </option>
          ))}
        </select>
        <button onClick={choose}>Add background clip</button>
        <small>
          Independent track · later overlapping clips override earlier clips.
          Cover/crop 9:16.
        </small>
        {number(
          "Background start (ms)",
          c.startMs,
          0,
          Math.max(0, totalMs - 34),
          (startMs) => patch({ startMs }),
        )}
        {number(
          "Background duration (ms)",
          c.durationMs,
          34,
          c.loop ? 86400000 : Math.max(34, c.sourceOutMs - c.sourceInMs),
          (durationMs) => patch({ durationMs }),
        )}
        {number(
          "Source In (ms)",
          c.sourceInMs,
          0,
          sourceMs - 34,
          (sourceInMs) =>
            patch({
              sourceInMs,
              sourceOutMs: Math.min(sourceMs, sourceInMs + c.durationMs),
              loop: sourceMs - sourceInMs < c.durationMs,
              offsetMs: 0,
            }),
        )}
        {number(
          "Source Out (ms)",
          c.sourceOutMs,
          c.sourceInMs + 34,
          sourceMs,
          (sourceOutMs) =>
            patch({
              sourceOutMs,
              loop: sourceOutMs - c.sourceInMs < c.durationMs,
              offsetMs: 0,
            }),
        )}
        <label>
          <input
            aria-label="Background loop"
            type="checkbox"
            checked={c.loop}
            onChange={(e) =>
              patch({
                loop: e.target.checked,
                durationMs: e.target.checked
                  ? c.durationMs
                  : Math.min(c.durationMs, c.sourceOutMs - c.sourceInMs),
              })
            }
          />{" "}
          Loop selected source range
        </label>
        {number("Segment seed", c.seed ?? 7, 0, 2147483647, (seed) =>
          patch({ seed }),
        )}
        <button
          onClick={() =>
            patch({
              ...autoSegment(
                sourceMs,
                Math.min(totalMs, c.durationMs),
                c.seed ?? 7,
              ),
              offsetMs: 0,
            })
          }
        >
          Auto-select segment (seeded)
        </button>
        <button
          onClick={() => {
            const seed = (c.seed ?? 7) + 1;
            patch({
              seed,
              ...autoSegment(sourceMs, Math.min(totalMs, c.durationMs), seed),
              offsetMs: 0,
            });
          }}
        >
          Another segment
        </button>
        <small>
          Deterministic heuristic; no AI/content quality scoring. Source{" "}
          {Math.round(sourceMs / 1000)}s, in {(c.sourceInMs / 1000).toFixed(3)}
          s; phase {(c.offsetMs || 0) / 1000}s.
        </small>
        <button
          onClick={() =>
            patch({
              startMs: 0,
              durationMs: totalMs,
              sourceOutMs: Math.min(sourceMs,c.sourceInMs+totalMs),
              loop: sourceMs-c.sourceInMs<totalMs,
              offsetMs: 0,
            })
          }
        >
          Extend across whole video
        </button>
        <button
          disabled={
            frameMs <= c.startMs + 34 ||
            frameMs >= c.startMs + c.durationMs - 34
          }
          onClick={() => {
            const n = Math.round(frameMs - c.startMs),
              second = {
                ...c,
                id: "bg-" + crypto.randomUUID(),
                startMs: Math.round(frameMs),
                durationMs: c.durationMs - n,
                offsetMs:
                  ((c.offsetMs || 0) + n) % (c.sourceOutMs - c.sourceInMs),
              };
            update(
              clips.flatMap((x) =>
                x.id === c.id ? [{ ...x, durationMs: n }, second] : [x],
              ),
            );
            select(second.id);
          }}
        >
          Split at playhead
        </button>
        <button onClick={() => update(clips.filter((x) => x.id !== c.id))}>
          Remove background clip
        </button>
        {a && a.kind === "VIDEO" && (
          <>
            <h4>Source preview</h4>
            <video
              key={a.id + ":" + c.sourceInMs}
              aria-label="Background source preview"
              src={a.uri}
              controls
              preload="metadata"
              style={{ width: "100%" }}
              onLoadedMetadata={(e) => {
                e.currentTarget.currentTime = c.sourceInMs / 1000;
              }}
              onTimeUpdate={(e) => {
                if (e.currentTarget.currentTime >= c.sourceOutMs / 1000)
                  e.currentTarget.pause();
              }}
            />
          </>
        )}
      </fieldset>
    </div>
  );
}
