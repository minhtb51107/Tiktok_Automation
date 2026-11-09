import {useRuntimeSafety,RuntimeRestriction} from './RuntimeSafety';
import { useState } from "react";
import type {
  StudioSession,
  StudioItem,
} from "../../../1_nest_backend/src/studio/studio.contracts";
import { StageReportPanel } from "./StageReportPanel";
import {
  VOICE_SPEED,
  spokenAmbiguities,
} from "../../../1_nest_backend/src/studio/voice-settings";
function VoiceScene({
  item,
  session,
  busy,
  act,
}: {
  item: StudioItem;
  session: StudioSession;
  busy: boolean;
  act: (id: string, body: Record<string, unknown>) => Promise<void>;
}) {
  const {locked}=useRuntimeSafety();
  const runtime = session.voiceRuntime,
    runnable = runtime?.voices || [],
    defaultVoice = runnable.find(v=>v.id === "my_yen")?.id || runnable[0]?.id || "";
  const [voice, setVoice] = useState(item.voiceSettings?.voice || defaultVoice),
    [speed, setSpeed] = useState(
      item.voiceSettings?.speed ?? VOICE_SPEED.default,
    ),
    [generating, setGenerating] = useState(false);
  const assets = session.voiceAssets?.filter((a) => a.itemId === item.id) || [],
    job = session.voiceJobs?.filter((j) => j.itemId === item.id).slice(-1)[0],
    asset = assets
      .slice()
      .reverse()
      .find(
        (a) =>
          a.status !== "STALE" &&
          a.voice === voice &&
          a.speed === speed &&
          a.spokenText === item.spokenText,
      );
  const ambiguities = spokenAmbiguities(item.spokenText,item.pronunciationOverrides);
  const settingsDirty =
    voice !== (item.voiceSettings?.voice || "") ||
    speed !== (item.voiceSettings?.speed ?? VOICE_SPEED.default);
  const blockReason = locked ? "DISABLED_BY_SAFETY: REAL_DATA_COPY; use existing audio playback only." : busy
    ? "Another operation is running (one at a time)."
    : runtime?.status !== "READY"
        ? "Voice runtime is not READY — press Check local runtime."
        : !runnable.some((v) => v.id === voice)
          ? "Select a locally available voice."
          : "";
  const generate = async (regenerate = false) => {
    setGenerating(true);
    try {
      await act(item.id, { action: "GENERATE", regenerate, voice, speed, draft: !item.spokenApproval?.valid });
    } finally {
      setGenerating(false);
    }
  };
  return (
    <article className="panel voice-scene">
      <div className="panel-top">
        <h3>
          {item.order + 1}. {item.author.displayName}
        </h3>
        <span className="badge">
          {generating
            ? "PROCESSING"
            : asset?.status || (job?.status === "ERROR" ? "ERROR" : assets.length ? "SETTINGS_CHANGED / NO_CURRENT_AUDIO" : "NOT_GENERATED")}
        </span>
      </div>
      <blockquote>{item.spokenText}</blockquote>
      <p>
        Đã lưu: {item.voiceSettings?.voice || "Chưa chọn giọng"} ·{" "}
        {item.voiceSettings?.speed ?? VOICE_SPEED.default}×
        {settingsDirty ? " — Có thay đổi chưa lưu" : ""}
      </p>
      {ambiguities.length > 0 && (
        <p className="warning">
          Cần duyệt nghĩa: {ambiguities.join(", ")}. Duyệt thử TTS không có
          nghĩa là duyệt xuất bản.
        </p>
      )}
      <p>
        Spoken approval:{" "}
        <b>{item.spokenApproval?.valid ? "APPROVED" : "DRAFT ONLY — chưa duyệt"}</b> ·
        Item revision {item.revision}
      </p>
      <button
        disabled={locked || busy || item.spokenApproval?.valid}
        onClick={() => {
          if (
            !ambiguities.length ||
            window.confirm(
              `Văn bản còn từ mơ hồ: ${ambiguities.join(", ")}. Chỉ duyệt để nghe thử TTS, chưa duyệt sản xuất?`,
            )
          )
            void act(item.id, { action: "APPROVE_SPOKEN" });
        }}
      >
        Approve spoken text after review
      </button>
      <div className="edit-grid">
        <label>
          Kokoro voice
          <select
            disabled={locked || busy}
            value={voice}
            onChange={(e) => setVoice(e.target.value)}
          >
            <option value="">Select a locally available voice</option>
            {(runtime?.declaredVoices || []).map((v) => (
              <option
                value={v.id}
                key={v.id}
                disabled={!runtime?.voices.some((a) => a.id === v.id)}
              >
                {v.label}{" "}
                {!runtime?.voices.some((a) => a.id === v.id)
                  ? "— unavailable locally"
                  : ""}
              </option>
            ))}
          </select>
        </label>
        <label>
          Playback speed: {speed.toFixed(2)}×
          <input
            type="range"
            min={VOICE_SPEED.min}
            max={VOICE_SPEED.max}
            step={VOICE_SPEED.step}
            disabled={locked || busy}
            value={speed}
            onChange={(e) => setSpeed(Number(e.target.value))}
          />
        </label>
      </div>
      <div className="actions">
        <button
          disabled={locked || busy || !settingsDirty}
          onClick={() =>
            void act(item.id, {
              action: "SETTINGS",
              voice: voice || null,
              speed,
            })
          }
        >
          Save voice / speed
        </button>
        <button
          className="primary"
          disabled={!!blockReason}
          title={blockReason || "Generate (reuses an identical valid audio)"}
          onClick={() => void generate(false)}
        >
          {item.spokenApproval?.valid ? "Generate" : "Generate DRAFT"}
        </button>
        <button
          disabled={!!blockReason || !asset}
          title={
            blockReason ||
            (asset ? "Force a new Kokoro synthesis" : "Generate first")
          }
          onClick={() => void generate(true)}
        >
          Regenerate
        </button>
      </div>
      {blockReason && !generating && <small>Why disabled: {blockReason}</small>}
      {generating && (
        <p role="status">
          Sequential processing: runtime preflight → Kokoro → FFmpeg atempo →
          FFprobe. No estimated percentage.
        </p>
      )}
      {job?.error && (
        <div className="alert error" role="alert">
          {job.error}
        </div>
      )}
      {asset && (
        <section>
          <audio controls preload="none" src={asset.uri} /><details><summary>Actual TTS input / number reading</summary><p>{asset.ttsInputText||asset.spokenText}</p><small>{asset.numberReadingVersion||"Legacy input"} · {asset.ttsInputHash?.slice(0,12)}</small></details>
          <p>
            {asset.purpose === "DRAFT" ? "DRAFT · chưa duyệt nội dung/audio · " : ""}FFprobe duration: {(asset.durationMs / 1000).toFixed(3)}s ·{" "}
            {asset.voice} · {asset.speed}× ·{" "}
            {asset.cacheHit ? "cache hit" : "new generation"}
          </p>
          <small>
            Model: {asset.model} / {asset.modelVersion} · Text hash{" "}
            {asset.textHash.slice(0, 12)}
          </small>
          <div>
            <button
              disabled={
                locked || busy ||
                asset.status !== "GENERATED" ||
                !item.spokenApproval?.valid
              }
              onClick={() =>
                void act(item.id, {
                  action: "APPROVE_AUDIO",
                  assetId: asset.id,
                })
              }
            >
              Approve Audio
            </button>
          </div>
        </section>
      )}
      {assets.length > 0 && (
        <details>
          <summary>So sánh các bản audio ({assets.length})</summary>
          {assets
            .slice()
            .reverse()
            .map((a) => (
              <section key={a.id}>
                <p>
                  {runtime?.declaredVoices.find((v) => v.id === a.voice)
                    ?.label || a.voice}{" "}
                  · {a.speed}× · {(a.durationMs / 1000).toFixed(3)}s ·{" "}
                  {a.id === asset?.id ? "HIỆN HÀNH" : "LỊCH SỬ / KHÁC SETTINGS"}{" "}
                  · {a.status}
                </p>
                <audio controls preload="none" src={a.uri} />
              </section>
            ))}
        </details>
      )}
      {runtime?.status === "BLOCKED_RUNTIME" && (
        <small>
          Generation is blocked until the listed runtime dependencies and local
          model files are supplied. Existing assets are preserved.
        </small>
      )}
    </article>
  );
}
export function VoiceWorkspace({
  session,
  busy,
  dirty,
  check,
  act,
  batch,
}: {
  session: StudioSession;
  busy: boolean;
  dirty: boolean;
  check: () => void;
  act: (id: string, body: Record<string, unknown>) => Promise<void>;
  batch: (body: Record<string, unknown>) => Promise<void>;
}) {
  // Runtime preflight is explicit: opening this workspace never creates a job.
  const [gc, setGc] = useState("");
  const [allSpeed, setAllSpeed] = useState<number>(VOICE_SPEED.default);
  const [allVoice, setAllVoice] = useState("");
  const [chosen, setChosen] = useState<string[]>([]), [focusId, setFocusId] = useState<string>("ALL");
  const {locked}=useRuntimeSafety();
  const runtime = session.voiceRuntime;
  const selected = session.items.filter((i) => i.selected);
  const names = new Map(session.items.map((i) => [i.id, i.author.displayName]));
  return (
    <>
      <section className="source-header">
        <div>
          <h2>03 / Voice Studio</h2><RuntimeRestriction/>
          <p>
            Generate DRAFT để nghe thử mà không cần duyệt nội dung. Chỉ duyệt spoken text/audio sau khi kiểm tra; luôn xử lý từng cảnh một.
          </p>
        </div>
        <button disabled={locked || busy || dirty} onClick={check}>
          Check local runtime
        </button>
      </section>
      <section className="panel">
        <h3>All selected scenes ({selected.length})</h3>
        <div className="actions">
          <button
            disabled={locked || busy || dirty}
            onClick={() => {
              if (
                window.confirm(
                  "Approve the current spoken text of every selected scene? Scenes with unresolved ambiguous proposals are skipped.",
                )
              )
                void batch({ action: "APPROVE_ALL_SPOKEN" });
            }}
          >
            Approve spoken text — all selected
          </button>
          <label>
            Giọng áp dụng hàng loạt
            <select
              value={allVoice}
              disabled={locked || busy}
              onChange={(e) => setAllVoice(e.target.value)}
            >
              <option value="">Chọn giọng</option>
              {(runtime?.declaredVoices || []).map((v) => (
                <option
                  key={v.id}
                  value={v.id}
                  disabled={!runtime?.voices.some((x) => x.id === v.id)}
                >
                  {v.label}
                  {!runtime?.voices.some((x) => x.id === v.id)
                    ? " — chưa cài"
                    : ""}
                </option>
              ))}
            </select>
          </label>
          <label>
            Speed for all: {allSpeed.toFixed(2)}×
            <input
              type="range"
              min={VOICE_SPEED.min}
              max={VOICE_SPEED.max}
              step={VOICE_SPEED.step}
              disabled={locked || busy}
              value={allSpeed}
              onChange={(e) => setAllSpeed(Number(e.target.value))}
            />
          </label>
          <button
            disabled={
              locked || busy || dirty || !runtime?.voices.some((v) => v.id === allVoice)
            }
            title="Áp dụng cho các cảnh đánh dấu, hoặc tất cả nếu không đánh dấu cảnh nào"
            onClick={() =>
              void batch({
                action: "SETTINGS_ALL",
                voice: allVoice,
                speed: allSpeed,
                ...(chosen.length ? { itemIds: chosen } : {}),
              })
            }
          >
            Áp dụng giọng / tốc độ ({chosen.length || selected.length} cảnh)
          </button>
          <button
            className="primary"
            disabled={locked || busy || dirty || runtime?.status !== "READY"}
            title={
              runtime?.status === "READY"
                ? "Skips unapproved scenes and unchanged valid audio"
                : "Voice runtime is not READY"
            }
            onClick={() => void batch({ action: "GENERATE_ALL" })}
          >
            Generate reviewed scenes (sequential)
          </button>
        </div>
        <small>
          Uses each scene's saved voice/speed (SERIOUS default: 1.2×). Skips
          unapproved scenes and audio that is already valid. One failing scene
          never blocks the others.
        </small>
        <div>
          {selected.map((i) => (
            <label
              key={i.id}
              style={{ display: "inline-flex", marginRight: 16 }}
            >
              <input
                type="checkbox"
                checked={chosen.includes(i.id)}
                disabled={locked || busy}
                onChange={(e) =>
                  setChosen(
                    e.target.checked
                      ? [...chosen, i.id]
                      : chosen.filter((id) => id !== i.id),
                  )
                }
              />{" "}
              Cảnh {i.order + 1}
            </label>
          ))}
        </div>
        {session.voiceBatch && (
          <div>
            <b>
              Last batch: {session.voiceBatch.action} · {session.voiceBatch.at}
            </b>
            {session.voiceBatch.results.map((r) => (
              <p
                key={r.itemId}
                className={r.outcome === "ERROR" ? "warning" : ""}
              >
                {names.get(r.itemId) || r.itemId}: <b>{r.outcome}</b>
                {r.reason ? " — " + r.reason : ""}
              </p>
            ))}
          </div>
        )}
      </section>
      <section className="panel">
        <h3>Runtime: {runtime?.status || "NOT_CHECKED"}</h3>
        {runtime ? (
          <>
            <p>
              Python {runtime.python} · Kokoro{" "}
              {runtime.packageVersion || "not installed"} · Device{" "}
              {runtime.device} · GPU{" "}
              {runtime.gpuAvailable === null
                ? "not checked"
                : runtime.gpuAvailable
                  ? "available"
                  : "not available"}
            </p>
            <p>
              FFmpeg {String(runtime.ffmpeg)} · FFprobe{" "}
              {String(runtime.ffprobe)} · Runnable voices{" "}
              {runtime.voices.length} / {runtime.declaredVoices.length} declared
              in source
            </p>
            <p data-testid="available-voices">Giọng khả dụng: {runtime.voices.map(v=>v.label).join(' · ')||'Chưa có'}. Số giọng không phụ thuộc số audio mẫu đã tạo.</p>
            <p>Verification: {runtime.verification??'LEGACY_UNSPECIFIED'} — configuration readiness is not proof of model load or LIVE speech.</p>
            {[...runtime.blockers,...(runtime.warnings||[])].map((b) => (
              <p className="warning" key={b}>
                {b}
              </p>
            ))}
          </>
        ) : (
          <p>
            Preflight does not install dependencies, download a model or start
            inference.
          </p>
        )}
        <button
          disabled={locked || busy}
          onClick={() =>
            void fetch(`/api/studio/sessions/${session.id}/voice-gc-preview`)
              .then((r) => r.json())
              .then((j) => setGc(JSON.stringify(j.data ?? j, null, 2)))
              .catch(() => setGc("Preview unavailable"))
          }
        >
          List orphan temp audio — dry-run only
        </button>
        {gc && <pre className="report-text">{gc}</pre>}
      </section>
      <StageReportPanel
        id={session.id}
        revision={session.revision}
        dirty={dirty}
        stage="VOICE"
      />
      {dirty && (
        <div className="alert">Save script edits before voice operations.</div>
      )}
      {selected.length > 1 && (
        <div className="v2-scene-jumpbar" role="toolbar" aria-label="Voice scene filter">
          <span>SCENE FOCUS:</span>
          <button className={focusId === "ALL" ? "active" : ""} onClick={() => setFocusId("ALL")}>All ({selected.length})</button>
          {selected.slice().sort((a, b) => a.order - b.order).map((item) => (
            <button key={item.id} className={focusId === item.id ? "active" : ""} onClick={() => setFocusId(item.id)}>#{item.order + 1} {item.author.displayName}</button>
          ))}
        </div>
      )}
      {session.items
        .filter((i) => i.selected && (focusId === "ALL" || i.id === focusId))
        .sort((a, b) => a.order - b.order)
        .map((i) => (
          <VoiceScene
            key={`${i.id}:${i.voiceSettings?.voice}:${i.voiceSettings?.speed}:${runtime?.voices.length}`}
            item={i}
            session={session}
            busy={busy || dirty}
            act={act}
          />
        ))}
    </>
  );
}
