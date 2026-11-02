import { useMemo, useState } from "react";
import type { StudioSession } from "../../../1_nest_backend/src/studio/studio.contracts";
import {
  computeMedallionItems,
  type Data01CatalogResponse,
  type MedallionItem,
} from "./studio-v2-adapter";

interface DataReviewProps {
  session: StudioSession | null;
  busy: boolean;
  dirty: boolean;
  data01Catalog?: Data01CatalogResponse | null;
  data01Connected?: boolean;
  onRefreshData01?: () => Promise<void>;
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
  | "QUARANTINE";

export function DataReviewWorkspace({
  session,
  busy,
  dirty,
  data01Catalog = null,
  data01Connected = false,
  onRefreshData01,
  onUpdateItem,
  onMoveItem,
  onRestoreItem,
  onSave,
  onNavigateStep,
}: DataReviewProps) {
  const [filter, setFilter] = useState<FilterTab>("ALL");
  const [search, setSearch] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [confirmedType, setConfirmedType] = useState<"POST" | "COMMENT" | "">(
    "",
  );
  const [reviewReason, setReviewReason] = useState("");
  const [reviewPending, setReviewPending] = useState(false);
  const [reviewNotice, setReviewNotice] = useState("");
  const [reviewError, setReviewError] = useState("");

  const { items, counts, dataProvenance } = useMemo(
    () => computeMedallionItems(session, data01Catalog, data01Connected),
    [session, data01Catalog, data01Connected],
  );

  const filteredItems = useMemo(() => {
    const q = search.trim().toLowerCase();
    return items.filter((item) => {
      if (filter === "NEEDS_REVIEW" && item.evaluationStatus !== "NEEDS_REVIEW")
        return false;
      if (filter === "QUALIFIED" && item.evaluationStatus !== "QUALIFIED")
        return false;
      if (filter === "QUEUED" && item.evaluationStatus !== "QUEUED")
        return false;
      if (filter === "QUARANTINE" && item.evaluationStatus !== "QUARANTINED")
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

  const submitData01Review = async (
    decision: "ACCEPT" | "REJECT" | "NEEDS_REVIEW",
  ) => {
    if (!activeItem?.data01PostId || activeItem.data01Revision === null) return;
    setReviewPending(true);
    setReviewError("");
    setReviewNotice("");
    try {
      const res = await fetch(
        `/api/studio/data/posts/${activeItem.data01PostId}/review`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            revision: activeItem.data01Revision,
            decision,
            reason: reviewReason.trim(),
            confirmedType: confirmedType || undefined,
          }),
        },
      );
      const json = await res.json();
      if (!res.ok) {
        throw new Error(
          json.error?.message || json.message || "Không thể lưu quyết định duyệt",
        );
      }
      setReviewNotice(
        `Đã lưu quyết định (${decision}) vào DATA-01. Dữ liệu gốc vẫn được bảo toàn.`,
      );
      setReviewReason("");
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
        `Đồng bộ hoàn tất (${d.status}): ${d.cursor}/${d.inputCount} bản ghi Bronze→Silver→Gold.`,
      );
      if (onRefreshData01) await onRefreshData01();
    } catch (err) {
      setReviewError((err as Error).message);
    } finally {
      setReviewPending(false);
    }
  };

  if (!session) {
    return (
      <section className="v2-workspace">
        <div className="v2-empty-box">
          <h3>Chưa chọn dự án</h3>
          <p>Hãy chọn một dự án Threads ở thanh bên trái để kiểm duyệt dữ liệu.</p>
        </div>
      </section>
    );
  }

  return (
    <section className="v2-workspace" aria-label="Duyệt dữ liệu DATA-01">
      <div className="v2-section-header">
        <div>
          <div className="v3-eyebrow-row">
            <span
              className={`v3-prov-pill ${data01Connected ? "prov-real" : "prov-disconnected"}`}
            >
              {dataProvenance}
            </span>
            <span className="v3-prov-pill prov-review">
              {counts.needsReview} NEEDS REVIEW
            </span>
          </div>
          <h2>Duyệt Dữ liệu Threads (Bronze → Silver → Gold)</h2>
          <p>
            Đánh giá thực tế từ động cơ DATA-01 cục bộ: {counts.bronzeObservations} bản
            ghi Bronze · {counts.silverValidated} bản ghi Silver hợp lệ ·{" "}
            {counts.goldScored} bản ghi Gold đã chấm điểm quy tắc ·{" "}
            <strong>{counts.needsReview} bài chờ người xác nhận</strong>.
          </p>
        </div>
        <div className="v2-header-actions">
          <button onClick={triggerData01Import} disabled={busy || reviewPending}>
            Đồng bộ phiên vào DATA-01
          </button>
          <button onClick={() => onNavigateStep("Script")}>
            Chuyển sang Kịch bản & Từ ngữ
          </button>
          <button
            className="primary"
            onClick={onSave}
            disabled={busy || !dirty}
          >
            {dirty ? "Lưu thay đổi dự án" : "Đã lưu cục bộ"}
          </button>
        </div>
      </div>

      {reviewError && (
        <div className="alert error" role="alert">
          {reviewError}
        </div>
      )}
      {reviewNotice && (
        <div className="v2-banner-warn" role="status">
          <span>{reviewNotice}</span>
        </div>
      )}

      {/* Filter Bar */}
      <div className="v2-filter-bar">
        <div className="v2-pill-group" role="tablist" aria-label="Lọc trạng thái">
          {(
            [
              { id: "ALL", label: `Tất cả (${items.length})` },
              {
                id: "NEEDS_REVIEW",
                label: `Cần duyệt (${counts.needsReview})`,
              },
              { id: "QUALIFIED", label: `Đạt chuẩn (${counts.qualified})` },
              { id: "QUEUED", label: `Trong hàng đợi (${counts.queued})` },
              { id: "QUARANTINE", label: `Cách ly (${counts.quarantine})` },
            ] as Array<{ id: FilterTab; label: string }>
          ).map((t) => (
            <button
              key={t.id}
              role="tab"
              aria-selected={filter === t.id}
              className={filter === t.id ? "v2-pill active" : "v2-pill"}
              onClick={() => setFilter(t.id)}
            >
              {t.label}
            </button>
          ))}
        </div>
        <input
          type="search"
          className="v2-search-input"
          placeholder="Tìm theo tác giả, @handle, chủ đề hoặc nội dung..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          aria-label="Tìm kiếm bài viết"
        />
      </div>

      {/* Master-Detail Split */}
      <div className="v2-master-detail">
        <div className="v2-card v2-table-card">
          <div className="v2-card-header">
            <h3>Danh sách bài viết ({filteredItems.length})</h3>
            <span className="v2-subtle">
              Điểm số là điểm quy tắc thử nghiệm (không phải % chất lượng tuyệt đối)
            </span>
          </div>
          <div className="v2-table-scroll">
            <table className="v2-table">
              <thead>
                <tr>
                  <th>#</th>
                  <th>Tác giả / Chủ đề</th>
                  <th>Trạng thái DATA-01</th>
                  <th>Điểm quy tắc</th>
                  <th>Giọng đọc</th>
                  <th>Lý do cần duyệt</th>
                  <th>Đưa vào Video</th>
                </tr>
              </thead>
              <tbody>
                {filteredItems.map((item) => {
                  const isCurrent = activeItem?.id === item.id;
                  return (
                    <tr
                      key={item.id}
                      className={isCurrent ? "is-selected" : ""}
                      onClick={() => setSelectedId(item.id)}
                    >
                      <td>#{item.itemIndex}</td>
                      <td>
                        <div className="v3-author-cell">
                          {item.avatarUrl ? (
                            <img
                              src={item.avatarUrl}
                              alt={item.author}
                              className="v3-avatar-xs"
                            />
                          ) : (
                            <span className="v3-avatar-fallback">
                              {item.author.slice(0, 1).toUpperCase()}
                            </span>
                          )}
                          <div>
                            <strong>{item.author}</strong>
                            <div className="v2-subtle">
                              @{item.handle}
                              {item.topic ? ` · #${item.topic}` : ""}
                            </div>
                          </div>
                        </div>
                      </td>
                      <td>
                        <span
                          className={`v2-status-pill ${
                            item.evaluationStatus === "QUALIFIED" ||
                            item.evaluationStatus === "QUEUED"
                              ? "status-success"
                              : item.evaluationStatus === "NEEDS_REVIEW"
                                ? "status-needs-review"
                                : "status-warning"
                          }`}
                        >
                          {item.evaluationStatus}
                        </span>
                      </td>
                      <td>
                        <strong>
                          {item.ruleScore !== null
                            ? `${item.ruleScore.toFixed(2)} / 100`
                            : "Chưa chấm"}
                        </strong>
                        <div className="v2-subtle">{item.wordCount} từ</div>
                      </td>
                      <td>
                        <span
                          className={`v2-status-pill ${
                            item.audioStatus === "APPROVED" ||
                            item.audioStatus === "DRAFT"
                              ? "status-success"
                              : "status-warning"
                          }`}
                        >
                          {item.audioStatus}
                        </span>
                        {item.audioDurationSec && (
                          <div className="v2-subtle">
                            {item.audioDurationSec.toFixed(1)}s
                          </div>
                        )}
                      </td>
                      <td>
                        {item.reviewReasons.slice(0, 2).map((r, idx) => (
                          <div key={idx} className="v2-subtle">
                            • {r}
                          </div>
                        ))}
                      </td>
                      <td onClick={(e) => e.stopPropagation()}>
                        <div className="v2-row-actions">
                          <button
                            className={item.selected ? "primary" : ""}
                            onClick={() =>
                              onUpdateItem(item.id, {
                                selected: !item.selected,
                              })
                            }
                          >
                            {item.selected ? "✓ Đang chọn" : "Đã loại"}
                          </button>
                          <button
                            onClick={() =>
                              onMoveItem(item.itemIndex - 1, -1)
                            }
                            disabled={item.itemIndex === 1}
                            title="Lên trên"
                          >
                            ↑
                          </button>
                          <button
                            onClick={() =>
                              onMoveItem(item.itemIndex - 1, 1)
                            }
                            disabled={item.itemIndex === items.length}
                            title="Xuống dưới"
                          >
                            ↓
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>

        {/* Right Detail Drawer */}
        <aside className="v2-card v2-detail-drawer">
          {activeItem ? (
            <>
              <div className="v2-card-header">
                <div>
                  <span className="v3-prov-pill prov-review">
                    {activeItem.evaluationStatus} ·{" "}
                    {activeItem.ruleScore !== null
                      ? `${activeItem.ruleScore} điểm`
                      : "Chưa chấm"}
                  </span>
                  <h3>
                    #{activeItem.itemIndex} · @{activeItem.handle}
                  </h3>
                </div>
                <span className="v2-subtle">Rev {activeItem.revision}</span>
              </div>

              <div className="v2-drawer-section">
                <label>Văn bản gốc Threads (Bất biến · Bronze Layer)</label>
                <pre className="v2-readonly-box">{activeItem.originalText}</pre>
              </div>

              {data01Connected && activeItem.data01PostId && (
                <div className="v2-drawer-section v3-review-box">
                  <label>Xác nhận Duyệt DATA-01 (Gold Layer Gate)</label>
                  <p className="v2-subtle">
                    Bài viết đang ở trạng thái <b>{activeItem.data01State}</b> (
                    {activeItem.evaluationStatus}). Để duyệt sang{" "}
                    <b>QUALIFIED</b>, vui lòng xác nhận loại bài và nhập lý do:
                  </p>
                  <label>
                    Loại mục tiêu (bắt buộc khi dữ liệu gốc là UNKNOWN)
                    <select
                      value={confirmedType}
                      onChange={(e) =>
                        setConfirmedType(
                          e.target.value as "POST" | "COMMENT" | "",
                        )
                      }
                    >
                      <option value="">-- Chọn loại thực thể --</option>
                      <option value="POST">Bài đăng gốc (POST)</option>
                      <option value="COMMENT">Bình luận / Phản hồi (COMMENT)</option>
                    </select>
                  </label>
                  <label>
                    Ghi chú / Lý do duyệt
                    <input
                      type="text"
                      placeholder="Ví dụ: Đã kiểm tra bài đăng gốc hợp lệ..."
                      value={reviewReason}
                      onChange={(e) => setReviewReason(e.target.value)}
                    />
                  </label>
                  <div className="v2-row-actions">
                    <button
                      className="primary"
                      disabled={
                        reviewPending ||
                        !reviewReason.trim() ||
                        !confirmedType
                      }
                      onClick={() => void submitData01Review("ACCEPT")}
                    >
                      ✓ Chấp nhận (QUALIFIED)
                    </button>
                    <button
                      disabled={reviewPending || !reviewReason.trim()}
                      onClick={() => void submitData01Review("NEEDS_REVIEW")}
                    >
                      Giữ Cần duyệt
                    </button>
                    <button
                      disabled={reviewPending || !reviewReason.trim()}
                      onClick={() => void submitData01Review("REJECT")}
                    >
                      Từ chối
                    </button>
                  </div>
                </div>
              )}

              <div className="v2-drawer-section">
                <label>Văn bản hiển thị trên Thẻ Video (Có thể chỉnh sửa)</label>
                <textarea
                  rows={3}
                  value={activeItem.displayText}
                  onChange={(e) =>
                    onUpdateItem(activeItem.id, { displayText: e.target.value })
                  }
                />
              </div>

              <div className="v2-drawer-section">
                <label>Kịch bản đọc TTS Kokoro (Có thể chỉnh sửa)</label>
                <textarea
                  rows={3}
                  value={activeItem.spokenText}
                  onChange={(e) =>
                    onUpdateItem(activeItem.id, { spokenText: e.target.value })
                  }
                />
              </div>

              <div className="v2-card-footer">
                <button
                  onClick={() => onRestoreItem(activeItem.id)}
                  disabled={busy}
                >
                  Khôi phục văn bản gốc
                </button>
                <button
                  className="primary"
                  onClick={onSave}
                  disabled={busy || !dirty}
                >
                  Lưu thay đổi
                </button>
              </div>
            </>
          ) : (
            <p className="v2-subtle">Chọn một bài viết để xem chi tiết.</p>
          )}
        </aside>
      </div>
    </section>
  );
}
