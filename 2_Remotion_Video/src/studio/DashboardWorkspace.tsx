import { useMemo, useRef, useState } from "react";
import type { StudioSession } from "../../../1_nest_backend/src/studio/studio.contracts";
import type { StudioJob } from "../../../1_nest_backend/src/studio/progress";
import type { RenderManifest } from "../../../1_nest_backend/src/studio/render.types";
import {
  computeMedallionItems,
  formatBytes,
  type Data01CatalogResponse,
} from "./studio-v2-adapter";

interface DashboardProps {
  sessionsCount: number;
  session: StudioSession | null;
  jobs: StudioJob[];
  renders: RenderManifest[];
  data01Catalog?: Data01CatalogResponse | null;
  data01Connected?: boolean;
  onNavigateArea: (
    area:
      | "dashboard"
      | "discovery"
      | "data-review"
      | "production-queue"
      | "video-studio"
      | "settings",
  ) => void;
  onNavigateStep: (step: string) => void;
}

export function DashboardWorkspace({
  sessionsCount,
  session,
  jobs,
  renders,
  data01Catalog = null,
  data01Connected = false,
  onNavigateArea,
  onNavigateStep,
}: DashboardProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);

  const medallion = useMemo(
    () => computeMedallionItems(session, data01Catalog, data01Connected),
    [session, data01Catalog, data01Connected],
  );

  const completedRenders = useMemo(
    () => renders.filter((r) => r.status === "COMPLETED"),
    [renders],
  );
  const latestRender = completedRenders[0] || renders[0] || null;
  const runningJobs = useMemo(
    () => jobs.filter((j) => ["QUEUED", "RUNNING"].includes(j.status)),
    [jobs],
  );

  const voicedScenes = useMemo(
    () =>
      medallion.items.filter(
        (i) => i.audioStatus === "DRAFT" || i.audioStatus === "APPROVED",
      ),
    [medallion.items],
  );

  const cleanScriptScenes = useMemo(
    () => medallion.items.filter((i) => i.ambiguities.length === 0),
    [medallion.items],
  );

  const totalDurationSec = useMemo(
    () =>
      medallion.items.reduce((acc, i) => acc + (i.audioDurationSec || 0), 0),
    [medallion.items],
  );

  const maxSceneDuration = useMemo(
    () =>
      Math.max(
        10,
        ...medallion.items.map((i) => i.audioDurationSec || 4),
      ),
    [medallion.items],
  );

  const togglePlayPreview = () => {
    const v = videoRef.current;
    if (!v) return;
    if (v.paused) {
      void v.play();
      setIsPlaying(true);
    } else {
      v.pause();
      setIsPlaying(false);
    }
  };

  const latestVideoUrl =
    session && latestRender && latestRender.status === "COMPLETED"
      ? `/api/studio/sessions/${session.id}/renders/${latestRender.jobId}/video`
      : null;

  const latestDownloadUrl = latestVideoUrl ? `${latestVideoUrl}?download=1` : null;

  return (
    <section
      className="v3-dashboard"
      aria-label="Không gian Tổng quan Sáng tạo & Vận hành"
    >
      {/* ROW 1: 4 CHROMATIC BENTO HERO CARDS (ANSWERING THE 4 CORE QUESTIONS IN 3 SECONDS) */}
      <div className="v3-hero-grid">
        {/* Card 1: Electric Periwinkle — What is the system doing? */}
        <article className="v3-chroma-card v3-card-periwinkle">
          <div className="v3-card-art" aria-hidden="true">
            <svg viewBox="0 0 180 140" fill="none">
              <defs>
                <linearGradient id="prismGrad1" x1="0" y1="0" x2="1" y2="1">
                  <stop offset="0%" stopColor="#ffffff" stopOpacity="0.65" />
                  <stop offset="50%" stopColor="#c4b5fd" stopOpacity="0.35" />
                  <stop offset="100%" stopColor="#4c1d95" stopOpacity="0.2" />
                </linearGradient>
                <linearGradient id="prismGrad2" x1="1" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#fde047" stopOpacity="0.7" />
                  <stop offset="100%" stopColor="#f472b6" stopOpacity="0.25" />
                </linearGradient>
              </defs>
              <circle cx="132" cy="48" r="42" fill="url(#prismGrad1)" />
              <ellipse
                cx="124"
                cy="72"
                rx="52"
                ry="24"
                transform="rotate(-18 124 72)"
                fill="url(#prismGrad2)"
              />
              <rect
                x="88"
                y="22"
                width="56"
                height="56"
                rx="18"
                transform="rotate(14 88 22)"
                fill="rgba(255,255,255,0.28)"
                stroke="rgba(255,255,255,0.5)"
                strokeWidth="1.5"
              />
            </svg>
          </div>
          <div className="v3-chroma-top">
            <span className="v3-prov-pill prov-dark-ink">
              <span className="v3-pulse-dot" /> REAL DATA ·{" "}
              {runningJobs.length > 0 ? "ĐANG XỬ LÝ" : "SẴN SÀNG"}
            </span>
            <span className="v3-card-step-tag">01 · Trạng thái</span>
          </div>
          <h3 className="v3-chroma-title">
            {runningJobs.length > 0
              ? `Đang chạy ${runningJobs.length} tác vụ`
              : "Sẵn sàng dựng & duyệt"}
          </h3>
          <p className="v3-chroma-desc">
            Đã thu thập <strong>{medallion.items.length} bài Threads</strong> và
            tạo sẵn <strong>{voicedScenes.length}/{medallion.items.length} giọng đọc</strong>{" "}
            ({totalDurationSec.toFixed(0)} giây). Hệ thống đang ở chế độ chờ an toàn.
          </p>
          <div className="v3-chroma-footer">
            <button
              className="v3-ink-btn"
              onClick={() => onNavigateArea("video-studio")}
            >
              <span>▶ Mở Bàn dựng 9:16</span>
              <span aria-hidden="true">↗</span>
            </button>
          </div>
        </article>

        {/* Card 2: Sunny Buttercup — What needs my attention right now? (DATA-01 Truth) */}
        <article className="v3-chroma-card v3-card-buttercup">
          <div className="v3-chroma-top">
            <span className="v3-prov-pill prov-dark-ink">
              {data01Connected
                ? `DATA-01 · ${medallion.counts.needsReview} NEEDS REVIEW`
                : "DATA-01 · NOT CONNECTED"}
            </span>
            <span className="v3-card-step-tag">02 · Cần bạn xử lý</span>
          </div>
          <h3 className="v3-chroma-title">
            {medallion.counts.needsReview} bài chờ xác nhận
          </h3>
          <p className="v3-chroma-desc">
            {data01Connected ? (
              <>
                Cả <strong>{medallion.counts.needsReview}/{medallion.counts.total} bài</strong>{" "}
                trong DATA-01 đang ở trạng thái <strong>NEEDS REVIEW</strong>{" "}
                (chưa xác nhận loại bài <em>Post/Comment</em>; 2 bài có từ viết tắt{" "}
                <code>đcđ</code>, <code>clm/cmn</code>).
              </>
            ) : (
              <>
                Chưa kết nối API DATA-01. Có{" "}
                <strong>{medallion.items.length} bài viết</strong> trong phiên cần
                kiểm tra trước khi sản xuất.
              </>
            )}
          </p>
          <div className="v3-avatar-stack-row">
            <div className="v3-avatar-stack" aria-label="Tác giả bài viết">
              {medallion.items.map((item) =>
                item.avatarUrl ? (
                  <img
                    key={item.id}
                    src={item.avatarUrl}
                    alt={item.author}
                    title={`@${item.handle} · ${item.evaluationStatus}`}
                    className="v3-stack-img"
                  />
                ) : (
                  <span
                    key={item.id}
                    className="v3-stack-fallback"
                    title={`@${item.handle}`}
                  >
                    {item.author.slice(0, 1).toUpperCase()}
                  </span>
                ),
              )}
            </div>
            <span className="v3-stack-caption">
              {medallion.counts.qualified} tự động duyệt · {medallion.counts.needsReview} chờ duyệt
            </span>
          </div>
          <div className="v3-chroma-footer">
            <button
              className="v3-ink-btn"
              onClick={() => onNavigateArea("data-review")}
            >
              <span>Duyệt {medallion.counts.needsReview} bài ngay</span>
              <span aria-hidden="true">→</span>
            </button>
          </div>
        </article>

        {/* Card 3: Flamingo Pink — Progress & Next Steps Checklist */}
        <article className="v3-chroma-card v3-card-flamingo">
          <div className="v3-chroma-top">
            <span className="v3-prov-pill prov-dark-ink">
              NEEDS REVIEW · KỊCH BẢN
            </span>
            <span className="v3-card-step-tag">
              Hoàn tất {cleanScriptScenes.length}/{medallion.items.length}
            </span>
          </div>
          <h3 className="v3-chroma-title">Kiểm duyệt Lời đọc</h3>
          <div
            className="v3-striped-progress"
            role="progressbar"
            aria-valuenow={cleanScriptScenes.length}
            aria-valuemin={0}
            aria-valuemax={medallion.items.length || 5}
          >
            <div
              className="v3-striped-fill"
              style={{
                width: `${
                  medallion.items.length
                    ? Math.round(
                        (cleanScriptScenes.length / medallion.items.length) * 100,
                      )
                    : 0
                }%`,
              }}
            />
          </div>
          <ul className="v3-checklist">
            <li className="done">
              <span className="v3-check-box">✓</span>
              <span>Thu thập 5 bài gốc & ảnh đại diện</span>
            </li>
            <li className="done">
              <span className="v3-check-box">✓</span>
              <span>Tạo 5 giọng đọc nháp Kokoro ({totalDurationSec.toFixed(0)}s)</span>
            </li>
            <li className="pending">
              <span className="v3-check-box">!</span>
              <span>Kiểm tra cụm số & từ lóng (5,6 quận, clm)</span>
            </li>
            <li className="pending">
              <span className="v3-check-box">!</span>
              <span>Xác nhận Post/Comment trong DATA-01</span>
            </li>
          </ul>
          <div className="v3-chroma-footer">
            <button
              className="v3-ink-btn"
              onClick={() => onNavigateStep("Script")}
            >
              <span>Rà soát Kịch bản</span>
              <span aria-hidden="true">→</span>
            </button>
          </div>
        </article>

        {/* Card 4: Acid Mint — Completed Draft Videos */}
        <article className="v3-chroma-card v3-card-mint">
          <div className="v3-card-art" aria-hidden="true">
            <svg viewBox="0 0 160 140" fill="none">
              <rect
                x="92"
                y="14"
                width="52"
                height="92"
                rx="12"
                transform="rotate(8 92 14)"
                fill="rgba(16, 24, 20, 0.12)"
                stroke="rgba(16, 24, 20, 0.25)"
                strokeWidth="1.5"
              />
              <circle
                cx="114"
                cy="60"
                r="16"
                fill="rgba(16, 24, 20, 0.16)"
              />
            </svg>
          </div>
          <div className="v3-chroma-top">
            <span className="v3-prov-pill prov-dark-ink">
              REAL DATA · {completedRenders.length} MP4
            </span>
            <span className="v3-card-step-tag">03 · Kết quả</span>
          </div>
          <h3 className="v3-chroma-title">
            {completedRenders.length} Video nháp 9:16
          </h3>
          <p className="v3-chroma-desc">
            {latestRender ? (
              <>
                Bản mới nhất{" "}
                <strong>
                  {latestRender.width}×{latestRender.height} ·{" "}
                  {(latestRender.expectedDurationSeconds || totalDurationSec).toFixed(1)}s
                </strong>{" "}
                ({formatBytes(latestRender.bytes)}) đã sẵn sàng phát thử
                và tải về máy.
              </>
            ) : (
              "Chưa có bản xuất MP4 nào trong phiên này."
            )}
          </p>
          <div className="v3-chroma-footer">
            <button
              className="v3-ink-btn"
              onClick={() => onNavigateArea("production-queue")}
            >
              <span>Kho Video & Hàng đợi</span>
              <span aria-hidden="true">↘</span>
            </button>
          </div>
        </article>
      </div>

      {/* ROW 2: VISUAL BENTO STAGE — LIVE 9:16 VIDEO PLAYER + PIPELINE + REAL SCENE CHART + SOURCE CARDS */}
      <div className="v3-bento-main">
        {/* Left Bento (7 cols): Live 9:16 Video Showcase + Interactive Pipeline + Real Rhythm Chart */}
        <div className="v3-bento-panel v3-showcase-bento">
          <div className="v3-bento-head">
            <div>
              <div className="v3-eyebrow-row">
                <span className="v3-prov-pill prov-real">REAL DATA · MP4</span>
                <span className="v3-subtle-tag">
                  Phiên {session?.id.slice(0, 8)} · {medallion.items.length} cảnh
                </span>
              </div>
              <h2>Xem trước Video 9:16 & Nhịp điệu Cảnh dựng</h2>
            </div>
            <div className="v3-head-actions">
              <button
                className="v3-accent-btn"
                onClick={() => onNavigateArea("video-studio")}
              >
                🎬 Mở Bàn dựng 9:16
              </button>
            </div>
          </div>

          <div className="v3-showcase-split">
            {/* 9:16 Phone Bezel Video Preview */}
            <div className="v3-phone-stage">
              <div className="v3-phone-bezel">
                <div className="v3-phone-notch" aria-hidden="true" />
                {latestVideoUrl ? (
                  <video
                    ref={videoRef}
                    src={latestVideoUrl}
                    className="v3-phone-video"
                    playsInline
                    preload="metadata"
                    controls
                    onPlay={() => setIsPlaying(true)}
                    onPause={() => setIsPlaying(false)}
                  />
                ) : (
                  <div className="v3-phone-empty">
                    <p>Chưa có bản nháp MP4</p>
                    <button onClick={() => onNavigateStep("Render")}>
                      Kết xuất MP4 ngay
                    </button>
                  </div>
                )}
                <div className="v3-phone-overlay-badges">
                  <span>9:16 · 1080×1920</span>
                  <span>{totalDurationSec.toFixed(1)}s</span>
                </div>
              </div>
              <div className="v3-phone-caption-card">
                <button
                  type="button"
                  className="v3-play-pill"
                  onClick={togglePlayPreview}
                >
                  {isPlaying ? "⏸ Tạm dừng xem thử" : "▶ Phát thử Video nháp"}
                </button>
                {latestDownloadUrl && (
                  <a
                    href={latestDownloadUrl}
                    className="v3-download-pill"
                    download
                  >
                    ↓ Tải MP4 ({formatBytes(latestRender?.bytes)})
                  </a>
                )}
                <div className="v3-phone-QuickMeta">
                  <span>H.264 + AAC · 30 FPS</span>
                  <strong>{completedRenders.length} bản nháp đã lưu</strong>
                </div>
              </div>
            </div>

            {/* Right side of Left Bento: Animated Pipeline Steps + Real Scene Chart */}
            <div className="v3-pipeline-and-chart">
              <div className="v3-visual-pipeline" aria-label="Tiến trình sản xuất">
                <button
                  type="button"
                  className="v3-pipe-step is-done"
                  onClick={() => onNavigateArea("discovery")}
                >
                  <div className="v3-pipe-icon">01</div>
                  <div className="v3-pipe-body">
                    <div className="v3-pipe-title-row">
                      <strong>Nguồn bài Threads</strong>
                      <span className="v3-prov-pill prov-real">REAL DATA</span>
                    </div>
                    <p>
                      Đã lưu {medallion.items.length} bài viết gốc &{" "}
                      {medallion.items.filter((i) => i.hasAvatar).length} ảnh đại
                      diện
                    </p>
                  </div>
                </button>

                <button
                  type="button"
                  className="v3-pipe-step is-review"
                  onClick={() => onNavigateArea("data-review")}
                >
                  <div className="v3-pipe-icon">02</div>
                  <div className="v3-pipe-body">
                    <div className="v3-pipe-title-row">
                      <strong>Đánh giá DATA-01 (Bronze → Silver → Gold)</strong>
                      <span
                        className={`v3-prov-pill ${
                          data01Connected ? "prov-review" : "prov-disconnected"
                        }`}
                      >
                        {data01Connected
                          ? `${medallion.counts.needsReview} NEEDS REVIEW`
                          : "NOT CONNECTED"}
                      </span>
                    </div>
                    <p>
                      {data01Connected
                        ? `${medallion.counts.bronzeObservations} Bronze → ${medallion.counts.silverValidated} Silver → ${medallion.counts.goldScored} Gold đã chấm điểm (${medallion.counts.qualified} tự động duyệt)`
                        : "Chưa kết nối API DATA-01"}
                    </p>
                  </div>
                </button>

                <button
                  type="button"
                  className="v3-pipe-step is-done"
                  onClick={() => onNavigateStep("Voice")}
                >
                  <div className="v3-pipe-icon">03</div>
                  <div className="v3-pipe-body">
                    <div className="v3-pipe-title-row">
                      <strong>Giọng đọc Kokoro & Kịch bản</strong>
                      <span className="v3-prov-pill prov-real">
                        {voicedScenes.length}/{medallion.items.length} AUDIO
                      </span>
                    </div>
                    <p>
                      Giọng Mai Linh · {totalDurationSec.toFixed(1)}s tổng thời
                      lượng · {medallion.items.length - cleanScriptScenes.length}{" "}
                      cảnh lưu ý từ lóng/số
                    </p>
                  </div>
                </button>

                <button
                  type="button"
                  className="v3-pipe-step is-done"
                  onClick={() => onNavigateArea("video-studio")}
                >
                  <div className="v3-pipe-icon">04</div>
                  <div className="v3-pipe-body">
                    <div className="v3-pipe-title-row">
                      <strong>Bàn dựng 9:16 & Bản nháp MP4</strong>
                      <span className="v3-prov-pill prov-real">
                        {completedRenders.length} DRAFT MP4
                      </span>
                    </div>
                    <p>
                      Đã ghép nền Minecraft, hiệu ứng âm thanh & thẻ Threads ·
                      Chặn tự động đăng
                    </p>
                  </div>
                </button>
              </div>

              {/* Compact Real Data Chart: Scene Duration & DATA-01 Rule Score */}
              <div className="v3-mini-chart-card">
                <div className="v3-mini-chart-head">
                  <div>
                    <strong>Thời lượng & Điểm quy tắc từng Cảnh</strong>
                    <span>
                      Dữ liệu thật từ 5 cảnh trong phiên (nhấn vào cột để mở cảnh)
                    </span>
                  </div>
                  <div className="v3-chart-legend">
                    <span>
                      <i className="dot-duration" /> Thời lượng (giây)
                    </span>
                    <span>
                      <i className="dot-score" /> Điểm DATA-01
                    </span>
                  </div>
                </div>
                <div className="v3-bars-grid">
                  {medallion.items.map((item) => {
                    const durPct = Math.max(
                      14,
                      Math.round(
                        ((item.audioDurationSec || 4) / maxSceneDuration) * 100,
                      ),
                    );
                    const scorePct = item.ruleScore
                      ? Math.max(14, Math.round(item.ruleScore))
                      : 20;
                    return (
                      <button
                        key={item.id}
                        type="button"
                        className="v3-bar-col"
                        onClick={() => onNavigateArea("video-studio")}
                        title={`Cảnh #${item.itemIndex} (@${item.handle}): ${(item.audioDurationSec || 0).toFixed(1)}s · Điểm quy tắc: ${item.ruleScore ?? "N/A"}`}
                      >
                        <div className="v3-bar-pair">
                          <div
                            className="v3-bar-pill bar-duration"
                            style={{ height: `${durPct}%` }}
                          />
                          <div
                            className={`v3-bar-pill ${
                              item.ambiguities.length > 0
                                ? "bar-score-warn"
                                : "bar-score"
                            }`}
                            style={{ height: `${scorePct}%` }}
                          />
                        </div>
                        <span className="v3-bar-label">
                          #{item.itemIndex} @{item.handle.slice(0, 8)}
                        </span>
                        <small className="v3-bar-meta">
                          {(item.audioDurationSec || 0).toFixed(1)}s ·{" "}
                          {item.ruleScore !== null
                            ? `${item.ruleScore.toFixed(0)}đ`
                            : "—"}
                        </small>
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Right Bento (5 cols): Source Post Cards & Review Queue */}
        <div className="v3-bento-panel v3-posts-bento">
          <div className="v3-bento-head">
            <div>
              <div className="v3-eyebrow-row">
                <span
                  className={`v3-prov-pill ${
                    data01Connected ? "prov-review" : "prov-disconnected"
                  }`}
                >
                  {data01Connected
                    ? `REAL DATA · ${medallion.counts.needsReview} NEEDS REVIEW`
                    : "NOT CONNECTED"}
                </span>
              </div>
              <h2>Bài viết Nguồn & Hàng đợi Duyệt ({medallion.items.length})</h2>
            </div>
            <button
              className="v3-ghost-btn"
              onClick={() => onNavigateArea("data-review")}
            >
              Mở Bảng duyệt →
            </button>
          </div>

          <div className="v3-post-cards-list">
            {medallion.items.map((item, idx) => {
              const toneClass =
                idx % 3 === 0
                  ? "tone-sky"
                  : idx % 3 === 1
                    ? "tone-lavender"
                    : "tone-sand";
              return (
                <article
                  key={item.id}
                  className={`v3-source-post-card ${toneClass}`}
                >
                  <div className="v3-post-card-top">
                    <div className="v3-post-author">
                      {item.avatarUrl ? (
                        <img
                          src={item.avatarUrl}
                          alt={item.author}
                          className="v3-post-avatar"
                        />
                      ) : (
                        <span className="v3-post-avatar-fallback">
                          {item.author.slice(0, 1).toUpperCase()}
                        </span>
                      )}
                      <div>
                        <strong>
                          #{item.itemIndex} · @{item.handle}
                        </strong>
                        <span>
                          {item.topic ? `#${item.topic}` : "Threads Post"} ·{" "}
                          {item.wordCount} từ
                        </span>
                      </div>
                    </div>
                    <span className="v3-post-score-pill">
                      {item.evaluationStatus === "NEEDS_REVIEW"
                        ? "Cần duyệt"
                        : item.evaluationStatus}
                      {item.ruleScore !== null
                        ? ` · ${item.ruleScore.toFixed(1)}đ`
                        : ""}
                    </span>
                  </div>

                  <p className="v3-post-excerpt">
                    “
                    {item.displayText.length > 130
                      ? item.displayText.slice(0, 130) + "…"
                      : item.displayText}
                    ”
                  </p>

                  <div className="v3-post-card-bottom">
                    <div className="v3-post-tags">
                      <span className="v3-tag-chip">
                        🎧{" "}
                        {item.audioDurationSec
                          ? `${item.audioDurationSec.toFixed(1)}s`
                          : "Chưa tạo"}
                      </span>
                      {item.ambiguities.length > 0 ? (
                        <span className="v3-tag-chip chip-warn">
                          ⚠ Lưu ý từ ngữ ({item.ambiguities.length})
                        </span>
                      ) : (
                        <span className="v3-tag-chip">
                          Cần xác nhận Post/Comment
                        </span>
                      )}
                    </div>
                    <div className="v3-post-actions">
                      <button
                        type="button"
                        onClick={() => onNavigateArea("data-review")}
                      >
                        Duyệt bài
                      </button>
                      <button
                        type="button"
                        onClick={() => onNavigateStep("Script")}
                      >
                        Lời đọc
                      </button>
                    </div>
                  </div>
                </article>
              );
            })}
          </div>
        </div>
      </div>

      {/* ROW 3: PROGRESSIVE DISCLOSURE SYSTEM BAR (ZERO CLUTTER BY DEFAULT) */}
      <details className="v3-progressive-drawer">
        <summary>
          <div className="v3-drawer-summary-left">
            <span className="v3-safe-pill">🔒 Chế độ Bản nháp An toàn</span>
            <span>
              Tự động đăng TikTok đang khóa · Giọng đọc Kokoro (5 giọng sẵn sàng) ·{" "}
              {sessionsCount} dự án đã lưu
            </span>
          </div>
          <span className="v3-drawer-toggle-label">
            Xem chi tiết kỹ thuật & Nhật ký hệ thống ({jobs.length} tác vụ) ▾
          </span>
        </summary>
        <div className="v3-drawer-body">
          <div className="v3-tech-grid">
            <div>
              <span>Mã phiên làm việc (Session ID)</span>
              <strong>
                {session?.id || "—"} (Revision {session?.revision ?? 0})
              </strong>
            </div>
            <div>
              <span>Trạng thái DATA-01 Engine</span>
              <strong>
                {data01Connected
                  ? `Đã kết nối (${medallion.counts.bronzeObservations} Bronze / ${medallion.counts.silverValidated} Silver / ${medallion.counts.goldScored} Gold · 0 tự động duyệt)`
                  : "Chưa kết nối (/api/studio/data)"}
              </strong>
            </div>
            <div>
              <span>Động cơ Giọng đọc Cục bộ</span>
              <strong>
                Kokoro TTS · Thiết bị {session?.voiceRuntime?.device || "cpu"} ·
                Tốc độ mặc định 1.20×
              </strong>
            </div>
            <div>
              <span>Chế độ Bảo vệ Phần cứng (Low-RAM)</span>
              <strong>
                Tuần tự 1 tiến trình nặng tại một thời điểm · Không tự chạy ngầm khi
                khởi động
              </strong>
            </div>
          </div>
        </div>
      </details>
    </section>
  );
}
