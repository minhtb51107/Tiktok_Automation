import {useRuntimeSafety} from './RuntimeSafety';
import {ConversationPanel} from './ConversationPanel';
import { targetType, reviewPayload, isUserAccepted, type TargetType } from "../../../1_nest_backend/src/data-engine/studio-integration";
import { useEffect, useMemo, useState } from "react";
import type { StudioSession } from "../../../1_nest_backend/src/studio/studio.contracts";
import {
  catalogPostView,
  catalogProvenance,
  fetchData01PostDetail,
  formatCompactNumber,
  formatVietnameseDate,
  type Data01CatalogResponse,
  type Data01PostDetailResponse,
  type MedallionItem,
} from "./studio-v2-adapter";

interface DataReviewProps {
  session: StudioSession | null;
  busy: boolean;
  dirty: boolean;
  data01Catalog?: Data01CatalogResponse | null;
  data01Connected?: boolean;
  onRefreshData01?: () => Promise<void>;
  onPageChange?: (page:number)=>Promise<void>;
  onUpdateItem: (id: string, patch: Record<string, unknown>) => void;
  onMoveItem: (index: number, delta: number) => void;
  onRestoreItem: (id: string) => void;
  onSave: () => void;
  onNavigateStep: (step: string) => void;
}

type FilterTab =
  | "ALL"
  | "NEEDS_REVIEW"
  | "QUALIFIED"
  | "QUEUED"
  | "REJECTED";

type ViewMode = "SPLIT_DETAIL" | "QUICK_GRID";

interface PendingConfirmation {
  mode: "SINGLE" | "BATCH" | "ENQUEUE";
  decision: "ACCEPT" | "REJECT" | "NEEDS_REVIEW";
  targetItems: MedallionItem[];
  confirmedType: TargetType;
  reason: string;
}

const PRESET_REASONS: Record<
  "ACCEPT" | "NEEDS_REVIEW" | "REJECT",
  string[]
> = {
  ACCEPT: [
    "Bài đăng gốc hợp lệ, nội dung đồng cảm cao",
    "Đã kiểm tra từ viết tắt, lời đọc tự nhiên",
    "Cấu trúc rõ ràng, phù hợp dựng video 9:16",
  ],
  NEEDS_REVIEW: [
    "Cần chỉnh lại câu chữ hoặc từ viết tắt trước khi thu âm",
    "Chờ đối chiếu thêm ngữ cảnh bình luận",
  ],
  REJECT: [
    "Nội dung chứa từ nhạy cảm / không phù hợp",
    "Ngữ cảnh quá ngắn, khó dựng thành câu chuyện",
  ],
};

const BREAKDOWN_LABELS: Record<string, string> = {
  topicRelevance: "Độ khớp chủ đề mục tiêu",
  contextCompleteness: "Độ đầy đủ ngữ cảnh",
  discussionPotential: "Sức hút thảo luận",
  videoSuitability: "Độ phù hợp nhịp đọc Video",
  length: "Độ dài nhịp đọc",
  structure: "Bố cục đoạn văn",
  clarity: "Độ rõ & sạch ký tự",
  freshness: "Độ mới bài viết",
  engagement: "Tương tác cộng đồng",
};

function translateEngineReason(raw: string): string {
  if (!raw) return "";
  return raw
    .replace(/^Topic terms:/i, "Từ khóa chủ đề:")
    .replace(/^Normalized body characters:/i, "Độ dài văn bản chuẩn hóa (ký tự):")
    .replace(
      /^Question punctuation \/ available narrative length$/i,
      "Có câu hỏi gợi mở & độ dài câu chuyện phù hợp",
    )
    .replace(
      /^Explicit text-length suitability band; no duration estimation$/i,
      "Độ dài văn bản nằm trong ngưỡng tối ưu cho cảnh ngắn",
    )
    .replace(/^Age at pinned asOf:/i, "Độ trễ thời gian:")
    .replace(/days$/i, "ngày")
    .replace(
      /^Weighted observed engagement \(may be approximate\):/i,
      "Điểm tương tác tổng hợp:",
    )
    .replace(
      /^Saved source observation; no network calls$/i,
      "Đã lưu bản ghi gốc từ nguồn thu thập cục bộ",
    )
    .replace(
      /^Required source fields validated$/i,
      "Đã kiểm tra hợp lệ các trường dữ liệu bắt buộc",
    )
    .replace(
      /^Deterministic score and rule breakdown saved$/i,
      "Đã chấm điểm tự động theo bộ tiêu chí nội dung",
    )
    .replace(
      /^Explicit local user review; deterministic score remains unchanged$/i,
      "Người dùng đã duyệt thủ công; giữ nguyên điểm gốc",
    );
}

const STATE_VI_LABELS: Record<string, string> = {
  DISCOVERED: "Đã thu thập bản gốc",
  VALIDATED: "Đã kiểm tra hợp lệ (Silver)",
  ELIGIBLE: "Đủ điều kiện sơ bộ",
  SCORED: "Đã chấm điểm tự động (Gold)",
  QUALIFIED: "Đạt chuẩn (tự động hoặc đã được bạn duyệt)",
  QUEUED: "Đã vào Hàng đợi Sản xuất",
  REJECTED: "Đã từ chối",
  QUARANTINED: "Đang cách ly kiểm tra",
  FAILED: "Lỗi xử lý",
};

export function DataReviewWorkspace({
  session,
  busy,
  dirty,
  data01Catalog = null,
  data01Connected = false,
  onRefreshData01,
  onPageChange,
  onUpdateItem,
  onMoveItem,
  onRestoreItem,
  onSave,
  onNavigateStep,
}: DataReviewProps) {
  const {locked}=useRuntimeSafety();
  const [filter, setFilter] = useState<FilterTab>("ALL");
  const [viewMode, setViewMode] = useState<ViewMode>("SPLIT_DETAIL");
  const [search, setSearch] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);

  // Per-post entity type selection ("POST" | "COMMENT")
  const [entityTypesByItem, setEntityTypesByItem] = useState<
    Record<string, "POST" | "COMMENT">
  >({});
  const [reviewReason, setReviewReason] = useState(
    PRESET_REASONS.ACCEPT[0],
  );
  const [reviewPending, setReviewPending] = useState(false);
  const [reviewNotice, setReviewNotice] = useState("");
  const [reviewError, setReviewError] = useState("");

  // Multi-select batch state (never auto-approves without user confirmation)
  const [batchCheckedIds, setBatchCheckedIds] = useState<string[]>([]);
  const [batchType, setBatchType] = useState<TargetType>("UNKNOWN");
  const [batchReason, setBatchReason] = useState(PRESET_REASONS.ACCEPT[0]);

  // Confirmation modal state
  const [confirmation, setConfirmation] =
    useState<PendingConfirmation | null>(null);

  // Loaded DATA-01 details (publishedAt, engagement, score breakdown, transitions, review history)
  const [detailsByPostId, setDetailsByPostId] = useState<
    Record<string, Data01PostDetailResponse>
  >({});
  const [inspectorTab, setInspectorTab] = useState<
    "EVALUATION" | "SCRIPT" | "HISTORY"
  >("EVALUATION");

  const items = useMemo(() => (data01Catalog?.rows || []).map((row,index) => ({...catalogPostView(row,detailsByPostId[row.id] || null,session),itemIndex:(data01Catalog?.page||0)*25+index+1})),[data01Catalog,detailsByPostId,session]);
  const c=data01Catalog?.counts||{};
  const counts={total:data01Catalog?.total||0,bronzeObservations:data01Catalog?.observations||0,silverValidated:Math.max(0,(data01Catalog?.total||0)-(c.QUARANTINED||0)),goldScored:(c.SCORED||0)+(c.QUALIFIED||0)+(c.QUEUED||0)+(c.REJECTED||0),needsReview:(c.SCORED||0)+(c.ELIGIBLE||0),qualified:c.QUALIFIED||0,queued:c.QUEUED||0,rejected:c.REJECTED||0,quarantine:c.QUARANTINED||0};
  const dataProvenance=data01Connected?catalogProvenance(data01Catalog):"NOT CONNECTED";

  // Fetch DATA-01 post details for rich cards & evaluation history
  useEffect(() => {
    if (!data01Connected) return;
    const postIds = items
      .map((i) => i.data01PostId)
      .filter((id): id is string => Boolean(id));
    if (postIds.length === 0) return;

    let cancelled = false;
    void Promise.all(
      postIds.map(async (pid) => {
        const d = await fetchData01PostDetail(pid);
        return [pid, d] as const;
      }),
    ).then((entries) => {
      if (cancelled) return;
      const next: Record<string, Data01PostDetailResponse> = {};
      for (const [pid, d] of entries) {
        if (d) next[pid] = d;
      }
      setDetailsByPostId(next);
    });

    return () => {
      cancelled = true;
    };
  }, [data01Connected, data01Catalog]);

  const filteredItems = useMemo(() => {
    const q = search.trim().toLowerCase();
    return items.filter((item) => {
      if (filter === "NEEDS_REVIEW" && item.evaluationStatus !== "NEEDS_REVIEW")
        return false;
      if (filter === "QUALIFIED" && item.evaluationStatus !== "QUALIFIED")
        return false;
      if (filter === "QUEUED" && item.evaluationStatus !== "QUEUED")
        return false;
      if (filter === "REJECTED" && item.evaluationStatus !== "REJECTED")
        return false;
      if (!q) return true;
      return (
        item.author.toLowerCase().includes(q) ||
        item.handle.toLowerCase().includes(q) ||
        item.displayText.toLowerCase().includes(q) ||
        item.spokenText.toLowerCase().includes(q) ||
        (item.topic || "").toLowerCase().includes(q)
      );
    });
  }, [items, filter, search]);

  const activeItem: MedallionItem | null =
    filteredItems.find((i) => i.id === selectedId) || filteredItems[0] || null;

  const activeDetail: Data01PostDetailResponse | null =
    activeItem?.data01PostId
      ? detailsByPostId[activeItem.data01PostId] || null
      : null;

  const getEffectiveEntityType = (item:MedallionItem):TargetType => targetType(item.entityType,entityTypesByItem[item.id],item.data01PostId?detailsByPostId[item.data01PostId]?.evaluation?.review?.confirmedType:undefined);

  const setItemEntityType = (itemId: string, t: "POST" | "COMMENT") => {
    const row=items.find(i=>i.id===itemId);
    if(row&&row.entityType!=="UNKNOWN"&&row.entityType!==t){setReviewError("Known target type cannot be silently changed");return;}
    setEntityTypesByItem((prev) => ({ ...prev, [itemId]: t }));
  };

  const toggleBatchItem = (itemId: string) => {
    setBatchCheckedIds((prev) =>
      prev.includes(itemId)
        ? prev.filter((id) => id !== itemId)
        : [...prev, itemId],
    );
  };

  const toggleBatchAllFiltered = () => {
    const allIds = filteredItems.map((i) => i.id);
    const allSelected =
      allIds.length > 0 && allIds.every((id) => batchCheckedIds.includes(id));
    if (allSelected) {
      setBatchCheckedIds((prev) => prev.filter((id) => !allIds.includes(id)));
    } else {
      setBatchCheckedIds(Array.from(new Set([...batchCheckedIds, ...allIds])));
    }
  };

  const requestSingleReview = (
    item: MedallionItem,
    decision: "ACCEPT" | "REJECT" | "NEEDS_REVIEW",
    customReason?: string,
  ) => {
    const chosenReason =
      (customReason ?? reviewReason).trim() ||
      PRESET_REASONS[decision][0];
    const chosenType = getEffectiveEntityType(item);
    if(!item.identityVerified){setReviewError("Wait for verified source details");return;}
    if(decision==="ACCEPT"&&chosenType==="UNKNOWN"){setReviewError("Explicitly confirm POST or COMMENT first");return;}
    setConfirmation({
      mode: "SINGLE",
      decision,
      targetItems: [item],
      confirmedType: chosenType,
      reason: chosenReason,
    });
  };

  const requestBatchReview = (
    decision: "ACCEPT" | "REJECT" | "NEEDS_REVIEW",
  ) => {
    const targets = items.filter(
      (i) => batchCheckedIds.includes(i.id) && i.data01PostId,
    );
    if (targets.length === 0) return;
    if(targets.some(i=>!i.identityVerified)||(decision==="ACCEPT"&&batchType==="UNKNOWN")){setReviewError("Confirm target type and verified identity for every selected post");return;}
    setConfirmation({
      mode: "BATCH",
      decision,
      targetItems: targets,
      confirmedType: batchType,
      reason: batchReason.trim() || PRESET_REASONS[decision][0],
    });
  };

  const requestEnqueue = (item: MedallionItem) => {
    setConfirmation({
      mode: "ENQUEUE",
      decision: "ACCEPT",
      targetItems: [item],
      confirmedType: getEffectiveEntityType(item),
      reason: "Đưa bài đã đạt chuẩn vào Hàng đợi Sản xuất (DRAFT_ONLY)",
    });
  };

  const executeConfirmedAction = async () => {
    if (!confirmation) return;
    setReviewPending(true);
    setReviewError("");
    setReviewNotice("");

    try {
      if (confirmation.mode === "ENQUEUE") {
        const target = confirmation.targetItems[0];
        if (!target?.data01PostId || target.data01Revision === null) {
          throw new Error("Bài viết chưa có định danh DATA-01");
        }
        const res = await fetch(
          `/api/studio/data/posts/${target.data01PostId}/enqueue`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ revision: target.data01Revision }),
          },
        );
        const json = await res.json();
        if (!res.ok) {
          throw new Error(
            json.error?.message || json.message || "Không thể đưa vào hàng đợi",
          );
        }
        setReviewNotice(
          `Đã đưa bài viết của @${target.handle} vào Hàng đợi Sản xuất (chế độ Bản nháp an toàn).`,
        );
      } else {
        for(const item of confirmation.targetItems){if(!item.identityVerified)throw Error("Verified identity required");reviewPayload(item.data01Revision!,confirmation.decision,confirmation.reason,targetType(item.entityType,confirmation.confirmedType));}
        let completed = 0;
        const updatedDetails: Record<string, Data01PostDetailResponse> = {};
        for (const item of confirmation.targetItems) {
          if (!item.data01PostId || item.data01Revision === null) continue;
          const res = await fetch(
            `/api/studio/data/posts/${item.data01PostId}/review`,
            {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(reviewPayload(item.data01Revision, confirmation.decision, confirmation.reason, targetType(item.entityType,confirmation.confirmedType))),
            },
          );
          const json = await res.json();
          if (!res.ok) {
            throw new Error(
              json.error?.message ||
                json.message ||
                `Không thể lưu quyết định cho @${item.handle}`,
            );
          }
          const detailPayload = (json.data ?? json) as Data01PostDetailResponse;
          if (detailPayload?.post?.id) {
            updatedDetails[detailPayload.post.id] = detailPayload;
          }
          completed++;
        }
        if (Object.keys(updatedDetails).length > 0) {
          setDetailsByPostId((prev) => ({ ...prev, ...updatedDetails }));
        }
        const labelMap = {
          ACCEPT: "Chấp nhận (Đạt chuẩn)",
          NEEDS_REVIEW: "Giữ Cần xem lại",
          REJECT: "Từ chối",
        };
        setReviewNotice(
          `Đã lưu quyết định "${labelMap[confirmation.decision]}" cho ${completed} bài viết. Văn bản gốc được bảo toàn nguyên vẹn.`,
        );
        if (confirmation.mode === "BATCH") {
          setBatchCheckedIds([]);
        }
      }
      setConfirmation(null);
      if (onRefreshData01) await onRefreshData01();
    } catch (err) {
      setReviewError((err as Error).message);
    } finally {
      setReviewPending(false);
    }
  };

  const triggerData01Import = async () => {
    if (!session) return;
    setReviewPending(true);
    setReviewError("");
    setReviewNotice("");
    try {
      const res = await fetch("/api/studio/data/import-session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId: session.id }),
      });
      const json = await res.json();
      if (!res.ok) {
        throw new Error(
          json.error?.message || json.message || "Không thể đồng bộ DATA-01",
        );
      }
      const d = json.data ?? json;
      setReviewNotice(
        `Đã đồng bộ ${d.cursor}/${d.inputCount} bài viết từ dự án vào bộ chấm điểm DATA-01.`,
      );
      if (onRefreshData01) await onRefreshData01();
    } catch (err) {
      setReviewError((err as Error).message);
    } finally {
      setReviewPending(false);
    }
  };

  if (!data01Connected) {
    return (
      <section className="v2-workspace">
        <div className="v2-empty-box">
          <h3>Chưa kết nối DATA-01</h3>
          <p>Connect the local Data Engine to review the global catalog.</p>
        </div>
      </section>
    );
  }

  const renderStatusBadge = (item: MedallionItem) => {
    // Pipeline QUALIFIED is a threshold result; only an explicit user ACCEPT makes it approved.
    const userAccepted =
      !!item.data01PostId &&
      isUserAccepted(detailsByPostId[item.data01PostId]?.evaluation?.review);
    switch (item.evaluationStatus) {
      case "QUALIFIED":
        return userAccepted ? (
          <span
            className="s2-status-badge badge-qualified"
            data-testid="badge-user-accepted"
          >
            ✓ Đạt chuẩn · Sẵn sàng dựng
          </span>
        ) : (
          <span
            className="s2-status-badge badge-review"
            data-testid="badge-auto-qualified"
          >
            ⏳ Đạt ngưỡng tự động · Chưa được bạn duyệt
          </span>
        );
      case "QUEUED":
        return (
          <span className="s2-status-badge badge-queued">
            🚀 Đã vào hàng đợi
          </span>
        );
      case "REJECTED":
        return (
          <span className="s2-status-badge badge-rejected">
            ✕ Đã từ chối
          </span>
        );
      case "QUARANTINED":
        return (
          <span className="s2-status-badge badge-quarantine">
            ⚠ Cách ly kiểm tra
          </span>
        );
      default:
        return (
          <span className="s2-status-badge badge-review">
            ⏳ Cần bạn duyệt
          </span>
        );
    }
  };

  return (
    <section
      className="v2-workspace s2-review-workspace"
      aria-label="Duyệt nội dung Threads"
      data-testid="data-review-workspace"
    >
      <ConversationPanel sourceUrl={activeDetail?.bronze?.sourceUrl}/>
      {/* Hero Banner with 3D-styled Illustration & One Clear Primary CTA */}
      <div className="s2-hero-banner s2-hero-review">
        <div className="s2-hero-copy">
          <div className="v3-eyebrow-row">
            <span
              className={`v3-prov-pill ${data01Connected ? "prov-real" : "prov-disconnected"}`}
            >
              ● {dataProvenance}
            </span>
            <span className="v3-prov-pill prov-review">
              {counts.needsReview} BÀI CHỜ QUYẾT ĐỊNH CỦA BẠN
            </span>
            {counts.qualified > 0 && (
              <span className="v3-prov-pill prov-real">
                {counts.qualified} ĐẠT NGƯỠNG TỰ ĐỘNG
              </span>
            )}
            {(data01Catalog?.rows || []).some((r) => r.synthetic) && (
              <span
                className="v3-prov-pill prov-review"
                data-testid="synthetic-catalog-warning"
              >
                {(data01Catalog?.rows || []).filter((r) => r.synthetic).length}{" "}
                SYNTHETIC / MOCK
              </span>
            )}
          </div>
          <h2>Kiểm duyệt & Chọn bài đưa vào Sản xuất</h2>
          <p>
            Xem trực quan từng bài viết Threads, hiểu ngay lý do hệ thống gợi ý
            hoặc cảnh báo, và quyết định <strong>Chấp nhận</strong>,{" "}
            <strong>Cần xem lại</strong> hoặc <strong>Từ chối</strong>. Hệ thống{" "}
            <strong>không tự động duyệt</strong> khi chưa có xác nhận của bạn.
          </p>
        </div>

        <div className="s2-hero-visual-right">
          <div className="s2-hero-3d-art" aria-hidden="true">
            <svg viewBox="0 0 96 80" fill="none">
              <rect
                x="8"
                y="14"
                width="48"
                height="54"
                rx="12"
                transform="rotate(-6 8 14)"
                fill="#fce068"
              />
              <rect
                x="32"
                y="8"
                width="52"
                height="58"
                rx="14"
                transform="rotate(5 32 8)"
                fill="#8fa0ff"
              />
              <circle cx="58" cy="36" r="14" fill="#12131a" />
              <path
                d="M52 36.5L56.2 40.5L64.5 31.5"
                stroke="#7ce8c8"
                strokeWidth="3.2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </div>
          <div className="s2-hero-actions">
            <button
              type="button"
              className="s2-btn-secondary"
              onClick={triggerData01Import}
              disabled={busy || reviewPending || !session}
            >
              ↻ Đồng bộ lại DATA-01
            </button>
            <button
              type="button"
              className="s2-btn-primary"
              disabled={!activeItem?.sessionItemId}
              onClick={() => onNavigateStep("Script")}
            >
              Sang bước Chuẩn hóa Kịch bản →
            </button>
          </div>
        </div>
      </div>

      {/* Feedback Alerts */}
      {reviewError && (
        <div className="alert error" role="alert">
          {reviewError}
        </div>
      )}
      {reviewNotice && (
        <div className="s2-toast-notice" role="status">
          <span>✓ {reviewNotice}</span>
          <button
            type="button"
            className="s2-toast-close"
            onClick={() => setReviewNotice("")}
          >
            Đóng
          </button>
        </div>
      )}

      {/* Control Bar: Status Filter Pills + Search + Quick/Detail View Toggle */}
      <div className="s2-toolbar">
        <div
          className="s2-filter-pills"
          role="tablist"
          aria-label="Lọc bài viết theo trạng thái"
        >
          {(
            [
              {
                id: "ALL",
                label: "Tất cả bài",
                count: items.length,
                tone: "neutral",
              },
              {
                id: "NEEDS_REVIEW",
                label: "Cần bạn duyệt",
                count: counts.needsReview,
                tone: "amber",
              },
              {
                id: "QUALIFIED",
                label: "Đạt chuẩn",
                count: counts.qualified,
                tone: "mint",
              },
              {
                id: "QUEUED",
                label: "Trong hàng đợi",
                count: counts.queued,
                tone: "violet",
              },
              {
                id: "REJECTED",
                label: "Đã từ chối",
                count: counts.rejected,
                tone: "rose",
              },
            ] as Array<{
              id: FilterTab;
              label: string;
              count: number;
              tone: string;
            }>
          ).map((t) => (
            <button
              key={t.id}
              type="button"
              role="tab"
              aria-selected={filter === t.id}
              className={`s2-filter-pill tone-${t.tone} ${filter === t.id ? "active" : ""}`}
              onClick={() => setFilter(t.id)}
            >
              <span>{t.label}</span>
              <b>{t.count}</b>
            </button>
          ))}
        </div>

        <div className="s2-toolbar-right">
          <button
            type="button"
            className="s2-batch-select-btn"
            onClick={toggleBatchAllFiltered}
          >
            {filteredItems.length > 0 &&
            filteredItems.every((i) => batchCheckedIds.includes(i.id))
              ? "☑ Bỏ chọn tất cả"
              : `☐ Chọn nhiều bài (${batchCheckedIds.length}/${filteredItems.length})`}
          </button>

          <input
            type="search"
            className="s2-search-box"
            placeholder="Tìm tác giả, @handle, chủ đề, nội dung..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            aria-label="Tìm kiếm bài viết"
          />

          <div
            className="s2-view-switcher"
            role="group"
            aria-label="Chế độ hiển thị"
          >
            <button
              type="button"
              className={viewMode === "QUICK_GRID" ? "active" : ""}
              onClick={() => setViewMode("QUICK_GRID")}
              data-testid="view-mode-quick"
            >
              ⊞ Xem nhanh (Thẻ)
            </button>
            <button
              type="button"
              className={viewMode === "SPLIT_DETAIL" ? "active" : ""}
              onClick={() => setViewMode("SPLIT_DETAIL")}
              data-testid="view-mode-detail"
            >
              ◫ Xem chi tiết & Lịch sử
            </button>
          </div>
        </div>
      </div>

      {/* Multi-Select Batch Action Bar (Never auto-approves; requires explicit user confirmation) */}
      {batchCheckedIds.length > 0 && (
        <div
          className="s2-batch-bar"
          role="region"
          aria-label="Thao tác duyệt nhiều bài"
          data-testid="batch-review-bar"
        >
          <div className="s2-batch-info">
            <span className="s2-batch-count">{batchCheckedIds.length}</span>
            <div>
              <strong>Đang chọn {batchCheckedIds.length} bài viết để duyệt cùng lúc</strong>
              <small>
                Quyết định chỉ được lưu sau khi bạn kiểm tra và bấm xác nhận ở bước kế tiếp.
              </small>
            </div>
          </div>

          <div className="s2-batch-controls">
            <div className="s2-inline-field">
              <span>Loại bài:</span>
              <div className="s2-type-Segmented">
                <button
                  type="button"
                  className={batchType === "POST" ? "active" : ""}
                  onClick={() => setBatchType("POST")}
                >
                  📄 Bài đăng gốc
                </button>
                <button
                  type="button"
                  className={batchType === "COMMENT" ? "active" : ""}
                  onClick={() => setBatchType("COMMENT")}
                >
                  💬 Bình luận
                </button>
              </div>
            </div>

            <input
              type="text"
              className="s2-batch-reason-input"
              value={batchReason}
              onChange={(e) => setBatchReason(e.target.value)}
              placeholder="Ghi chú lý do duyệt loạt bài..."
              aria-label="Lý do duyệt hàng loạt"
            />

            <div className="s2-batch-actions">
              <button
                type="button"
                className="s2-decision-btn btn-accept"
                disabled={locked || reviewPending}
                onClick={() => requestBatchReview("ACCEPT")}
              >
                ✓ Chấp nhận ({batchCheckedIds.length})
              </button>
              <button
                type="button"
                className="s2-decision-btn btn-hold"
                disabled={locked || reviewPending}
                onClick={() => requestBatchReview("NEEDS_REVIEW")}
              >
                ⏳ Cần xem lại
              </button>
              <button
                type="button"
                className="s2-decision-btn btn-reject"
                disabled={locked || reviewPending}
                onClick={() => requestBatchReview("REJECT")}
              >
                ✕ Từ chối
              </button>
              <button
                type="button"
                className="s2-btn-ghost"
                onClick={() => setBatchCheckedIds([])}
              >
                Hủy chọn
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Confirmation Dialog Modal for Data-Affecting Actions */}
      {confirmation && (
        <div
          className="s2-confirm-backdrop"
          role="dialog"
          aria-modal="true"
          aria-labelledby="s2-confirm-title"
          data-testid="review-confirm-modal"
        >
          <div className="s2-confirm-modal">
            <div className="s2-confirm-header">
              <span
                className={`s2-confirm-badge decision-${confirmation.decision.toLowerCase()}`}
              >
                {confirmation.mode === "ENQUEUE"
                  ? "🚀 ĐƯA VÀO HÀNG ĐỢI SẢN XUẤT"
                  : confirmation.decision === "ACCEPT"
                    ? "✓ XÁC NHẬN CHẤP NHẬN (ACCEPT)"
                    : confirmation.decision === "REJECT"
                      ? "✕ XÁC NHẬN TỪ CHỐI (REJECT)"
                      : "⏳ XÁC NHẬN CẦN XEM LẠI (NEEDS REVIEW)"}
              </span>
              <h3 id="s2-confirm-title">
                {confirmation.mode === "ENQUEUE"
                  ? `Đưa bài của @${confirmation.targetItems[0]?.handle} vào Hàng đợi?`
                  : `Áp dụng quyết định cho ${confirmation.targetItems.length} bài viết?`}
              </h3>
            </div>

            <p className="s2-confirm-desc">
              Hành động này sẽ ghi nhận quyết định của bạn vào hồ sơ đánh giá{" "}
              <strong>DATA-01</strong>. Văn bản gốc Threads vẫn được bảo toàn
              bất biến và bạn có thể xem lại trong lịch sử đánh giá bất cứ lúc
              nào.
            </p>

            <div className="s2-confirm-summary">
              <div className="s2-confirm-row">
                <span>Bài viết áp dụng:</span>
                <strong>
                  {confirmation.targetItems
                    .map((i) => `@${i.handle}`)
                    .join(", ")}
                </strong>
              </div>
              <div className="s2-confirm-row">
                <span>Loại bài xác nhận:</span>
                <strong>
                  {confirmation.confirmedType === "UNKNOWN" ? "UNKNOWN — not confirmed" : confirmation.confirmedType === "POST"
                    ? "📄 Bài đăng gốc (POST)"
                    : "💬 Bình luận / Phản hồi (COMMENT)"}
                </strong>
              </div>
              <div className="s2-confirm-row">
                <span>Lý do lưu lịch sử:</span>
                <input
                  type="text"
                  value={confirmation.reason}
                  onChange={(e) =>
                    setConfirmation({
                      ...confirmation,
                      reason: e.target.value,
                    })
                  }
                />
              </div>
            </div>

            {reviewError && (
              <div
                className="alert error"
                role="alert"
                data-testid="review-confirm-error"
                style={{ marginTop: 10 }}
              >
                {reviewError}
              </div>
            )}

            <div className="s2-confirm-footer">
              <button
                type="button"
                className="s2-btn-secondary"
                disabled={locked || reviewPending}
                onClick={() => {
                  setReviewError("");
                  setConfirmation(null);
                }}
              >
                Quay lại
              </button>
              <button
                type="button"
                className="s2-btn-primary"
                disabled={locked || reviewPending || !confirmation.reason.trim()}
                onClick={() => void executeConfirmedAction()}
                data-testid="confirm-review-submit"
              >
                {reviewPending
                  ? "Đang lưu vào DATA-01..."
                  : "Xác nhận & Lưu quyết định"}
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="v2-header-actions" data-testid="catalog-pagination"><button disabled={!(data01Catalog?.page) || reviewPending} onClick={()=>void onPageChange?.((data01Catalog?.page||0)-1)}>Previous page</button><span>Catalog page {(data01Catalog?.page||0)+1} · {data01Catalog?.total||0} posts</span><button disabled={((data01Catalog?.page||0)+1)*25 >= (data01Catalog?.matching||0) || reviewPending} onClick={()=>void onPageChange?.((data01Catalog?.page||0)+1)}>Next page</button></div>
      {/* Catalog cards are independent of the currently opened session. */}
      <div
        className={
          viewMode === "QUICK_GRID"
            ? "s2-review-grid-mode"
            : "s2-review-split-mode"
        }
      >
        {/* Left / Full Column: Visual Threads Post Cards */}
        <div
          className="s2-cards-column"
          role="list"
          aria-label="Danh sách thẻ bài viết Threads"
        >
          {filteredItems.map((item) => {
            const isSelected = activeItem?.id === item.id;
            const isChecked = batchCheckedIds.includes(item.id);
            const detail = item.data01PostId
              ? detailsByPostId[item.data01PostId]
              : null;
            const pubDate = formatVietnameseDate(
              detail?.bronze?.publishedAt || item.publishedAt,
            );
            const likes = detail?.bronze?.engagement?.likes ?? item.likesCount;
            const replies =
              detail?.bronze?.engagement?.replies ?? item.repliesCount;
            const reposts =
              detail?.bronze?.engagement?.reposts ?? item.repostsCount;
            const currentType = getEffectiveEntityType(item);
            const lastReview = detail?.evaluation?.review || null;

            return (
              <article
                key={item.id}
                role="listitem"
                data-testid={`review-card-${item.itemIndex}`}
                data-source-provenance={item.provenanceBadge}
                data-post-id={item.data01PostId}
                className={`s2-thread-card status-${item.evaluationStatus.toLowerCase()} ${
                  isSelected && viewMode === "SPLIT_DETAIL" ? "is-focused" : ""
                } ${isChecked ? "is-batch-checked" : ""}`}
                onClick={() => setSelectedId(item.id)}
              >
                {/* Card Top Header: Checkbox + Avatar + Author + Date + Status Badge */}
                <div className="s2-thread-card-head">
                  <div className="s2-thread-author-wrap">
                    <label
                      className="s2-card-checkbox"
                      onClick={(e) => e.stopPropagation()}
                      title="Chọn bài này để duyệt hàng loạt"
                    >
                      <input
                        type="checkbox"
                        checked={isChecked}
                        onChange={() => toggleBatchItem(item.id)}
                        aria-label={`Chọn bài viết của ${item.author}`}
                      />
                    </label>

                    <div className="s2-thread-avatar-box">
                      {item.avatarUrl ? (
                        <img
                          src={item.avatarUrl}
                          alt={item.author}
                          className="s2-thread-avatar"
                        />
                      ) : (
                        <span className="s2-thread-avatar-fallback">
                          {item.author.slice(0, 1).toUpperCase()}
                        </span>
                      )}
                      <span className="s2-scene-num">#{item.itemIndex}</span>
                    </div>

                    <div className="s2-thread-author-meta">
                      <div className="s2-author-name-row">
                        <strong>{item.author}</strong>
                        <span className="s2-handle">@{item.handle}</span>
                        {item.topic && (
                          <span className="s2-topic-chip">#{item.topic}</span>
                        )}
                        {(
                          <span
                            className="v3-prov-pill prov-review"
                            data-testid={item.provenanceBadge === "SYNTHETIC" ? "synthetic-badge" : "source-provenance-badge"}
                          >
                            {item.provenanceBadge}
                          </span>
                        )}
                      </div>
                      <div className="s2-post-submeta">
                        <span>📅 Đăng ngày {pubDate}</span>
                        <span>·</span>
                        <span>{item.wordCount} từ</span>
                        {item.audioDurationSec && (
                          <>
                            <span>·</span>
                            <span>🎙 {item.audioDurationSec.toFixed(1)}s</span>
                          </>
                        )}
                      </div>
                    </div>
                  </div>

                  <div className="s2-thread-head-right">
                    {renderStatusBadge(item)}
                  </div>
                </div>

                {/* Post Body Content */}
                <div className="s2-thread-body">
                  <p>{item.displayText}</p>
                </div>

                {/* Plain-Language "Why Good vs. Why Needs Review" Visual Diagnostic Strip */}
                <div className="s2-why-strip">
                  <div className="s2-why-group">
                    <span className="s2-why-label">Điểm mạnh:</span>
                    <div className="s2-signal-pills">
                      {item.positiveSignals.slice(0, 3).map((sig, i) => (
                        <span key={i} className="s2-sig-pill sig-good">
                          ✓ {sig}
                        </span>
                      ))}
                    </div>
                  </div>

                  {item.reviewBlockers.length > 0 && (
                    <div className="s2-why-group">
                      <span className="s2-why-label">Cần kiểm tra:</span>
                      <div className="s2-signal-pills">
                        {item.reviewBlockers.map((blk) => (
                          <span
                            key={blk.code}
                            className={`s2-sig-pill sig-${blk.severity}`}
                            title={blk.hint}
                          >
                            ⚠ {blk.title}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}
                </div>

                {/* Previous Review History Pill if already reviewed */}
                {lastReview && (
                  <div className="s2-last-review-banner">
                    <span>
                      🕒 Đã đánh giá ({lastReview.decision} ·{" "}
                      {lastReview.confirmedType || "POST"}):
                    </span>
                    <strong>"{lastReview.reason}"</strong>
                    <small>{formatVietnameseDate(lastReview.at)}</small>
                  </div>
                )}

                {/* Card Footer: Engagement Metrics + Quick Entity Type + 3 Decision Buttons */}
                <div
                  className="s2-thread-card-foot"
                  onClick={(e) => e.stopPropagation()}
                >
                  <div className="s2-engagement-pills">
                    {likes !== null && (
                      <span title="Lượt thích">
                        ♥ {formatCompactNumber(likes)}
                      </span>
                    )}
                    {replies !== null && (
                      <span title="Bình luận">
                        💬 {formatCompactNumber(replies)}
                      </span>
                    )}
                    {reposts !== null && (
                      <span title="Đăng lại">
                        ↻ {formatCompactNumber(reposts)}
                      </span>
                    )}
                    <a data-testid="source-permalink" href={item.sourceUrl} target="_blank" rel="noreferrer" onClick={e=>e.stopPropagation()}>Source permalink ↗</a>
                    <button
                      type="button"
                      className={`s2-include-chip ${item.selected ? "is-on" : ""}`}
                      disabled={!item.sessionItemId}
                      onClick={() =>
                        onUpdateItem(item.sessionItemId || "", { selected: !item.selected })
                      }
                    >
                      {item.selected ? "🎬 Có trong Video" : "○ Đang ẩn khỏi Video"}
                    </button>
                  </div>

                  {/* Quick Decision Controls directly on every card */}
                  <div className="s2-card-quick-actions">
                    <div
                      className="s2-type-Segmented compact"
                      role="group"
                      aria-label="Xác nhận loại bài"
                    >
                      <button
                        type="button"
                        className={currentType === "POST" ? "active" : ""}
                        onClick={() => setItemEntityType(item.id, "POST")}
                        title="Xác nhận đây là Bài đăng gốc"
                      >
                        Bài gốc
                      </button>
                      <button
                        type="button"
                        className={currentType === "COMMENT" ? "active" : ""}
                        onClick={() => setItemEntityType(item.id, "COMMENT")}
                        title="Xác nhận đây là Bình luận"
                      >
                        Bình luận
                      </button>
                    </div>

                    <button
                      type="button"
                      className="s2-decision-btn btn-accept"
                      disabled={locked || reviewPending}
                      onClick={() => requestSingleReview(item, "ACCEPT")}
                    >
                      ✓ Chấp nhận
                    </button>
                    <button
                      type="button"
                      className="s2-decision-btn btn-hold"
                      disabled={locked || reviewPending}
                      onClick={() => requestSingleReview(item, "NEEDS_REVIEW")}
                    >
                      ⏳ Cần xem lại
                    </button>
                    <button
                      type="button"
                      className="s2-decision-btn btn-reject"
                      disabled={locked || reviewPending}
                      onClick={() => requestSingleReview(item, "REJECT")}
                    >
                      ✕ Từ chối
                    </button>

                    {viewMode === "QUICK_GRID" && (
                      <button
                        type="button"
                        className="s2-btn-ghost"
                        onClick={() => {
                          setSelectedId(item.id);
                          setViewMode("SPLIT_DETAIL");
                        }}
                      >
                        Soi chi tiết →
                      </button>
                    )}
                  </div>
                </div>
              </article>
            );
          })}
        </div>

        {/* Right Column (Shown in SPLIT_DETAIL mode): Deep Evaluation, Script Editor & History Timeline */}
        {viewMode === "SPLIT_DETAIL" && (
          <aside
            className="s2-inspector-drawer"
            aria-label="Chi tiết đánh giá và lịch sử bài viết"
            data-testid="data-review-inspector"
          >
            {activeItem ? (
              <>
                <div className="s2-inspector-head">
                  <div className="s2-inspector-author">
                    {activeItem.avatarUrl ? (
                      <img
                        src={activeItem.avatarUrl}
                        alt={activeItem.author}
                        className="s2-thread-avatar"
                      />
                    ) : (
                      <span className="s2-thread-avatar-fallback">
                        {activeItem.author.slice(0, 1).toUpperCase()}
                      </span>
                    )}
                    <div>
                      <span className="s2-eyebrow-tag">
                        CẢNH #{activeItem.itemIndex} · @
                        {activeItem.handle}
                      </span>
                      <h3>{activeItem.author}</h3>
                    </div>
                  </div>
                  {renderStatusBadge(activeItem)}
                </div>

                {/* 3 Inspector Sub-Tabs: Đánh giá & Quyết định | Chỉnh sửa Lời đọc | Lịch sử Đánh giá */}
                <div
                  className="s2-inspector-tabs"
                  role="tablist"
                  aria-label="Các mục chi tiết"
                >
                  <button
                    type="button"
                    role="tab"
                    aria-selected={inspectorTab === "EVALUATION"}
                    className={inspectorTab === "EVALUATION" ? "active" : ""}
                    onClick={() => setInspectorTab("EVALUATION")}
                    data-testid="inspector-tab-evaluation"
                  >
                    🎯 Vì sao & Duyệt
                  </button>
                  <button
                    type="button"
                    role="tab"
                    aria-selected={inspectorTab === "SCRIPT"}
                    className={inspectorTab === "SCRIPT" ? "active" : ""}
                    onClick={() => setInspectorTab("SCRIPT")}
                    data-testid="inspector-tab-script"
                  >
                    ✍ Lời đọc & Hiển thị
                  </button>
                  <button
                    type="button"
                    role="tab"
                    aria-selected={inspectorTab === "HISTORY"}
                    className={inspectorTab === "HISTORY" ? "active" : ""}
                    onClick={() => setInspectorTab("HISTORY")}
                    data-testid="inspector-tab-history"
                  >
                    🕒 Lịch sử (
                    {(activeDetail?.evaluation?.transitions?.length || 0) +
                      (activeDetail?.evaluation?.review ? 1 : 0)}
                    )
                  </button>
                </div>

                {inspectorTab === "EVALUATION" && (
                  <div className="s2-inspector-body">
                    {/* Visual Explanation of Why Needs Review / Why Good */}
                    <div className="s2-explain-card">
                      <div className="s2-explain-top">
                        <div>
                          <strong>Tóm tắt Đánh giá Tự động</strong>
                          <p>
                            Giải thích rõ ràng bằng ngôn ngữ tự nhiên từ dữ liệu
                            DATA-01
                          </p>
                        </div>
                        {activeItem.ruleScore !== null && (
                          <div
                            className="s2-score-ring"
                            title="Điểm quy tắc tham khảo từ DATA-01"
                          >
                            <b>{activeItem.ruleScore.toFixed(0)}</b>
                            <small>/100</small>
                          </div>
                        )}
                      </div>

                      {activeItem.reviewBlockers.length > 0 ? (
                        <div className="s2-blocker-list">
                          {activeItem.reviewBlockers.map((b) => (
                            <div
                              key={b.code}
                              className={`s2-blocker-item severity-${b.severity}`}
                            >
                              <strong>⚠ {b.title}</strong>
                              <p>{b.hint}</p>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <div className={isUserAccepted(activeDetail?.evaluation?.review)?"s2-blocker-item severity-good":"s2-blocker-item severity-warning"}>
                          <strong>{isUserAccepted(activeDetail?.evaluation?.review)?"Đã có quyết định ACCEPT của người dùng":"Điểm quy tắc tham khảo — chưa được bạn duyệt"}</strong>
                          <p>Enqueue, duyệt kịch bản và audio vẫn là các thao tác riêng.</p>
                        </div>
                      )}

                      {/* 6-Criterion Visual Bars from DATA-01 Gold Breakdown */}
                      {activeDetail?.evaluation?.gold?.breakdown && (
                        <div className="s2-breakdown-bars">
                          <span className="s2-sub-heading">
                            Chi tiết 6 tiêu chí nội dung
                          </span>
                          {Object.entries(
                            activeDetail.evaluation.gold.breakdown,
                          ).map(([key, item]) => (
                            <div key={key} className="s2-metric-row">
                              <div className="s2-metric-label">
                                <span>{BREAKDOWN_LABELS[key] || key}</span>
                                <strong>{Math.round(item.value)}%</strong>
                              </div>
                              <div className="s2-metric-track">
                                <div
                                  className="s2-metric-fill"
                                  style={{
                                    width: `${Math.min(100, Math.max(6, item.value))}%`,
                                  }}
                                />
                              </div>
                              <small>{translateEngineReason(item.reason)}</small>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>

                    {/* Guided Human Decision Panel */}
                    <div className="s2-decision-card">
                      <h4>Ra quyết định cho bài viết này</h4>

                      <div className="s2-decision-step">
                        <span>1. Xác nhận loại bài viết trên Threads:</span>
                        <div className="s2-type-Segmented">
                          <button
                            type="button"
                            className={
                              getEffectiveEntityType(activeItem) === "POST"
                                ? "active"
                                : ""
                            }
                            onClick={() =>
                              setItemEntityType(activeItem.id, "POST")
                            }
                          >
                            📄 Bài đăng gốc (POST)
                          </button>
                          <button
                            type="button"
                            className={
                              getEffectiveEntityType(activeItem) === "COMMENT"
                                ? "active"
                                : ""
                            }
                            onClick={() =>
                              setItemEntityType(activeItem.id, "COMMENT")
                            }
                          >
                            💬 Bình luận (COMMENT)
                          </button>
                        </div>
                      </div>

                      <div className="s2-decision-step">
                        <span>2. Chọn nhanh hoặc nhập lý do đánh giá:</span>
                        <div className="s2-preset-chips">
                          {[
                            ...PRESET_REASONS.ACCEPT.slice(0, 2),
                            ...PRESET_REASONS.NEEDS_REVIEW.slice(0, 1),
                            ...PRESET_REASONS.REJECT.slice(0, 1),
                          ].map((preset) => (
                            <button
                              key={preset}
                              type="button"
                              className={`s2-preset-chip ${reviewReason === preset ? "active" : ""}`}
                              onClick={() => setReviewReason(preset)}
                            >
                              {preset}
                            </button>
                          ))}
                        </div>
                        <input
                          type="text"
                          className="s2-reason-input"
                          value={reviewReason}
                          onChange={(e) => setReviewReason(e.target.value)}
                          placeholder="Nhập ghi chú đánh giá của bạn..."
                        />
                      </div>

                      <div className="s2-decision-step">
                        <span>3. Chọn quyết định (có bước xác nhận an toàn):</span>
                        <div className="s2-decision-main-btns">
                          <button
                            type="button"
                            className="s2-decision-btn btn-accept large"
                            disabled={locked || reviewPending}
                            onClick={() =>
                              requestSingleReview(activeItem, "ACCEPT")
                            }
                            data-testid="inspector-btn-accept"
                          >
                            ✓ Chấp nhận (Đạt chuẩn)
                          </button>
                          <button
                            type="button"
                            className="s2-decision-btn btn-hold large"
                            disabled={locked || reviewPending}
                            onClick={() =>
                              requestSingleReview(activeItem, "NEEDS_REVIEW")
                            }
                            data-testid="inspector-btn-hold"
                          >
                            ⏳ Cần xem lại
                          </button>
                          <button
                            type="button"
                            className="s2-decision-btn btn-reject large"
                            disabled={locked || reviewPending}
                            onClick={() =>
                              requestSingleReview(activeItem, "REJECT")
                            }
                            data-testid="inspector-btn-reject"
                          >
                            ✕ Từ chối
                          </button>
                        </div>
                      </div>

                      {activeItem.evaluationStatus === "QUALIFIED" &&
                        !isUserAccepted(activeDetail?.evaluation?.review) && (
                          <div
                            className="s2-enqueue-callout"
                            data-testid="enqueue-needs-accept"
                          >
                            <span>
                              Bài này mới đạt ngưỡng chấm điểm tự động. Hãy bấm
                              “Chấp nhận” để xác nhận trước khi đưa vào Hàng
                              đợi Sản xuất.
                            </span>
                          </div>
                        )}
                      {activeItem.evaluationStatus === "QUALIFIED" &&
                        isUserAccepted(activeDetail?.evaluation?.review) && (
                        <div className="s2-enqueue-callout">
                          <span>
                            Bài viết đã Đạt chuẩn! Bạn có muốn xếp vào Hàng đợi
                            Sản xuất Video không?
                          </span>
                          <button
                            type="button"
                            className="s2-btn-primary"
                            disabled={locked} onClick={() => requestEnqueue(activeItem)}
                          >
                            🚀 Đưa vào Hàng đợi Sản xuất
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                )}

                {inspectorTab === "SCRIPT" && (
                  <div className="s2-inspector-body">
                    <div className="s2-script-section">
                      <label>
                        Văn bản gốc từ Threads (Được bảo toàn nguyên vẹn)
                      </label>
                      <pre className="s2-readonly-original">
                        {activeItem.originalText}
                      </pre>
                    </div>

                    <div className="s2-script-section">
                      <label>
                        Nội dung hiển thị trên Thẻ Video 9:16
                        <textarea
                          rows={3}
                          disabled={!activeItem.sessionItemId}
                          value={activeItem.displayText}
                          onChange={(e) =>
                            onUpdateItem(activeItem.sessionItemId || "", {
                              displayText: e.target.value,
                            })
                          }
                        />
                      </label>
                    </div>

                    <div className="s2-script-section">
                      <label>
                        Lời đọc giọng AI Kokoro (Viết rõ từ viết tắt nếu cần)
                        <textarea
                          rows={4}
                          disabled={!activeItem.sessionItemId}
                          value={activeItem.spokenText}
                          onChange={(e) =>
                            onUpdateItem(activeItem.sessionItemId || "", {
                              spokenText: e.target.value,
                            })
                          }
                        />
                      </label>
                    </div>

                    <div className="s2-script-footer">
                      <button
                        type="button"
                        className="s2-btn-secondary"
                        onClick={() => onRestoreItem(activeItem.sessionItemId || "")}
                        disabled={busy}
                      >
                        ↺ Khôi phục về nguyên bản
                      </button>
                      <button
                        type="button"
                        className="s2-btn-primary"
                        onClick={onSave}
                        disabled={busy || !dirty}
                      >
                        {dirty ? "💾 Lưu chỉnh sửa lời đọc" : "✓ Đã lưu lời đọc"}
                      </button>
                    </div>
                  </div>
                )}

                {inspectorTab === "HISTORY" && (
                  <div
                    className="s2-inspector-body"
                    data-testid="review-history-timeline"
                  >
                    <div className="s2-history-box">
                      <h4>Lịch sử Đánh giá & Chuyển trạng thái</h4>
                      <p className="s2-subtle">
                        Mọi bước kiểm tra tự động và quyết định của người dùng
                        đều được lưu vết bất biến trong DATA-01.
                      </p>

                      {activeDetail?.evaluation?.review ? (
                        <div className="s2-human-review-record">
                          <span className="s2-record-badge">
                            QUYẾT ĐỊNH CỦA BẠN:{" "}
                            {activeDetail.evaluation.review.decision}
                          </span>
                          <strong>
                            Loại bài xác nhận:{" "}
                            {activeDetail.evaluation.review.confirmedType ===
                            "COMMENT"
                              ? "Bình luận (COMMENT)"
                              : "Bài đăng gốc (POST)"}
                          </strong>
                          <p>
                            Lý do: "{activeDetail.evaluation.review.reason}"
                          </p>
                          <small>
                            Thời gian:{" "}
                            {new Date(
                              activeDetail.evaluation.review.at,
                            ).toLocaleString("vi-VN")}
                          </small>
                        </div>
                      ) : (
                        <div className="s2-no-human-review">
                          Chưa có quyết định duyệt thủ công nào cho bài viết
                          này.
                        </div>
                      )}

                      <div className="s2-timeline-list">
                        {(activeDetail?.evaluation?.transitions || []).map(
                          (tr, idx) => (
                            <div key={idx} className="s2-timeline-step">
                              <span
                                className={`s2-timeline-dot outcome-${tr.outcome.toLowerCase()}`}
                              />
                              <div className="s2-timeline-content">
                                <div className="s2-timeline-head">
                                  <strong>
                                    {STATE_VI_LABELS[tr.to] || tr.to}
                                  </strong>
                                  <small>
                                    {new Date(tr.at).toLocaleTimeString(
                                      "vi-VN",
                                    )}
                                  </small>
                                </div>
                                <p>{translateEngineReason(tr.reason)}</p>
                              </div>
                            </div>
                          ),
                        )}
                      </div>
                    </div>
                  </div>
                )}
              </>
            ) : (
              <div className="v2-empty-box">
                <p>Hãy chọn một thẻ bài viết bên trái để xem chi tiết.</p>
              </div>
            )}
          </aside>
        )}
      </div>
    </section>
  );
}
