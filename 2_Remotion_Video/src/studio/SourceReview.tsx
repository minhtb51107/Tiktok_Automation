import { useState } from "react";
export function MediaPreview({ item }: { item: StudioItem }) {
  const [open, setOpen] = useState(false);
  return (
    <div>
      <button onClick={() => setOpen(!open)}>
        {open ? "Hide" : "Load"} media preview (
        {item.metadata?.media.length || 0})
      </button>
      {open &&
        item.metadata?.media.map((m, n) =>
          m.kind === "VIDEO" ? (
            <video
              key={n}
              src={m.url}
              controls
              preload="none"
              style={{ maxWidth: "100%", maxHeight: 300 }}
            />
          ) : (
            <img
              key={n}
              src={m.url}
              alt={`Source media ${n + 1}`}
              loading="lazy"
              referrerPolicy="no-referrer"
              style={{ maxWidth: "100%", maxHeight: 300 }}
            />
          ),
        )}
    </div>
  );
}
import type {
  StudioItem,
  StudioSession,
} from "../../../1_nest_backend/src/studio/studio.contracts";
export function UrlRows({
  session,
  disabled,
  onFetch,
}: {
  session: StudioSession;
  disabled: boolean;
  onFetch: (
    urls: string[],
    scope: "TARGET_ONLY" | "WITH_CONTEXT",
  ) => Promise<void>;
}) {
  const [rows, setRows] = useState<string[]>(
    () => session.attempts?.map((a) => a.originalUrl) || [""],
  );
  const [paste, setPaste] = useState(""),
    [message, setMessage] = useState(""),
    [active, setActive] = useState<string | null>(null),
    [filterMode, setFilterMode] = useState<"ALL" | "FAILED" | "READY">("ALL"),
    [page, setPage] = useState(0),
    [showAllRows, setShowAllRows] = useState(false),
    [collections, setCollections] = useState<
      Array<{
        id: string;
        rootUrl: string;
        authorHandle: string;
        textPreview: string;
        verifiedReplyCount: number;
        observedCardCount: number;
      }>
    >([]),
    [selectedCollectionId, setSelectedCollectionId] = useState(""),
    [collectionsLoaded, setCollectionsLoaded] = useState(false);
  const [scope, setScope] = useState<"TARGET_ONLY" | "WITH_CONTEXT">(
    session.scope || "TARGET_ONLY",
  );
  const PAGE_SIZE = 15;
  const unique = (v: string) => {
    try {
      const u = new URL(v);
      u.search = "";
      u.hash = "";
      return u.href.replace(/\/$/, "");
    } catch {
      return v.trim();
    }
  };
  const values = rows.map((x) => x.trim()).filter(Boolean);
  const add = (input: string) => {
    const incoming = input
      .split(/[\r\n\s,;]+/)
      .map((x) => x.trim())
      .filter(Boolean);
    const merged = [...rows.filter((x) => x.trim()), ...incoming];
    const seen = new Set<string>();
    let duplicates = 0;
    const next = merged.filter((x) => {
      const key = unique(x);
      if (seen.has(key)) {
        duplicates++;
        return false;
      }
      seen.add(key);
      return true;
    });
    setRows(next.length ? next : [""]);
    setPaste("");
    setMessage(
      duplicates > 0
        ? `Added ${next.length} unique URL(s) (${duplicates} duplicate URL(s) deduplicated).`
        : `Queue ready: ${next.length} unique URL(s).`,
    );
  };
  const moveRow = (index: number, delta: -1 | 1) => {
    const target = index + delta;
    if (target < 0 || target >= rows.length) return;
    const next = [...rows];
    const [picked] = next.splice(index, 1);
    next.splice(target, 0, picked);
    setRows(next);
  };
  const fetchRows = async (urls: string[]) => {
    const clean = urls.map((u) => u.trim()).filter(Boolean);
    if (!clean.length) return;
    try {
      setActive(clean.length === 1 ? clean[0] : `BATCH (${clean.length})`);
      await onFetch(clean, scope);
    } finally {
      setActive(null);
    }
  };
  const failedOrPendingUrls = values.filter((url) => {
    const attempt = session.attempts?.find(
      (a) => unique(a.originalUrl) === unique(url),
    );
    return !attempt || attempt.status === "ERROR";
  });
  const indexedRows = rows
    .map((url, index) => ({
      url,
      index,
      attempt: session.attempts?.find(
        (a) => unique(a.originalUrl) === unique(url),
      ),
    }))
    .filter((entry) => {
      if (filterMode === "FAILED")
        return !entry.attempt || entry.attempt.status === "ERROR";
      if (filterMode === "READY")
        return (
          !!entry.attempt &&
          (entry.attempt.status === "SUCCESS" ||
            entry.attempt.status === "PARTIAL")
        );
      return true;
    });
  const totalPages = Math.max(1, Math.ceil(indexedRows.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages - 1);
  const visibleRows = showAllRows
    ? indexedRows
    : indexedRows.slice(safePage * PAGE_SIZE, (safePage + 1) * PAGE_SIZE);
  const loadSavedCollections = async () => {
    try {
      const res = await fetch("/api/studio/collections");
      if (!res.ok) return;
      const list = await res.json();
      if (Array.isArray(list)) {
        setCollections(list);
        if (list[0]?.id && !selectedCollectionId)
          setSelectedCollectionId(list[0].id);
      }
      setCollectionsLoaded(true);
    } catch {}
  };
  const importSelectedCollection = async () => {
    if (!selectedCollectionId) return;
    try {
      setActive("COLLECTION_IMPORT");
      const res = await fetch(
        `/api/studio/sessions/${session.id}/import-collection`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            revision: session.revision,
            collectionId: selectedCollectionId,
            includeAllVerified: true,
          }),
        },
      );
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        setMessage(err.message || "Collection import failed.");
        return;
      }
      setMessage(
        "Imported root post and verified replies directly from ThreadCollection. Reloading session…",
      );
      window.location.reload();
    } finally {
      setActive(null);
    }
  };
  return (
    <div className="url-workspace">
      <label>
        Extraction scope
        <select
          disabled={disabled}
          value={scope}
          onChange={(e) => setScope(e.target.value as typeof scope)}
        >
          <option value="TARGET_ONLY">TARGET_ONLY — exact supplied URLs</option>
          <option value="WITH_CONTEXT">
            WITH_CONTEXT — explicitly include nearby cards
          </option>
        </select>
      </label>
      <p>
        Paste a Threads Share link or permalink (unlimited queue, sequential bounded concurrency = 1).
        {" "}Một permalink: chọn WITH_CONTEXT để lấy bài cùng các thẻ quan sát; hoặc nhập trực tiếp từ ThreadCollection đã thu thập.
      </p>
      {session.urlQueue && (
        <p className="media" data-testid="url-queue-summary">
          Queue summary: {session.urlQueue.uniqueValidCount} unique valid ·{" "}
          {session.urlQueue.succeededCount} succeeded ·{" "}
          {session.urlQueue.failedCount} failed ·{" "}
          {session.urlQueue.duplicateCount} duplicate(s) removed ·{" "}
          {session.urlQueue.malformedCount} malformed · concurrency ={" "}
          {session.urlQueue.concurrency}
        </p>
      )}
      {rows.length > 6 && (
        <div className="actions" style={{ marginBottom: 8 }}>
          <label>
            Filter queue
            <select
              value={filterMode}
              onChange={(e) => {
                setFilterMode(e.target.value as typeof filterMode);
                setPage(0);
              }}
            >
              <option value="ALL">All ({rows.length})</option>
              <option value="FAILED">
                Pending / Failed ({failedOrPendingUrls.length})
              </option>
              <option value="READY">
                Fetched ({rows.length - failedOrPendingUrls.length})
              </option>
            </select>
          </label>
          {indexedRows.length > PAGE_SIZE && (
            <>
              <button
                type="button"
                disabled={showAllRows || safePage <= 0}
                onClick={() => setPage(Math.max(0, safePage - 1))}
              >
                Prev Page
              </button>
              <span className="badge">
                {showAllRows
                  ? `Showing all ${indexedRows.length}`
                  : `Page ${safePage + 1}/${totalPages} (${indexedRows.length} rows)`}
              </span>
              <button
                type="button"
                disabled={showAllRows || safePage >= totalPages - 1}
                onClick={() => setPage(Math.min(totalPages - 1, safePage + 1))}
              >
                Next Page
              </button>
              <button
                type="button"
                onClick={() => setShowAllRows((prev) => !prev)}
              >
                {showAllRows ? "Paginate (15/page)" : "Show All"}
              </button>
            </>
          )}
        </div>
      )}
      {visibleRows.map(({ url, index: n, attempt }) => {
        return (
          <div className="url-entry" key={n}>
            <label>
              Source {n + 1}
              <input
                aria-label={`Source URL ${n + 1}`}
                value={url}
                placeholder="https://www.threads.com/share/…"
                onChange={(e) => {
                  const next = [...rows];
                  next[n] = e.target.value;
                  setRows(next);
                }}
                onBlur={() => {
                  if (values.length === rows.length) add("");
                }}
                onPaste={(e) => {
                  const text = e.clipboardData.getData("text");
                  if (/\s/.test(text.trim())) {
                    e.preventDefault();
                    add(text);
                  }
                }}
              />
            </label>
            <div className="actions">
              <span className="badge">
                {active === url || (active?.startsWith("BATCH") && !attempt)
                  ? "Fetching…"
                  : attempt?.status || "Not fetched"}
              </span>
              <button
                disabled={disabled || !!active || !url.trim()}
                onClick={() => void fetchRows([url])}
              >
                {attempt ? "Retry URL" : "Fetch URL"}
              </button>
              <button
                type="button"
                title="Move URL up"
                disabled={disabled || !!active || n === 0}
                onClick={() => moveRow(n, -1)}
              >
                ↑
              </button>
              <button
                type="button"
                title="Move URL down"
                disabled={disabled || !!active || n >= rows.length - 1}
                onClick={() => moveRow(n, 1)}
              >
                ↓
              </button>
              <button
                disabled={disabled || !!active}
                onClick={() => {
                  const next = rows.filter((_, i) => i !== n);
                  setRows(next.length ? next : [""]);
                }}
              >
                Remove
              </button>
            </div>
            {attempt && (
              <details>
                <summary>
                  Resolution & diagnostics ·{" "}
                  {(attempt.elapsedMs / 1000).toFixed(1)}s
                </summary>
                <p className="media">
                  Original: {attempt.originalUrl}
                  <br />
                  Resolved: {attempt.resolvedUrl || "Unavailable"}
                  <br />
                  Canonical: {attempt.canonicalUrl || "Unavailable"}
                </p>
                {attempt.diagnostics.map((d, i) => (
                  <p key={i}>
                    {d.stage} / {d.code}: {d.message}
                  </p>
                ))}
              </details>
            )}
          </div>
        );
      })}
      <div className="actions">
        <button
          disabled={disabled}
          onClick={() => setRows([...rows, ""])}
        >
          ＋ Add URL
        </button>
        <button
          className="primary"
          disabled={disabled || !!active || !values.length}
          onClick={() => void fetchRows(values)}
        >
          Fetch Content ({values.length} URL{values.length === 1 ? "" : "s"})
        </button>
        {failedOrPendingUrls.length > 0 &&
          failedOrPendingUrls.length < values.length && (
            <button
              type="button"
              disabled={disabled || !!active}
              onClick={() => void fetchRows(failedOrPendingUrls)}
            >
              Resume Failed/Pending ({failedOrPendingUrls.length})
            </button>
          )}
      </div>
      <details>
        <summary>Paste multiple URLs (bulk import & deduplicate)</summary>
        <textarea
          aria-label="Paste multiple URLs"
          value={paste}
          onChange={(e) => setPaste(e.target.value)}
          placeholder="One or more Threads URLs (newline, space, or comma separated — no 5-URL limit)"
        />
        <button onClick={() => add(paste)}>Add pasted URLs</button>
      </details>
      <details
        onToggle={(e) => {
          if ((e.currentTarget as HTMLDetailsElement).open && !collectionsLoaded)
            void loadSavedCollections();
        }}
      >
        <summary>
          Import directly from collected ThreadCollection (root + verified replies)
        </summary>
        <div className="actions" style={{ marginTop: 8 }}>
          <button
            type="button"
            disabled={disabled || !!active}
            onClick={() => void loadSavedCollections()}
          >
            Refresh Saved Collections
          </button>
          {collections.length > 0 && (
            <>
              <select
                aria-label="Select ThreadCollection"
                value={selectedCollectionId}
                onChange={(e) => setSelectedCollectionId(e.target.value)}
              >
                {collections.map((c) => (
                  <option key={c.id} value={c.id}>
                    @{c.authorHandle} · {c.verifiedReplyCount} verified replies ·{" "}
                    {c.observedCardCount} observed cards · {c.textPreview.slice(0, 48)}
                  </option>
                ))}
              </select>
              <button
                type="button"
                className="primary"
                disabled={disabled || !!active || !selectedCollectionId}
                onClick={() => void importSelectedCollection()}
              >
                Import Root + Verified Replies
              </button>
            </>
          )}
        </div>
      </details>
      <small role="status">{message}</small>
    </div>
  );
}
export function MetadataEditor({
  item,
  onChange,
}: {
  item: StudioItem;
  onChange: (patch: Partial<StudioItem>) => void;
}) {
  const m = item.metadata;
  if (!m) return <p>Legacy item: metadata unavailable.</p>;
  const patch = (p: Partial<typeof m>) =>
    onChange({ metadata: { ...m, ...p } });
  return (
    <details>
      <summary>Author, media & source metadata · fill missing fields</summary>
      <div className="edit-grid">
        <label>
          Author name
          <input
            value={m.author}
            onChange={(e) => patch({ author: e.target.value })}
          />
        </label>
        <label>
          Handle
          <input
            value={m.handle || ""}
            onChange={(e) => patch({ handle: e.target.value })}
          />
        </label>
        <label>
          Avatar URL (HTTPS)
          <input
            value={m.avatar || ""}
            onChange={(e) => patch({ avatar: e.target.value })}
          />
        </label>
        <label>
          Created timestamp
          <input
            value={m.createdAt || ""}
            onChange={(e) => patch({ createdAt: e.target.value })}
          />
        </label>
      </div>
      <p>
        Type: {m.type} · Parent: {m.parentReference || "Unavailable"} · Likes:{" "}
        {m.likeCount ?? "Unavailable"} · Replies:{" "}
        {m.replyCount ?? "Unavailable"} · Reposts:{" "}
        {m.repostCount ?? "Unavailable"}
      </p>
      <div className="edit-grid">
        <label>
          Verified type (manual)
          <select
            value={m.type}
            onChange={(e) => patch({ type: e.target.value as typeof m.type })}
          >
            {["UNKNOWN", "POST", "COMMENT"].map((t) => (
              <option key={t}>{t}</option>
            ))}
          </select>
        </label>
        <label>
          Parent URL / source reference
          <input
            value={m.parentReference || ""}
            onChange={(e) => patch({ parentReference: e.target.value || null })}
          />
        </label>
        {(
          ["likeCount", "replyCount", "repostCount", "shareCount"] as const
        ).map((key) => (
          <label key={key}>
            {key} (blank = unavailable)
            <input
              type="number"
              min={0}
              value={m[key] ?? ""}
              onChange={(e) =>
                patch({
                  [key]: e.target.value === "" ? null : Number(e.target.value),
                })
              }
            />
          </label>
        ))}
      </div>
      {m.media.map((media, n) => (
        <div className="actions" key={n}>
          <select
            aria-label="Media kind"
            value={media.kind}
            onChange={(e) =>
              patch({
                media: m.media.map((v, i) =>
                  i === n ? { ...v, kind: e.target.value as typeof v.kind } : v,
                ),
              })
            }
          >
            {["IMAGE", "GIF", "VIDEO"].map((t) => (
              <option key={t}>{t}</option>
            ))}
          </select>
          <input
            aria-label="Media URL"
            value={media.url}
            onChange={(e) =>
              patch({
                media: m.media.map((v, i) =>
                  i === n ? { ...v, url: e.target.value } : v,
                ),
              })
            }
          />
          <button
            onClick={() => patch({ media: m.media.filter((_, i) => i !== n) })}
          >
            Remove media
          </button>
        </div>
      ))}
      <button
        onClick={() =>
          patch({ media: [...m.media, { url: "", kind: "IMAGE" }] })
        }
      >
        Add media reference
      </button>
      <button
        disabled={!item.rawExtraction}
        onClick={() => patch(structuredClone(item.rawExtraction!))}
      >
        Restore extracted metadata
      </button>
      <details>
        <summary>Immutable raw fields and provenance</summary>
        <pre>{JSON.stringify(item.rawExtraction, null, 2)}</pre>
      </details>
    </details>
  );
}
