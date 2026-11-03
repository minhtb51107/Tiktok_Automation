import { useEffect, useState } from "react";
import type {
  StudioItem,
  StudioSession,
} from "../../../1_nest_backend/src/studio/studio.contracts";
import { UrlRows, MetadataEditor, MediaPreview } from "./SourceReview";
import { StageReportPanel } from "./StageReportPanel";
import { ThreadsPreview } from "./ThreadsPreview";
import { TopicEditor } from "./VisualControls";
import {
  fetchThreadsDiscoveryState,
  type ThreadsAuthStatusResponse,
  type ThreadsCollectorRunItem,
  type ThreadsSchedulerStatus,
} from "./studio-v2-adapter";

interface DiscoveryWorkspaceProps {
  session: StudioSession | null;
  busy: boolean;
  dirty: boolean;
  onUpdateSessionTitle: (title: string) => void;
  onSave: () => void;
  onFetchUrls: (
    urls: string[],
    scope: "TARGET_ONLY" | "WITH_CONTEXT",
  ) => Promise<void>;
  onManualImport: (payload: {
    text: string;
    author: string;
    comments: string;
    url: string;
  }) => Promise<void>;
  onAddContextCandidate: (originalUrl: string, index: number) => Promise<void>;
  onRefreshMetadata: (itemId: string) => void;
  onSaveTopic: (itemId: string, body: unknown) => Promise<void>;
  onUpdateItem: (id: string, patch: Partial<StudioItem>) => void;
  onMoveItem: (id: string, direction: number) => void;
  onNavigateArea: (
    area: "dashboard" | "discovery" | "data-review" | "production-queue" | "video-studio" | "settings",
  ) => void;
  onCreateProject: () => void;
  onRefreshData01?: () => Promise<void>;
}

type AcquisitionTab = "URLS_AND_MANUAL" | "KEYWORD_API" | "FUTURE_SCHEDULE";

const SUGGESTED_KEYWORDS = [
  "công việc",
  "tâm sự",
  "fresher",
  "chuyện công sở",
  "thị trường lao động",
  "kỹ năng sống",
  "tài chính cá nhân",
];

const COLLECTOR_STAGE_LABELS: Record<string, string> = {
  AUTH_PREFLIGHT: "Kiểm tra điều kiện xác thực ban đầu",
  VERIFY_TOKEN: "Xác minh chữ ký & quyền Token",
  KEYWORD_SEARCH: "Đang truy vấn từ khóa qua Threads API",
  DATA01_IMPORT: "Đang đưa bài viết vào bộ lọc DATA-01",
  WAITING_MANUAL_REVIEW: "Hoàn tất thu thập · Chờ bạn duyệt bài",
  STOPPED: "Đã dừng an toàn",
};

export function DiscoveryWorkspace({
  session,
  busy,
  dirty,
  onUpdateSessionTitle,
  onSave,
  onFetchUrls,
  onManualImport,
  onAddContextCandidate,
  onRefreshMetadata,
  onSaveTopic,
  onUpdateItem,
  onMoveItem,
  onNavigateArea,
  onCreateProject,
  onRefreshData01,
}: DiscoveryWorkspaceProps) {
  const [activeTab, setActiveTab] =
    useState<AcquisitionTab>("URLS_AND_MANUAL");
  const [focusItemId, setFocusItemId] = useState<string>("ALL");

  // Manual import state
  const [manualOpen, setManualOpen] = useState(false);
  const [manualUrl, setManualUrl] = useState("");
  const [manualAuthor, setManualAuthor] = useState("");
  const [manualText, setManualText] = useState("");
  const [manualComments, setManualComments] = useState("");

  // Official Threads API (DATA-02) state
  const [authStatus, setAuthStatus] =
    useState<ThreadsAuthStatusResponse | null>(null);
  const [collectorRuns, setCollectorRuns] = useState<
    ThreadsCollectorRunItem[]
  >([]);
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
  const [scheduler, setScheduler] = useState<ThreadsSchedulerStatus | null>(
    null,
  );
  const [apiBusy, setApiBusy] = useState(false);
  const [apiMessage, setApiMessage] = useState("");
  const [apiError, setApiError] = useState("");

  // Keyword builder state (supports organizing multiple keywords & active pilot pair)
  const [keywords, setKeywords] = useState<string[]>(["công việc", "tâm sự"]);
  const [keywordDraft, setKeywordDraft] = useState("");
  const [searchType, setSearchType] = useState<"RECENT" | "TOP">("RECENT");
  const [perKeyword, setPerKeyword] = useState<number>(5);
  const [maxRequests, setMaxRequests] = useState<number>(8);
  const [maxRunSeconds, setMaxRunSeconds] = useState<number>(120);

  // Scheduler form state (backend enforces minimum 6 hours = 21600000 ms, maximum 7 days = 604800000 ms)
  const [schedIntervalHours, setSchedIntervalHours] = useState<number>(6);
  const [schedMinInventory, setSchedMinInventory] = useState<number>(10);
  const [schedBacklogLimit, setSchedBacklogLimit] = useState<number>(20);

  const loadThreadsApiState = async () => {
    const res = await fetchThreadsDiscoveryState();
    setAuthStatus(res.auth);
    setCollectorRuns(res.runs);
    if (res.runs.length > 0 && !selectedRunId) {
      setSelectedRunId(res.runs[0].id);
    }
    if (res.scheduler) {
      setScheduler(res.scheduler);
      if (res.scheduler.keywords?.length) {
        setKeywords(res.scheduler.keywords);
      }
      setSearchType(res.scheduler.searchType || "RECENT");
      setPerKeyword(res.scheduler.perKeyword || 5);
      if (res.scheduler.maxRequests) {
        setMaxRequests(Math.min(12, Math.max(1, res.scheduler.maxRequests)));
      }
      if (res.scheduler.maxRunMs) {
        setMaxRunSeconds(
          Math.min(180, Math.max(10, Math.round(res.scheduler.maxRunMs / 1000))),
        );
      }
      setSchedIntervalHours(
        Math.min(
          168,
          Math.max(6, Math.round((res.scheduler.intervalMs || 21600000) / 3600000)),
        ),
      );
      setSchedMinInventory(res.scheduler.minimumInventory || 10);
      setSchedBacklogLimit(res.scheduler.reviewBacklogLimit || 20);
    }
  };

  useEffect(() => {
    void loadThreadsApiState();
  }, []);

  const addKeyword = (kw: string) => {
    const clean = kw.trim().replace(/^#/, "");
    if (!clean) return;
    if (keywords.includes(clean)) {
      setKeywordDraft("");
      return;
    }
    setKeywords((prev) => [...prev, clean]);
    setKeywordDraft("");
  };

  const removeKeyword = (kw: string) => {
    setKeywords((prev) => prev.filter((item) => item !== kw));
  };

  const handleVerifyAuth = async () => {
    setApiBusy(true);
    setApiError("");
    setApiMessage("");
    try {
      const res = await fetch("/api/studio/threads/auth/verify", {
        method: "POST",
      });
      const json = await res.json();
      if (!res.ok) {
        throw new Error(
          json.error?.message || json.message || "Không thể kiểm tra kết nối API",
        );
      }
      const data = (json.data ?? json) as ThreadsAuthStatusResponse;
      setAuthStatus(data);
      if (data.status === "READY") {
        setApiMessage("Kết nối Threads API hợp lệ và sẵn sàng thu thập!");
      } else {
        setApiMessage(
          `Trạng thái xác thực hiện tại: ${data.status} — ${data.reason}`,
        );
      }
    } catch (err) {
      setApiError((err as Error).message);
    } finally {
      setApiBusy(false);
    }
  };

  const handleStartCollectorRun = async () => {
    setApiBusy(true);
    setApiError("");
    setApiMessage("");
    try {
      const pilotKeywords = Array.from(
        new Set(keywords.map((k) => k.trim()).filter(Boolean)),
      ).slice(0, 2);
      if (pilotKeywords.length < 1) {
        throw new Error("Vui lòng chọn ít nhất 1 từ khóa để bắt đầu thu thập.");
      }
      const requestId = `pilot-${Date.now()}`;
      const body = {
        keywords: pilotKeywords,
        searchType,
        perKeyword: Math.min(5, Math.max(1, Math.round(perKeyword))),
        maxRequests: Math.min(12, Math.max(1, Math.round(maxRequests))),
        maxRunMs: Math.min(180000, Math.max(1000, Math.round(maxRunSeconds * 1000))),
        requestId,
      };
      const res = await fetch("/api/studio/threads/collector/runs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = await res.json();
      if (!res.ok) {
        throw new Error(
          json.error?.message ||
            json.message ||
            "Không thể khởi chạy bộ thu thập Threads",
        );
      }
      const run = (json.data ?? json) as ThreadsCollectorRunItem;
      setCollectorRuns((prev) => [
        run,
        ...prev.filter((existing) => existing.id !== run.id),
      ]);
      setSelectedRunId(run.id);
      if (run.status === "COMPLETED") {
        setApiMessage(
          `Đã hoàn tất lượt thu thập #${run.id.slice(0, 8)}: lấy được ${run.returned} bài, đưa vào DATA-01 ${run.imported} bài (${run.newPosts} bài mới).`,
        );
      } else {
        setApiMessage(
          `Lượt thu thập #${run.id.slice(0, 8)} dừng ở trạng thái ${run.status} (${run.stage}).`,
        );
      }
      if (onRefreshData01) {
        await onRefreshData01();
      }
      await loadThreadsApiState();
    } catch (err) {
      setApiError((err as Error).message);
    } finally {
      setApiBusy(false);
    }
  };

  const handleResumeCollectorRun = async (runId: string) => {
    setApiBusy(true);
    setApiError("");
    setApiMessage("");
    try {
      const res = await fetch(
        `/api/studio/threads/collector/runs/${runId}/resume`,
        {
          method: "POST",
        },
      );
      const json = await res.json();
      if (!res.ok) {
        throw new Error(
          json.error?.message ||
            json.message ||
            "Không thể tiếp tục phiên thu thập",
        );
      }
      const run = (json.data ?? json) as ThreadsCollectorRunItem;
      setCollectorRuns((prev) => [
        run,
        ...prev.filter((existing) => existing.id !== run.id),
      ]);
      setSelectedRunId(run.id);
      setApiMessage(
        `Đã tiếp tục phiên #${run.id.slice(0, 8)} → Trạng thái: ${run.status} (${run.imported}/${run.returned} bài đã nạp).`,
      );
      if (onRefreshData01) {
        await onRefreshData01();
      }
      await loadThreadsApiState();
    } catch (err) {
      setApiError((err as Error).message);
    } finally {
      setApiBusy(false);
    }
  };

  const handleSaveScheduler = async () => {
    setApiBusy(true);
    setApiError("");
    setApiMessage("");
    try {
      const pilotKeywords = Array.from(
        new Set(keywords.map((k) => k.trim()).filter(Boolean)),
      ).slice(0, 2);
      if (pilotKeywords.length === 0) {
        throw new Error("Vui lòng chọn ít nhất 1 từ khóa cho lịch thu thập.");
      }
      const clampedHours = Math.min(168, Math.max(6, Math.round(schedIntervalHours)));
      const res = await fetch("/api/studio/threads/scheduler/configure", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          keywords: pilotKeywords,
          searchType,
          perKeyword: Math.min(5, Math.max(1, Math.round(perKeyword))),
          maxRequests: Math.min(12, Math.max(1, Math.round(maxRequests))),
          maxRunMs: Math.min(180000, Math.max(1000, Math.round(maxRunSeconds * 1000))),
          intervalMs: clampedHours * 3600000,
          minimumInventory: Math.min(1000, Math.max(1, Math.round(schedMinInventory))),
          reviewBacklogLimit: Math.min(1000, Math.max(1, Math.round(schedBacklogLimit))),
        }),
      });
      const json = await res.json();
      if (!res.ok) {
        throw new Error(
          json.error?.message || json.message || "Không thể lưu cấu hình lịch",
        );
      }
      setScheduler(json.data ?? json);
      setApiMessage(
        `Đã lưu cấu hình lịch thu thập định kỳ mỗi ${clampedHours} giờ vào DATA-02 (chế độ an toàn: không tự động chạy ngầm khi chưa mở khóa OAuth).`,
      );
    } catch (err) {
      setApiError((err as Error).message);
    } finally {
      setApiBusy(false);
    }
  };

  const handleSchedulerAction = async (
    endpoint: "pause" | "resume" | "acknowledge-block",
  ) => {
    setApiBusy(true);
    setApiError("");
    setApiMessage("");
    try {
      const res = await fetch(`/api/studio/threads/scheduler/${endpoint}`, {
        method: "POST",
      });
      const json = await res.json();
      if (!res.ok) {
        throw new Error(
          json.error?.message || json.message || "Không thể cập nhật trạng thái lịch",
        );
      }
      setScheduler(json.data ?? json);
      setApiMessage(
        endpoint === "pause"
          ? "Đã tạm dừng lịch thu thập tự động."
          : endpoint === "resume"
            ? "Đã bỏ tạm dừng lịch thu thập."
            : "Đã xác nhận gỡ trạng thái khóa lịch thu thập.",
      );
    } catch (err) {
      setApiError((err as Error).message);
    } finally {
      setApiBusy(false);
    }
  };

  if (!session) {
    return (
      <section className="v2-workspace s2-discovery-workspace">
        <div className="s2-empty-hero">
          <span className="hero-icon">✦</span>
          <h2>Bắt đầu câu chuyện mới từ Threads</h2>
          <p>
            Tạo một dự án mới để thu thập bài viết từ liên kết hoặc từ khóa,
            kiểm duyệt dữ liệu và dựng thành video 9:16.
          </p>
          <button
            type="button"
            className="s2-btn-primary"
            disabled={busy}
            onClick={onCreateProject}
          >
            ＋ Tạo dự án Threads mới
          </button>
        </div>
      </section>
    );
  }

  const visibleSourceItems = (session.items || []).filter(
    (i) =>
      (focusItemId === "ALL" || i.id === focusItemId) &&
      (i.inclusion === "EXPLICIT_CONTEXT" ||
        i.inclusion === "MANUAL" ||
        !session.attempts?.length ||
        session.attempts.some(
          (a) => !!a.matchedTargetId && a.canonicalUrl === i.sourceUrl,
        )),
  );

  const isAuthReady = authStatus?.status === "READY";

  return (
    <section
      className="v2-workspace s2-discovery-workspace"
      aria-label="Khám phá và thu thập nguồn bài Threads"
      data-testid="discovery-workspace"
    >
      {/* Hero Header with 3-Step Visual Guide & Primary Action */}
      <div className="s2-hero-banner s2-hero-discovery">
        <div className="s2-hero-copy">
          <div className="v3-eyebrow-row">
            <span className="v3-prov-pill prov-real">
              ● {session.items.length} BÀI ĐÃ THU THẬP
            </span>
            <span
              className={`v3-prov-pill ${isAuthReady ? "prov-real" : "prov-review"}`}
            >
              {isAuthReady
                ? "● THREADS API: ĐÃ KẾT NỐI"
                : "🔒 THREADS API: CHỜ CẤP QUYỀN OAUTH"}
            </span>
          </div>
          <h2>Khám phá & Thu thập Nguồn bài Threads</h2>
          <p>
            Thêm bài viết từ liên kết công khai, nhập nội dung trực tiếp hoặc
            cấu hình bộ thu thập theo từ khóa. Mọi bài viết mới đều đi qua bước{" "}
            <strong>Duyệt dữ liệu</strong> trước khi sản xuất video.
          </p>

          <div className="s2-step-guide-strip" aria-label="Quy trình 3 bước">
            <span className="s2-guide-pill active">
              <b>1</b> Chọn nguồn (Link / Từ khóa)
            </span>
            <span className="s2-guide-arrow">→</span>
            <span className="s2-guide-pill">
              <b>2</b> Tải bài gốc & giữ nguyên bản
            </span>
            <span className="s2-guide-arrow">→</span>
            <span className="s2-guide-pill">
              <b>3</b> Duyệt bài đưa vào dựng video
            </span>
          </div>
        </div>

        <div className="s2-hero-visual-right">
          <div className="s2-hero-3d-art" aria-hidden="true">
            <svg viewBox="0 0 96 80" fill="none">
              <circle cx="42" cy="40" r="26" fill="#8fa0ff" />
              <circle cx="42" cy="40" r="16" fill="#12131a" />
              <circle cx="42" cy="40" r="7" fill="#fce068" />
              <rect
                x="60"
                y="52"
                width="24"
                height="10"
                rx="5"
                transform="rotate(38 60 52)"
                fill="#ff8ad8"
              />
              <circle cx="72" cy="20" r="8" fill="#7ce8c8" />
            </svg>
          </div>
          <div className="s2-hero-actions">
            <button
              type="button"
              className="s2-btn-secondary"
              disabled={busy}
              onClick={onSave}
            >
              {dirty ? "💾 Lưu thay đổi dự án" : "✓ Đã lưu dự án"}
            </button>
            <button
              type="button"
              className="s2-btn-primary"
              onClick={() => onNavigateArea("data-review")}
              data-testid="discovery-go-review-btn"
            >
              Duyệt {session.items.length} bài đã thu thập →
            </button>
          </div>
        </div>
      </div>

      {apiError && (
        <div className="alert error" role="alert">
          {apiError}
        </div>
      )}
      {apiMessage && (
        <div className="s2-toast-notice" role="status">
          <span>ℹ {apiMessage}</span>
          <button
            type="button"
            className="s2-toast-close"
            onClick={() => setApiMessage("")}
          >
            Đóng
          </button>
        </div>
      )}

      {/* Mode Switcher Tabs: 1. Link & Manual | 2. Keyword Collector (DATA-02) | 3. Future Schedule */}
      <div
        className="s2-mode-tabs"
        role="tablist"
        aria-label="Phương thức thu thập nguồn bài"
      >
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === "URLS_AND_MANUAL"}
          className={`s2-mode-tab ${activeTab === "URLS_AND_MANUAL" ? "active" : ""}`}
          onClick={() => setActiveTab("URLS_AND_MANUAL")}
          data-testid="discovery-tab-urls"
        >
          <span className="s2-mode-icon">🔗</span>
          <div>
            <strong>Thêm từ Liên kết hoặc Dán bài</strong>
            <small>Hoạt động ngay · Tối đa 5 URL mỗi lượt</small>
          </div>
          <span className="s2-mode-pill pill-ready">Sẵn sàng</span>
        </button>

        <button
          type="button"
          role="tab"
          aria-selected={activeTab === "KEYWORD_API"}
          className={`s2-mode-tab ${activeTab === "KEYWORD_API" ? "active" : ""}`}
          onClick={() => setActiveTab("KEYWORD_API")}
          data-testid="discovery-tab-keywords"
        >
          <span className="s2-mode-icon">🔍</span>
          <div>
            <strong>Tìm theo Từ khóa & Chủ đề</strong>
            <small>Threads Official API · Đa nguồn từ khóa</small>
          </div>
          <span
            className={`s2-mode-pill ${isAuthReady ? "pill-ready" : "pill-gate"}`}
          >
            {isAuthReady ? "Đã kết nối" : "Chờ cấp quyền"}
          </span>
        </button>

        <button
          type="button"
          role="tab"
          aria-selected={activeTab === "FUTURE_SCHEDULE"}
          className={`s2-mode-tab ${activeTab === "FUTURE_SCHEDULE" ? "active" : ""}`}
          onClick={() => setActiveTab("FUTURE_SCHEDULE")}
          data-testid="discovery-tab-schedule"
        >
          <span className="s2-mode-icon">🗓</span>
          <div>
            <strong>Lịch Thu thập Tự động</strong>
            <small>Cấu hình định kỳ & ngưỡng tồn kho</small>
          </div>
          <span className="s2-mode-pill pill-neutral">
            {scheduler?.enabled && !scheduler?.paused ? "Đang bật" : "Đang tạm dừng"}
          </span>
        </button>
      </div>

      {/* TAB 1: Direct URLs & Manual Input (100% Preserved Studio Session Capabilities) */}
      {activeTab === "URLS_AND_MANUAL" && (
        <div className="s2-discovery-bento">
          <div className="s2-bento-card s2-url-card">
            <div className="s2-card-head">
              <div>
                <span className="s2-eyebrow-tag">PHƯƠNG THỨC CHÍNH</span>
                <h3>Dán Liên kết Bài viết Threads</h3>
                <p>
                  Nhập tối đa 5 liên kết bài đăng hoặc link chia sẻ công khai.
                  Hệ thống sẽ tải tuần tự nội dung gốc, tên tác giả và ảnh đại
                  diện.
                </p>
              </div>
              <span className="v3-prov-pill prov-real">HOẠT ĐỘNG NGAY</span>
            </div>

            <UrlRows
              key={session.id}
              session={session}
              disabled={busy || dirty}
              onFetch={onFetchUrls}
            />

            <div className="s2-url-helper-foot">
              <small>
                {dirty
                  ? "⚠ Bạn có thay đổi chưa lưu. Hãy nhấn 'Lưu thay đổi dự án' trước khi tải bài mới."
                  : "💡 Hệ thống chỉ tải bài khi bạn chủ động nhấn nút Fetch."}
              </small>
            </div>
          </div>

          <div className="s2-bento-card s2-side-config-card">
            <div className="s2-card-head">
              <div>
                <span className="s2-eyebrow-tag">THÔNG TIN DỰ ÁN & NHẬP TAY</span>
                <h3>Tên Dự án & Dán Nội dung Thủ công</h3>
              </div>
            </div>

            <label className="s2-field-label">
              Tên dự án sản xuất
              <input
                maxLength={150}
                value={session.title}
                onChange={(e) => onUpdateSessionTitle(e.target.value)}
                placeholder="Nhập tên dự án dễ nhớ..."
              />
            </label>

            <div className="s2-manual-box">
              <div className="s2-manual-head">
                <div>
                  <strong>Chưa có link? Dán văn bản trực tiếp</strong>
                  <p>
                    Dùng khi bạn muốn tự biên tập một bài viết hoặc bình luận có
                    sẵn.
                  </p>
                </div>
                <button
                  type="button"
                  className="s2-btn-secondary"
                  onClick={() => setManualOpen((v) => !v)}
                >
                  {manualOpen ? "Thu gọn" : "＋ Dán bài thủ công"}
                </button>
              </div>

              {manualOpen && (
                <div className="s2-manual-form">
                  <label>
                    Liên kết bài gốc (không bắt buộc)
                    <input
                      value={manualUrl}
                      onChange={(e) => setManualUrl(e.target.value)}
                      placeholder="https://www.threads.com/..."
                    />
                  </label>
                  <label>
                    Tên tác giả / @handle
                    <input
                      value={manualAuthor}
                      onChange={(e) => setManualAuthor(e.target.value)}
                      placeholder="Ví dụ: nguyenvana"
                    />
                  </label>
                  <label>
                    Nội dung bài viết gốc
                    <textarea
                      rows={3}
                      value={manualText}
                      onChange={(e) => setManualText(e.target.value)}
                      placeholder="Dán nội dung bài đăng..."
                    />
                  </label>
                  <label>
                    Bình luận đi kèm (nếu có)
                    <textarea
                      rows={2}
                      value={manualComments}
                      onChange={(e) => setManualComments(e.target.value)}
                      placeholder="Mỗi dòng một bình luận..."
                    />
                  </label>
                  <button
                    type="button"
                    className="s2-btn-primary"
                    disabled={busy || dirty || !manualText.trim()}
                    onClick={() =>
                      void onManualImport({
                        text: manualText,
                        author: manualAuthor,
                        comments: manualComments,
                        url: manualUrl,
                      }).then(() => {
                        setManualText("");
                        setManualComments("");
                        setManualOpen(false);
                      })
                    }
                  >
                    Thêm bài viết vào dự án
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* TAB 2: Official Threads Keyword Collector (DATA-02 Truth, No Fake Crawler) */}
      {activeTab === "KEYWORD_API" && (
        <div
          className="s2-discovery-bento"
          data-testid="discovery-keyword-panel"
        >
          {/* Left: Multi-Keyword & Topic Builder */}
          <div className="s2-bento-card s2-keyword-builder-card">
            <div className="s2-card-head">
              <div>
                <span className="s2-eyebrow-tag">
                  BỘ THU THẬP TỪ KHÓA CHÍNH THỨC (DATA-02)
                </span>
                <h3>Thiết lập Từ khóa & Nguồn Chủ đề</h3>
                <p>
                  Tổ chức danh sách từ khóa để tìm bài viết công khai qua
                  Threads Official API. Không cào dữ liệu trái phép, không tự
                  động chạy ngầm.
                </p>
              </div>
              <span className="v3-prov-pill prov-review">
                TỐI ĐA 2 TỪ KHÓA / LƯỢT PILOT
              </span>
            </div>

            {/* Active Keyword Chips */}
            <div className="s2-keyword-section">
              <label className="s2-field-label">
                Danh sách từ khóa đang chọn ({keywords.length})
              </label>
              <div className="s2-keyword-chips">
                {keywords.map((kw, index) => (
                  <span
                    key={kw}
                    className={`s2-kw-chip ${index < 2 ? "is-pilot-active" : ""}`}
                  >
                    <b>#{kw}</b>
                    {index < 2 && <small>Lượt chạy tiếp theo</small>}
                    <button
                      type="button"
                      onClick={() => removeKeyword(kw)}
                      aria-label={`Xóa từ khóa ${kw}`}
                    >
                      ×
                    </button>
                  </span>
                ))}
              </div>

              <div className="s2-kw-input-row">
                <input
                  type="text"
                  value={keywordDraft}
                  onChange={(e) => setKeywordDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      addKeyword(keywordDraft);
                    }
                  }}
                  placeholder="Nhập từ khóa mới (ví dụ: áp lực đồng trang lứa)..."
                  aria-label="Thêm từ khóa mới"
                />
                <button
                  type="button"
                  className="s2-btn-secondary"
                  onClick={() => addKeyword(keywordDraft)}
                >
                  ＋ Thêm từ khóa
                </button>
              </div>

              <div className="s2-kw-suggestions">
                <span>Gợi ý chủ đề Serious:</span>
                {SUGGESTED_KEYWORDS.map((sug) => (
                  <button
                    key={sug}
                    type="button"
                    className="s2-sug-pill"
                    onClick={() => addKeyword(sug)}
                  >
                    + #{sug}
                  </button>
                ))}
              </div>
            </div>

            {/* Search Parameters */}
            <div className="s2-kw-params-grid">
              <div className="s2-param-box">
                <span>Chế độ sắp xếp kết quả</span>
                <div className="s2-type-Segmented">
                  <button
                    type="button"
                    className={searchType === "RECENT" ? "active" : ""}
                    onClick={() => setSearchType("RECENT")}
                  >
                    🕒 Mới nhất (RECENT)
                  </button>
                  <button
                    type="button"
                    className={searchType === "TOP" ? "active" : ""}
                    onClick={() => setSearchType("TOP")}
                  >
                    🔥 Nổi bật (TOP)
                  </button>
                </div>
              </div>

              <div className="s2-param-box">
                <span>Số bài mỗi từ khóa (1–5 bài)</span>
                <div className="s2-type-Segmented">
                  {[1, 3, 5].map((n) => (
                    <button
                      key={n}
                      type="button"
                      className={perKeyword === n ? "active" : ""}
                      onClick={() => setPerKeyword(n)}
                    >
                      {n} bài / từ khóa
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {/* Honest Action Footer: Connected to POST /api/studio/threads/collector/runs */}
            <div className="s2-collector-action-box">
              <div>
                <strong>
                  {isAuthReady
                    ? "Sẵn sàng chạy thu thập từ khóa (POST /api/studio/threads/collector/runs)"
                    : "🔒 Chưa thể bắt đầu quét tự động (API chưa kết nối OAuth)"}
                </strong>
                <p>
                  {isAuthReady
                    ? `Sẽ tìm tối đa ${perKeyword} bài cho mỗi từ khóa (${keywords.slice(0, 2).join(", ")}) · Giới hạn ${maxRequests} request / ${maxRunSeconds}s.`
                    : "Hệ thống trung thực: không giả lập dữ liệu crawler khi chưa xác thực tài khoản Meta Threads."}
                </p>
              </div>
              <button
                type="button"
                className="s2-btn-primary"
                disabled={!isAuthReady || apiBusy || keywords.length === 0}
                onClick={() => void handleStartCollectorRun()}
                data-testid="discovery-start-collector-btn"
                title={
                  isAuthReady
                    ? "Gọi POST /api/studio/threads/collector/runs"
                    : "Cần hoàn tất kết nối OAuth ở khung bên phải trước"
                }
              >
                {apiBusy
                  ? "⏳ Đang thu thập từ khóa..."
                  : isAuthReady
                    ? "🚀 Bắt đầu thu thập ngay"
                    : "🔒 Cần kết nối API để thu thập"}
              </button>
            </div>
          </div>

          {/* Right: Clear API Connection, OAuth Vault vs .env Token Distinction & Permission Card */}
          <div
            className="s2-bento-card s2-auth-status-card"
            data-testid="threads-auth-status-card"
          >
            <div className="s2-card-head">
              <div>
                <span className="s2-eyebrow-tag">
                  TRẠNG THÁI KẾT NỐI & QUYỀN TRUY CẬP
                </span>
                <h3>Chẩn đoán Threads API (DATA-02)</h3>
              </div>
              <span
                className={`s2-status-badge ${
                  isAuthReady ? "badge-qualified" : "badge-review"
                }`}
                data-testid="threads-auth-status-badge"
              >
                {authStatus?.status || "BLOCKED_AUTH"}
              </span>
            </div>

            <div className="s2-auth-reason-callout">
              <strong>
                {isAuthReady
                  ? "✓ Tài khoản đã được cấp quyền hợp lệ"
                  : "⚠ Chưa xác thực User Access Token cho ứng dụng Threads"}
              </strong>
              <p>
                {authStatus?.reason ||
                  "Cần cấu hình App ID, App Secret, HTTPS Callback URI và xác thực Token (qua OAuth Vault hoặc biến môi trường) trước khi tìm kiếm theo từ khóa."}
              </p>
            </div>

            {/* 1. App Credentials in .env (Distinct from User Token) */}
            <div className="s2-checklist-group">
              <span className="s2-sub-heading">
                1. Cấu hình Ứng dụng Meta (`1_nest_backend/.env`)
              </span>
              <div className="s2-env-grid">
                {(
                  [
                    {
                      key: "THREADS_APP_ID",
                      label: "THREADS_APP_ID",
                      ok: Boolean(authStatus?.config?.present?.THREADS_APP_ID),
                      detail: authStatus?.config?.present?.THREADS_APP_ID
                        ? "Đã cấu hình"
                        : "Chưa cấu hình",
                    },
                    {
                      key: "THREADS_APP_SECRET",
                      label: "THREADS_APP_SECRET",
                      ok: Boolean(
                        authStatus?.config?.present?.THREADS_APP_SECRET,
                      ),
                      detail: authStatus?.config?.present?.THREADS_APP_SECRET
                        ? "Đã cấu hình"
                        : "Chưa cấu hình",
                    },
                    {
                      key: "THREADS_REDIRECT_URI",
                      label: "THREADS_REDIRECT_URI",
                      ok: Boolean(
                        authStatus?.config?.present?.THREADS_REDIRECT_URI &&
                          authStatus?.config?.redirectValid,
                      ),
                      detail: !authStatus?.config?.present?.THREADS_REDIRECT_URI
                        ? "Chưa cấu hình"
                        : authStatus?.config?.redirectValid
                          ? "HTTPS Callback hợp lệ"
                          : "Cần domain HTTPS hợp lệ",
                    },
                  ] as const
                ).map((item) => (
                  <div
                    key={item.key}
                    className={`s2-env-pill ${item.ok ? "is-ok" : "is-missing"}`}
                    data-testid={`env-pill-${item.key}`}
                  >
                    <span>{item.ok ? "✓" : "○"}</span>
                    <div>
                      <strong>{item.label}</strong>
                      <small>{item.detail}</small>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* 2. Explicit Distinction: OAuth Vault Token vs .env THREADS_ACCESS_TOKEN */}
            <div
              className="s2-checklist-group"
              data-testid="threads-token-source-box"
            >
              <span className="s2-sub-heading">
                2. Nguồn User Access Token (Chọn 1 trong 2 cơ chế)
              </span>
              <div className="s2-env-grid">
                {(() => {
                  const usingVault = authStatus?.tokenSource === "OAUTH_VAULT";
                  const hasEnvToken = Boolean(
                    authStatus?.config?.present?.THREADS_ACCESS_TOKEN,
                  );
                  const usingEnv =
                    authStatus?.tokenSource === "ENV" || hasEnvToken;
                  return (
                    <>
                      <div
                        className={`s2-env-pill ${usingVault ? "is-ok" : "is-neutral"}`}
                        data-testid="token-source-oauth-vault"
                      >
                        <span>{usingVault ? "✓" : "🔐"}</span>
                        <div>
                          <strong>OAuth Vault cục bộ (Khuyên dùng)</strong>
                          <small>
                            {usingVault
                              ? "Đang sử dụng Token mã hóa trong OAuth Vault"
                              : hasEnvToken
                                ? "Đang tạm tắt vì có THREADS_ACCESS_TOKEN trong .env"
                                : "Lưu tự động sau khi đăng nhập OAuth (/oauth/login)"}
                          </small>
                        </div>
                      </div>

                      <div
                        className={`s2-env-pill ${
                          usingEnv || usingVault ? "is-ok" : "is-neutral"
                        }`}
                        data-testid="token-source-env-var"
                      >
                        <span>{hasEnvToken || usingVault ? "✓" : "⚙"}</span>
                        <div>
                          <strong>Biến THREADS_ACCESS_TOKEN (.env)</strong>
                          <small>
                            {hasEnvToken
                              ? authStatus?.tokenSource === "ENV"
                                ? "Đang dùng Token từ .env (Đã xác thực)"
                                : "Đã khai báo trong .env (Chờ verify)"
                              : usingVault
                                ? "Để trống hợp lệ (Đang dùng OAuth Vault)"
                                : "Tùy chọn: để trống nếu dùng OAuth Vault"}
                          </small>
                        </div>
                      </div>
                    </>
                  );
                })()}
              </div>
            </div>

            {/* 3. Required OAuth Scopes */}
            <div className="s2-checklist-group">
              <span className="s2-sub-heading">
                3. Quyền OAuth bắt buộc từ Meta Threads
              </span>
              <div className="s2-scope-list">
                {(
                  authStatus?.config?.requestedScopes || [
                    "threads_basic",
                    "threads_keyword_search",
                  ]
                ).map((sc) => {
                  const granted = authStatus?.scopes?.includes(sc);
                  return (
                    <span
                      key={sc}
                      className={`s2-scope-chip ${granted ? "is-granted" : ""}`}
                    >
                      {granted ? "✓" : "🔒"} {sc}
                    </span>
                  );
                })}
              </div>
            </div>

            <div className="s2-auth-card-foot">
              <small>
                Nguồn token hiện tại:{" "}
                <b>
                  {authStatus?.tokenSource === "OAUTH_VAULT"
                    ? "OAuth Vault cục bộ"
                    : authStatus?.tokenSource === "ENV"
                      ? "Biến môi trường (.env)"
                      : authStatus?.config?.present?.THREADS_ACCESS_TOKEN
                        ? "Biến .env (Chưa verify)"
                        : "Chưa nạp token"}
                </b>
              </small>
              <button
                type="button"
                className="s2-btn-secondary"
                disabled={apiBusy}
                onClick={() => void handleVerifyAuth()}
                data-testid="threads-verify-auth-btn"
              >
                {apiBusy ? "Đang kiểm tra..." : "↻ Kiểm tra lại kết nối API"}
              </button>
            </div>
          </div>

          {/* Full-Width Collector Run Status, Progress, Counts, Errors & History Panel */}
          <div
            className="s2-bento-card s2-collector-runs-card"
            style={{ gridColumn: "1 / -1" }}
            data-testid="collector-runs-panel"
          >
            <div className="s2-card-head">
              <div>
                <span className="s2-eyebrow-tag">
                  TIẾN TRÌNH & LỊCH SỬ BỘ THU THẬP (GET /api/studio/threads/collector/runs)
                </span>
                <h3>
                  Trạng thái Chạy, Số bài Thu thập & Nhật ký Lỗi ({collectorRuns.length}{" "}
                  lượt)
                </h3>
                <p>
                  Dữ liệu trực tiếp từ API <code>/api/studio/threads/collector/runs</code>.
                  Hiển thị tiến độ từng từ khóa, số bài lấy được, số bài đưa vào{" "}
                  <code>DATA-01</code> và cho phép tiếp tục (Resume) khi gián đoạn.
                </p>
              </div>
              <button
                type="button"
                className="s2-btn-secondary"
                disabled={apiBusy}
                onClick={() => void loadThreadsApiState()}
              >
                ↻ Làm mới lịch sử Collector
              </button>
            </div>

            {collectorRuns.length === 0 ? (
              <div
                className="s2-empty-card"
                data-testid="collector-runs-empty"
              >
                <p>
                  Chưa có lượt chạy bộ thu thập từ khóa nào được ghi nhận trong{" "}
                  <code>.studio-data/threads-api/runs</code>. Khi kết nối OAuth{" "}
                  <strong>READY</strong> và nhấn{" "}
                  <strong>🚀 Bắt đầu thu thập ngay</strong>, tiến trình và kết quả
                  sẽ hiển thị tại đây.
                </p>
              </div>
            ) : (
              (() => {
                const activeRun =
                  collectorRuns.find((r) => r.id === selectedRunId) ||
                  collectorRuns[0];
                const totalTarget =
                  (activeRun.input?.keywords?.length || 1) *
                  (activeRun.input?.perKeyword || 5);
                const progressPct =
                  activeRun.status === "COMPLETED"
                    ? 100
                    : Math.min(
                        95,
                        Math.max(
                          10,
                          Math.round(
                            (activeRun.returned / Math.max(1, totalTarget)) * 100,
                          ),
                        ),
                      );

                return (
                  <div className="s2-collector-live-grid">
                    {/* Active / Selected Run Detail */}
                    <div
                      className="s2-collector-detail-box"
                      data-testid="collector-latest-run"
                    >
                      <div className="s2-collector-detail-head">
                        <div>
                          <span
                            className={`s2-status-badge ${
                              activeRun.status === "COMPLETED"
                                ? "badge-qualified"
                                : activeRun.status === "RUNNING"
                                  ? "badge-queued"
                                  : "badge-rejected"
                            }`}
                            data-testid="collector-run-status"
                          >
                            {activeRun.status}
                          </span>
                          <strong style={{ marginLeft: 8 }}>
                            Phiên #{activeRun.id.slice(0, 8)} ({activeRun.execution})
                          </strong>
                        </div>
                        <span
                          className="s2-mono-id"
                          data-testid="collector-run-stage"
                        >
                          Bước:{" "}
                          {COLLECTOR_STAGE_LABELS[activeRun.stage] ||
                            activeRun.stage}
                        </span>
                      </div>

                      {/* Progress Bar */}
                      <div className="s2-collector-progress-wrap">
                        <div className="s2-metric-label">
                          <span>
                            Tiến độ truy vấn:{" "}
                            <b>
                              Từ khóa{" "}
                              {Math.min(
                                activeRun.input.keywords.length,
                                (activeRun.queryIndex ?? 0) +
                                  (activeRun.status === "COMPLETED" ? 0 : 1),
                              )}
                              /{activeRun.input.keywords.length}
                            </b>{" "}
                            · Request{" "}
                            <b>
                              {activeRun.requestAttempts}/
                              {activeRun.input.maxRequests}
                            </b>
                          </span>
                          <strong>{progressPct}%</strong>
                        </div>
                        <div className="s2-metric-track">
                          <div
                            className="s2-metric-fill"
                            style={{ width: `${progressPct}%` }}
                          />
                        </div>
                      </div>

                      {/* 4 Key Operational Counts */}
                      <div
                        className="s2-collector-kpi-row"
                        data-testid="collector-run-counts"
                      >
                        <div className="s2-env-pill is-ok">
                          <span>📥</span>
                          <div>
                            <strong data-testid="collector-count-returned">
                              {activeRun.returned} bài
                            </strong>
                            <small>Lấy được từ API</small>
                          </div>
                        </div>
                        <div className="s2-env-pill is-ok">
                          <span>🗄</span>
                          <div>
                            <strong data-testid="collector-count-imported">
                              {activeRun.imported} bài
                            </strong>
                            <small>Đã nạp DATA-01</small>
                          </div>
                        </div>
                        <div className="s2-env-pill is-ok">
                          <span>✨</span>
                          <div>
                            <strong data-testid="collector-count-new">
                              {activeRun.newPosts} bài mới
                            </strong>
                            <small>Chưa từng có</small>
                          </div>
                        </div>
                        <div className="s2-env-pill is-neutral">
                          <span>♻</span>
                          <div>
                            <strong data-testid="collector-count-duplicates">
                              {activeRun.sourceDuplicates} bài
                            </strong>
                            <small>Trùng lặp đã lọc</small>
                          </div>
                        </div>
                      </div>

                      {/* Per-keyword breakdown & DATA-01 state badges */}
                      <div className="s2-scope-list" style={{ marginTop: 10 }}>
                        {activeRun.input.keywords.map((kw, idx) => (
                          <span key={kw} className="s2-scope-chip is-granted">
                            #{kw}: {activeRun.counts?.[idx] ?? 0}/
                            {activeRun.input.perKeyword} bài
                          </span>
                        ))}
                        {Object.entries(activeRun.dataStates || {}).map(
                          ([st, cnt]) => (
                            <span key={st} className="s2-scope-chip">
                              {st}: {cnt}
                            </span>
                          ),
                        )}
                      </div>

                      {/* Errors from API */}
                      {activeRun.errors && activeRun.errors.length > 0 && (
                        <div
                          className="alert error"
                          role="alert"
                          style={{ marginTop: 12 }}
                          data-testid="collector-run-errors"
                        >
                          <strong>
                            ⚠ Lỗi ghi nhận trong phiên thu thập ({activeRun.errors.length}):
                          </strong>
                          <ul style={{ margin: "6px 0 0 18px" }}>
                            {activeRun.errors.map((err, i) => (
                              <li key={i}>{err}</li>
                            ))}
                          </ul>
                        </div>
                      )}

                      {/* Collected Items Preview */}
                      {activeRun.items && activeRun.items.length > 0 && (
                        <div
                          className="s2-collector-items-list"
                          style={{ marginTop: 12 }}
                          data-testid="collector-run-items"
                        >
                          <span className="s2-sub-heading">
                            Bài viết thu được trong phiên này ({activeRun.items.length})
                          </span>
                          <div className="s2-env-grid" style={{ marginTop: 6 }}>
                            {activeRun.items.map((item) => (
                              <div
                                key={item.postId}
                                className="s2-env-pill is-ok"
                              >
                                <span>📄</span>
                                <div>
                                  <strong>
                                    @{item.author || "threads_user"} ·{" "}
                                    {item.state}
                                    {item.score !== null
                                      ? ` (${Math.round(item.score)}đ)`
                                      : ""}
                                  </strong>
                                  <small>
                                    {item.sourceUrl || item.postId.slice(0, 16)}
                                  </small>
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}

                      {/* Resume / Action Footer */}
                      <div
                        className="s2-auth-card-foot"
                        style={{ marginTop: 12 }}
                      >
                        <small>
                          Bắt đầu:{" "}
                          {new Date(activeRun.startedAt).toLocaleString("vi-VN")}
                          {activeRun.metrics?.elapsedMs !== undefined
                            ? ` · Thời gian chạy ${(activeRun.metrics.elapsedMs / 1000).toFixed(1)}s`
                            : ""}
                        </small>
                        {activeRun.status !== "COMPLETED" && (
                          <button
                            type="button"
                            className="s2-btn-primary"
                            disabled={apiBusy}
                            onClick={() =>
                              void handleResumeCollectorRun(activeRun.id)
                            }
                            data-testid="collector-resume-btn"
                          >
                            ↻ Tiếp tục phiên thu thập (Resume)
                          </button>
                        )}
                      </div>
                    </div>

                    {/* Historical Collector Runs List */}
                    <div
                      className="s2-collector-history-box"
                      data-testid="collector-history-list"
                    >
                      <span className="s2-sub-heading">
                        Lịch sử các lượt chạy ({collectorRuns.length})
                      </span>
                      <div
                        style={{
                          display: "flex",
                          flexDirection: "column",
                          gap: 8,
                          marginTop: 8,
                        }}
                      >
                        {collectorRuns.map((r) => (
                          <button
                            key={r.id}
                            type="button"
                            className={`s2-env-pill ${
                              r.id === activeRun.id ? "is-ok" : "is-neutral"
                            }`}
                            style={{
                              textAlign: "left",
                              cursor: "pointer",
                              width: "100%",
                            }}
                            onClick={() => setSelectedRunId(r.id)}
                            data-testid={`collector-history-item-${r.id.slice(0, 8)}`}
                          >
                            <span>
                              {r.status === "COMPLETED"
                                ? "✓"
                                : r.status === "RUNNING"
                                  ? "⏳"
                                  : "⚠"}
                            </span>
                            <div style={{ flex: 1 }}>
                              <strong>
                                #{r.id.slice(0, 8)} ·{" "}
                                {r.input.keywords.map((k) => `#${k}`).join(", ")}{" "}
                                ({r.status})
                              </strong>
                              <small>
                                Lấy được {r.returned} bài · Đã nạp {r.imported}{" "}
                                bài · Bài mới {r.newPosts}
                                {r.errors?.length
                                  ? ` · ${r.errors.length} lỗi`
                                  : ""}
                              </small>
                            </div>
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>
                );
              })()
            )}
          </div>
        </div>
      )}

      {/* TAB 3: Future Collection Schedule Configuration (DATA-02 Scheduler) */}
      {activeTab === "FUTURE_SCHEDULE" && (
        <div
          className="s2-discovery-bento"
          data-testid="discovery-schedule-panel"
        >
          <div className="s2-bento-card s2-schedule-config-card">
            <div className="s2-card-head">
              <div>
                <span className="s2-eyebrow-tag">
                  CẤU HÌNH LỊCH THU THẬP TƯƠNG LAI (DATA-02 SCHEDULER)
                </span>
                <h3>Thiết lập Quy tắc Thu thập Định kỳ</h3>
                <p>
                  Chuẩn bị trước lịch quét từ khóa và ngưỡng an toàn. Theo quy
                  tắc an toàn Studio, lịch này{" "}
                  <strong>mặc định Tắt & Tạm dừng</strong> và giới hạn chu kỳ{" "}
                  <strong>tối thiểu 6 giờ (tối đa 7 ngày)</strong> theo đúng ràng
                  buộc backend.
                </p>
              </div>
              <span className="s2-status-badge badge-review">
                {scheduler?.enabled && !scheduler?.paused
                  ? "ĐANG BẬT"
                  : "TẠM DỪNG AN TOÀN"}
              </span>
            </div>

            {scheduler?.blockedReason && (
              <div className="alert error" role="alert">
                <strong>
                  ⚠ Lịch thu thập đang bị khóa an toàn: {scheduler.blockedReason}
                </strong>
                <button
                  type="button"
                  className="s2-btn-secondary"
                  style={{ marginLeft: 12 }}
                  disabled={apiBusy}
                  onClick={() => void handleSchedulerAction("acknowledge-block")}
                >
                  Xác nhận đã kiểm tra
                </button>
              </div>
            )}

            <div className="s2-sched-grid">
              <label className="s2-field-label">
                Chu kỳ kiểm tra định kỳ (Giới hạn Backend: 6 giờ – 7 ngày)
                <select
                  value={schedIntervalHours}
                  onChange={(e) =>
                    setSchedIntervalHours(
                      Math.min(168, Math.max(6, Number(e.target.value) || 6)),
                    )
                  }
                  data-testid="scheduler-interval-select"
                >
                  <option value={6}>Mỗi 6 giờ (Tối thiểu theo chính sách)</option>
                  <option value={12}>Mỗi 12 giờ (2 lần / ngày)</option>
                  <option value={24}>Mỗi 24 giờ (1 lần / ngày)</option>
                  <option value={48}>Mỗi 48 giờ (2 ngày / lần)</option>
                  <option value={72}>Mỗi 72 giờ (3 ngày / lần)</option>
                  <option value={168}>Mỗi 7 ngày (168 giờ — Tối đa)</option>
                </select>
              </label>

              <label className="s2-field-label">
                Ngưỡng bài Đạt chuẩn tối thiểu (Tự dừng khi đủ bài)
                <input
                  type="number"
                  min={1}
                  max={1000}
                  value={schedMinInventory}
                  onChange={(e) =>
                    setSchedMinInventory(
                      Math.min(1000, Math.max(1, Number(e.target.value) || 10)),
                    )
                  }
                />
              </label>

              <label className="s2-field-label">
                Giới hạn bài chờ duyệt tối đa (Tránh quá tải)
                <input
                  type="number"
                  min={1}
                  max={1000}
                  value={schedBacklogLimit}
                  onChange={(e) =>
                    setSchedBacklogLimit(
                      Math.min(1000, Math.max(1, Number(e.target.value) || 20)),
                    )
                  }
                />
              </label>
            </div>

            <div className="s2-sched-footer">
              <small>
                Từ khóa áp dụng cho lịch:{" "}
                <strong>#{keywords.slice(0, 2).join(", #")}</strong> (
                {searchType} · {perKeyword} bài/từ khóa · Chu kỳ {schedIntervalHours}h)
              </small>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                {scheduler && (
                  <button
                    type="button"
                    className="s2-btn-secondary"
                    disabled={apiBusy}
                    onClick={() =>
                      void handleSchedulerAction(
                        scheduler.paused ? "resume" : "pause",
                      )
                    }
                  >
                    {scheduler.paused
                      ? "▶ Bỏ tạm dừng lịch"
                      : "⏸ Tạm dừng lịch"}
                  </button>
                )}
                <button
                  type="button"
                  className="s2-btn-primary"
                  disabled={apiBusy}
                  onClick={() => void handleSaveScheduler()}
                  data-testid="scheduler-save-btn"
                >
                  {apiBusy
                    ? "Đang lưu cấu hình..."
                    : "💾 Lưu cấu hình lịch thu thập"}
                </button>
              </div>
            </div>
          </div>

          <div className="s2-bento-card s2-schedule-guard-card">
            <div className="s2-card-head">
              <div>
                <span className="s2-eyebrow-tag">CƠ CHẾ BẢO VỆ TỰ ĐỘNG</span>
                <h3>Quy tắc An toàn Khi Vận hành Lịch</h3>
              </div>
            </div>
            <ul className="s2-guard-list">
              <li>
                <strong>Không tự chạy ngầm khi mở máy:</strong> Mọi chu kỳ đều
                kiểm tra quyền OAuth và hạn mức trước khi gửi yêu cầu.
              </li>
              <li>
                <strong>Tự dừng khi đủ bài:</strong> Nếu kho đã có đủ{" "}
                <b>{schedMinInventory} bài Đạt chuẩn</b> hoặc còn tồn{" "}
                <b>{schedBacklogLimit} bài chờ duyệt</b>, hệ thống sẽ bỏ qua lượt
                quét để tiết kiệm tài nguyên.
              </li>
              <li>
                <strong>Bắt buộc người duyệt:</strong> Bài thu thập từ lịch tự
                động luôn vào mục <em>Duyệt dữ liệu</em> trước, không tự động
                render hay đăng bài.
              </li>
            </ul>
          </div>
        </div>
      )}

      {/* Session Errors & Stage Reports */}
      {session.errors
        .filter(
          (e) =>
            !(session.attempts || []).some(
              (a) =>
                a.status === "PARTIAL" &&
                a.diagnostics.some(
                  (d) => e === a.originalUrl + ": " + d.message,
                ),
            ),
        )
        .map((e) => (
          <div role="alert" className="alert error" key={e}>
            {e}
          </div>
        ))}

      <StageReportPanel
        id={session.id}
        revision={session.revision}
        dirty={dirty}
      />

      {!!session.attempts?.some((a) => a.contextCandidates?.length) && (
        <details className="panel">
          <summary>
            Ngữ cảnh phụ trợ — không tự động đưa vào kịch bản trừ khi bạn chọn
          </summary>
          {session.attempts.flatMap((a) =>
            (a.contextCandidates || []).map((c, index) => (
              <div
                className="context-candidate"
                key={a.originalUrl + index}
              >
                <strong>{c.author}</strong>
                <p>{c.text}</p>
                <small>
                  {String(c.url || "No permalink")} · Relationship unverified
                </small>
                <button
                  type="button"
                  disabled={
                    busy ||
                    dirty ||
                    session.items.some((i) => i.sourceUrl === c.url)
                  }
                  onClick={() =>
                    void onAddContextCandidate(a.originalUrl, index)
                  }
                >
                  Thêm vào dự án
                </button>
              </div>
            )),
          )}
        </details>
      )}

      {/* Collected Results Section */}
      <section className="s2-collected-section">
        <div className="s2-collected-head">
          <div>
            <h3>
              Kết quả Bài viết Đã Thu thập{" "}
              <span className="s2-count-pill">{session.items.length}</span>
            </h3>
            <p>
              {session.items.filter((i) => i.selected).length} bài đang chọn đưa
              vào video · {dirty ? "Chưa lưu thay đổi" : "Đã lưu cục bộ"}
              {session.elapsedMs !== undefined
                ? ` · Thời gian trích xuất ${(session.elapsedMs / 1000).toFixed(1)}s`
                : ""}
            </p>
          </div>

          {session.items.length > 1 && (
            <div
              className="v2-scene-jumpbar"
              role="toolbar"
              aria-label="Lọc nhanh bài đã thu thập"
            >
              <span>LỌC NHANH:</span>
              <button
                type="button"
                className={focusItemId === "ALL" ? "active" : ""}
                onClick={() => setFocusItemId("ALL")}
              >
                Tất cả ({session.items.length})
              </button>
              {session.items.map((item, idx) => (
                <button
                  key={item.id}
                  type="button"
                  className={focusItemId === item.id ? "active" : ""}
                  onClick={() => setFocusItemId(item.id)}
                >
                  #{idx + 1} {item.author.displayName}
                </button>
              ))}
            </div>
          )}
        </div>

        {session.items.length === 0 ? (
          <div className="panel empty-small">
            Chưa có bài viết nào trong dự án. Hãy dán liên kết Threads ở khung
            trên để bắt đầu thu thập.
          </div>
        ) : (
          <div className="s2-collected-grid">
            {visibleSourceItems.map((i, index) => (
              <article
                className={
                  "content-card s2-collected-card " +
                  (i.selected ? "selected" : "")
                }
                key={i.id}
              >
                <div className="card-head">
                  <label>
                    <input
                      type="checkbox"
                      checked={i.selected}
                      onChange={(e) =>
                        onUpdateItem(i.id, { selected: e.target.checked })
                      }
                    />
                    <strong>{i.author.displayName}</strong>
                    <span className="badge">
                      {i.metadata?.type || i.sourceReference.entityType}
                    </span>
                  </label>
                  <div className="s2-card-order-btns">
                    <button
                      type="button"
                      aria-label="Move up"
                      disabled={index === 0}
                      onClick={() => onMoveItem(i.id, -1)}
                    >
                      ↑
                    </button>
                    <button
                      type="button"
                      aria-label="Move down"
                      disabled={index === session.items.length - 1}
                      onClick={() => onMoveItem(i.id, 1)}
                    >
                      ↓
                    </button>
                  </div>
                </div>

                {i.sourceUrl && (
                  <a
                    className="s2-source-link"
                    href={i.sourceUrl}
                    target="_blank"
                    rel="noreferrer"
                  >
                    🔗 {i.sourceUrl}
                  </a>
                )}

                <ThreadsPreview
                  item={i}
                  disabled={busy || dirty}
                  onRefresh={() => onRefreshMetadata(i.id)}
                />

                <details className="s2-advanced-edit-drawer">
                  <summary>
                    ⚙ Chỉnh sửa văn bản, chủ đề & thông tin bài viết
                  </summary>
                  <details>
                    <summary>Văn bản gốc · Chỉ đọc</summary>
                    <p className="original">{i.originalText}</p>
                    {i.mediaReferences.map((m, n) => (
                      <p className="media" key={n}>
                        Media reference: {m}
                      </p>
                    ))}
                  </details>
                  <TopicEditor
                    item={i}
                    disabled={busy || dirty}
                    save={(body) => onSaveTopic(i.id, body)}
                  />
                  <MetadataEditor
                    item={i}
                    onChange={(patch) => onUpdateItem(i.id, patch)}
                  />
                  <MediaPreview item={i} />
                  <div className="edit-grid">
                    <label>
                      Display text
                      <textarea
                        rows={4}
                        value={i.displayText}
                        onChange={(e) =>
                          onUpdateItem(i.id, { displayText: e.target.value })
                        }
                      />
                    </label>
                    <label>
                      Spoken text
                      <textarea
                        rows={4}
                        value={i.spokenText}
                        onChange={(e) =>
                          onUpdateItem(i.id, { spokenText: e.target.value })
                        }
                      />
                    </label>
                  </div>
                  <div className="card-bottom">
                    <small>
                      #{index + 1} · Revision {i.revision} ·{" "}
                      {i.manualLocks.length
                        ? "Manual text locks"
                        : "Original text"}{" "}
                    </small>
                    <button
                      type="button"
                      onClick={() =>
                        onUpdateItem(i.id, {
                          displayText: i.originalText,
                          spokenText: i.originalText,
                        })
                      }
                    >
                      Restore original text
                    </button>
                  </div>
                </details>
              </article>
            ))}
          </div>
        )}
      </section>
    </section>
  );
}
