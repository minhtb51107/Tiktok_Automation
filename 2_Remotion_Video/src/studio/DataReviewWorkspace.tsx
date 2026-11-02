import { useState } from "react";
import type {
  StudioSession,
  StudioItem,
} from "../../../1_nest_backend/src/studio/studio.contracts";
import { computeMedallionItems } from "./studio-v2-adapter";

export function DataReviewWorkspace({
  session,
  busy,
  dirty,
  onUpdateItem,
  onMoveItem,
  onSaveSession,
  onOpenStep,
}: {
  session: StudioSession | null;
  busy: boolean;
  dirty: boolean;
  onUpdateItem: (id: string, patch: Partial<StudioItem>) => void;
  onMoveItem: (id: string, direction: number) => void;
  onSaveSession: () => void;
  onOpenStep: (step: string) => void;
}) {
  const [tierFilter, setTierFilter] = useState<
    "ALL" | "GOLD" | "SILVER" | "BRONZE" | "QUARANTINE"
  >("ALL");
  const [search, setSearch] = useState("");
  const [activeId, setActiveId] = useState<string>(
    () => session?.items[0]?.id || "",
  );

  if (!session) {
    return (
      <section className="v2-empty-state" data-testid="data-review-empty">
        <h3>No Active Session Selected</h3>
        <p>Select or create a SERIOUS project session to review Bronze/Silver/Gold items.</p>
      </section>
    );
  }

  const medallion = computeMedallionItems(session);
  const filtered = medallion.items.filter((item) => {
    if (tierFilter !== "ALL" && item.tier !== tierFilter) return false;
    if (!search.trim()) return true;
    const q = search.toLowerCase();
    return (
      item.author.toLowerCase().includes(q) ||
      item.handle.toLowerCase().includes(q) ||
      item.originalText.toLowerCase().includes(q) ||
      item.spokenText.toLowerCase().includes(q)
    );
  });

  const inspected =
    medallion.items.find((i) => i.id === activeId) ||
    filtered[0] ||
    medallion.items[0];
  const rawItem = session.items.find((i) => i.id === inspected?.id);

  return (
    <div className="v2-workspace" data-testid="data-review-workspace">
      <div className="v2-page-header">
        <div>
          <span className="v2-eyebrow">
            MEDALLION CONTENT EVALUATION · REAL SESSION + DERIVED QUALITY GATE
          </span>
          <h2>Data Review & Quality Triage</h2>
          <p>
            Evaluate extracted Threads items across Bronze, Silver, Gold, and
            Quarantine tiers. Original text remains immutable; Accept/Reject
            toggles production inclusion.
          </p>
        </div>
        <div className="v2-header-actions">
          <button
            disabled={busy}
            onClick={() => onOpenStep("Script")}
          >
            Open Script Normalization
          </button>
          <button
            className="primary"
            disabled={busy || !dirty}
            onClick={onSaveSession}
          >
            {dirty ? "Save Review Decisions" : "All Decisions Saved"}
          </button>
        </div>
      </div>

      {/* Medallion Filter Bar */}
      <div className="v2-filter-bar" role="toolbar" aria-label="Medallion tier filters">
        <div className="v2-segmented">
          {(
            [
              { id: "ALL", label: `All (${medallion.items.length})` },
              { id: "GOLD", label: `Gold (${medallion.counts.gold})` },
              { id: "SILVER", label: `Silver (${medallion.counts.silver})` },
              { id: "BRONZE", label: `Bronze (${medallion.counts.bronze})` },
              {
                id: "QUARANTINE",
                label: `Quarantine (${medallion.counts.quarantine})`,
              },
            ] as const
          ).map((t) => (
            <button
              key={t.id}
              className={tierFilter === t.id ? "active" : ""}
              onClick={() => setTierFilter(t.id)}
            >
              {t.label}
            </button>
          ))}
        </div>
        <input
          type="search"
          aria-label="Filter items by author or text"
          placeholder="Search author, @handle, spoken text, or topic…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="v2-search-input"
        />
      </div>

      {/* Duplicate Clusters Alert */}
      {medallion.duplicates.length > 0 && (
        <section className="v2-banner status-warning">
          <strong>
            {medallion.duplicates.length} Duplicate Cluster(s) Detected:
          </strong>{" "}
          {medallion.duplicates
            .map((d) => `${d.groupId}: ${d.reason} (${d.itemIds.length} items)`)
            .join(" · ")}
        </section>
      )}

      {/* Split Master-Detail Table + Drawer */}
      <div className="v2-master-detail">
        <section className="v2-card v2-table-card">
          <div className="v2-card-header">
            <h3>Evaluated Content Items ({filtered.length})</h3>
            <small>
              {session.items.filter((i) => i.selected).length} accepted for
              production
            </small>
          </div>
          <div className="v2-table-scroll">
            <table className="v2-table" data-testid="medallion-table">
              <thead>
                <tr>
                  <th>Order</th>
                  <th>Author / Handle</th>
                  <th>Tier</th>
                  <th>Score</th>
                  <th>Audio / TTS</th>
                  <th>Issues / Locks</th>
                  <th>Decision</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((row) => (
                  <tr
                    key={row.id}
                    className={
                      (inspected?.id === row.id ? "is-active-row " : "") +
                      (row.selected ? "is-selected-row" : "")
                    }
                    onClick={() => setActiveId(row.id)}
                  >
                    <td>
                      <span className="v2-mono">#{row.itemIndex}</span>
                    </td>
                    <td>
                      <strong>{row.author}</strong>
                      <small className="v2-block-sub">
                        @{row.handle}
                        {row.topic ? ` · › ${row.topic}` : ""}
                      </small>
                    </td>
                    <td>
                      <span
                        className={`v2-tier-badge tier-${row.tier.toLowerCase()}`}
                      >
                        {row.tier}
                      </span>
                    </td>
                    <td>
                      <strong className="v2-mono">{row.qualityScore}/100</strong>
                      <small className="v2-block-sub">{row.wordCount} words</small>
                    </td>
                    <td>
                      <span
                        className={`v2-status-pill status-${row.audioStatus === "APPROVED" || row.audioStatus === "DRAFT" ? "success" : "warning"}`}
                      >
                        {row.audioStatus}
                      </span>
                      {row.audioDurationSec !== null && (
                        <small className="v2-block-sub v2-mono">
                          {row.audioDurationSec.toFixed(2)}s
                        </small>
                      )}
                    </td>
                    <td>
                      {row.ambiguities.length > 0 ? (
                        <span className="v2-status-pill status-needs-review">
                          {row.ambiguities.length} ambiguity
                        </span>
                      ) : (
                        <span className="v2-muted">Clean</span>
                      )}
                      {row.manualLocks.length > 0 && (
                        <small className="v2-block-sub">
                          🔒 {row.manualLocks.join(", ")}
                        </small>
                      )}
                    </td>
                    <td onClick={(e) => e.stopPropagation()}>
                      <div className="v2-row-actions">
                        <button
                          className={row.selected ? "primary" : ""}
                          disabled={busy}
                          onClick={() =>
                            onUpdateItem(row.id, { selected: !row.selected })
                          }
                        >
                          {row.selected ? "✓ Accepted" : "Quarantine / Excluded"}
                        </button>
                        <button
                          aria-label={`Move row ${row.itemIndex} up`}
                          disabled={busy || row.itemIndex === 1}
                          onClick={() => onMoveItem(row.id, -1)}
                        >
                          ↑
                        </button>
                        <button
                          aria-label={`Move row ${row.itemIndex} down`}
                          disabled={
                            busy || row.itemIndex === session.items.length
                          }
                          onClick={() => onMoveItem(row.id, 1)}
                        >
                          ↓
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        {/* Right Inspection Drawer */}
        {inspected && rawItem && (
          <aside className="v2-card v2-inspector-drawer" data-testid="data-review-inspector">
            <div className="v2-card-header">
              <div>
                <span className={`v2-tier-badge tier-${inspected.tier.toLowerCase()}`}>
                  {inspected.tier} · SCORE {inspected.qualityScore}
                </span>
                <h3>
                  #{inspected.itemIndex} · {inspected.author}
                </h3>
              </div>
              <small className="v2-mono">Rev {inspected.revision}</small>
            </div>

            {inspected.rejectionOrReviewReasons.length > 0 && (
              <div className="v2-drawer-alert">
                <strong>Quality & Review Diagnostics:</strong>
                <ul>
                  {inspected.rejectionOrReviewReasons.map((r, idx) => (
                    <li key={idx}>{r}</li>
                  ))}
                </ul>
              </div>
            )}

            <label className="v2-field-label">
              Immutable Original Text (Read-Only Provenance)
              <pre className="v2-readonly-box">{rawItem.originalText}</pre>
            </label>

            <label className="v2-field-label">
              Card Display Text (Editable)
              <textarea
                rows={3}
                disabled={busy}
                value={rawItem.displayText}
                onChange={(e) =>
                  onUpdateItem(rawItem.id, { displayText: e.target.value })
                }
              />
            </label>

            <label className="v2-field-label">
              TTS Spoken Text (Editable)
              <textarea
                rows={4}
                disabled={busy}
                value={rawItem.spokenText}
                onChange={(e) =>
                  onUpdateItem(rawItem.id, { spokenText: e.target.value })
                }
              />
            </label>

            <div className="v2-drawer-actions">
              <button
                disabled={busy}
                onClick={() =>
                  onUpdateItem(rawItem.id, {
                    selected: !rawItem.selected,
                  })
                }
              >
                {rawItem.selected ? "Exclude from Production" : "Accept into Production"}
              </button>
              <button
                disabled={busy}
                onClick={() =>
                  onUpdateItem(rawItem.id, {
                    displayText: rawItem.originalText,
                    spokenText: rawItem.originalText,
                  })
                }
              >
                Restore Original Text
              </button>
              <button
                className="primary"
                disabled={busy || !dirty}
                onClick={onSaveSession}
              >
                Save Item Changes
              </button>
            </div>
          </aside>
        )}
      </div>
    </div>
  );
}
