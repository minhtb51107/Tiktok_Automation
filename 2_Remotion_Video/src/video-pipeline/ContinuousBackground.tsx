import React from "react";
import {
  OffthreadVideo,
  Sequence,
  Video,
  useCurrentFrame,
  useRemotionEnvironment,
} from "remotion";
import type { MediaAsset } from "../../../1_nest_backend/src/video-pipeline/contracts";
import type { BackgroundClip } from "../../../1_nest_backend/src/video-pipeline/editing";
import { correctSeekPrecision } from "../../../1_nest_backend/src/video-pipeline/editing";
export function ContinuousBackground({
  asset,
  clip,
  fps,
}: {
  asset: MediaAsset;
  clip: BackgroundClip;
  fps: number;
}) {
  const frame = useCurrentFrame(),
    env = useRemotionEnvironment(),
    before = Math.floor((clip.sourceInMs * fps) / 1000),
    after = Math.ceil((clip.sourceOutMs * fps) / 1000),
    span = Math.max(1, after - before),
    totalClipFrames = Math.max(
      1,
      Math.ceil(
        ((clip.durationMs || clip.sourceOutMs - clip.sourceInMs) * fps) / 1000,
      ) + Math.round(((clip.offsetMs || 0) * fps) / 1000),
    );
  if (env.isRendering) {
    if (!clip.loop || totalClipFrames <= span) {
      return (
        <OffthreadVideo
          data-testid="global-background-video"
          data-clip-id={clip.id}
          src={asset.uri}
          trimBefore={before}
          trimAfter={after}
          muted
          style={{ width: "100%", height: "100%", objectFit: "cover" }}
        />
      );
    }
    const loopCount = Math.max(1, Math.ceil(totalClipFrames / span));
    return (
      <>
        {Array.from({ length: loopCount }, (_, idx) => {
          const from = idx * span;
          const dur = Math.max(1, Math.min(span, totalClipFrames - from));
          return (
            <Sequence key={idx} from={from} durationInFrames={dur}>
              <OffthreadVideo
                data-testid="global-background-video"
                data-clip-id={clip.id}
                src={asset.uri}
                trimBefore={before}
                trimAfter={before + dur}
                muted
                style={{ width: "100%", height: "100%", objectFit: "cover" }}
              />
            </Sequence>
          );
        })}
      </>
    );
  }
  const expected =
    (before + (clip.loop ? ((frame % span) + span) % span : frame)) / fps;
  return (
    <Video
      data-testid="global-background-video"
      data-clip-id={clip.id}
      src={asset.uri}
      trimBefore={before}
      trimAfter={after}
      loop={clip.loop}
      muted
      acceptableTimeShiftInSeconds={0.08}
      onSeeked={(event) => {
        const video = event.currentTarget;
        const corrected = correctSeekPrecision(video.currentTime, expected);
        if (corrected !== null) video.currentTime = corrected;
      }}
      style={{ width: "100%", height: "100%", objectFit: "cover" }}
    />
  );
}
