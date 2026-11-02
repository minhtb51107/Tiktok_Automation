import { useState } from "react";
import type { LibraryAsset } from "../../../1_nest_backend/src/studio/public-assets";
import type { StudioMediaAsset } from "../../../1_nest_backend/src/studio/editor.types";
import type { EditorObject } from "./editor-timeline";
export function ContextAssets({
  library,
  uploads,
  context,
  category,
  setCategory,
  busy,
  assign,
  upload,
  remove,
  deleteUpload,
  canDelete,
  onAudition,
  recategorize,
}: {
  library: LibraryAsset[];
  uploads: StudioMediaAsset[];
  context: EditorObject;
  category: string;
  setCategory: (v: string) => void;
  busy: boolean;
  assign: (id: string, role: EditorObject) => void;
  upload: (f: File, category: string) => void;
  remove: (id: string) => void;
  deleteUpload: (a: StudioMediaAsset) => void;
  canDelete: (id: string) => boolean;
  onAudition: () => void;
  recategorize: (id: string, category: string) => void;
}) {
  const [query, setQuery] = useState(""),
    [limit, setLimit] = useState(12),
    [audition, setAudition] = useState<string | null>(null);
  const role:EditorObject=category==='SFX'?'SFX':category==='BGM'?'BGM':category==='MEME'||category==='GIF'?'MEME':category==='BACKGROUND'?'BACKGROUND':context==='MEME'?'MEME':context==='SFX'?'SFX':context==='BGM'?'BGM':'BACKGROUND';
  const userRows = [...uploads]
    .reverse()
    .map((a) => ({
      id: a.id,
      name: a.originalName,
      relativePath: "Uploads",
      uri: a.uri,
      bytes: a.bytes,
      kind: a.kind,
      category: a.category || "UPLOADS",
      uploaded: true,
    }));
  const rows =
    category === "UPLOADS"
      ? userRows
      : [...library.map((a) => ({ ...a, uploaded: false })), ...userRows]
          .filter((a) => a.category === category)
          .sort((a, b) => Number(b.uploaded) - Number(a.uploaded));
  const compatible = (a: (typeof rows)[number]) =>
    role === "MEME"
      ? ["MEME", "GIF", "UPLOADS"].includes(a.category) &&
        ["IMAGE", "GIF"].includes(a.kind)
      : role === "BACKGROUND"
        ? ["BACKGROUND", "UPLOADS"].includes(a.category) &&
          ["IMAGE", "GIF", "VIDEO"].includes(a.kind)
        : role === "SFX"
          ? a.category === "SFX" && a.kind === "AUDIO"
          : a.category === "BGM" && a.kind === "AUDIO";
  const accept: Record<string, string> = {
    MEME: "image/png,image/jpeg,image/webp",
    GIF: "image/gif",
    BACKGROUND: "image/png,image/jpeg,image/webp,video/mp4,video/webm",
    SFX: "audio/mpeg,audio/wav,audio/ogg,audio/mp4",
    BGM: "audio/mpeg,audio/wav,audio/ogg,audio/mp4",
    UPLOADS: "image/png,image/jpeg,image/webp,image/gif",
  };
  const filtered = rows.filter((a) =>
    (a.name + " " + a.relativePath).toLowerCase().includes(query.toLowerCase()),
  );
  return (
    <div className="context-assets">
      <div
        className="asset-categories"
        role="tablist"
        aria-label="Asset categories"
      >
        {["BACKGROUND", "MEME", "GIF", "SFX", "BGM", "UPLOADS", "OTHER"].map(
          (c) => (
            <button
              key={c}
              role="tab"
              aria-selected={category === c}
              onClick={() => {
                setCategory(c);
                setLimit(12);
                setQuery("");
                setAudition(null);
              }}
            >
              {
                (
                  {
                    BACKGROUND: "Background",
                    MEME: "Meme",
                    GIF: "GIF",
                    SFX: "SFX",
                    BGM: "BGM",
                    UPLOADS: "Uploads",
                    OTHER: "Other",
                  } as Record<string, string>
                )[c]
              }
            </button>
          ),
        )}
      </div>
      <p className="picker-context">
        Picker: <b>{role}</b> · {filtered.length} assets
      </p>
      <input
        aria-label="Search category assets"
        placeholder={"Search " + category.toLowerCase() + "…"}
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          setLimit(12);
        }}
      />
      {accept[category] && (
        <label className="upload-button">
          Upload to {category}
          <input
            aria-label="Upload category media"
            type="file"
            accept={accept[category]}
            disabled={busy}
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) {
                setQuery("");
                setLimit(12);
                upload(f, category);
              }
              e.target.value = "";
            }}
          />
          <small>Images ≤10 MB; audio/video ≤50 MB. Save before upload.</small>
        </label>
      )}
      <div className="context-asset-grid">
        {filtered.slice(0, limit).map((a) => (
          <article
            key={a.id}
            data-asset-id={a.id}
            draggable={compatible(a)}
            onDragStart={(e) =>
              e.dataTransfer.setData(
                "application/studio-asset",
                JSON.stringify({ id: a.id, role }),
              )
            }
            title={a.name}
          >
            <div className="asset-thumbnail">
              {["IMAGE", "GIF"].includes(a.kind) ? (
                <img src={a.uri} alt={a.name} loading="lazy" />
              ) : a.kind === "VIDEO" ? (
                audition === a.id ? (
                  <video
                    src={a.uri}
                    controls
                    autoPlay
                    muted
                    preload="metadata"
                  />
                ) : (
                  <span>▸ VIDEO</span>
                )
              ) : (
                <span>♫ AUDIO</span>
              )}
            </div>
            <strong>
              {/^[a-f0-9]{24,}\./i.test(a.name)
                ? category + " · " + a.name.slice(0, 8)
                : a.name.replace(/_/g, " ")}
            </strong>
            <small>
              {(a.bytes / 1024).toFixed(0)} KB ·{" "}
              {a.uploaded ? "Uploaded" : a.category}
            </small>
            {["AUDIO", "VIDEO", "GIF"].includes(a.kind) && (
              <button
                onClick={() => {
                  onAudition();
                  setAudition(audition === a.id ? null : a.id);
                }}
              >
                Preview
              </button>
            )}
            {a.kind === "AUDIO" && audition === a.id && (
              <audio src={a.uri} controls autoPlay preload="metadata" />
            )}
            {compatible(a) && (
              <button
                disabled={busy}
                data-action="assign-asset"
                onClick={() => assign(a.id, role)}
              >
                Use{" "}
                {role === "BACKGROUND"
                  ? "background"
                  : role === "MEME"
                    ? "meme"
                    : role}
              </button>
            )}
            {a.uploaded && (
              <>
                <select
                  aria-label={"Category " + a.name}
                  value={a.category}
                  disabled={busy}
                  onChange={(e) => recategorize(a.id, e.target.value)}
                >
                  {(a.kind === "AUDIO"
                    ? ["SFX", "BGM"]
                    : a.kind === "VIDEO"
                      ? ["BACKGROUND"]
                      : a.kind === "GIF"
                        ? ["GIF", "BACKGROUND"]
                        : ["MEME", "BACKGROUND", "UPLOADS"]
                  ).map((c) => (
                    <option key={c}>{c}</option>
                  ))}
                </select>
                <button disabled={busy} onClick={() => remove(a.id)}>
                  Remove from timeline
                </button>
                <button
                  disabled={busy || !canDelete(a.id)}
                  onClick={() =>
                    deleteUpload(uploads.find((x) => x.id === a.id)!)
                  }
                >
                  Delete upload
                </button>
              </>
            )}
          </article>
        ))}
      </div>
      {!filtered.length && <p>No assets in this category.</p>}
      {limit < filtered.length && (
        <button onClick={() => setLimit(limit + 12)}>Show more</button>
      )}
    </div>
  );
}
