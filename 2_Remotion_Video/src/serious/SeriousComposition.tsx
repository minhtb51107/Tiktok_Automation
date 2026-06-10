import React from 'react';
import { AbsoluteFill, Audio, Series, staticFile, useVideoConfig, interpolate, useCurrentFrame } from 'remotion';

import { NeonBackground } from './NeonBackground';
import { SeriousIntro } from './SeriousIntro';
import { SeriousBroll } from './SeriousBroll';
import { SeriousSubtitle } from './SeriousSubtitle'; // Đã import Subtitle siêu cấp
import { SeriousOutro } from './SeriousOutro';

export type SeriousProps = {
  tiktok_caption: string;
  bgm: string;
  postInfo: { author: string; avatar: string };
  chunks: Array<{ text: string; keyword: string; brollUrl: string; audioSrc: string; durationInFrames: number; }>;
};

// Component tiện ích để Fade (Mờ ảo) giữa các cảnh
const FadeTransition: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const frame = useCurrentFrame();
  const opacity = interpolate(frame, [0, 15], [0, 1], { extrapolateRight: 'clamp' });
  return <AbsoluteFill style={{ opacity }}>{children}</AbsoluteFill>;
};

export const SeriousComposition: React.FC<SeriousProps> = ({ bgm, postInfo, chunks }) => {
  const { fps } = useVideoConfig();
  const INTRO_FRAMES = 3 * fps; 
  const OUTRO_FRAMES = 5 * fps;

  return (
    <AbsoluteFill style={{ backgroundColor: '#020617' }}>
      {/* Nền Grid lúc nào cũng chạy bên dưới */}
      <NeonBackground />
      {bgm && <Audio src={staticFile(bgm)} volume={0.15} loop />}

      <Series>
        {/* INTRO */}
        <Series.Sequence durationInFrames={INTRO_FRAMES}>
           <SeriousIntro author={postInfo.author} avatar={postInfo.avatar} />
        </Series.Sequence>

        {/* CÁC ĐOẠN VIDEO B-ROLL */}
        {chunks.map((chunk, index) => (
          <Series.Sequence key={index} durationInFrames={chunk.durationInFrames}>
            <FadeTransition>
              <SeriousBroll brollUrl={chunk.brollUrl} />
              <SeriousSubtitle text={chunk.text} />
              {chunk.audioSrc && <Audio src={staticFile(chunk.audioSrc)} />}
            </FadeTransition>
          </Series.Sequence>
        ))}

        {/* OUTRO */}
        <Series.Sequence durationInFrames={OUTRO_FRAMES}>
           <FadeTransition>
             <SeriousOutro />
           </FadeTransition>
        </Series.Sequence>
      </Series>
    </AbsoluteFill>
  );
};