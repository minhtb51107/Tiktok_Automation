import type { EditorObject } from "./editor-timeline";
import type {
  EditorSceneSettings,
  EditorSettings,
} from "../../../1_nest_backend/src/studio/editor.types";
import {
  normalizeVisual,
  defaultSceneVisual,
  defaultBgm,
} from "../../../1_nest_backend/src/video-pipeline/scene-visual";
import type { StudioItem } from "../../../1_nest_backend/src/studio/studio.contracts";
export function EditorInspector({
  sceneDurationMs,
  voiceDurationMs,
  sfxDurationMs,
  timelineDurationMs,
  object,
  item,
  current,
  settings,
  disabled,
  update,
  globalUpdate,
  choose,
  editText,
  text,
  onVoice,
}: {
  sceneDurationMs?: number;
  voiceDurationMs?: number;
  sfxDurationMs?: number;
  timelineDurationMs?: number;
  object: EditorObject;
  item: StudioItem;
  current: EditorSceneSettings;
  settings: EditorSettings;
  disabled: boolean;
  update: (p: Partial<EditorSceneSettings>) => void;
  globalUpdate: (p: Partial<EditorSettings>) => void;
  choose: (o: EditorObject) => void;
  editText: (s: string) => void;
  text: string;
  onVoice: () => void;
}) {
  const v = normalizeVisual(current.visual),
    m = v.meme,
    bgm = settings.backgroundMusic || defaultBgm();
  const n = (
    label: string,
    value: number,
    min: number,
    max: number,
    fn: (n: number) => void,
    step = 1,
  ) => (
    <label>
      <span className="inspector-label-row"><span>{label}</span>{Number.isFinite(value) && max > min && (max - min <= 1920 || step < 1) && (<input aria-label={label + " slider"} type="range" min={min} max={max} step={step} value={Math.min(max, Math.max(min, value))} disabled={disabled} onChange={(e) => fn(Number(e.target.value))} />)}</span>
      <input
        aria-label={label}
        type="number"
        value={Number.isFinite(value) ? value : ""}
        min={min}
        max={max}
        step={step}
        disabled={disabled}
        onChange={(e) => {
          if (e.target.value !== "")
            fn(Math.min(max, Math.max(min, Number(e.target.value))));
        }}
      />
    </label>
  );
  const check = (label: string, value: boolean, fn: (v: boolean) => void) => (
    <label className="inspector-check">
      <input
        type="checkbox"
        checked={value}
        disabled={disabled}
        onChange={(e) => fn(e.target.checked)}
      />
      {label}
    </label>
  );
  const card = (p: Partial<typeof v.card>) =>
      update({ visual: { ...v, card: { ...v.card, ...p } } }),
    meme = (p: Partial<typeof m>) =>
      update({ visual: { ...v, meme: { ...m, ...p } } });
  return (
    <div
      className="inspector-fields"
      data-testid="object-inspector"
      data-object={object}
    >
      <div className="inspector-heading">
        <span className={"object-dot " + object.toLowerCase()} />
        <h3>
          {
            {
              CARD: "Threads Card",
              MEME: "Meme / GIF",
              BACKGROUND: "Background",
              VOICE: "Voice",
              SFX: "Sound effect",
              BGM: "Background music",
            }[object]
          }
        </h3>
      </div>
      <p className="muted">{item.author.displayName}</p>
      {object === "CARD" && (
        <>
          {check("Card visible", v.card.enabled !== false, (enabled) =>
            card({ enabled }),
          )}
          {n("Card start (ms)", v.card.startMs || 0, 0, 30000, (startMs) =>
            card({ startMs }),
          )}
          {n(
            "Card duration (ms)",
            v.card.durationMs ??
              Math.max(
                34,
                (sceneDurationMs ?? current.silentDurationMs) -
                  (v.card.startMs || 0),
              ),
            34,
            30000,
            (durationMs) => card({ durationMs }),
          )}
          <div className="inspector-two">
            {n("Card X", v.card.x, 0, 1080 - v.card.width * v.card.scale, (x) =>
              card({ x }),
            )}
            {n("Card Y", v.card.y, 0, 1500, (y) => card({ y }))}
            {n(
              "Card width",
              v.card.width,
              240,
              (1080 - v.card.x) / v.card.scale,
              (width) => card({ width }),
            )}
            {n(
              "Card scale",
              v.card.scale,
              0.5,
              Math.min(1.5, (1080 - v.card.x) / v.card.width),
              (scale) => card({ scale }),
              0.05,
            )}
            {n("Card padding", v.card.padding, 12, 80, (padding) =>
              card({ padding }),
            )}
            {n("Font size", v.card.fontSize, 24, 64, (fontSize) =>
              card({ fontSize }),
            )}
            {n(
              "Line height",
              v.card.lineHeight ?? 1.45,
              1.1,
              2,
              (lineHeight) => card({ lineHeight }),
              0.05,
            )}
            {n("Section gap", v.card.gap, 0, 60, (gap) => card({ gap }))}
          </div>
          <label>
            Card appearance
            <select
              aria-label="Card appearance"
              value={v.card.appearance ?? "LIGHT"}
              disabled={disabled}
              onChange={(e) =>
                card({ appearance: e.target.value as "LIGHT" | "DARK" })
              }
            >
              <option value="LIGHT">Light card</option>
              <option value="DARK">Dark card</option>
            </select>
          </label>
          <button
            disabled={disabled}
            onClick={() =>
              update({
                visual: {
                  ...v,
                  card: {
                    ...defaultSceneVisual().card,
                    appearance: v.card.appearance,
                  },
                },
              })
            }
          >
            Reset Layout
          </button>
          <label>
            Display text
            <textarea
              aria-label="Display text"
              value={text}
              disabled={disabled}
              onChange={(e) => editText(e.target.value)}
            />
          </label>
          <details>
            <summary>Original source · read-only</summary>
            <p>{item.originalText}</p>
            <small>
              Topic: {item.contentMapping?.topic || "—"} · Locks:{" "}
              {item.manualLocks.join(", ") || "—"}
            </small>
          </details>
          <h4>Scene timing</h4>
          {n(
            "Padding before (ms)",
            current.paddingBeforeMs,
            0,
            30000,
            (paddingBeforeMs) => update({ paddingBeforeMs }),
          )}
          {n(
            "Gap after (ms)",
            current.paddingAfterMs,
            0,
            30000,
            (paddingAfterMs) => update({ paddingAfterMs }),
          )}
          {n(
            "Visual-only duration (ms)",
            current.silentDurationMs,
            100,
            30000,
            (silentDurationMs) => update({ silentDurationMs }),
          )}
          <p className="muted">
            Missing voice uses this explicit visual duration. Narration is never
            estimated.
          </p>
        </>
      )}
      {object === "MEME" && (
        <>
          <button disabled={disabled} onClick={() => choose("MEME")}>
            Choose Meme / GIF
          </button>
          {check(
            "Lock image aspect ratio",
            m.lockAspect !== false,
            (lockAspect) => meme({ lockAspect }),
          )}
          {check("Visible", m.enabled, (enabled) => meme({ enabled }))}
          <div className="inspector-two">
            {n("Meme width", m.width, 80, 1080 - (m.x ?? 0), (width) =>
              meme({ width }),
            )}
            {n(
              "Meme height",
              m.height,
              60,
              Math.min(900, 1920 - (m.y ?? 0)),
              (height) => meme({ height }),
            )}
            {n("Meme gap", m.gap, 0, 160, (gap) => meme({ gap }))}
            {n("Meme start (ms)", m.startMs, 0, 30000, (startMs) =>
              meme({ startMs }),
            )}
            {n("Meme duration (ms)", m.durationMs, 1, 30000, (durationMs) =>
              meme({ durationMs }),
            )}
          </div>
          <label>
            Meme X · blank = center
            <input
              aria-label="Meme X"
              type="number"
              value={m.x ?? ""}
              disabled={disabled}
              onChange={(e) =>
                meme({
                  x:
                    e.target.value === ""
                      ? null
                      : Math.min(
                          1080 - m.width,
                          Math.max(0, Number(e.target.value)),
                        ),
                })
              }
            />
          </label>
          <label>
            Meme Y · blank = below card
            <input
              aria-label="Meme Y"
              type="number"
              value={m.y ?? ""}
              disabled={disabled}
              onChange={(e) =>
                meme({
                  y:
                    e.target.value === ""
                      ? null
                      : Math.min(
                          1920 - m.height,
                          Math.max(0, Number(e.target.value)),
                        ),
                })
              }
            />
          </label>
          <button
            disabled={disabled}
            onClick={() => meme({ assetId: null, enabled: false })}
          >
            Remove from scene
          </button>
          <small>
            Animation phase of GIF after seeking is not export-validated.
          </small>
        </>
      )}
      {object === "BACKGROUND" && (
        <>
          <button disabled={disabled} onClick={() => choose("BACKGROUND")}>
            Choose Background
          </button>
          <p>Fill canvas · crop to 9:16 · source aspect ratio preserved.</p>
          <button
            disabled={disabled}
            onClick={() => update({ visual: { ...v, backgroundId: null } })}
          >
            Remove scene background
          </button>
          <button
            disabled={disabled || !settings.backgroundId}
            onClick={() => globalUpdate({ backgroundId: null })}
          >
            Remove global background
          </button>
        </>
      )}
      {object === "VOICE" && (
        <>
          {n(
            "Voice start offset (ms)",
            v.voiceStartMs || 0,
            0,
            30000,
            (voiceStartMs) => update({ visual: { ...v, voiceStartMs } }),
          )}
          {n(
            "Voice source in (ms)",
            v.voiceSourceInMs || 0,
            0,
            30000,
            (voiceSourceInMs) => update({ visual: { ...v, voiceSourceInMs } }),
          )}
          {n(
            "Voice clip duration (ms)",
            v.voiceDurationMs ??
              Math.max(34, (voiceDurationMs ?? 0) - (v.voiceSourceInMs || 0)),
            34,
            30000,
            (voiceDurationMs) => update({ visual: { ...v, voiceDurationMs } }),
          )}
          {check("Voice enabled", v.voiceEnabled, (voiceEnabled) =>
            update({ visual: { ...v, voiceEnabled } }),
          )}
          {n(
            "Voice volume",
            v.voiceVolume,
            0,
            1,
            (voiceVolume) => update({ visual: { ...v, voiceVolume } }),
            0.05,
          )}
          <p>
            Only matching draft or reviewed audio from this session is used.
            Approval is never automatic.
          </p>
          <button disabled={disabled} onClick={onVoice}>
            Open Voice workspace
          </button>
        </>
      )}
      {object === "SFX" && (
        <>
          {n(
            "SFX source in (ms)",
            v.sfx.sourceInMs || 0,
            0,
            30000,
            (sourceInMs) =>
              update({ visual: { ...v, sfx: { ...v.sfx, sourceInMs } } }),
          )}
          {n(
            "SFX clip duration (ms)",
            v.sfx.durationMs ??
              Math.max(
                34,
                Math.min(
                  (sfxDurationMs ?? 3000) - (v.sfx.sourceInMs || 0),
                  (sceneDurationMs ?? current.silentDurationMs) - v.sfx.startMs,
                ),
              ),
            34,
            30000,
            (durationMs) =>
              update({ visual: { ...v, sfx: { ...v.sfx, durationMs } } }),
          )}
          <button disabled={disabled} onClick={() => choose("SFX")}>
            Choose SFX
          </button>
          {check("SFX enabled", v.sfx.enabled, (enabled) =>
            update({ visual: { ...v, sfx: { ...v.sfx, enabled } } }),
          )}
          {n("SFX start (ms)", v.sfx.startMs, 0, 30000, (startMs) =>
            update({ visual: { ...v, sfx: { ...v.sfx, startMs } } }),
          )}
          {n(
            "SFX volume",
            v.sfx.volume,
            0,
            0.7,
            (volume) => update({ visual: { ...v, sfx: { ...v.sfx, volume } } }),
            0.05,
          )}
          <button
            disabled={disabled}
            onClick={() =>
              update({
                visual: {
                  ...v,
                  sfx: { ...v.sfx, assetId: null, enabled: false },
                },
              })
            }
          >
            Remove SFX
          </button>
        </>
      )}
      {object === "BGM" && (
        <>
          {n(
            "BGM source in (ms)",
            bgm.sourceInMs || 0,
            0,
            86400000,
            (sourceInMs) =>
              globalUpdate({ backgroundMusic: { ...bgm, sourceInMs } }),
          )}
          {n(
            "BGM clip duration (ms)",
            bgm.durationMs ??
              Math.max(34, (timelineDurationMs ?? 30000) - bgm.startMs),
            34,
            86400000,
            (durationMs) =>
              globalUpdate({ backgroundMusic: { ...bgm, durationMs } }),
          )}
          <button disabled={disabled} onClick={() => choose("BGM")}>
            Choose BGM
          </button>
          {check("BGM enabled", bgm.enabled, (enabled) =>
            globalUpdate({ backgroundMusic: { ...bgm, enabled } }),
          )}
          {n("BGM start (ms)", bgm.startMs, 0, 30000, (startMs) =>
            globalUpdate({ backgroundMusic: { ...bgm, startMs } }),
          )}
          {n(
            "BGM volume",
            bgm.volume,
            0,
            0.25,
            (volume) => globalUpdate({ backgroundMusic: { ...bgm, volume } }),
            0.01,
          )}
          {check("BGM in this scene", v.bgmEnabled, (bgmEnabled) =>
            update({ visual: { ...v, bgmEnabled } }),
          )}
          <button
            disabled={disabled}
            onClick={() =>
              globalUpdate({
                backgroundMusic: { ...bgm, enabled: false, assetId: null },
              })
            }
          >
            Remove BGM
          </button>
          <small>Gain only. Fade/ducking are not implemented.</small>
        </>
      )}
    </div>
  );
}
