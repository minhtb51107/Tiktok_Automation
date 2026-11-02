import { Video, useCurrentFrame } from "remotion";
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
    before = Math.floor((clip.sourceInMs * fps) / 1000),
    after = Math.ceil((clip.sourceOutMs * fps) / 1000),
    span = Math.max(1, after - before);
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
