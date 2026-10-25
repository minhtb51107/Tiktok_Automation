import React from 'react';
import { AbsoluteFill, Audio, Img, Sequence, staticFile } from 'remotion';
import type {
  ContentStyle,
  MediaAsset,
  TimelineScene,
  VideoPreviewProps,
} from '../../../1_nest_backend/src/video-pipeline/contracts';

const assetSource = (uri: string): string =>
  /^(https?:|data:|blob:|\/)/.test(uri) ? uri : staticFile(uri);

const SceneCard: React.FC<{
  item: TimelineScene;
  style: ContentStyle;
  background?: MediaAsset;
  mediaAssets: MediaAsset[];
}> = ({ item, style, background, mediaAssets }) => (
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
    {background?.availability === 'AVAILABLE' ? (
      <Img
        src={assetSource(background.uri)}
        style={{ height: '100%', objectFit: 'cover', position: 'absolute', width: '100%' }}
      />
    ) : null}
    <div
      data-testid="composition-display-text"
      style={{
        background: 'rgba(9, 14, 24, 0.78)',
        border: '2px solid rgba(255, 255, 255, 0.18)',
        borderRadius: 36,
        fontSize: 54,
        lineHeight: 1.3,
        maxWidth: 880,
        padding: 52,
        position: 'relative',
      }}
    >
      {item.scene.displayText}
    </div>
    {mediaAssets
      .filter((asset) => asset.kind !== 'BACKGROUND')
      .map((asset) =>
        asset.availability === 'AVAILABLE' ? (
          <Img
            key={asset.id}
            src={assetSource(asset.uri)}
            style={{
              borderRadius: 28,
              bottom: 330,
              height: 260,
              objectFit: 'contain',
              position: 'absolute',
              right: 70,
              width: 260,
            }}
          />
        ) : (
          <div
            key={asset.id}
            style={{
              background: '#9f2535',
              bottom: 330,
              fontSize: 30,
              padding: 18,
              position: 'absolute',
              right: 70,
            }}
          >
            Missing asset: {asset.id}
          </div>
        ),
      )}
  </AbsoluteFill>
);

const TimelinePreviewComposition: React.FC<
  VideoPreviewProps & { expectedStyle: ContentStyle }
> = ({ timeline, audioAssets, mediaAssets, expectedStyle }) => {
  if (timeline.style !== expectedStyle) {
    throw new Error(
      `Timeline style ${timeline.style} cannot use ${expectedStyle} preview.`,
    );
  }
  const audioById = new Map(audioAssets.map((asset) => [asset.id, asset]));
  const mediaById = new Map(mediaAssets.map((asset) => [asset.id, asset]));
  const background = mediaAssets.find(
    (asset) =>
      asset.kind === 'BACKGROUND' &&
      asset.id.startsWith(expectedStyle === 'FUNNY' ? 'funny-' : 'serious-'),
  );

  return (
    <AbsoluteFill style={{ backgroundColor: '#000000' }}>
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
                background={background}
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
            {narration &&
            narration.availability === 'AVAILABLE' &&
            item.audioStartFrame !== undefined &&
            item.audioEndFrame !== undefined ? (
              <Sequence
                from={item.audioStartFrame}
                durationInFrames={item.audioEndFrame - item.audioStartFrame}
                premountFor={item.audioStartFrame}
              >
                <Audio src={assetSource(narration.uri)} />
              </Sequence>
            ) : null}
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
