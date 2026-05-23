// src/Composition.tsx
import React from 'react';
import { AbsoluteFill, Sequence, Audio, useCurrentFrame, useVideoConfig, Img, staticFile, interpolate } from 'remotion';

import { LYRIC_SCRIPT } from './data/script';
import { LyricLine } from './LyricLine';
import audioTrack from './music.wav';

const images = [
  staticFile('1.jpg'), staticFile('2.jpg'), staticFile('3.jpg'),
  staticFile('4.jpg'), staticFile('5.jpg'), staticFile('6.jpg'), staticFile('7.jpg'),
];

const CUTE_ICONS = [
  { char: '✨', top: '25%', left: '20%', size: 'text-5xl', delay: 0 },
  { char: '🤍', top: '70%', left: '15%', size: 'text-6xl', delay: 45 },
  { char: '🫧', top: '35%', left: '80%', size: 'text-4xl', delay: 90 },
  { char: '☁️', top: '15%', left: '65%', size: 'text-6xl', delay: 60 },
];

export const MyComposition = () => {
  const frame = useCurrentFrame();
  const { durationInFrames } = useVideoConfig();

  const framesPerImage = 15; 
  const currentImageIndex = Math.floor(frame / framesPerImage) % images.length;
  
  const firstLyricStart = LYRIC_SCRIPT[0]?.start || 134;
  const climaxFrame = 815; 

  const overlayOpacity = interpolate(
    frame,
    [firstLyricStart - 30, firstLyricStart],
    [0.6, 0.15], 
    { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' }
  );

  const titleOpacity = interpolate(frame, [firstLyricStart - 20, firstLyricStart], [1, 0]);
  const titleFloat = Math.sin(frame / 12) * 10; 
  
  const cameraZoom = interpolate(frame, [0, durationInFrames], [1, 1.15]);

  const climaxFlashOpacity = interpolate(
    frame,
    [climaxFrame, climaxFrame + 5, climaxFrame + 30],
    [0, 0.8, 0], 
    { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' }
  );

  // HIỆU ỨNG MÉO HÌNH: Tính toán độ méo (warp) liên tục lượn sóng
  const warpAmount = 5 + Math.sin(frame / 20) * 3;

  return (
    <AbsoluteFill className="bg-[#A8DADC] overflow-hidden flex items-center justify-center">
      
      {/* KHAI BÁO BỘ LỌC SVG LÀM MÉO HÌNH (DREAMY DISPLACEMENT MAP) */}
      <svg className="absolute w-0 h-0 pointer-events-none">
        <filter id="dreamy-warp">
          {/* Tạo độ nhiễu gợn sóng */}
          <feTurbulence type="fractalNoise" baseFrequency="0.015" numOctaves="1" result="noise" />
          {/* Áp dụng độ nhiễu đó để làm méo hình ảnh (scale thay đổi theo frame) */}
          <feDisplacementMap in="SourceGraphic" in2="noise" scale={warpAmount} xChannelSelector="R" yChannelSelector="G" />
        </filter>
      </svg>

      <div className="absolute inset-0 z-0" style={{ transform: `scale(${cameraZoom})`, transformOrigin: 'center center' }}>
        
        {/* LỚP ẢNH: Đã thêm filter lượn sóng */}
        <div className="absolute inset-0 z-0 bg-black">
          <Img 
            src={images[currentImageIndex]} 
            className="w-full h-full object-cover opacity-85" 
            alt={`Background ${currentImageIndex}`} 
            style={{ 
              filter: 'url(#dreamy-warp)', // Áp dụng hiệu ứng méo hình
              transform: 'scale(1.05)' // Phóng to nhẹ ảnh gốc để bù trừ viền bị kéo méo
            }}
          />
        </div>

        <div className="absolute inset-0 z-0 bg-gradient-to-br from-[#A8DADC] via-[#DFF6FF] to-[#F1FAEE]" style={{ opacity: overlayOpacity }} />

        <div className="absolute inset-0 z-0 pointer-events-none">
          {CUTE_ICONS.map((icon, i) => {
             const floatY = Math.sin((frame + icon.delay) / 25) * 20;
             const floatX = Math.cos((frame + icon.delay) / 35) * 15;
             return (
               <div 
                 key={i} 
                 className={`absolute opacity-75 ${icon.size} drop-shadow-md`}
                 style={{ top: icon.top, left: icon.left, transform: `translate(${floatX}px, ${floatY}px)` }}
               >
                 {icon.char}
               </div>
             );
          })}
        </div>
      </div>

      <div 
        className="absolute inset-0 z-[5] bg-white pointer-events-none mix-blend-overlay"
        style={{ opacity: climaxFlashOpacity }}
      />

      <Sequence from={0} durationInFrames={firstLyricStart}>
        <div 
          className="absolute inset-0 flex flex-col items-center justify-center z-10 px-8"
          style={{ opacity: titleOpacity, transform: `translateY(${titleFloat}px)` }}
        >
          <div className="flex flex-col items-start text-left max-w-4xl">
            <h1 className="text-4xl md:text-6xl font-sans font-black text-white drop-shadow-[0_5px_15px_rgba(0,0,0,0.3)] mb-6 uppercase tracking-tighter">
              THIS IS WHAT FALLING IN LOVE FEELS LIKE
            </h1>
            <h2 className="text-xl font-bold tracking-[0.4em] text-white/95 drop-shadow-[0_3px_10px_rgba(0,0,0,0.4)] uppercase">
              JVKE
            </h2>
          </div>
        </div>
      </Sequence>

      <Audio src={audioTrack} />

      <div className="absolute inset-0 z-10 pointer-events-none">
        {LYRIC_SCRIPT.map((line, index) => {
          const nextLineStart = LYRIC_SCRIPT[index + 1]?.start;
          const safeDuration = nextLineStart ? nextLineStart - line.start : line.duration;

          return (
            <Sequence key={index} from={line.start} durationInFrames={safeDuration}>
              <LyricLine lineStart={line.start} words={line.words} vietnamese={line.vietnamese} />
            </Sequence>
          );
        })}
      </div>

    </AbsoluteFill>
  );
};