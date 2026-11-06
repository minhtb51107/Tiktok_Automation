import {useRuntimeSafety,RuntimeRestriction} from './RuntimeSafety';
import { ProductionBridge } from "./ProductionBridge";
import { studioRequest } from "./integration-api";
import { useState,useEffect } from "react";
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
import { technicalJobView } from './capability-fixes';

type QueueZoneFilter = "ALL" | "MP4_OUTPUTS" | "ACTIVE_PRODUCTION" | "TECH_JOBS";

const STAGE_META: Record<
  string,
  { icon: string; label: string; stepTarget: string; colorClass: string }
> = {
  RENDER: {
    icon: "🎬",
    label: "Kết xuất Video MP4",
    stepTarget: "Render",
    colorClass: "stage-render",
  },
  EDITOR: {
    icon: "🖼",
    label: "Chuẩn bị Bàn dựng 9:16",
    stepTarget: "Video Editor",
    colorClass: "stage-editor",
  },
  VOICE: {
    icon: "🎙",
    label: "Tổng hợp Giọng đọc Kokoro",
    stepTarget: "Voice",
    colorClass: "stage-voice",
  },
  SCRIPT: {
    icon: "✍",
    label: "Chuẩn hóa Kịch bản đọc",
    stepTarget: "Script",
    colorClass: "stage-script",
  },
  MEDIA: {
    icon: "📥",
    label: "Tải & Lưu ảnh đại diện",
    stepTarget: "Source",
    colorClass: "stage-media",
  },
  SOURCE: {
    icon: "🔗",
    label: "Trích xuất Bài gốc Threads",
    stepTarget: "Source",
    colorClass: "stage-source",
  },
};

export function ProductionQueueWorkspace({
  session,
  jobs,
  renders,
  busy,
  onCancelJob,
  onOpenStep,
  onOpenProject,
}: {
  session: StudioSession | null;
  jobs: StudioJob[];
  renders: RenderManifest[];
  busy: boolean;
  onCancelJob: (jobId: string) => void;
  onOpenStep: (step: string) => void;
  onOpenProject:(project:string,step:string)=>Promise<void>;
}) {
  const {locked}=useRuntimeSafety();
  const [zoneFilter, setZoneFilter] = useState<QueueZoneFilter>("ALL");
  const [stageFilter, setStageFilter] = useState<string>("ALL");
  const [playingRenderId, setPlayingRenderId] = useState<string | null>(null);
  const [inspectedRenderId, setInspectedRenderId] = useState<string | null>(
    null,
  );
  const [expandedJobId, setExpandedJobId] = useState<string | null>(null);

  const filteredJobs = jobs.filter(
    (j) => stageFilter === "ALL" || j.currentStage === stageFilter,
  );
  const stages = Array.from(
    new Set(["ALL", ...jobs.map((j) => j.currentStage)]),
  );

  const completedRenders = renders.filter((r) => r.status === "COMPLETED");
  const failedOrCancelledRenders = renders.filter(
    (r) => r.status !== "COMPLETED",
  );
  const runningJobs = jobs.filter((j) =>
    ["QUEUED", "RUNNING"].includes(j.status),
  );

  const [serverReadiness,setServerReadiness]=useState<any>(null);
  useEffect(()=>{setServerReadiness(null);if(session)void studioRequest("/sessions/"+session.id+"/readiness").then(setServerReadiness).catch(()=>setServerReadiness(null));},[session?.id,session?.revision]);
  const selectedItems = (session?.items || []).filter((i) => i.selected);
  const getLatestVoiceAsset = (itemId:string) => (session?.voiceAssets||[]).find(a=>a.id===serverReadiness?.items.find((r:any)=>r.itemId===itemId)?.assetId)||null;
  const scenesWithAudio=selectedItems.filter(i=>!!getLatestVoiceAsset(i.id));
  const approvedSpokenScenes=selectedItems.filter(i=>serverReadiness?.items.find((r:any)=>r.itemId===i.id)?.script==='APPROVED');
  const approvedVoiceScenes=selectedItems.filter(i=>serverReadiness?.items.find((r:any)=>r.itemId===i.id)?.voice==='APPROVED');
  const productionApprovedScenes=selectedItems.filter(i=>serverReadiness?.items.find((r:any)=>r.itemId===i.id)?.productionApproved===true);
  const totalAudioSec = selectedItems.reduce((acc, item) => {
    const asset = getLatestVoiceAsset(item.id);
    return acc + (asset ? asset.durationMs / 1000 : 0);
  }, 0);

  const isFullyProductionApproved =
    selectedItems.length > 0 &&
    productionApprovedScenes.length === selectedItems.length;

  const productionApprovalPct =
    selectedItems.length > 0
      ? Math.round(
          (productionApprovedScenes.length / selectedItems.length) * 100,
        )
      : 0;

  return (
    <div
      className="v2-workspace s2-queue-workspace"
      data-testid="production-queue-workspace"
    >
      <ProductionBridge onOpen={onOpenProject}/>
      {!serverReadiness&&<p role="status">Readiness not loaded from backend; no approval inferred.</p>}
      {/* Hero Banner with 3D Film Clapperboard Art & Primary Action */}
      <div className="s2-hero-banner s2-hero-queue">
        <div className="s2-hero-copy">
          <div className="v3-eyebrow-row">
            <span className="v3-prov-pill prov-real">
              ● {completedRenders.length} MP4 BẢN NHÁP (DRAFT)
            </span>
            <span
              className={`v3-prov-pill ${
                isFullyProductionApproved ? "prov-real" : "prov-review"
              }`}
              data-testid="queue-hero-readiness-pill"
            >
              {isFullyProductionApproved
                ? `✓ ${productionApprovedScenes.length}/${selectedItems.length} CẢNH ĐẠT CHUẨN SẢN XUẤT`
                : `🎙 ${scenesWithAudio.length}/${selectedItems.length} AUDIO DRAFT · ⏳ ${productionApprovedScenes.length}/${selectedItems.length} ĐÃ DUYỆT SẢN XUẤT`}
            </span>
            <span className="v3-prov-pill prov-real">
              ⚙ {jobs.length} TÁC VỤ KỸ THUẬT
            </span>
          </div>
          <h2>Kho Video & Điều phối Sản xuất</h2>
          <p>
            Quản lý trực quan toàn bộ quy trình sản xuất: phân biệt rõ{" "}
            <strong>Audio/MP4 bản nháp (DRAFT)</strong> với{" "}
            <strong>Video đạt chất lượng sản xuất (đã duyệt lời đọc & giọng đọc)</strong>{" "}
            và <strong>Nhật ký tác vụ kỹ thuật</strong>. Mọi thao tác thử lại đều
            bảo toàn nguyên vẹn dữ liệu dự án.
          </p>
        </div>

        <div className="s2-hero-visual-right">
          <div className="s2-hero-3d-art" aria-hidden="true">
            <svg viewBox="0 0 96 80" fill="none">
              <rect
                x="14"
                y="18"
                width="68"
                height="48"
                rx="12"
                fill="#7ce8c8"
              />
              <rect
                x="20"
                y="10"
                width="56"
                height="12"
                rx="6"
                transform="rotate(-6 20 10)"
                fill="#fce068"
              />
              <circle cx="48" cy="42" r="14" fill="#12131a" />
              <path d="M44 35.5L55 42L44 48.5V35.5Z" fill="#ff8ad8" />
            </svg>
          </div>
          <div className="s2-hero-actions">
            <button
              type="button"
              className="s2-btn-secondary"
              disabled={busy}
              onClick={() => onOpenStep("Voice")}
            >
              🎙 Tạo Giọng đọc Hàng loạt
            </button>
            <button
              type="button"
              className="s2-btn-primary"
              disabled={busy}
              onClick={() => onOpenStep("Render")}
              data-testid="queue-open-render-btn"
            >
              🎬 Mở Phòng Xuất Video MP4 →
            </button>
          </div>
        </div>
      </div>

      {/* 3-Zone Visual Switcher Bar */}
      <div
        className="s2-zone-tabs"
        role="tablist"
        aria-label="Phân loại hàng đợi sản xuất"
      >
        <button
          type="button"
          role="tab"
          aria-selected={zoneFilter === "ALL"}
          className={`s2-zone-tab ${zoneFilter === "ALL" ? "active" : ""}`}
          onClick={() => setZoneFilter("ALL")}
        >
          <span>⊞ Tất cả khu vực</span>
          <b>{renders.length + 1 + jobs.length}</b>
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={zoneFilter === "MP4_OUTPUTS"}
          className={`s2-zone-tab ${zoneFilter === "MP4_OUTPUTS" ? "active" : ""}`}
          onClick={() => setZoneFilter("MP4_OUTPUTS")}
          data-testid="zone-tab-mp4"
        >
          <span>🎬 Video MP4 Đã xuất</span>
          <b>{renders.length}</b>
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={zoneFilter === "ACTIVE_PRODUCTION"}
          className={`s2-zone-tab ${zoneFilter === "ACTIVE_PRODUCTION" ? "active" : ""}`}
          onClick={() => setZoneFilter("ACTIVE_PRODUCTION")}
          data-testid="zone-tab-production"
        >
          <span>🎞 Video Đang Sản xuất</span>
          <b>{selectedItems.length} cảnh</b>
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={zoneFilter === "TECH_JOBS"}
          className={`s2-zone-tab ${zoneFilter === "TECH_JOBS" ? "active" : ""}`}
          onClick={() => setZoneFilter("TECH_JOBS")}
          data-testid="zone-tab-jobs"
        >
          <span>⚙ Tác vụ Kỹ thuật</span>
          <b>{jobs.length}</b>
        </button>
      </div>

      {/* ZONE 1: Exported MP4 Videos & Failed Render Recovery */}
      {(zoneFilter === "ALL" || zoneFilter === "MP4_OUTPUTS") && (
        <section
          className="s2-queue-section"
          aria-label="Kho Video MP4 đã xuất"
          data-testid="zone-mp4-outputs"
        >
          <div className="s2-section-title-row">
            <div>
              <span className="s2-zone-pill pill-mint">
                KHU VỰC 1 · THÀNH PHẨM BẢN NHÁP
              </span>
              <h3>
                Video MP4 Đã Xuất ({completedRenders.length} hoàn chỉnh ·{" "}
                {failedOrCancelledRenders.length} lỗi/đã hủy)
              </h3>
              <p>
                Các file MP4 thật lưu tại <code>.studio-data/renders</code>. Bản
                nháp phục vụ kiểm duyệt nội bộ, không tự động đăng công khai.
              </p>
            </div>
          </div>

          {renders.length === 0 ? (
            <div className="s2-empty-card">
              <p>
                Chưa có bản xuất MP4 nào cho dự án này. Hãy nhấn{" "}
                <strong>Mở Phòng Xuất Video MP4</strong> để kết xuất bản nháp
                đầu tiên.
              </p>
            </div>
          ) : (
            <div className="s2-mp4-grid">
              {renders.map((m, idx) => {
                const isCompleted = m.status === "COMPLETED";
                const isPlaying = playingRenderId === m.jobId;
                const isInspected = inspectedRenderId === m.jobId;
                const previewPoster =
                  session?.sourceImages?.[selectedItems[idx % Math.max(1, selectedItems.length)]?.id]?.uri ||
                  undefined;

                return (
                  <article
                    key={m.jobId}
                    className={`s2-mp4-card status-${m.status.toLowerCase()}`}
                    data-testid={`mp4-card-${m.jobId.slice(0, 8)}`}
                  >
                    {/* Visual 9:16 Video Thumbnail Header */}
                    <div className="s2-mp4-thumb-wrap">
                      {isCompleted ? (
                        isPlaying ? (
                          <video
                            src={m.downloadUrl}
                            controls
                            autoPlay
                            playsInline
                            className="s2-mp4-video-player"
                          />
                        ) : (
                          <div
                            className="s2-mp4-thumb-preview"
                            onClick={() => setPlayingRenderId(m.jobId)}
                            role="button"
                            tabIndex={0}
                            onKeyDown={(e) => {
                              if (e.key === "Enter" || e.key === " ") {
                                e.preventDefault();
                                setPlayingRenderId(m.jobId);
                              }
                            }}
                            aria-label={`Phát thử video ${m.jobId.slice(0, 8)}`}
                          >
                            <video
                              src={`${m.downloadUrl}#t=1.0`}
                              preload="metadata"
                              muted
                              playsInline
                              poster={previewPoster}
                              className="s2-mp4-video-Still"
                            />
                            <div className="s2-mp4-thumb-overlay">
                              <span className="s2-play-circle">▶</span>
                              <span className="s2-res-pill">
                                {m.width}×{m.height} · {m.fps}fps
                              </span>
                              <span className="s2-dur-pill">
                                ⏱ {m.expectedDurationSeconds.toFixed(1)}s
                              </span>
                            </div>
                          </div>
                        )
                      ) : (
                        <div className="s2-mp4-thumb-failed">
                          <span className="s2-failed-icon">
                            {m.status === "CANCELLED" ? "⏹" : "⚠"}
                          </span>
                          <strong>
                            {m.status === "CANCELLED"
                              ? "Đã dừng theo yêu cầu"
                              : "Lượt xuất MP4 bị gián đoạn"}
                          </strong>
                          <small>
                            {m.width}×{m.height} ·{" "}
                            {m.expectedDurationSeconds.toFixed(1)}s
                          </small>
                        </div>
                      )}
                    </div>

                    {/* Card Details */}
                    <div className="s2-mp4-card-body">
                      <div className="s2-mp4-head-row">
                        {(() => {
                          const isDraftRender =
                            m.mode === "DRAFT" ||
                            m.warnings.some(
                              (w) =>
                                w.includes("DRAFT") ||
                                w.includes("not approved"),
                            );
                          return (
                            <span
                              className={`s2-status-badge ${
                                isCompleted
                                  ? isDraftRender
                                    ? "badge-review"
                                    : "badge-qualified"
                                  : m.status === "CANCELLED"
                                    ? "badge-review"
                                    : "badge-rejected"
                              }`}
                            >
                              {isCompleted
                                ? isDraftRender
                                  ? "🎬 MP4 Bản nháp (DRAFT — Chưa duyệt xuất bản)"
                                  : "✓ MP4 Đạt chuẩn Sản xuất"
                                : m.status === "CANCELLED"
                                  ? "⏹ Đã hủy"
                                  : "✕ Lỗi xuất"}
                            </span>
                          );
                        })()}
                        <code className="s2-mono-id">#{m.jobId.slice(0, 8)}</code>
                      </div>

                      <strong className="s2-mp4-title">
                        Bản dựng {m.width === 1080 ? "Full HD 9:16" : "HD 9:16"} ·{" "}
                        {formatBytes(m.bytes)}
                      </strong>

                      <div className="s2-mp4-meta-list">
                        <span>
                          Thời lượng: <b>{m.expectedDurationSeconds.toFixed(1)} giây</b>
                        </span>
                        <span>·</span>
                        <span>
                          Chế độ: <b>{m.mode}</b>
                        </span>
                      </div>

                      {/* Expandable Warnings / Error Diagnostics */}
                      {m.warnings.length > 0 && (
                        <div className="s2-mp4-diag-box">
                          <button
                            type="button"
                            className="s2-diag-toggle"
                            onClick={() =>
                              setInspectedRenderId(
                                isInspected ? null : m.jobId,
                              )
                            }
                          >
                            {isInspected
                              ? "▾ Ẩn ghi chú kỹ thuật"
                              : `▸ Xem ${m.warnings.length} ghi chú khi kết xuất`}
                          </button>
                          {isInspected && (
                            <ul className="s2-diag-list">
                              {m.warnings.slice(0, 5).map((w, wi) => (
                                <li key={wi}>{w}</li>
                              ))}
                            </ul>
                          )}
                        </div>
                      )}

                      <div className="s2-mp4-actions">
                        {isCompleted ? (
                          <>
                            <button
                              type="button"
                              className="s2-btn-secondary"
                              onClick={() =>
                                setPlayingRenderId(
                                  isPlaying ? null : m.jobId,
                                )
                              }
                            >
                              {isPlaying ? "⏹ Thu gọn trình phát" : "▶ Phát thử"}
                            </button>
                            <a
                              className="s2-btn-primary s2-link-btn"
                              href={m.downloadUrl + "?download=1"}
                            >
                              ⬇ Tải MP4 ({formatBytes(m.bytes)})
                            </a>
                          </>
                        ) : (
                          <button
                            type="button"
                            className="s2-btn-primary"
                            onClick={() => onOpenStep("Render")}
                          >
                            ↺ Mở Phòng Render để thử lại an toàn
                          </button>
                        )}
                      </div>
                    </div>
                  </article>
                );
              })}
            </div>
          )}
        </section>
      )}

      {/* ZONE 2: Active Video Production Storyboard & Readiness */}
      {(zoneFilter === "ALL" || zoneFilter === "ACTIVE_PRODUCTION") && (
        <section
          className="s2-queue-section"
          aria-label="Video đang trong quá trình sản xuất"
          data-testid="zone-active-production"
        >
          <div className="s2-section-title-row">
            <div>
              <span className="s2-zone-pill pill-periwinkle">
                KHU VỰC 2 · VIDEO ĐANG SẢN XUẤT
              </span>
              <h3>
                Bản dựng Hiện tại: {session?.title || "Untitled project"} (
                {selectedItems.length} cảnh nối tiếp)
              </h3>
              <p>
                Tiến trình chuẩn bị nguyên liệu của dự án hiện tại trước khi
                xuất bản nháp MP4 mới.
              </p>
            </div>
            <div className="s2-row-btns">
              <button
                type="button"
                className="s2-btn-secondary"
                onClick={() => onOpenStep("Video Editor")}
              >
                🖼 Mở Bàn dựng 9:16
              </button>
              <button
                type="button"
                className="s2-btn-primary"
                onClick={() => onOpenStep("Render")}
              >
                🎬 Xuất bản nháp MP4 mới
              </button>
            </div>
          </div>

          <div className="s2-active-prod-card">
            <div className="s2-prod-progress-head">
              <div>
                <strong>
                  Nguyên liệu hiện tại: {scenesWithAudio.length}/
                  {selectedItems.length} cảnh đã có Audio nháp (DRAFT) ·{" "}
                  {productionApprovedScenes.length}/{selectedItems.length} cảnh đã
                  duyệt chuẩn sản xuất (~{totalAudioSec.toFixed(1)}s)
                </strong>
                <small>
                  {runningJobs.length > 0
                    ? `${runningJobs.length} bản ghi QUEUED/RUNNING; chưa xác minh worker đang hoạt động`
                    : isFullyProductionApproved
                      ? "Tất cả cảnh đã được duyệt kịch bản đọc và giọng đọc chính thức."
                      : "⚠ Audio hiện tại là bản nháp (DRAFT) để nghe thử & dựng nháp. Cần hoàn tất duyệt lời đọc (Spoken Approval) và duyệt giọng đọc (Voice Approval) trước khi đạt chuẩn sản xuất."}
                </small>
              </div>
              <div
                style={{ display: "flex", gap: 8, flexWrap: "wrap" }}
                data-testid="production-readiness-badges"
              >
                <span
                  className="s2-status-badge badge-review"
                  data-testid="badge-draft-audio-count"
                >
                  🎙 {scenesWithAudio.length}/{selectedItems.length} AUDIO NHÁP
                  (DRAFT)
                </span>
                <span
                  className={`s2-status-badge ${
                    isFullyProductionApproved
                      ? "badge-qualified"
                      : "badge-review"
                  }`}
                  data-testid="badge-production-approval-status"
                >
                  {isFullyProductionApproved
                    ? "✓ ĐẠT CHUẨN SẢN XUẤT"
                    : `⏳ CHƯA DUYỆT SẢN XUẤT (${productionApprovedScenes.length}/${selectedItems.length})`}
                </span>
              </div>
            </div>

            {/* 4-Gate Approval & Draft Breakdown Strip */}
            <div
              className="s2-env-grid"
              style={{ marginBottom: 14 }}
              data-testid="production-approval-gate-strip"
            >
              <div className="s2-env-pill is-neutral">
                <span>🎙</span>
                <div>
                  <strong>
                    Audio nháp (DRAFT): {scenesWithAudio.length}/
                    {selectedItems.length} cảnh
                  </strong>
                  <small>Phục vụ nghe thử & căn nhịp (~{totalAudioSec.toFixed(1)}s)</small>
                </div>
              </div>
              <div
                className={`s2-env-pill ${
                  approvedSpokenScenes.length === selectedItems.length &&
                  selectedItems.length > 0
                    ? "is-ok"
                    : "is-missing"
                }`}
              >
                <span>
                  {approvedSpokenScenes.length === selectedItems.length &&
                  selectedItems.length > 0
                    ? "✓"
                    : "⏳"}
                </span>
                <div>
                  <strong>
                    Duyệt kịch bản đọc: {approvedSpokenScenes.length}/
                    {selectedItems.length} cảnh
                  </strong>
                  <small>Spoken Text Approval trước khi xuất bản</small>
                </div>
              </div>
              <div
                className={`s2-env-pill ${
                  approvedVoiceScenes.length === selectedItems.length &&
                  selectedItems.length > 0
                    ? "is-ok"
                    : "is-missing"
                }`}
              >
                <span>
                  {approvedVoiceScenes.length === selectedItems.length &&
                  selectedItems.length > 0
                    ? "✓"
                    : "⏳"}
                </span>
                <div>
                  <strong>
                    Duyệt giọng đọc: {approvedVoiceScenes.length}/
                    {selectedItems.length} cảnh
                  </strong>
                  <small>Voice Asset Approval trong bước Giọng đọc</small>
                </div>
              </div>
              <div
                className={`s2-env-pill ${
                  isFullyProductionApproved ? "is-ok" : "is-missing"
                }`}
              >
                <span>{isFullyProductionApproved ? "✓" : "🔒"}</span>
                <div>
                  <strong>
                    Chuẩn sản xuất chính thức: {productionApprovedScenes.length}/
                    {selectedItems.length} cảnh ({productionApprovalPct}%)
                  </strong>
                  <small>
                    {isFullyProductionApproved
                      ? "Đủ điều kiện xuất chính thức"
                      : "Chỉ xuất được MP4 Bản nháp (DRAFT)"}
                  </small>
                </div>
              </div>
            </div>

            <div className="v3-striped-progress-track">
              <div
                className="v3-striped-progress-fill"
                style={{ width: `${Math.max(6, productionApprovalPct)}%` }}
              />
            </div>

            <div className="s2-storyboard-strip">
              {selectedItems.map((item, idx) => {
                const avatar =
                  session?.sourceImages?.[item.id]?.uri ||
                  item.metadata?.avatar ||
                  null;
                const asset = getLatestVoiceAsset(item.id);
                const isVoiceApproved = Boolean(
                  asset && asset.status === "APPROVED" && asset.approvedAt,
                );
                const isSpokenApproved = Boolean(
                  item.spokenApproval?.valid &&
                    item.spokenApproval.revision === item.revision,
                );

                return (
                  <div key={item.id} className="s2-story-scene-card">
                    <div className="s2-story-scene-top">
                      <span className="s2-scene-badge">Cảnh #{idx + 1}</span>
                      <span
                        className={`s2-audio-dot ${
                          isVoiceApproved
                            ? "is-ready"
                            : asset
                              ? "is-draft"
                              : "is-missing"
                        }`}
                      >
                        {asset
                          ? `🎙 ${(asset.durationMs / 1000).toFixed(1)}s · ${
                              isVoiceApproved ? "Đã duyệt" : "DRAFT"
                            }`
                          : "○ Chưa có âm thanh"}
                      </span>
                    </div>
                    <div className="s2-story-author">
                      {avatar ? (
                        <img
                          src={avatar}
                          alt={item.author.displayName}
                          className="s2-story-avatar"
                        />
                      ) : (
                        <span className="s2-story-avatar-fallback">
                          {item.author.displayName.slice(0, 1).toUpperCase()}
                        </span>
                      )}
                      <div>
                        <strong>{item.author.displayName}</strong>
                        <small>@{item.metadata?.handle || item.author.handle}</small>
                      </div>
                    </div>
                    <p className="s2-story-excerpt">
                      {item.displayText.slice(0, 85)}
                      {item.displayText.length > 85 ? "..." : ""}
                    </p>
                    <div
                      style={{
                        display: "flex",
                        gap: 6,
                        flexWrap: "wrap",
                        marginTop: 8,
                        fontSize: "0.73rem",
                      }}
                    >
                      <span className="s2-mono-id">
                        Lời đọc: {isSpokenApproved ? "✓ Đã duyệt" : "⏳ Chờ duyệt"}
                      </span>
                      <span className="s2-mono-id">
                        Voice: {isVoiceApproved ? "✓ Đã duyệt" : "⏳ Audio nháp"}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </section>
      )}

      {/* ZONE 3: Technical Pipeline Jobs & Safe Error Recovery */}
      {(zoneFilter === "ALL" || zoneFilter === "TECH_JOBS") && (
        <section
          className="s2-queue-section"
          aria-label="Nhật ký tác vụ kỹ thuật"
          data-testid="zone-tech-jobs"
        >
          <div className="s2-section-title-row">
            <div>
              <span className="s2-zone-pill pill-buttercup">
                KHU VỰC 3 · TÁC VỤ KỸ THUẬT HỆ THỐNG
              </span>
              <h3>Nhật ký Tác vụ Kỹ thuật ({filteredJobs.length})</h3>
              <p>
                Nhật ký trạng thái đã lưu, không phải danh sách worker đang hoạt động.
                QUEUED/RUNNING không xác nhận tiến trình còn sống. Mở bước tương ứng
                để kiểm tra; không tự động chạy lại tác vụ.
              </p>
            </div>

            <div
              className="s2-stage-filter-pills"
              role="group"
              aria-label="Lọc theo giai đoạn kỹ thuật"
            >
              {stages.map((st) => (
                <button
                  key={st}
                  type="button"
                  className={stageFilter === st ? "active" : ""}
                  onClick={() => setStageFilter(st)}
                >
                  {st === "ALL"
                    ? `Tất cả (${jobs.length})`
                    : `${STAGE_META[st]?.icon || "⚙"} ${st}`}
                </button>
              ))}
            </div>
          </div>

          <div
            className="s2-tech-jobs-list"
            data-testid="production-jobs-table"
          >
            {filteredJobs.map((j) => {
              const view = technicalJobView(j);
              const isRunning = view.pending;
              const isFailed = j.status === "FAILED";
              const meta = STAGE_META[j.currentStage] || {
                icon: "⚙",
                label: j.currentStage,
                stepTarget: "Source",
                colorClass: "stage-default",
              };
              const pct = view.percent;
              const isExpanded = expandedJobId === j.jobId;
              const hasDiagnostics = Boolean(j.error || j.warnings.length > 0);

              return (
                <article
                  key={j.jobId}
                  className={`s2-job-card ${isFailed ? "is-failed" : ""} ${
                    isRunning ? "is-running" : ""
                  }`}
                >
                  <div className="s2-job-main-row">
                    {/* Left: Visual Stage Thumbnail Badge + Operation Name */}
                    <div className="s2-job-identity">
                      <span className={`s2-job-icon-box ${meta.colorClass}`}>
                        {meta.icon}
                      </span>
                      <div>
                        <div className="s2-job-title-line">
                          <strong>{meta.label}</strong>
                          <code className="s2-mono-id">
                            #{j.jobId.slice(0, 8)}
                          </code>
                        </div>
                        <small className="s2-job-op-sub">
                          Thao tác: <code>{j.operation}</code> · Bước:{" "}
                          {j.currentStep}
                        </small>
                      </div>
                    </div>

                    {/* Center: Progress Bar & Timing */}
                    <div className="s2-job-progress-col">
                      <div className="s2-job-progress-top">
                        <span>
                          {pct !== null
                            ? `${j.completed} / ${j.total} đơn vị (${pct}%)`
                            : j.currentStep}
                        </span>
                        <b>⏱ {(j.elapsedMs / 1000).toFixed(1)}s</b>
                      </div>
                      <small>{view.workerEvidence}</small>
                      {pct !== null ? <div className="s2-job-bar-track" role="progressbar" aria-label="Tiến trình đo được" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
                        <div
                          className={`s2-job-bar-fill ${
                            isFailed
                              ? "fill-failed"
                              : isRunning
                                ? "fill-running"
                                : "fill-ok"
                          }`}
                          style={{ width: `${pct}%` }}
                        />
                      </div> : isRunning ? <progress aria-label="Chưa đo được tiến trình; worker chưa xác minh"/> : <small>Không có số liệu tiến trình.</small>}
                    </div>

                    {/* Right: Status Badge + Diagnostics Toggle + Safe Retry / Open Button */}
                    <div className="s2-job-actions-col">
                      <span
                        className={`s2-status-badge ${
                          isRunning
                            ? "badge-queued"
                            : isFailed
                              ? "badge-rejected"
                              : j.status === 'SUCCEEDED' ? "badge-qualified" : "badge-needs-review"
                        }`}
                      >
                        {view.label}
                      </span>

                      {hasDiagnostics && (
                        <button
                          type="button"
                          className="s2-btn-ghost"
                          onClick={() =>
                            setExpandedJobId(isExpanded ? null : j.jobId)
                          }
                          data-testid={`job-diag-btn-${j.jobId.slice(0, 8)}`}
                        >
                          {isExpanded
                            ? "Ẩn chi tiết"
                            : j.error
                              ? "⚠ Xem lỗi"
                              : `ℹ ${j.warnings.length} ghi chú`}
                        </button>
                      )}

                      {isRunning ? (
                        <button
                          type="button"
                          className="s2-btn-secondary"
                          disabled={locked || j.cancelRequested}
                          title={locked ? 'REAL_DATA_COPY: không điều khiển worker; đây là nhật ký đã lưu.' : 'Yêu cầu hủy job; không xác nhận worker còn hoạt động.'}
                          onClick={() => onCancelJob(j.jobId)}
                        >
                          {j.cancelRequested ? "Đang dừng..." : "⏹ Dừng tác vụ"}
                        </button>
                      ) : (
                        <button
                          type="button"
                          className="s2-btn-secondary"
                          onClick={() => onOpenStep(meta.stepTarget)}
                        >
                          {isFailed
                            ? "↺ Mở bước này để thử lại"
                            : "Mở công cụ →"}
                        </button>
                      )}
                    </div>
                  </div>

                  {/* Expandable Error & Warning Inspector */}
                  {isExpanded && hasDiagnostics && (
                    <div
                      className="s2-job-diagnostics-drawer"
                      data-testid={`job-diag-drawer-${j.jobId.slice(0, 8)}`}
                    >
                      {j.error && (
                        <div className="s2-job-error-box">
                          <strong>Nguyên nhân lỗi:</strong>
                          <p>{j.error}</p>
                        </div>
                      )}
                      {j.warnings.length > 0 && (
                        <div className="s2-job-warn-box">
                          <strong>
                            Ghi chú kỹ thuật ({j.warnings.length}) — Dữ liệu dự
                            án vẫn an toàn:
                          </strong>
                          <ul>
                            {j.warnings.map((w, idx) => (
                              <li key={idx}>{w}</li>
                            ))}
                          </ul>
                        </div>
                      )}
                      <div className="s2-job-recovery-foot">
                        <small>
                          💡 Mọi chỉnh sửa kịch bản, giọng đọc và bố cục của bạn
                          vẫn được giữ nguyên.
                        </small>
                        <button
                          type="button"
                          className="s2-btn-primary"
                          onClick={() => onOpenStep(meta.stepTarget)}
                        >
                          ↺ Chuyển tới {meta.label} để kiểm tra / chạy lại
                        </button>
                      </div>
                    </div>
                  )}
                </article>
              );
            })}
          </div>
        </section>
      )}
    </div>
  );
}

export function SettingsWorkspace({
  session,
  publicAssets,
  theme,
  onCheckVoiceRuntime,
  busy,
}: {
  session: StudioSession | null;
  publicAssets: LibraryAsset[];
  theme: "DARK" | "LIGHT";
  onCheckVoiceRuntime: () => void;
  busy: boolean;
}) {
  const {locked}=useRuntimeSafety();
  const assetSummary = summarizePublicAssets(publicAssets);
  const runtime = session?.voiceRuntime;

  return (
    <div className="v2-workspace" data-testid="settings-workspace">
      <div className="v2-page-header">
        <div>
          <span className="v2-eyebrow">
            STUDIO CONFIGURATION · RUNTIME, VOICE, PRESETS & SAFETY THRESHOLDS
          </span>
          <h2>Cấu hình Hệ thống & Giọng đọc</h2><RuntimeRestriction/>
          <p>
            Kiểm tra trạng thái Kokoro TTS cục bộ, kho tài nguyên nền, giới hạn
            RAM an toàn và chế độ giao diện Sáng / Tối.
          </p>
        </div>
        <div className="v2-header-actions">
          <button
            disabled={locked || busy || !session}
            onClick={onCheckVoiceRuntime}
          >
            Kiểm tra Runtime Kokoro
          </button>
          <span>Studio theme: {theme} · change using the single header control.</span>
        </div>
      </div>

      <div className="v2-two-col">
        {/* Voice & Kokoro Runtime */}
        <section className="v2-card">
          <div className="v2-card-header">
            <div>
              <h3>Kokoro Local TTS & Voice Presets</h3>
              <small>Saved preflight snapshot, not a current runtime verification</small>
            </div>
            <span className="v2-status-pill status-success">
              {runtime?.status || "STANDBY"}
            </span>
          </div>
          <div className="v2-kv-list">
            <div className="v2-kv-row">
              <span>Python & Package</span>
              <strong>
                {runtime?.python || "NOT_VERIFIED"} · Kokoro{" "}
                {runtime?.packageVersion || "NOT_VERIFIED"}
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
                  "NOT_VERIFIED — no installed voices inferred"}
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
                  {s.cadence} · {s.rateLimit}
                </strong>
              </div>
            ))}
            <div className="v2-kv-row">
              <span>Medallion Gold Threshold</span>
              <strong>MOCK / design reference only — use DATA-01/Gold reports for actual rules</strong>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
