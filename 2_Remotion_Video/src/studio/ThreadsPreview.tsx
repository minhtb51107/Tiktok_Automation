import type { StudioItem } from "../../../1_nest_backend/src/studio/studio.contracts";
export function ThreadsPreview({
  item,
  onRefresh,
  disabled,
}: {
  item: StudioItem;
  onRefresh: () => void;
  disabled: boolean;
}) {
  const m = item.metadata;
  const date = m?.createdAt ? new Date(m.createdAt) : null;
  return (
    <section className="threads-preview">
      <div className="threads-identity">
        {m?.avatar ? (
          <img
            src={m.avatar}
            alt="Source avatar"
            referrerPolicy="no-referrer"
            loading="lazy"
          />
        ) : (
          <span className="avatar-missing">
            Avatar
            <br />
            UNAVAILABLE
          </span>
        )}
        <div>
          <strong>{m?.author || item.author.displayName}{(item.contentMapping?.topic||m?.topic)&&<span> › {item.contentMapping?.topic||m?.topic}</span>}</strong>
          <div>
            @{m?.handle || "handle unavailable"} ·{" "}
            {m?.fields?.createdAt?.raw ||
              (date && !isNaN(date.getTime())
                ? date.toLocaleDateString("vi-VN", {
                    timeZone: "Asia/Ho_Chi_Minh",
                  })
                : "Timestamp UNAVAILABLE")}
          </div>
        </div>
        <span>•••</span>
      </div>
      <p className="threads-original">{item.contentMapping?.bodyText??m?.bodyText??item.originalText}</p>
      <div className="threads-media">
        {m?.media.map((a, n) =>
          a.kind === "VIDEO" ? (
            <video src={a.url} key={n} controls preload="none" />
          ) : (
            <img
              key={n}
              src={a.url}
              alt={`Attached media ${n + 1}`}
              referrerPolicy="no-referrer"
              loading="lazy"
            />
          ),
        )}
        {!m?.media.length && (
          <small>Media: {m?.fields?.media?.status || "UNVERIFIED"}</small>
        )}
      </div>
      <div className="threads-metrics">
        {(
          ["likeCount", "replyCount", "repostCount", "shareCount"] as const
        ).map((k, n) => {
          const field = m?.fields?.[k];
          const value = m?.[k];
          return (
            <div key={k} title={field?.source || "No labelled evidence stored"}>
              <span>
                {["♡ Likes", "◯ Replies", "⇄ Reposts", "➤ Shares"][n]}
              </span>
              <b>
                {value != null
                  ? field?.raw || value.toLocaleString()
                  : field?.status || "UNVERIFIED"}
              </b>
              {field?.approximate && <small>rounded public value</small>}
            </div>
          );
        })}
      </div>
      <a href={item.sourceUrl} target="_blank" rel="noreferrer">
        Open original Threads permalink ↗
      </a>
      <div className="actions">
        <button disabled={disabled} onClick={onRefresh}>
          Refresh exact-target metadata
        </button>
        <button
          onClick={(e) => {
            const details = e.currentTarget
              .closest("article")
              ?.querySelector("details");
            if (details) details.open = !details.open;
          }}
        >
          Edit metadata & text
        </button>
      </div>
    </section>
  );
}
