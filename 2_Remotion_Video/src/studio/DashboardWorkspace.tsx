import type { StudioSession } from "../../../1_nest_backend/src/studio/studio.contracts";
import type { StudioJob } from "../../../1_nest_backend/src/studio/progress";
import type { RenderManifest } from "../../../1_nest_backend/src/studio/render.types";
import {
  computeMedallionItems,
  formatBytes,
} from "./studio-v2-adapter";

export function DashboardWorkspace({
  sessions,
  session,
  jobs,
  renders,
  busy,
  onNavigateArea,
  onNavigateStep,
  onSelectSession,
  onCreateSession,
}: {
  sessions: { id: string; title: string; updatedAt?: string }[];
  session: StudioSession | null;
  jobs: StudioJob[];
  renders: RenderManifest[];
  busy: boolean;
  onNavigateArea: (area: string) => void;
  onNavigateStep: (step: string) => void;
  onSelectSession: (id: string) => void;
  onCreateSession: () => void;
}) {
  const medallion = computeMedallionItems(session);
  const selectedItems = session?.items.filter((i) => i.selected) || [];
  const draftOrApprovedAudio = medallion.items.filter(
    (i) => i.selected && (i.audioStatus === "DRAFT" || i.audioStatus === "APPROVED"),
  );
  const completedRenders = renders.filter((r) => r.status === "COMPLETED");
  const latestRender = completedRenders[0] || renders[0];
  const runningJobs = jobs.filter((j) =>
    ["QUEUED", "RUNNING"].includes(j.status),
  );
  const failedJobs = jobs.filter((j) => j.status === "FAILED");
  const reviewRequiredItems = medallion.items.filter(
    (i) => i.ambiguities.length > 0 || i.tier === "QUARANTINE",
  );

  const stageFlow = [
    {
      id: "Discovery",
      title: "01. Threads Discovery",
      status:
        (session?.items.length || 0) > 0 ? "SUCCESS" : "NEEDS_REVIEW",
      metric: `${session?.items.length || 0} posts fetched`,
      detail: `${session?.attempts?.length || 0} URL attempts · ${session?.scope || "TARGET_ONLY"}`,
      action: () => onNavigateArea("Discovery"),
    },
    {
      id: "Data Review",
      title: "02. Data Evaluation",
      status:
        medallion.counts.quarantine > 0 || reviewRequiredItems.length > 0
          ? "NEEDS_REVIEW"
          : medallion.counts.gold > 0
            ? "SUCCESS"
            : "WARNING",
      metric: `${medallion.counts.gold} Gold · ${medallion.counts.silver} Silver`,
      detail: `${medallion.counts.bronze} Bronze · ${medallion.counts.quarantine} Quarantine`,
      action: () => onNavigateArea("Data Review"),
    },
    {
      id: "Voice",
      title: "03. Kokoro Voice Synth",
      status:
        draftOrApprovedAudio.length === selectedItems.length &&
        selectedItems.length > 0
          ? "SUCCESS"
          : "WARNING",
      metric: `${draftOrApprovedAudio.length}/${selectedItems.length} scenes voiced`,
      detail: `Device: ${session?.voiceRuntime?.device || "cpu"} · Sequential FIFO`,
      action: () => onNavigateStep("Voice"),
    },
    {
      id: "Video Studio",
      title: "04. Video Composition",
      status: selectedItems.length > 0 ? "SUCCESS" : "WARNING",
      metric: `${selectedItems.length} scenes · 9:16`,
      detail: "1080×1920 · 30 FPS · Direct Canvas + Timeline",
      action: () => onNavigateStep("Video Editor"),
    },
    {
      id: "Render",
      title: "05. Quality Assurance & MP4",
      status:
        completedRenders.length > 0
          ? "SUCCESS"
          : runningJobs.some((j) => j.operation === "render")
            ? "RUNNING"
            : "WARNING",
      metric: `${completedRenders.length} MP4 retained`,
      detail: latestRender
        ? `${latestRender.expectedDurationSeconds.toFixed(1)}s · ${formatBytes(latestRender.bytes)} (${latestRender.mode})`
        : "No completed MP4 yet",
      action: () => onNavigateStep("Render"),
    },
    {
      id: "Publish",
      title: "06. Publishing Gate",
      status: "BLOCKED",
      metric: "BLOCKED_SAFETY_GATE",
      detail: "LIVE transfer off · UNKNOWN rights gate enforced",
      action: () => onNavigateStep("Publish"),
    },
  ];

  return (
    <div className="v2-workspace" data-testid="dashboard-workspace">
      <div className="v2-page-header">
        <div>
          <span className="v2-eyebrow">INTELLIGENT OPERATIONS CONSOLE · LIVE SESSION TELEMETRY</span>
          <h2>Pipeline Overview & Operations Health</h2>
          <p>
            End-to-end observability across Threads Discovery, Medallion Evaluation,
            Kokoro Local TTS, Remotion NLE, and Offline MP4 Verification.
          </p>
        </div>
        <div className="v2-header-actions">
          <button
            disabled={busy}
            onClick={() => onNavigateArea("Data Review")}
          >
            Review Data ({reviewRequiredItems.length} attention)
          </button>
          <button
            className="primary"
            disabled={busy || !session}
            onClick={() => onNavigateStep("Video Editor")}
          >
            Open Video Studio ↗
          </button>
        </div>
      </div>

      {/* KPI Strip */}
      <section className="v2-kpi-grid" aria-label="Pipeline key metrics">
        <article className="v2-kpi-card">
          <div className="v2-kpi-top">
            <span>COLLECTED POSTS</span>
            <span className="v2-status-pill status-success">LIVE DATA</span>
          </div>
          <strong className="v2-kpi-value">{session?.items.length ?? 0}</strong>
          <small>
            {selectedItems.length} selected for production · Revision{" "}
            {session?.revision ?? 0}
          </small>
        </article>

        <article className="v2-kpi-card">
          <div className="v2-kpi-top">
            <span>QUALIFIED (GOLD / SILVER)</span>
            <span
              className={`v2-status-pill ${medallion.counts.gold > 0 ? "status-success" : "status-warning"}`}
            >
              {medallion.counts.gold} GOLD
            </span>
          </div>
          <strong className="v2-kpi-value">
            {medallion.counts.gold + medallion.counts.silver}
            <span className="v2-kpi-unit"> / {session?.items.length ?? 0}</span>
          </strong>
          <small>
            {medallion.counts.bronze} Bronze · {medallion.counts.quarantine}{" "}
            Quarantined
          </small>
        </article>

        <article className="v2-kpi-card">
          <div className="v2-kpi-top">
            <span>NARRATION COVERAGE</span>
            <span
              className={`v2-status-pill ${draftOrApprovedAudio.length === selectedItems.length && selectedItems.length > 0 ? "status-success" : "status-warning"}`}
            >
              {session?.voiceRuntime?.status || "KOKORO"}
            </span>
          </div>
          <strong className="v2-kpi-value">
            {draftOrApprovedAudio.length}
            <span className="v2-kpi-unit"> / {selectedItems.length}</span>
          </strong>
          <small>
            {session?.voiceAssets?.length ?? 0} cached audio files in session
          </small>
        </article>

        <article className="v2-kpi-card">
          <div className="v2-kpi-top">
            <span>PRODUCTION QUEUE</span>
            <span
              className={`v2-status-pill ${runningJobs.length > 0 ? "status-running" : failedJobs.length > 0 ? "status-failed" : "status-success"}`}
            >
              {runningJobs.length > 0 ? `${runningJobs.length} RUNNING` : "IDLE"}
            </span>
          </div>
          <strong className="v2-kpi-value">{jobs.length}</strong>
          <small>
            {jobs.filter((j) => ["SUCCEEDED", "WAITING_REVIEW"].includes(j.status)).length}{" "}
            completed · {failedJobs.length} failed
          </small>
        </article>

        <article className="v2-kpi-card">
          <div className="v2-kpi-top">
            <span>COMPLETED DRAFTS</span>
            <span className="v2-status-pill status-review">DRAFT MP4</span>
          </div>
          <strong className="v2-kpi-value">{completedRenders.length}</strong>
          <small>
            {latestRender
              ? `${latestRender.width}×${latestRender.height} · ${latestRender.expectedDurationSeconds.toFixed(1)}s`
              : "Ready for local render"}
          </small>
        </article>

        <article className="v2-kpi-card">
          <div className="v2-kpi-top">
            <span>SAFETY & PUBLISHING</span>
            <span className="v2-status-pill status-blocked">BLOCKED</span>
          </div>
          <strong className="v2-kpi-value">LOCKED</strong>
          <small>
            No auto-publish · Rights UNKNOWN · Loopback 127.0.0.1
          </small>
        </article>
      </section>

      {/* End-to-End Pipeline Health Flow */}
      <section className="v2-card">
        <div className="v2-card-header">
          <div>
            <h3>End-to-End Pipeline Stage Health</h3>
            <small>Click any stage node to jump directly to its operational workspace</small>
          </div>
          <span className="v2-badge-mono">
            SESSION {session?.id.slice(0, 8) || "NONE"} · REV {session?.revision ?? 0}
          </span>
        </div>
        <div className="v2-pipeline-flow">
          {stageFlow.map((st, idx) => (
            <button
              key={st.id}
              className="v2-pipeline-node"
              onClick={st.action}
            >
              <div className="v2-pipeline-node-head">
                <span className="v2-node-index">0{idx + 1}</span>
                <span
                  className={`v2-status-pill status-${st.status.toLowerCase().replace("_", "-")}`}
                >
                  {st.status}
                </span>
              </div>
              <strong>{st.title.replace(/^0\d\.\s*/, "")}</strong>
              <div className="v2-node-metric">{st.metric}</div>
              <small>{st.detail}</small>
            </button>
          ))}
        </div>
      </section>

      <div className="v2-two-col">
        {/* Exceptions & Attention Queue */}
        <section className="v2-card">
          <div className="v2-card-header">
            <div>
              <h3>Actionable Exceptions & Quality Gates</h3>
              <small>Items requiring human review before FINAL export</small>
            </div>
            <span className="v2-status-pill status-needs-review">
              {reviewRequiredItems.length + (session?.errors.length || 0)} ITEMS
            </span>
          </div>
          <div className="v2-list">
            {reviewRequiredItems.map((item) => (
              <div className="v2-list-row" key={item.id}>
                <div>
                  <strong>
                    Scene #{item.itemIndex} · {item.author} (@{item.handle})
                  </strong>
                  <p>
                    {item.rejectionOrReviewReasons.join(" · ") ||
                      "Needs spoken/audio verification"}
                  </p>
                </div>
                <div className="v2-row-actions">
                  <span className={`v2-tier-badge tier-${item.tier.toLowerCase()}`}>
                    {item.tier} · {item.qualityScore}
                  </span>
                  <button onClick={() => onNavigateStep("Script")}>
                    Inspect Script
                  </button>
                </div>
              </div>
            ))}
            {(session?.errors || []).slice(0, 3).map((err, i) => (
              <div className="v2-list-row" key={"err-" + i}>
                <div>
                  <strong>Extraction / Stage Diagnostic</strong>
                  <p>{err}</p>
                </div>
                <div className="v2-row-actions">
                  <span className="v2-status-pill status-warning">DIAGNOSTIC</span>
                  <button onClick={() => onNavigateArea("Discovery")}>
                    View Source
                  </button>
                </div>
              </div>
            ))}
            {reviewRequiredItems.length === 0 &&
              (session?.errors.length || 0) === 0 && (
                <p className="v2-muted">
                  All selected scenes pass baseline syntax checks. Human semantic
                  and audio listening approval still required before FINAL.
                </p>
              )}
          </div>
        </section>

        {/* Worker, Resource & Guardrail Telemetry */}
        <section className="v2-card">
          <div className="v2-card-header">
            <div>
              <h3>Worker & Hardware Resource Telemetry</h3>
              <small>Low-RAM sequential execution guardrails active</small>
            </div>
            <span className="v2-status-pill status-success">SEQUENTIAL MODE</span>
          </div>
          <div className="v2-kv-list">
            <div className="v2-kv-row">
              <span>Local TTS Engine</span>
              <strong>
                Kokoro {session?.voiceRuntime?.packageVersion || "0.9.4"} ·{" "}
                {session?.voiceRuntime?.voices.length ?? 5} voices ready
              </strong>
            </div>
            <div className="v2-kv-row">
              <span>Inference Device & Rate</span>
              <strong>
                {session?.voiceRuntime?.device || "cpu"} · SERIOUS 1.20× default
              </strong>
            </div>
            <div className="v2-kv-row">
              <span>Render Worker Concurrency</span>
              <strong>Concurrency 1 · 768 MiB V8 heap limit · H.264 + WAV→AAC</strong>
            </div>
            <div className="v2-kv-row">
              <span>Startup Auto-Triggers</span>
              <strong>OFF (No scrape, AI, TTS, render, or publish on boot)</strong>
            </div>
            <div className="v2-kv-row">
              <span>Original Source Immutability</span>
              <strong>LOCKED (Revisions, manualLocks & provenance preserved)</strong>
            </div>
            <div className="v2-kv-row">
              <span>Active Workspace Sessions</span>
              <strong>
                {sessions.length} persisted sessions in .studio-data
              </strong>
            </div>
          </div>
          <div className="v2-card-footer">
            <button disabled={busy} onClick={() => onNavigateArea("Production Queue")}>
              Inspect Job Queue ({jobs.length})
            </button>
            <button disabled={busy} onClick={onCreateSession}>
              ＋ New SERIOUS Project
            </button>
          </div>
        </section>
      </div>
    </div>
  );
}
