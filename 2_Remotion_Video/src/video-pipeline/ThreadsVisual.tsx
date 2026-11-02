import React from "react";
import {
  AbsoluteFill,
  Img,
  Video,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import type {
  MediaAsset,
  TimelineScene,
} from "../../../1_nest_backend/src/video-pipeline/contracts";
import {
  cardPages,
  dateLabel,
  normalizeVisual,
} from "../../../1_nest_backend/src/video-pipeline/scene-visual";
const Image: React.FC<{
  uri: string;
  style: React.CSSProperties;
  avatar?: boolean;
}> = ({ uri, style, avatar }) => {
  const [failed, setFailed] = React.useState(false);
  return failed ? (
    avatar ? (
      <div style={{ ...style, background: style.background ?? "#edf0f4" }} />
    ) : null
  ) : (
    <Img src={uri} style={style} onError={() => setFailed(true)} />
  );
};
export const ThreadsVisual: React.FC<{
  item: TimelineScene;
  mediaAssets: MediaAsset[];
  background?: MediaAsset;
  transparent?:boolean;
}> = ({ item, mediaAssets, background, transparent }) => {
  const frame = useCurrentFrame(),
    { fps } = useVideoConfig(),
    v = normalizeVisual(item.scene.visual),
    c = v.card,
    card = item.scene.threadsCard!;
  const attachments = mediaAssets.filter(
    (a) => a.id.startsWith("source-") && a.kind !== "VIDEO",
  );
  const layout = cardPages(item.scene.displayText, v, attachments.length),
    contentStart = item.contentStartFrame - item.startFrame;
  const pageIndex = Math.min(
    layout.pages.length - 1,
    Math.floor(
      Math.max(0, frame - contentStart) /
        Math.max(
          1,
          (item.contentEndFrame - item.contentStartFrame) / layout.pages.length,
        ),
    ),
  );
  const meme = mediaAssets.find((a) => a.id === v.meme.assetId),
    memeY = v.meme.y ?? c.y + layout.height + v.meme.gap,
    memeX = v.meme.x ?? (1080 - v.meme.width) / 2;
  const showMeme =
    v.meme.enabled &&
    meme &&
    frame >= Math.ceil((v.meme.startMs * fps) / 1000) &&
    frame < Math.ceil(((v.meme.startMs + v.meme.durationMs) * fps) / 1000);
  const date = dateLabel(card.dateLabel) || dateLabel(card.createdAt);
  const dark = c.appearance === "DARK",
    palette = {
      background: dark ? "#181a20" : "#ffffff",
      text: dark ? "#f2f4f8" : "#10141b",
      muted: dark ? "#aeb5c2" : "#677180",
      border: dark ? "#353a45" : "#e4e7eb",
      avatar: dark ? "#343946" : "#edf0f4",
    };
  return (
    <AbsoluteFill
      style={{
        background: transparent ? "transparent" : "#e9edf4",
        fontFamily: "Arial, Helvetica, sans-serif",
        color: palette.text,
      }}
    >
      {background && (
        <AbsoluteFill data-editor-object="BACKGROUND">
          {background.kind === "VIDEO" ? (
            <Video
              data-testid="video-background"
              src={background.uri}
              muted
              loop
              preload="metadata"
              style={{
                position: "absolute",
                width: "100%",
                height: "100%",
                objectFit: "cover",
              }}
            />
          ) : (
            <Image
              uri={background.uri}
              style={{
                position: "absolute",
                width: "100%",
                height: "100%",
                objectFit: "cover",
              }}
            />
          )}
        </AbsoluteFill>
      )}
      <article
        data-testid="threads-video-card"
        data-editor-object="CARD"
        data-appearance={c.appearance ?? "LIGHT"}
        data-scene-id={item.scene.id}
        data-page={pageIndex + 1}
        style={{
          display:c.enabled===false || frame < Math.ceil((c.startMs||0)*fps/1000) || c.durationMs!==undefined && frame>=Math.ceil(((c.startMs||0)+c.durationMs)*fps/1000)?"none":undefined,
          position: "absolute",
          left: c.x,
          top: c.y,
          width: layout.width,
          padding: layout.pad,
          background: palette.background,
          color: palette.text,
          border: "1px solid " + palette.border,
          borderRadius: 28,
          boxShadow: "0 10px 44px #15294a24",
        }}
      >
        <div
          style={{
            display: "flex",
            gap: c.gap,
            alignItems: "flex-start",
            marginBottom: c.gap,
          }}
        >
          {card.avatarUrl ? (
            <Image
              key={card.avatarUrl}
              uri={card.avatarUrl}
              avatar
              style={{
                width: 64,
                height: 64,
                minWidth: 64,
                borderRadius: "50%",
                background: palette.avatar,
                objectFit: "cover",
              }}
            />
          ) : (
            <div
              style={{
                width: 64,
                height: 64,
                minWidth: 64,
                borderRadius: "50%",
                background: palette.avatar,
              }}
            />
          )}
          <div style={{ flex: 1, minWidth: 0, display:"flex",alignItems:"center",gap:12,flexWrap:"wrap" }}>
            <div
              style={{
                display: "flex",
                flexWrap: "wrap",
                gap: 12,
                fontSize: 30 * c.scale,
                lineHeight: 1.3,
              }}
            >
              <strong style={{fontWeight:600}}>{card.handle || card.author}</strong>
              {card.topic && (
                <>
                  <span style={{ color: palette.muted }}>›</span>
                  <span
                    data-testid="card-topic"
                    style={{ color: palette.muted, overflowWrap: "anywhere" }}
                  >
                    {card.topic}
                  </span>
                </>
              )}
            </div>
            {date && (
              <div
                data-testid="card-date"
                style={{
                  fontSize: 22 * c.scale,
                  color: palette.muted,
                  marginLeft:"auto",
                  whiteSpace:"nowrap",
                }}
              >
                {date}
              </div>
            )}
          </div>
        </div>
        <div
          data-testid="composition-display-text"
          style={{
            fontSize: layout.font,
            fontWeight:400,
            lineHeight: c.lineHeight ?? 1.45,
            width: "100%",
            minWidth: 0,
            color: palette.text,
            whiteSpace: "pre-wrap",
            overflowWrap: "anywhere",
          }}
        >
          {layout.pages[pageIndex]}
        </div>
        {attachments.length > 0 && (
          <div style={{ display: "flex", gap: 12, height: 180, marginTop: 18 }}>
            {attachments.map((a) => (
              <Image
                key={a.id}
                uri={a.uri}
                style={{
                  width: `${100 / attachments.length}%`,
                  height: 180,
                  objectFit: "contain",
                  borderRadius: 12,
                }}
              />
            ))}
          </div>
        )}
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            gap: 12,
            marginTop: c.gap,
            paddingTop: 18,
            borderTop: "1px solid " + palette.border,
            color: palette.muted,
            fontSize: 25 * c.scale,
          }}
        >
          {(["likes", "replies", "reposts", "shares"] as const).map((k, n) => (
            <div
              key={k}
              data-count={k}
              style={{ display: "flex", alignItems: "center", gap: 10 }}
            >
              <svg
                width="30"
                height="30"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.6"
              >
                <path
                  d={
                    [
                      "M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1.1-1.1a5.5 5.5 0 0 0-7.8 7.8L12 21l8.8-8.6a5.5 5.5 0 0 0 0-7.8Z",
                      "M21 11a9 9 0 1 1-4-7.5M21 11v10l-6-2",
                      "M4 8h15l-4-4M20 16H5l4 4M19 8v5M5 16v-5",
                      "M22 2 9 15M22 2l-8 20-5-7-7-5Z",
                    ][n]
                  }
                />
              </svg>
              {card.counts[k] !== null && (
                <span>{card.countLabels?.[k] || card.counts[k]}</span>
              )}
            </div>
          ))}
        </div>
        {layout.pages.length > 1 && (
          <div
            style={{
              fontSize: 20,
              color: palette.muted,
              textAlign: "right",
              marginTop: 12,
            }}
          >
            {pageIndex + 1}/{layout.pages.length}
          </div>
        )}
      </article>
      {showMeme && (
        <div
          data-testid="scene-meme"
          data-editor-object="MEME"
          style={{
            position: "absolute",
            left: memeX,
            top: memeY,
            width: v.meme.width,
            height: v.meme.height,
          }}
        >
          <Image
            key={meme!.id}
            uri={meme!.uri}
            style={{
              width: "100%",
              height: "100%",
              objectFit: "contain",
              borderRadius: 18,
            }}
          />
        </div>
      )}
    </AbsoluteFill>
  );
};
