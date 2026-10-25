import React from 'react';
import { AbsoluteFill, Audio, Sequence } from 'remotion';
import type {
  ContentStyle,
  TimelineScene,
  VideoPreviewProps,
} from '../../../1_nest_backend/src/video-pipeline/contracts';

const SceneCard: React.FC<{
  item: TimelineScene;
  style: ContentStyle;
}> = ({ item, style }) => (
  <AbsoluteFill
    style={{
      alignItems: 'center',
      backgroundColor: style === 'FUNNY' ? '#111111' : '#172033',
      color: '#ffffff',
      display: 'flex',
      fontFamily: 'Arial, sans-serif',
      justifyContent: 'center',
      padding: 80,
      textAlign: 'center',
    }}
  >
    <div style={{ fontSize: 54, lineHeight: 1.3 }}>{item.scene.displayText}</div>
  </AbsoluteFill>
);

const TimelinePreviewComposition: React.FC<
  VideoPreviewProps & { expectedStyle: ContentStyle }
> = ({ timeline, audioAssets, expectedStyle }) => {
  if (timeline.style !== expectedStyle) {
    throw new Error(
      `Timeline style ${timeline.style} cannot use ${expectedStyle} preview.`,
    );
  }
  const audioById = new Map(audioAssets.map((asset) => [asset.id, asset]));

  return (
    <AbsoluteFill style={{ backgroundColor: '#000000' }}>
      {timeline.scenes.map((item) => {
        const narration = item.scene.audioAssetId
          ? audioById.get(item.scene.audioAssetId)
          : undefined;
        return (
          <Sequence
            key={item.scene.id}
            from={item.startFrame}
            durationInFrames={item.durationInFrames}
          >
            <SceneCard item={item} style={expectedStyle} />
            {narration &&
            item.audioStartFrame !== undefined &&
            item.audioEndFrame !== undefined ? (
              <Sequence
                from={item.audioStartFrame - item.startFrame}
                durationInFrames={item.audioEndFrame - item.audioStartFrame}
              >
                <Audio src={narration.uri} />
              </Sequence>
            ) : null}
            {item.subtitles.map((cue) => (
              <Sequence
                key={cue.id}
                from={cue.startFrame - item.startFrame}
                durationInFrames={cue.endFrame - cue.startFrame}
              >
                <div
                  style={{
                    alignSelf: 'flex-end',
                    background: 'rgba(0, 0, 0, 0.72)',
                    bottom: 180,
                    color: '#ffffff',
                    fontSize: 44,
                    left: 70,
                    padding: 24,
                    position: 'absolute',
                    right: 70,
                    textAlign: 'center',
                  }}
                >
                  {cue.text}
                </div>
              </Sequence>
            ))}
          </Sequence>
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
