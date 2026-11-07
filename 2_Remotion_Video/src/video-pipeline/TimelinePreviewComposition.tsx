import {cardPages,normalizeVisual} from '../../../1_nest_backend/src/video-pipeline/scene-visual';
import {bgmVolumeAtFrame} from '../../../1_nest_backend/src/video-pipeline/bgm-volume';
import {frameRange} from '../../../1_nest_backend/src/video-pipeline/editing';
import { ContinuousBackground } from "./ContinuousBackground";
import { ThreadsVisual } from "./ThreadsVisual";
import React from "react";
import {
  AbsoluteFill,
  Audio,
  Img,
  Sequence,
  staticFile,
  useCurrentFrame,
} from "remotion";
import type {
  ContentStyle,
  MediaAsset,
  TimelineScene,
  VideoPreviewProps,
} from "../../../1_nest_backend/src/video-pipeline/contracts";

const assetSource = (uri: string): string =>
  /^(https?:|data:|blob:|\/)/.test(uri) ? uri : staticFile(uri);

const SceneCard: React.FC<{
  item: TimelineScene;
  style: ContentStyle;
  background?: MediaAsset;
  transparent?: boolean;
  mediaAssets: MediaAsset[];
}> = ({ item, style, background, mediaAssets, transparent }) => {
  const frame=useCurrentFrame();
  const visual=normalizeVisual(item.scene.visual),editorial=item.scene.editorial?.kind==='COMMENTARY';
  const pages=editorial?cardPages(item.scene.displayText,visual,0).pages:[item.scene.displayText];
  const page=Math.min(pages.length-1,Math.floor(Math.max(0,frame)/Math.max(1,item.durationInFrames)*pages.length));
  return item.scene.threadsCard ? (
    <ThreadsVisual
      item={item}
      transparent={transparent}
      mediaAssets={mediaAssets}
      background={background}
    />
  ) : (
    <AbsoluteFill
      style={{
        alignItems: "center",
        backgroundColor: editorial && transparent ? "transparent" : style === "FUNNY" ? "#111111" : "#172033",
        color: "#ffffff",
        display: "flex",
        fontFamily: "Arial, sans-serif",
        justifyContent: "center",
        padding: 80,
        textAlign: "center",
      }}
    >
      {background?.availability === "AVAILABLE" ? (
        <Img
          src={assetSource(background.uri)}
          style={{
            height: "100%",
            objectFit: "cover",
            position: "absolute",
            width: "100%",
          }}
        />
      ) : null}
      <div
        data-testid="composition-display-text"
        style={{
          background: "rgba(9, 14, 24, 0.78)",
          border: "2px solid rgba(255, 255, 255, 0.18)",
          borderRadius: 36,
          fontSize: editorial ? visual.card.fontSize*visual.card.scale : 54,
          lineHeight: editorial ? visual.card.lineHeight : 1.3,
          maxWidth: editorial ? undefined : 880,
          ...(editorial?{position:"absolute" as const,left:visual.card.x,top:visual.card.y,width:visual.card.width*visual.card.scale,boxSizing:"border-box" as const,whiteSpace:"pre-wrap" as const,overflowWrap:"break-word" as const}:{}),
          padding: editorial ? visual.card.padding*visual.card.scale : 52,
          position: editorial ? "absolute" : "relative",
        }}
      >
        {editorial&&<small style={{display:"block",fontSize:26,marginBottom:20}}>Bình luận biên tập · không phải trích dẫn</small>}
        {pages[page]}
      </div>
      {mediaAssets
        .filter((asset) => asset.kind !== "BACKGROUND")
        .map((asset) =>
          asset.availability === "AVAILABLE" ? (
            <Img
              key={asset.id}
              src={assetSource(asset.uri)}
              style={{
                borderRadius: 28,
                bottom: 330,
                height: 260,
                objectFit: "contain",
                position: "absolute",
                right: 70,
                width: 260,
              }}
            />
          ) : (
            <div
              key={asset.id}
              style={{
                background: "#9f2535",
                bottom: 330,
                fontSize: 30,
                padding: 18,
                position: "absolute",
                right: 70,
              }}
            >
              Missing asset: {asset.id}
            </div>
          ),
        )}
    </AbsoluteFill>
  );
};

const TimelinePreviewComposition: React.FC<
  VideoPreviewProps & { expectedStyle: ContentStyle }
> = ({
  timeline,
  audioAssets,
  mediaAssets,
  expectedStyle,
  backgroundMusic,
  backgroundTracks = [],
}) => {
  const frame = useCurrentFrame();
  if (timeline.style !== expectedStyle) {
    throw new Error(
      `Timeline style ${timeline.style} cannot use ${expectedStyle} preview.`,
    );
  }
  const audioById = new Map(audioAssets.map((asset) => [asset.id, asset]));
  const mediaById = new Map(mediaAssets.map((asset) => [asset.id, asset]));
  const background = mediaAssets.find(
    (asset) =>
      asset.kind === "BACKGROUND" &&
      asset.id.startsWith(expectedStyle === "FUNNY" ? "funny-" : "serious-"),
  );

  const activeBackground=backgroundTracks.slice().reverse().find(c=>{const r=frameRange(c.startMs,c.durationMs,timeline.fps);return c.enabled&&frame>=r.start&&frame<r.end;});
  return (
    <AbsoluteFill style={{ backgroundColor: "#000000" }}>
      {backgroundTracks
        .filter((c) => c.id===activeBackground?.id)
        .map((c) => {
          const a = mediaById.get(c.assetId);
          return a ? (
            <Sequence
              key={c.id}
              from={frameRange(c.startMs,c.durationMs,timeline.fps).start}
              durationInFrames={frameRange(c.startMs,c.durationMs,timeline.fps).duration}
            >
              <AbsoluteFill>
                <Sequence
                  from={-Math.round(((c.offsetMs || 0) * timeline.fps) / 1000)}
                >
                  {a.kind === "VIDEO" ? (
                    <ContinuousBackground
                      asset={a}
                      clip={c}
                      fps={timeline.fps}
                    />
                  ) : (
                    <Img
                      src={a.uri}
                      style={{
                        width: "100%",
                        height: "100%",
                        objectFit: "cover",
                      }}
                    />
                  )}
                </Sequence>
              </AbsoluteFill>
            </Sequence>
          ) : null;
        })}
      {backgroundMusic?.enabled &&
        backgroundMusic.assetId &&
        audioById.get(backgroundMusic.assetId) && (
          <Sequence
            from={Math.ceil((backgroundMusic.startMs * timeline.fps) / 1000)}
            durationInFrames={Math.max(
              1,
              Math.min(
                timeline.totalFrames -
                  Math.ceil((backgroundMusic.startMs * timeline.fps) / 1000),
                Math.ceil(
                  ((backgroundMusic.durationMs ?? 86400000) * timeline.fps) /
                    1000,
                ),
              ),
            )}
          >
            <Audio
              acceptableTimeShiftInSeconds={0.08}
              trimBefore={Math.ceil(
                ((backgroundMusic.sourceInMs || 0) * timeline.fps) / 1000,
              )}
              src={assetSource(audioById.get(backgroundMusic.assetId)!.uri)}
              loop
              volume={f=>bgmVolumeAtFrame(backgroundMusic,timeline,f+Math.ceil(backgroundMusic.startMs*timeline.fps/1000))}
            />
          </Sequence>
        )}
      {timeline.scenes.map((item) => {
        const narration = item.scene.audioAssetId
          ? audioById.get(item.scene.audioAssetId)
          : undefined;
        return (
          <React.Fragment key={item.scene.id}>
            <Sequence
              from={item.startFrame}
              durationInFrames={item.durationInFrames}
            >
              <SceneCard
                item={item}
                style={expectedStyle}
                transparent={!!activeBackground}
                background={
                  activeBackground && !item.scene.visual?.backgroundOverride
                    ? undefined
                    : mediaById.get(item.scene.visual?.backgroundId || "") || background
                }
                mediaAssets={item.scene.mediaAssetIds
                  .map((id) => mediaById.get(id))
                  .filter((asset): asset is MediaAsset => asset !== undefined)}
              />
              {item.subtitles.map((cue) => (
                <Sequence
                  key={cue.id}
                  from={cue.startFrame - item.startFrame}
                  durationInFrames={cue.endFrame - cue.startFrame}
                >
                  <div
                    style={{
                      alignSelf: "flex-end",
                      background: "rgba(0, 0, 0, 0.72)",
                      bottom: 180,
                      color: "#ffffff",
                      fontSize: 44,
                      left: 70,
                      padding: 24,
                      position: "absolute",
                      right: 70,
                      textAlign: "center",
                    }}
                  >
                    {cue.text}
                  </div>
                </Sequence>
              ))}
            </Sequence>
            {item.scene.visual?.voiceEnabled !== false &&
            narration &&
            narration.availability === "AVAILABLE" &&
            item.audioStartFrame !== undefined &&
            item.audioEndFrame !== undefined ? (
              <Sequence
                from={
                  item.audioStartFrame +
                  Math.ceil(
                    ((item.scene.visual?.voiceStartMs || 0) * timeline.fps) /
                      1000,
                  )
                }
                durationInFrames={Math.max(
                  1,
                  Math.min(
                    item.endFrame -
                      item.audioStartFrame -
                      Math.ceil(
                        ((item.scene.visual?.voiceStartMs || 0) *
                          timeline.fps) /
                          1000,
                      ),
                    Math.ceil(
                      (Math.min(
                        narration.durationMs -
                          (item.scene.visual?.voiceSourceInMs || 0),
                        item.scene.visual?.voiceDurationMs ?? 86400000,
                      ) *
                        timeline.fps) /
                        1000,
                    ),
                  ),
                )}
                premountFor={Math.min(
                  Math.floor(timeline.fps / 2),
                  item.audioStartFrame,
                )}
              >
                <Audio
                  trimBefore={Math.ceil(
                    ((item.scene.visual?.voiceSourceInMs || 0) * timeline.fps) /
                      1000,
                  )}
                  volume={item.scene.visual?.voiceVolume ?? 1}
                  src={assetSource(narration.uri)}
                  acceptableTimeShiftInSeconds={
                    item.scene.threadsCard ? 0.08 : undefined
                  }
                />
              </Sequence>
            ) : null}
            {item.scene.sfxLayer &&
              audioById.get(item.scene.sfxLayer.assetId) &&
              Math.ceil((item.scene.sfxLayer.startMs * timeline.fps) / 1000) <
                item.durationInFrames && (
                <Sequence
                  premountFor={Math.min(
                    Math.floor(timeline.fps / 2),
                    item.startFrame +
                      Math.ceil(
                        (item.scene.sfxLayer.startMs * timeline.fps) / 1000,
                      ),
                  )}
                  from={
                    item.startFrame +
                    Math.ceil(
                      (item.scene.sfxLayer.startMs * timeline.fps) / 1000,
                    )
                  }
                  durationInFrames={Math.max(
                    1,
                    Math.min(
                      item.durationInFrames -
                        Math.ceil(
                          (item.scene.sfxLayer.startMs * timeline.fps) / 1000,
                        ),
                      Math.ceil(
                        (Math.min(
                          audioById.get(item.scene.sfxLayer.assetId)!
                            .durationMs - (item.scene.sfxLayer.sourceInMs || 0),
                          item.scene.sfxLayer.durationMs ?? 86400000,
                        ) *
                          timeline.fps) /
                          1000,
                      ),
                    ),
                  )}
                >
                  <Audio
                    src={assetSource(
                      audioById.get(item.scene.sfxLayer.assetId)!.uri,
                    )}
                    trimBefore={Math.ceil(
                      ((item.scene.sfxLayer.sourceInMs || 0) * timeline.fps) /
                        1000,
                    )}
                    volume={item.scene.sfxLayer.volume}
                    acceptableTimeShiftInSeconds={0.08}
                  />
                </Sequence>
              )}
          </React.Fragment>
        );
      })}
    </AbsoluteFill>
  );
};

export const FunnyTimelinePreview: React.FC<VideoPreviewProps> = (props) => (
  <TimelinePreviewComposition {...props} expectedStyle="FUNNY" />
);

export const SeriousTimelinePreview: React.FC<VideoPreviewProps> = (props) => (
  <TimelinePreviewComposition {...props} expectedStyle="SERIOUS" />
);
