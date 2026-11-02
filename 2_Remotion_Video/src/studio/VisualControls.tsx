import { useState } from "react";
import type { LibraryAsset } from "../../../1_nest_backend/src/studio/public-assets";
import type {
  EditorSettings,
  EditorSceneSettings,
} from "../../../1_nest_backend/src/studio/editor.types";
import type {
  StudioSession,
  StudioItem,
} from "../../../1_nest_backend/src/studio/studio.contracts";
import {
  defaultSceneVisual,
  defaultBgm,
} from "../../../1_nest_backend/src/video-pipeline/scene-visual";
export function TopicEditor({
  item,
  disabled,
  save,
}: {
  item: StudioItem;
  disabled: boolean;
  save: (body: unknown) => Promise<void>;
}) {
  const [topic, setTopic] = useState(
      item.contentMapping?.topic || item.metadata?.topic || "",
    ),
    [body, setBody] = useState(
      item.contentMapping?.bodyText || item.displayText,
    ),
    [correct, setCorrect] = useState(true);
  return (
    <details className="panel">
      <summary>
        Topic / body — xác nhận thủ công (
        {item.contentMapping?.status || "chưa phân tách"})
      </summary>
      <p>
        Không suy đoán dòng đầu là Topic. Chỉ xác nhận khi đã đối chiếu header
        nguồn. Original luôn được giữ.
      </p>
      <label>
        Topic
        <input
          value={topic}
          disabled={disabled}
          onChange={(e) => setTopic(e.target.value)}
        />
      </label>
      <label>
        Body
        <textarea
          value={body}
          disabled={disabled}
          onChange={(e) => setBody(e.target.value)}
        />
      </label>
      <label>
        <input
          type="checkbox"
          checked={correct}
          onChange={(e) => setCorrect(e.target.checked)}
        />
        Bỏ Topic khỏi spoken text nếu prefix khớp chính xác; invalidate audio cũ
      </label>
      <button
        disabled={disabled}
        onClick={() => {
          const locked=correct&&item.manualLocks.includes('NARRATION_TEXT');
          if(locked&&!window.confirm('Spoken text đã khóa. Xác nhận bỏ riêng Topic khỏi prefix khớp chính xác? Audio cũ được giữ nhưng sẽ stale.'))return;
          void save({topic,bodyText:body,correctSpoken:correct,confirmLockedSpoken:locked});
        }}
      >
        Confirm Topic / body mapping
      </button>
      <small>
        Spoken đã khóa cần xác nhận riêng; trường hợp mơ hồ phải sửa ở Script.
        Không tự duyệt TTS.
      </small>
    </details>
  );
}
export function VisualControls({
  session,
  current,
  settings,
  library,
  disabled,
  change,
  globalChange,
}: {
  session: StudioSession;
  current: EditorSceneSettings;
  settings: EditorSettings;
  library: LibraryAsset[];
  disabled: boolean;
  change: (patch: Partial<EditorSceneSettings>) => void;
  globalChange: (patch: Partial<EditorSettings>) => void;
}) {
  const v = current.visual || defaultSceneVisual(),
    bgm = settings.backgroundMusic || defaultBgm();
  const images = [
    ...library
      .filter((a) => ["IMAGE", "GIF"].includes(a.kind))
      .map((a) => ({ id: a.id, name: a.name })),
    ...(session.studioMedia || []).map((a) => ({
      id: a.id,
      name: a.originalName,
    })),
  ];
  const backgrounds = [
    ...library
      .filter((a) => ["IMAGE", "GIF", "VIDEO"].includes(a.kind))
      .map((a) => ({ id: a.id, name: a.relativePath })),
    ...(session.studioMedia || []).map((a) => ({
      id: a.id,
      name: a.originalName,
    })),
  ];
  const select = (
    label: string,
    value: string | null,
    options: { id: string; name: string }[],
    fn: (id: string | null) => void,
  ) => (
    <label>
      {label}
      <select
        disabled={disabled}
        value={value || ""}
        onChange={(e) => fn(e.target.value || null)}
      >
        <option value="">Không chọn</option>
        {options.map((a) => (
          <option key={a.id} value={a.id}>
            {a.name}
          </option>
        ))}
      </select>
    </label>
  );
  const n = (
    label: string,
    value: number,
    min: number,
    max: number,
    fn: (n: number) => void,
    step = 1,
  ) => (
    <label>
      {label}
      <input
        type="number"
        disabled={disabled}
        value={value}
        min={min}
        max={max}
        step={step}
        onChange={(e) => fn(Number(e.target.value))}
      />
    </label>
  );
  const card = (key: keyof typeof v.card, value: number) =>
    change({ visual: { ...v, card: { ...v.card, [key]: value } } });
  const meme = (patch: Partial<typeof v.meme>) =>
    change({ visual: { ...v, meme: { ...v.meme, ...patch } } });
  return (
    <section className="panel visual-controls">
      <h3>Layout 1080 × 1920 — từng scene</h3>
      <div className="edit-grid">
        {n("Card X", v.card.x, 0, 1080, (x) => card("x", x))}
        {n("Card Y (mặc định 15%)", v.card.y, 0, 1500, (x) => card("y", x))}
        {n("Card width", v.card.width, 240, 1080, (x) => card("width", x))}
        {n("Card scale", v.card.scale, 0.5, 1.5, (x) => card("scale", x), 0.05)}
        {n("Card padding", v.card.padding, 12, 80, (x) => card("padding", x))}
        {n("Font size", v.card.fontSize, 24, 64, (x) => card("fontSize", x))}
        {n("Header/body gap", v.card.gap, 0, 60, (x) => card("gap", x))}
      </div>
      <p>
        Post dài được phân trang hình ảnh theo thời lượng scene, không cắt
        narration và không giả word-level sync.
      </p>
      <h3>Meme/GIF bên dưới card</h3>
      <label>
        <input
          type="checkbox"
          checked={v.meme.enabled}
          disabled={disabled}
          onChange={(e) => meme({ enabled: e.target.checked })}
        />
        Bật meme/GIF
      </label>
      {select("Meme/GIF", v.meme.assetId, images, (id) =>
        meme({ assetId: id, enabled: !!id }),
      )}
      <div className="edit-grid">
        {n("Meme width", v.meme.width, 80, 1080, (x) => meme({ width: x }))}
        {n("Meme height", v.meme.height, 60, 900, (x) => meme({ height: x }))}
        {n("Gap card → meme", v.meme.gap, 0, 160, (x) => meme({ gap: x }))}
        {n("Start (ms)", v.meme.startMs, 0, 30000, (x) => meme({ startMs: x }))}
        {n("Duration (ms)", v.meme.durationMs, 1, 30000, (x) =>
          meme({ durationMs: x }),
        )}
        <label>
          Meme X (trống = giữa)
          <input
            type="number"
            value={v.meme.x ?? ""}
            disabled={disabled}
            onChange={(e) =>
              meme({ x: e.target.value === "" ? null : Number(e.target.value) })
            }
          />
        </label>
        <label>
          Meme Y (trống = tự nằm dưới card)
          <input
            type="number"
            value={v.meme.y ?? ""}
            disabled={disabled}
            onChange={(e) =>
              meme({ y: e.target.value === "" ? null : Number(e.target.value) })
            }
          />
        </label>
      </div>
      <h3>Background</h3>
      {select("Background riêng scene", v.backgroundId, backgrounds, (id) =>
        change({ visual: { ...v, backgroundId: id } }),
      )}
      {select(
        "Background toàn project",
        settings.backgroundId || null,
        backgrounds,
        (id) => globalChange({ backgroundId: id }),
      )}
      <h3>Voice / SFX / BGM</h3>
      <label>
        <input
          type="checkbox"
          checked={v.voiceEnabled}
          disabled={disabled}
          onChange={(e) =>
            change({ visual: { ...v, voiceEnabled: e.target.checked } })
          }
        />
        Voice scene
      </label>
      {n(
        "Voice volume",
        v.voiceVolume,
        0,
        1,
        (x) => change({ visual: { ...v, voiceVolume: x } }),
        0.05,
      )}
      <label>
        <input
          type="checkbox"
          checked={v.sfx.enabled}
          disabled={disabled}
          onChange={(e) =>
            change({
              visual: { ...v, sfx: { ...v.sfx, enabled: e.target.checked } },
            })
          }
        />
        SFX scene
      </label>
      {select(
        "SFX",
        v.sfx.assetId,
        library
          .filter((a) => a.category === "SFX")
          .map((a) => ({ id: a.id, name: a.name })),
        (id) =>
          change({
            visual: { ...v, sfx: { ...v.sfx, assetId: id, enabled: !!id } },
          }),
      )}
      <div className="edit-grid">
        {n(
          "SFX volume",
          v.sfx.volume,
          0,
          0.7,
          (x) => change({ visual: { ...v, sfx: { ...v.sfx, volume: x } } }),
          0.05,
        )}
        {n("SFX start (ms)", v.sfx.startMs, 0, 30000, (x) =>
          change({ visual: { ...v, sfx: { ...v.sfx, startMs: x } } }),
        )}
      </div>
      <label>
        <input
          type="checkbox"
          checked={bgm.enabled}
          disabled={disabled}
          onChange={(e) =>
            globalChange({
              backgroundMusic: { ...bgm, enabled: e.target.checked },
            })
          }
        />
        BGM toàn project
      </label>
      {select(
        "BGM",
        bgm.assetId,
        library
          .filter((a) => a.category === "BGM")
          .map((a) => ({ id: a.id, name: a.name })),
        (id) =>
          globalChange({
            backgroundMusic: { ...bgm, assetId: id, enabled: !!id },
          }),
      )}
      <div className="edit-grid">
        {n(
          "BGM volume (≤ 0.25)",
          bgm.volume,
          0,
          0.25,
          (x) => globalChange({ backgroundMusic: { ...bgm, volume: x } }),
          0.01,
        )}
        {n("BGM start (ms)", bgm.startMs, 0, 30000, (x) =>
          globalChange({ backgroundMusic: { ...bgm, startMs: x } }),
        )}
      </div>
      <label>
        <input
          type="checkbox"
          checked={v.bgmEnabled}
          disabled={disabled}
          onChange={(e) =>
            change({ visual: { ...v, bgmEnabled: e.target.checked } })
          }
        />
        BGM được phát trong scene này
      </label>
      <p>
        BGM mặc định 0.08, voice 1.0. Cần nghe duyệt tương quan âm lượng; chưa
        có loudness mastering.
      </p>
    </section>
  );
}
export function AssetLibrary({
  assets,
  disabled,
  assign,
}: {
  assets: LibraryAsset[];
  disabled: boolean;
  assign: (a: LibraryAsset, role: string) => void;
}) {
  const [category, setCategory] = useState("ALL"),
    [query, setQuery] = useState(""),
    [limit, setLimit] = useState(24);
  const filtered = assets.filter(
    (a) =>
      (category === "ALL" || a.category === category) &&
      (a.name + " " + a.relativePath)
        .toLowerCase()
        .includes(query.toLowerCase()),
  );
  return (
    <section className="panel asset-library">
      <h3>Public Asset Library ({assets.length})</h3>
      <div className="actions">
        <input
          aria-label="Search assets"
          placeholder="Tìm filename / thư mục…"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setLimit(24);
          }}
        />
        <select
          aria-label="Asset category"
          value={category}
          onChange={(e) => {
            setCategory(e.target.value);
            setLimit(24);
          }}
        >
          {["ALL", "BACKGROUND", "MEME", "GIF", "SFX", "BGM", "OTHER"].map(
            (x) => (
              <option key={x}>{x}</option>
            ),
          )}
        </select>
      </div>
      <p>{filtered.length} assets · Không sao chép thư mục public</p>
      <div className="library-grid">
        {filtered.slice(0, limit).map((a) => (
          <article key={a.id}>
            <strong>{a.name}</strong>
            <small>
              {a.category} · {(a.bytes / 1024).toFixed(1)} KB
            </small>
            {a.kind === "IMAGE" || a.kind === "GIF" ? (
              <img src={a.uri} loading="lazy" alt={a.name} />
            ) : a.kind === "VIDEO" ? (
              <video src={a.uri} controls muted preload="none" />
            ) : a.kind === "AUDIO" ? (
              <audio src={a.uri} controls preload="none" />
            ) : null}
            <div className="actions">
              {["IMAGE", "GIF"].includes(a.kind) && (
                <button disabled={disabled} onClick={() => assign(a, "MEME")}>
                  Use as meme
                </button>
              )}
              {["IMAGE", "GIF", "VIDEO"].includes(a.kind) && (
                <button
                  disabled={disabled}
                  onClick={() => assign(a, "BACKGROUND")}
                >
                  Scene background
                </button>
              )}
              {a.category === "SFX" && (
                <button disabled={disabled} onClick={() => assign(a, "SFX")}>
                  Use SFX
                </button>
              )}
              {a.category === "BGM" && (
                <button disabled={disabled} onClick={() => assign(a, "BGM")}>
                  Use BGM
                </button>
              )}
            </div>
          </article>
        ))}
      </div>
      {limit < filtered.length && (
        <button onClick={() => setLimit(limit + 24)}>Show more</button>
      )}
    </section>
  );
}
