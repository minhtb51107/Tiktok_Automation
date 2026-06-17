import React from 'react';
import { AbsoluteFill, Series, Audio, staticFile } from 'remotion';
import { GridBackground } from './GridBackground';
import { BigCaption } from './BigCaption';
import { StoryCard } from './StoryCard';
import { GifIllustration } from './GifIllustration'; 
import { KaraokeSubtitle } from './KaraokeSubtitle'; 
import { SeriousIntro } from './SeriousIntro';

export const SeriousComposition: React.FC<{ chunks: any, bgm: string, postInfo: any }> = ({ chunks, bgm, postInfo }) => {
  return (
    <AbsoluteFill style={{ backgroundColor: '#0e0e16' }}>
      <GridBackground />
      {bgm && <Audio src={bgm.startsWith('http') ? bgm : staticFile(bgm)} volume={0.15} loop />}

      <Series>
        {/* 🔥 FIX LỖI 5: Không tách Intro câm nữa, nhét Intro vào Chunk 0 để có giọng đọc! */}
        {chunks.map((chunk: any, index: number) => (
          <Series.Sequence key={index} durationInFrames={Math.max(chunk.durationInFrames, 30)}>
            <AbsoluteFill style={{ justifyContent: 'center', alignItems: 'center' }}>
              
              {/* Giọng đọc AI */}
              {chunk.audioSrc && <Audio src={staticFile(chunk.audioSrc)} />}

              {/* Nếu là đoạn đầu tiên -> Mở Intro hoành tráng */}
              {index === 0 ? (
                <SeriousIntro 
                  author={chunk.commentInfo?.author || postInfo.author} 
                  avatar={chunk.commentInfo?.avatar || postInfo.avatar} 
                  text={chunk.text} 
                  postInfo={postInfo} 
                  hookText={chunk.caption} // Chữ giật tít của AI
                />
              ) : (
                /* Các đoạn sau -> Hiện Card, GIF và Karaoke bình thường */
                <>
                  <div style={{ zIndex: 10, position: 'absolute', inset: 0 }}>
                    {chunk.caption && <BigCaption text={chunk.caption} />}
                  </div>

                  <div style={{ zIndex: 20, position: 'absolute', top: '35%' }}>
                    {(chunk.cardToShow === 'post' || chunk.cardToShow === 'comment') && chunk.commentInfo && (
                        <StoryCard info={chunk.commentInfo} />
                    )}
                  </div>

                  {chunk.gifImg && (
                    <div style={{ zIndex: 30, position: 'absolute', inset: 0 }}>
                      <GifIllustration src={chunk.gifImg} />
                    </div>
                  )}

                  {chunk.words && chunk.words.length > 0 && (
                    <KaraokeSubtitle words={chunk.words} />
                  )}
                </>
              )}

            </AbsoluteFill>
          </Series.Sequence>
        ))}
      </Series>
    </AbsoluteFill>
  );
};
