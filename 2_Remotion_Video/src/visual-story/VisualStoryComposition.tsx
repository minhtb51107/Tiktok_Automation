import React from 'react';
import { AbsoluteFill, Series, Audio, staticFile } from 'remotion';
import { GridBackground } from './GridBackground';
import { BigCaption } from './BigCaption';
import { StoryCard } from './StoryCard';
import { MemeIllustration } from './MemeIllustration';
import { VisualStoryIntro } from './VisualStoryIntro';

export const VisualStoryComposition: React.FC<{ data: any }> = ({ data }) => {
  return (
    <AbsoluteFill>
      {/* LAYER 0: GRID TRẮNG ĐEN */}
      <div style={{ zIndex: 0, position: 'absolute', inset: 0 }}>
         <GridBackground />
      </div>

      <Series>
        {/* ĐOẠN INTRO ĐỎ CAM TỪ TRƯỚC */}
        <Series.Sequence durationInFrames={3 * 60}>
          <VisualStoryIntro author={data.postInfo.author} avatar={data.postInfo.avatar} text={data.postInfo.text} postInfo={data.postInfo} />
        </Series.Sequence>

        {/* PHẦN THÂN: BÌNH LUẬN & HEADLINE */}
        {data.chunks.map((chunk: any, index: number) => (
          <Series.Sequence key={index} durationInFrames={chunk.durationInFrames}>
            <AbsoluteFill style={{ justifyContent: 'center', alignItems: 'center' }}>
              
              {/* LAYER 1: HEADLINE TO ĐÙNG NẰM SAU LƯNG THẺ */}
              <div style={{ zIndex: 10, position: 'absolute', inset: 0 }}>
                {chunk.caption && <BigCaption text={chunk.caption} />}
              </div>

              {/* LAYER 2: CARD TRẮNG NẰM ĐÈ LÊN HEADLINE */}
              <div style={{ zIndex: 20, position: 'absolute', top: '40%' }}>
                {chunk.cardToShow === 'post' && <StoryCard info={data.postInfo} />}
                {chunk.cardToShow === 'comment' && <StoryCard info={chunk.commentInfo} />}
              </div>

              {/* LAYER 3: MEME NHẢY VÀO LÊN TRÊN CÙNG ĐỂ NGẮT NHỊP */}
              {chunk.memeImg && (
                <div style={{ zIndex: 30, position: 'absolute', inset: 0 }}>
                  <MemeIllustration src={chunk.memeImg} />
                </div>
              )}

            </AbsoluteFill>
          </Series.Sequence>
        ))}
      </Series>
    </AbsoluteFill>
  );
};
