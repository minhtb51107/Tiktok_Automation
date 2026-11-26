import React from "react";
import { AnimatedGif } from "./AnimatedGif";
import {
  AbsoluteFill,
  Img,
  OffthreadVideo,
  Video,
  useCurrentFrame,
  useRemotionEnvironment,
  useVideoConfig,
} from "remotion";
import type {
  MediaAsset,
  TimelineScene,
} from "../../../1_nest_backend/src/video-pipeline/contracts";
import { dateLabel } from "../../../1_nest_backend/src/video-pipeline/scene-visual";
import { threadsCardState } from "../../../1_nest_backend/src/video-pipeline/threads-card-state";

const AvatarFallback: React.FC<{
  style: React.CSSProperties;
  label?: string | null;
}> = ({ style }) => (
  <div
    title="Avatar unavailable"
    data-testid="avatar-fallback"
    data-avatar-status="AVATAR_UNAVAILABLE"
    style={{
      ...style,
      background: style.background ?? "#f4f5f7",
      display: "grid",
      placeItems: "center",
      overflow: "hidden",
      position: "relative",
    }}
  >
    <svg
      width="100%"
      height="100%"
      viewBox="0 0 36 36"
      fill="none"
      aria-hidden="true"
    >
      <circle cx="18" cy="14" r="7.2" fill="#828894" />
      <ellipse cx="18" cy="36.5" rx="14.5" ry="13.5" fill="#828894" />
    </svg>
  </div>
);

const AvatarFollowBadge: React.FC<{
  u: number;
  cardBackground: string;
  dark: boolean;
}> = ({ u, cardBackground, dark }) => (
  <svg
    width={20 * u}
    height={20 * u}
    viewBox="0 0 20 20"
    fill="none"
    aria-hidden="true"
    style={{
      position: "absolute",
      right: -4 * u,
      bottom: -3 * u,
      pointerEvents: "none",
    }}
  >
    <circle cx="10" cy="10" r="9.2" fill={cardBackground} />
    <circle cx="10" cy="10" r="7.5" fill={dark ? "#ffffff" : "#101010"} />
    <path
      d="M10 6.5v7M6.5 10h7"
      stroke={dark ? "#101010" : "#ffffff"}
      strokeWidth="1.9"
      strokeLinecap="round"
    />
  </svg>
);

const Image: React.FC<{
  uri: string;
  style: React.CSSProperties;
  avatar?: boolean;
  animated?: boolean;
  startMs?: number;
}> = ({ uri, style, avatar, animated, startMs }) => {
  const [failed, setFailed] = React.useState(false);
  return failed ? (
    avatar ? (
      <AvatarFallback style={style} />
    ) : null
  ) : animated ? (
    <AnimatedGif key={uri} uri={uri} style={style} startMs={startMs} />
  ) : (
    <Img
      src={uri}
      data-avatar-status={avatar ? "READY" : undefined}
      style={style}
      onError={() => setFailed(true)}
    />
  );
};

export const ThreadsVisual: React.FC<{
  item: TimelineScene;
  mediaAssets: MediaAsset[];
  background?: MediaAsset;
  transparent?: boolean;
}> = ({ item, mediaAssets, background, transparent }) => {
  const frame = useCurrentFrame(),
    env = useRemotionEnvironment(),
    { fps } = useVideoConfig(),
    { visual: v, attachments, layout, contentStart, imageHeight, at } =
      threadsCardState(item, mediaAssets, fps),
    { pageIndex, visible } = at(frame),
    c = v.card,
    card = item.scene.threadsCard!;
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
      background: dark ? "#101010" : "#ffffff",
      text: dark ? "#f3f5f7" : "#10141b",
      muted: dark ? "#777777" : "#677180",
      action: dark ? "#cccccc" : "#3c4043",
      border: dark ? "#2d2d2d" : "#e4e7eb",
      avatar: "#f4f5f7",
    };

  // Uniform desktop reference unit: u = 1.0 at 15px desktop font (640px card width),
  // scaling all components uniformly when rendered on 9:16 video canvases.
  const u = layout.font / 15;
  const cardScale = layout.width / 640;
  const padScale = layout.pad / 24;
  const avatarSize = 36 * u;
  const lineHeightPx = 21 * u * ((layout.lineHeight ?? 1.4) / 1.4);

  return (
    <AbsoluteFill
      style={{
        background: transparent
          ? "transparent"
          : v.backgroundColor || "#101010",
        fontFamily:
          'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif',
        fontSize: 15 * u,
        fontWeight: 400,
        lineHeight: `${lineHeightPx}px`,
        color: palette.text,
        WebkitFontSmoothing: "antialiased",
      }}
    >
      {background && (
        <AbsoluteFill data-editor-object="BACKGROUND">
          {background.kind === "VIDEO" ? (
            env.isRendering ? (
              <OffthreadVideo
                data-testid="video-background"
                src={background.uri}
                muted
                style={{
                  position: "absolute",
                  width: "100%",
                  height: "100%",
                  objectFit: "cover",
                }}
              />
            ) : (
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
            )
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
        data-appearance={c.appearance ?? "DARK"}
        data-scene-id={item.scene.id}
        data-page={pageIndex + 1}
        style={{
          display: visible ? undefined : "none",
          position: "absolute",
          left: c.x,
          top: c.y,
          width: layout.width,
          boxSizing: "border-box",
          paddingTop: 23 * padScale,
          paddingRight: 24 * padScale,
          paddingBottom: 19 * padScale,
          paddingLeft: 24 * padScale,
          background: palette.background,
          color: palette.text,
          border: `${Math.max(1, Math.round(cardScale))}px solid ${palette.border}`,
          borderRadius: 24 * cardScale,
          boxShadow: dark ? "none" : "0 10px 44px #15294a24",
        }}
      >
        <div
          style={{
            display: "flex",
            gap: 12 * u,
            alignItems: "center",
            minHeight: avatarSize,
            marginBottom: 13 * u,
          }}
        >
          <div
            style={{
              position: "relative",
              width: avatarSize,
              height: avatarSize,
              minWidth: avatarSize,
              flexShrink: 0,
            }}
          >
            {card.avatarUrl ? (
              <Image
                key={card.avatarUrl}
                uri={card.avatarUrl}
                avatar
                style={{
                  width: avatarSize,
                  height: avatarSize,
                  minWidth: avatarSize,
                  borderRadius: "50%",
                  background: palette.avatar,
                  objectFit: "cover",
                }}
              />
            ) : (
              <AvatarFallback
                label={card.handle || card.author}
                style={{
                  width: avatarSize,
                  height: avatarSize,
                  minWidth: avatarSize,
                  borderRadius: "50%",
                  background: palette.avatar,
                }}
              />
            )}
            <AvatarFollowBadge
              u={u}
              cardBackground={palette.background}
              dark={dark}
            />
          </div>
          <div
            style={{
              flex: 1,
              minWidth: 0,
              display: "flex",
              alignItems: "baseline",
              flexWrap: "wrap",
              columnGap: 7 * u,
              rowGap: 2 * u,
              fontSize: 15 * u,
              lineHeight: `${20 * u}px`,
              overflowWrap: "anywhere",
            }}
          >
            <strong
              style={{
                fontWeight: 600,
                color: palette.text,
                letterSpacing: 0,
              }}
            >
              {card.handle || card.author}
            </strong>
            {date && (
              <span
                data-testid="card-date"
                style={{
                  fontSize: 15 * u,
                  fontWeight: 400,
                  color: palette.muted,
                  whiteSpace: "nowrap",
                }}
              >
                {date}
              </span>
            )}
            {item.scene.editorial?.kind === "PARAPHRASE" && (
              <small style={{ fontSize: 13 * u, color: palette.muted }}>
                {" "}
                · Diễn giải của biên tập
              </small>
            )}
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
          <svg
            width={18 * u}
            height={18 * u}
            viewBox="0 0 18 18"
            fill={palette.muted}
            aria-hidden="true"
            style={{
              flexShrink: 0,
              marginLeft: 8 * u,
              marginRight: 1 * u,
              marginTop: 1 * u,
            }}
          >
            <circle cx="2" cy="9" r="1.5" />
            <circle cx="9" cy="9" r="1.5" />
            <circle cx="16" cy="9" r="1.5" />
          </svg>
        </div>
        <div
          data-testid="composition-display-text"
          style={{
            fontSize: 15 * u,
            fontWeight: 400,
            textAlign: "left",
            wordSpacing: "normal",
            letterSpacing: 0,
            lineHeight: `${lineHeightPx}px`,
            width: "100%",
            minWidth: 0,
            color: palette.text,
            whiteSpace: "pre-wrap",
            overflowWrap: "break-word",
          }}
        >
          {layout.pages[pageIndex]}
        </div>
        {attachments.length > 0 && (
          <div
            data-testid="threads-attachments"
            style={{
              display: "flex",
              gap: 8 * u,
              height: imageHeight,
              marginTop: 12 * u,
              overflow: "hidden",
            }}
          >
            {attachments.map((a) => (
              <Image
                key={a.id}
                uri={a.uri}
                style={{
                  width: `${100 / attachments.length}%`,
                  height: imageHeight,
                  objectFit: "contain",
                  transform:
                    v.imageMode === "PAN"
                      ? `translate(${(v.imagePanX || 0) * Math.min(1, Math.max(0, frame - contentStart) / Math.max(1, item.contentEndFrame - item.contentStartFrame))}%, ${(v.imagePanY || 0) * Math.min(1, Math.max(0, frame - contentStart) / Math.max(1, item.contentEndFrame - item.contentStartFrame))}%) scale(${v.imageZoom || 1})`
                      : undefined,
                  borderRadius: 8 * u,
                }}
              />
            ))}
          </div>
        )}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "flex-start",
            flexWrap: "wrap",
            columnGap: 21.25 * u,
            rowGap: 6 * u,
            marginTop: 15 * u,
            minHeight: 18 * u,
            color: palette.action,
            fontSize: 13 * u,
            lineHeight: `${18 * u}px`,
            fontWeight: 400,
          }}
        >
          {(["likes", "replies", "reposts", "shares"] as const).map((k) => {
            const label = card.countLabels?.[k] ?? card.counts[k];
            const showCount =
              card.counts[k] !== null && label !== null && label !== "";
            return (
              <div
                key={k}
                data-count={k}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 4.5 * u,
                  minWidth: !showCount ? 18 * u : undefined,
                }}
              >
                {k === "likes" && (
                  <svg
                    width={19 * u}
                    height={18 * u}
                    viewBox="0 0 19 18"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.65"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <path d="M13.8 1.8c-1.7 0-3.2.9-4.3 2.5C8.4 2.7 6.9 1.8 5.2 1.8 2.7 1.8 1 3.7 1 6.3c0 4.2 4.4 7.1 8.5 9.9 4.1-2.8 8.5-5.7 8.5-9.9 0-2.6-1.7-4.5-4.2-4.5Z" />
                  </svg>
                )}
                {k === "replies" && (
                  <svg
                    width={18 * u}
                    height={18 * u}
                    viewBox="0 0 18 18"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.65"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <path d="M15.3 12.7A7.2 7.2 0 1 0 12.7 15.3L16.2 16.2Z" />
                  </svg>
                )}
                {k === "reposts" && (
                  <svg
                    width={18 * u}
                    height={18 * u}
                    viewBox="0 0 18 18"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.65"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <path d="M2.3 6.4A7.1 7.1 0 0 1 16 6.5" />
                    <path d="M2 2.2v4.3h4.3" />
                    <path d="M15.7 11.6A7.1 7.1 0 0 1 2 11.5" />
                    <path d="M16 15.8v-4.3h-4.3" />
                  </svg>
                )}
                {k === "shares" && (
                  <svg
                    width={17 * u}
                    height={18 * u}
                    viewBox="0 0 17 18"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.65"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <path d="M1.8 2.1 15.6 9 1.8 15.9 3.1 9 1.8 2.1Z" />
                    <line x1="3.1" y1="9" x2="15.6" y2="9" />
                  </svg>
                )}
                {showCount && <span>{label}</span>}
              </div>
            );
          })}
          <div
            data-count="bookmark"
            style={{ display: "flex", alignItems: "center" }}
          >
            <svg
              width={16 * u}
              height={18 * u}
              viewBox="0 0 16 18"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.65"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="M1.8 3.6A1.6 1.6 0 0 1 3.4 2h9.2a1.6 1.6 0 0 1 1.6 1.6v12.6L8 12.3l-6.2 3.9V3.6Z" />
            </svg>
          </div>
        </div>
        {layout.pages.length > 1 && (
          <div
            style={{
              fontSize: 12 * u,
              color: palette.muted,
              textAlign: "right",
              marginTop: 8 * u,
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
            animated={meme!.kind === "GIF"}
            startMs={v.meme.startMs}
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
