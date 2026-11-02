import { useState } from "react";
import type { StudioSession } from "../../../1_nest_backend/src/studio/studio.contracts";
import type { StudioJob } from "../../../1_nest_backend/src/studio/progress";
import type { RenderManifest } from "../../../1_nest_backend/src/studio/render.types";
import type { LibraryAsset } from "../../../1_nest_backend/src/studio/public-assets";
import {
  formatBytes,
  SIMULATED_DISCOVERY_SCHEDULES,
  summarizePublicAssets,
} from "./studio-v2-adapter";
import { VOICE_SPEED } from "../../../1_nest_backend/src/studio/voice-settings";

export function ProductionQueueWorkspace({
  session,
  jobs,
  renders,
  busy,
  onCancelJob,
  onOpenStep,
}: {
  session: StudioSession | null;
  jobs: StudioJob[];
  renders: RenderManifest[];
  busy: boolean;
  onCancelJob: (jobId: string) => void;
  onOpenStep: (step: string) => void;
}) {
  const [stageFilter, setStageFilter] = useState<string>("ALL");
  const filteredJobs = jobs.filter(
    (j) => stageFilter === "ALL" || j.currentStage === stageFilter,
  );
  const stages = Array.from(new Set(["ALL", ...jobs.map((j) => j.currentStage)]));

  return (
    <div className="v2-workspace" data-testid="production-queue-workspace">
      <div className="v2-page-header">
        <div>
          <span className="v2-eyebrow">
            SEQUENTIAL FIFO JOB ORCHESTRATOR · PERSISTED EXECUTION HISTORY
          </span>
          <h2>Production Queue & Draft Outputs</h2>
          <p>
            Track active and historical pipeline jobs across Source Extraction,
            AI/Offline Script Normalization, Kokoro Voice Synthesis, Preview
            Preparation, and Local MP4 Rendering.
          </p>
        </div>
        <div className="v2-header-actions">
          <button disabled={busy} onClick={() => onOpenStep("Voice")}>
            Voice Batch Studio
          </button>
          <button
            className="primary"
            disabled={busy}
            onClick={() => onOpenStep("Render")}
          >
            Open MP4 Render Console
          </button>
        </div>
      </div>

      {/* Retained Video Drafts */}
      <section className="v2-card">
        <div className="v2-card-header">
          <div>
            <h3>Retained Video Drafts ({renders.length})</h3>
            <small>
              Verified local MP4 outputs from .studio-data/renders (not approved
              for publishing)
            </small>
          </div>
          <span className="v2-status-pill status-review">
            {renders.filter((r) => r.status === "COMPLETED").length} COMPLETED
          </span>
        </div>
        {renders.length === 0 ? (
          <p className="v2-muted">No render manifests recorded for this session yet.</p>
        ) : (
          <div className="v2-drafts-grid">
            {renders.map((m) => (
              <article className="v2-draft-card" key={m.jobId}>
                <div className="v2-draft-head">
                  <span
                    className={`v2-status-pill status-${m.status === "COMPLETED" ? "success" : "warning"}`}
                  >
                    {m.mode} · {m.status}
                  </span>
                  <code className="v2-mono">{m.jobId.slice(0, 8)}</code>
                </div>
                <strong>
                  {m.width}×{m.height} · {m.fps} FPS ·{" "}
                  {m.expectedDurationSeconds.toFixed(2)}s
                </strong>
                <small>
                  Size: {formatBytes(m.bytes)} · Timeline hash{" "}
                  {m.timelineHash.slice(0, 10)}
                </small>
                {m.warnings.length > 0 && (
                  <small className="v2-warning-text">
                    {m.warnings.length} render warnings logged
                  </small>
                )}
                {m.status === "COMPLETED" && (
                  <div className="v2-row-actions">
                    <a
                      className="v2-btn-link"
                      href={m.downloadUrl + "?download=1"}
                    >
                      ⬇ Download MP4
                    </a>
                    <a
                      className="v2-btn-link"
                      href={m.downloadUrl}
                      target="_blank"
                      rel="noreferrer"
                    >
                      ▶ Open Stream
                    </a>
                  </div>
                )}
              </article>
            ))}
          </div>
        )}
      </section>

      {/* Persisted Jobs Table */}
      <section className="v2-card">
        <div className="v2-card-header">
          <div>
            <h3>FIFO Job Queue ({filteredJobs.length})</h3>
            <small>
              Session {session?.id.slice(0, 8) || "—"} · Related to{" "}
              {session?.items.filter((i) => i.selected).length ?? 0} selected
              source posts
            </small>
          </div>
          <div className="v2-segmented">
            {stages.map((st) => (
              <button
                key={st}
                className={stageFilter === st ? "active" : ""}
                onClick={() => setStageFilter(st)}
              >
                {st}
              </button>
            ))}
          </div>
        </div>
        <div className="v2-table-scroll">
          <table className="v2-table" data-testid="production-jobs-table">
            <thead>
              <tr>
                <th>Job ID</th>
                <th>Stage / Operation</th>
                <th>Status</th>
                <th>Current Step / Progress</th>
                <th>Elapsed</th>
                <th>Diagnostics</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              {filteredJobs.map((j) => {
                const isRunning = ["QUEUED", "RUNNING"].includes(j.status);
                return (
                  <tr key={j.jobId}>
                    <td>
                      <code className="v2-mono">{j.jobId.slice(0, 8)}</code>
                    </td>
                    <td>
                      <strong>{j.currentStage}</strong>
                      <small className="v2-block-sub v2-mono">
                        {j.operation}
                      </small>
                    </td>
                    <td>
                      <span
                        className={`v2-status-pill status-${
                          isRunning
                            ? "running"
                            : j.status === "FAILED"
                              ? "failed"
                              : "success"
                        }`}
                      >
                        {j.status}
                      </span>
                    </td>
                    <td>
                      <div>{j.currentStep}</div>
                      {j.total !== null && j.completed !== null && (
                        <small className="v2-mono">
                          {j.completed} / {j.total} units (
                          {Math.floor((j.completed / Math.max(1, j.total)) * 100)}
                          %)
                        </small>
                      )}
                    </td>
                    <td>
                      <span className="v2-mono">
                        {(j.elapsedMs / 1000).toFixed(1)}s
                      </span>
                    </td>
                    <td>
                      {j.error ? (
                        <span className="v2-error-text">{j.error}</span>
                      ) : j.warnings.length > 0 ? (
                        <span className="v2-warning-text">
                          {j.warnings.length} warning(s)
                        </span>
                      ) : (
                        <span className="v2-muted">Clean</span>
                      )}
                    </td>
                    <td>
                      {isRunning ? (
                        <button
                          disabled={j.cancelRequested}
                          onClick={() => onCancelJob(j.jobId)}
                        >
                          {j.cancelRequested ? "Cancelling…" : "Cancel Job"}
                        </button>
                      ) : (
                        <button
                          onClick={() =>
                            onOpenStep(
                              j.currentStage === "RENDER"
                                ? "Render"
                                : j.currentStage === "VOICE"
                                  ? "Voice"
                                  : j.currentStage === "SCRIPT"
                                    ? "Script"
                                    : j.currentStage === "EDITOR"
                                      ? "Video Editor"
                                      : "Source",
                            )
                          }
                        >
                          Open Stage
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

export function SettingsWorkspace({
  session,
  publicAssets,
  theme,
  onChangeTheme,
  onCheckVoiceRuntime,
  busy,
}: {
  session: StudioSession | null;
  publicAssets: LibraryAsset[];
  theme: "DARK" | "LIGHT";
  onChangeTheme: (next: "DARK" | "LIGHT") => void;
  onCheckVoiceRuntime: () => void;
  busy: boolean;
}) {
  const assetSummary = summarizePublicAssets(publicAssets);
  const runtime = session?.voiceRuntime;

  return (
    <div className="v2-workspace" data-testid="settings-workspace">
      <div className="v2-page-header">
        <div>
          <span className="v2-eyebrow">
            STUDIO CONFIGURATION · RUNTIME, VOICE, PRESETS & SAFETY THRESHOLDS
          </span>
          <h2>Studio Settings & System Configuration</h2>
          <p>
            Inspect local Kokoro TTS voicepacks, public asset inventory,
            low-RAM resource limits, and SERIOUS content presets.
          </p>
        </div>
        <div className="v2-header-actions">
          <button
            disabled={busy || !session}
            onClick={onCheckVoiceRuntime}
          >
            Run Local Runtime Preflight
          </button>
          <button
            className="primary"
            onClick={() => onChangeTheme(theme === "DARK" ? "LIGHT" : "DARK")}
          >
            Switch to {theme === "DARK" ? "Light" : "Dark"} Theme
          </button>
        </div>
      </div>

      <div className="v2-two-col">
        {/* Voice & Kokoro Runtime */}
        <section className="v2-card">
          <div className="v2-card-header">
            <div>
              <h3>Kokoro Local TTS & Voice Presets</h3>
              <small>Real runtime status from backend preflight</small>
            </div>
            <span className="v2-status-pill status-success">
              {runtime?.status || "STANDBY"}
            </span>
          </div>
          <div className="v2-kv-list">
            <div className="v2-kv-row">
              <span>Python & Package</span>
              <strong>
                {runtime?.python || "Local Python"} · Kokoro{" "}
                {runtime?.packageVersion || "0.9.4"}
              </strong>
            </div>
            <div className="v2-kv-row">
              <span>Device & Default Speed</span>
              <strong>
                {runtime?.device || "cpu"} · Default {VOICE_SPEED.default}× (Range{" "}
                {VOICE_SPEED.min}×–{VOICE_SPEED.max}×)
              </strong>
            </div>
            <div className="v2-kv-row">
              <span>Installed Voices</span>
              <strong>
                {runtime?.voices.map((v) => v.label).join(", ") ||
                  "My Yen, Nam Minh, Linh, An, Khoa (Run preflight to verify)"}
              </strong>
            </div>
            <div className="v2-kv-row">
              <span>Vietnamese Number Normalization</span>
              <strong>vi-numbers-1 (Transport-only; preserves spokenText)</strong>
            </div>
          </div>
        </section>

        {/* Background & Asset Inventory */}
        <section className="v2-card">
          <div className="v2-card-header">
            <div>
              <h3>Background & Public Asset Inventory</h3>
              <small>Served directly from 2_Remotion_Video/public</small>
            </div>
            <span className="v2-badge-mono">{assetSummary.total} ASSETS</span>
          </div>
          <div className="v2-kv-list">
            {Object.entries(assetSummary.byCategory).map(([cat, count]) => (
              <div className="v2-kv-row" key={cat}>
                <span>Category: {cat}</span>
                <strong>{count} file(s)</strong>
              </div>
            ))}
            <div className="v2-kv-row">
              <span>Session Uploaded Media</span>
              <strong>
                {session?.studioMedia?.length ?? 0} file(s) in .studio-data/media
              </strong>
            </div>
            <div className="v2-kv-row">
              <span>Cached Source Avatars</span>
              <strong>
                {Object.keys(session?.sourceImages || {}).length} verified local
                avatar(s)
              </strong>
            </div>
          </div>
        </section>

        {/* Resource & Safety Limits */}
        <section className="v2-card">
          <div className="v2-card-header">
            <div>
              <h3>Low-RAM & Safety Thresholds</h3>
              <small>Enforced by backend workers and AGENTS.md policy</small>
            </div>
            <span className="v2-status-pill status-blocked">STRICT</span>
          </div>
          <div className="v2-kv-list">
            <div className="v2-kv-row">
              <span>Worker Concurrency</span>
              <strong>1 Heavy Worker at a time (FIFO Queue + Session Lock)</strong>
            </div>
            <div className="v2-kv-row">
              <span>Render Worker V8 Heap</span>
              <strong>768 MiB max_old_space_size · Auto-cancel on low RAM</strong>
            </div>
            <div className="v2-kv-row">
              <span>Upload Size Limits</span>
              <strong>Images/GIF ≤ 10 MB · Audio/Video ≤ 50 MB</strong>
            </div>
            <div className="v2-kv-row">
              <span>Publishing Safety Gate</span>
              <strong>LIVE OAuth & Upload disabled · Explicit FINAL + Rights required</strong>
            </div>
          </div>
        </section>

        {/* Planned Autopilot Schedules (Explicitly marked contract preview) */}
        <section className="v2-card">
          <div className="v2-card-header">
            <div>
              <h3>Autopilot Discovery & Quality Thresholds</h3>
              <small>
                Clearly marked contract preview — no background cron runs at
                startup
              </small>
            </div>
            <span className="v2-status-pill status-needs-review">
              [SIMULATED / CONTRACT PREVIEW]
            </span>
          </div>
          <div className="v2-kv-list">
            {SIMULATED_DISCOVERY_SCHEDULES.map((s) => (
              <div className="v2-kv-row" key={s.id}>
                <span>{s.queryOrSource}</span>
                <strong>
                  {s.cadence} · {s.lastRunStatus}
                </strong>
              </div>
            ))}
            <div className="v2-kv-row">
              <span>Medallion Gold Threshold</span>
              <strong>Score ≥ 76 · 0 Ambiguous Terms · Audio Linked</strong>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
