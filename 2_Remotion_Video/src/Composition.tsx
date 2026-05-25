import React from 'react';
import { AbsoluteFill, Sequence, Audio, useCurrentFrame, useVideoConfig, Img, staticFile, interpolate } from 'remotion';
import { LYRIC_SCRIPT, LyricData } from './data/script';
import { LyricLine } from './LyricLine';

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

  // 🚨 [TRẠM DEBUG 3]: Xem Frontend có nhận được nhạc và số Frame không
  const musicPath = staticFile('music.mp3');
  console.log(`[DEBUG 3 - FRONTEND] Tổng Frame: ${durationInFrames}`);
  console.log(`[DEBUG 3 - FRONTEND] Đường dẫn file nhạc nội bộ: ${musicPath}`);

  const framesPerImage = 15; 
  const currentImageIndex = Math.floor(frame / framesPerImage) % images.length;
  
  const getTrueStartFrame = (line: LyricData) => {
    if (!line) return 0;
    const firstWordSec = line.words[0]?.start || 0;
    if (Math.abs(line.start - firstWordSec) < 5) {
      return Math.round(line.start * 30);
    }
    return Math.round(line.start);
  };

  const getTrueDurationFrame = (line: LyricData) => {
    if (!line) return 30;
    return line.duration < 20 ? Math.round(line.duration * 30) : Math.round(line.duration);
  };

  const firstLyricStartFrame = LYRIC_SCRIPT.length > 0 ? getTrueStartFrame(LYRIC_SCRIPT[0]) : 134;
  const climaxFrame = 815; 

  const overlayOpacity = interpolate(
    frame,
    [Math.max(0, firstLyricStartFrame - 30), firstLyricStartFrame],
    [0.6, 0.15], 
    { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' }
  );

  const titleOpacity = interpolate(frame, [Math.max(0, firstLyricStartFrame - 20), firstLyricStartFrame], [1, 0], { extrapolateRight: 'clamp' });
  const titleFloat = Math.sin(frame / 12) * 10; 
  const cameraZoom = interpolate(frame, [0, durationInFrames], [1, 1.15]);
  const climaxFlashOpacity = interpolate(frame, [climaxFrame, climaxFrame + 5, climaxFrame + 30], [0, 0.8, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
  const warpAmount = 5 + Math.sin(frame / 20) * 3;

  return (
    <AbsoluteFill className="bg-[#A8DADC] overflow-hidden flex items-center justify-center">
      <svg className="absolute w-0 h-0 pointer-events-none">
        <filter id="dreamy-warp" colorInterpolationFilters="sRGB">
          <feTurbulence type="fractalNoise" baseFrequency="0.015" numOctaves="1" result="noise" />
          <feDisplacementMap in="SourceGraphic" in2="noise" scale={warpAmount} xChannelSelector="R" yChannelSelector="G" />
        </filter>
      </svg>

      <div className="absolute inset-0 z-0" style={{ transform: `scale(${cameraZoom})`, transformOrigin: 'center center' }}>
        <div className="absolute inset-0 z-0 bg-black">
          <Img src={images[currentImageIndex]} className="w-full h-full object-cover opacity-85" style={{ filter: 'url(#dreamy-warp)', transform: 'scale(1.25)' }} />
        </div>
        <div className="absolute inset-0 z-0 bg-gradient-to-br from-[#A8DADC] via-[#DFF6FF] to-[#F1FAEE]" style={{ opacity: overlayOpacity }} />
        <div className="absolute inset-0 z-0 pointer-events-none">
          {CUTE_ICONS.map((icon, i) => {
             const floatY = Math.sin((frame + icon.delay) / 25) * 20;
             const floatX = Math.cos((frame + icon.delay) / 35) * 15;
             return <div key={i} className={`absolute opacity-75 ${icon.size} drop-shadow-md`} style={{ top: icon.top, left: icon.left, transform: `translate(${floatX}px, ${floatY}px)` }}>{icon.char}</div>;
          })}
        </div>
      </div>

      <div className="absolute inset-0 z-[5] bg-white pointer-events-none mix-blend-overlay" style={{ opacity: climaxFlashOpacity }} />

      <Sequence from={0} durationInFrames={firstLyricStartFrame}>
        <div className="absolute inset-0 flex flex-col items-center justify-center z-10 px-8" style={{ opacity: titleOpacity, transform: `translateY(${titleFloat}px)` }}>
          <div className="flex flex-col items-start text-left max-w-4xl">
            <h1 className="text-4xl md:text-6xl font-sans font-black text-white drop-shadow-[0_5px_15px_rgba(0,0,0,0.3)] mb-6 uppercase tracking-tighter">THIS IS WHAT FALLING IN LOVE FEELS LIKE</h1>
            <h2 className="text-xl font-bold tracking-[0.4em] text-white/95 drop-shadow-[0_3px_10px_rgba(0,0,0,0.4)] uppercase">JVKE</h2>
          </div>
        </div>
      </Sequence>

      <Audio src={staticFile('music.wav')} volume={1} />

      <div className="absolute inset-0 z-10 pointer-events-none">
        {LYRIC_SCRIPT.map((line, index) => {
          const startFrame = getTrueStartFrame(line);
          const nextStartFrame = LYRIC_SCRIPT[index + 1] ? getTrueStartFrame(LYRIC_SCRIPT[index + 1]) : startFrame + getTrueDurationFrame(line);
          const duration = Math.max(1, nextStartFrame - startFrame);

          return (
            <Sequence key={index} from={startFrame} durationInFrames={duration}>
              <LyricLine lineStartFrame={startFrame} words={line.words} vietnamese={line.vietnamese} />
            </Sequence>
          );
        })}
      </div>
    </AbsoluteFill>
  );
};