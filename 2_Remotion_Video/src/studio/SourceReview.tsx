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
    [active, setActive] = useState<string | null>(null);
  const [scope, setScope] = useState<"TARGET_ONLY" | "WITH_CONTEXT">(
    session.scope || "TARGET_ONLY",
  );
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
    const merged = [
      ...rows.filter((x) => x.trim()),
      ...input.split(/\s+/).filter(Boolean),
    ];
    const seen = new Set<string>();
    const next = merged.filter((x) => {
      const key = unique(x);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    if (next.length > 5) {
      setMessage("Maximum 5 URLs. Remove a row before adding more.");
      return;
    }
    setRows(next.length ? next : [""]);
    setPaste("");
    setMessage("Duplicate URLs removed.");
  };
  const fetchRows = async (urls: string[]) => {
    try {
      for (const url of urls) {
        setActive(url);
        await onFetch([url], scope);
      }
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
        Paste a Threads Share link or permalink. Each row is a separate source.
      </p>
      {rows.map((url, n) => {
        const attempt = session.attempts?.find(
          (a) => unique(a.originalUrl) === unique(url),
        );
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
                {active === url
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
                disabled={disabled || !!active}
                onClick={() => setRows(rows.filter((_, i) => i !== n))}
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
          disabled={disabled || rows.length >= 5}
          onClick={() => setRows([...rows, ""])}
        >
          ＋ Add URL
        </button>
        <button
          className="primary"
          disabled={disabled || !!active || !values.length}
          onClick={() => void fetchRows(values)}
        >
          Fetch Content ({values.length}/5)
        </button>
      </div>
      <details>
        <summary>Paste multiple URLs</summary>
        <textarea
          aria-label="Paste multiple URLs"
          value={paste}
          onChange={(e) => setPaste(e.target.value)}
          placeholder="One URL per line"
        />
        <button onClick={() => add(paste)}>Add pasted URLs</button>
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
