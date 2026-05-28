import React from 'react';
import { AbsoluteFill, Sequence, Audio, useCurrentFrame, useVideoConfig, Img, staticFile, interpolate } from 'remotion';
import { LYRIC_SCRIPT } from './data/script';
import { LyricLine } from './LyricLine';

const CUTE_ICONS = [
  { char: '✨', top: '25%', left: '20%', size: 'text-5xl', delay: 0 },
  { char: '🤍', top: '70%', left: '15%', size: 'text-6xl', delay: 45 },
  { char: '🫧', top: '35%', left: '80%', size: 'text-4xl', delay: 90 },
  { char: '☁️', top: '15%', left: '65%', size: 'text-6xl', delay: 60 },
];

export interface MyCompositionProps {
  imageList?: string[]; 
  songTitle?: string;
  artist?: string;
}

export const MyComposition = ({ 
  imageList = [], 
  songTitle = "THIS IS WHAT FALLING IN LOVE FEELS LIKE", 
  artist = "JVKE" 
}: MyCompositionProps) => {
  const frame = useCurrentFrame();
  const { durationInFrames } = useVideoConfig();

  const defaultImages = ['1.jpg', '2.jpg', '3.jpg', '4.jpg', '5.jpg', '6.jpg', '7.jpg'];
  const currentImageList = imageList.length > 0 ? imageList : defaultImages;
  const images = currentImageList.map(imgName => staticFile(imgName));

  const framesPerImage = 15; 
  const safeImageLength = images.length > 0 ? images.length : 1; 
  const currentImageIndex = Math.floor(frame / framesPerImage) % safeImageLength;
  
  const getTrueStartFrame = (startVal: number) => {
    return startVal < 1000 ? Math.round(startVal * 30) : Math.round(startVal);
  };
  const getTrueDurationFrame = (durationVal: number) => {
    return durationVal < 20 ? Math.round(durationVal * 30) : Math.round(durationVal);
  };

  // ==========================================
  // THUẬT TOÁN INTRO ĐỘNG (THÔNG MINH NHẤT)
  // ==========================================
  const MIN_INTRO_SECONDS = 3; // Intro yêu cầu phải dài ít nhất 3 giây

  // 1. Quét tìm index của câu hát đầu tiên xuất hiện SAU 3 giây
  const firstValidLyricIndex = LYRIC_SCRIPT.findIndex(line => line.start >= MIN_INTRO_SECONDS);

  // 2. Tính số Frame kết thúc Intro (Kéo giãn Intro để khớp hoàn hảo với câu hát mới)
  const introEndFrame = firstValidLyricIndex !== -1 
    ? getTrueStartFrame(LYRIC_SCRIPT[firstValidLyricIndex].start) 
    : MIN_INTRO_SECONDS * 30;

  // 3. Lọc bỏ toàn bộ các câu hát diễn ra trong lúc Intro đang chiếu (Bỏ lời thừa)
  const visibleLyrics = firstValidLyricIndex !== -1 
    ? LYRIC_SCRIPT.slice(firstValidLyricIndex) 
    : [];
  // ==========================================

  const climaxFrame = 815; 

  const overlayOpacity = interpolate(
    frame,
    [Math.max(0, introEndFrame - 30), introEndFrame],
    [0.6, 0.15], 
    { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' }
  );

  // Intro tự động mờ đi trong 15 frame (nửa giây) trước khi kết thúc
  const titleOpacity = interpolate(frame, [introEndFrame - 15, introEndFrame], [1, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
  const titleFloat = Math.sin(frame / 12) * 10; 
  
  const cameraZoom = interpolate(frame, [0, durationInFrames], [1, 1.15]);

  const climaxFlashOpacity = interpolate(
    frame,
    [climaxFrame, climaxFrame + 5, climaxFrame + 30],
    [0, 0.8, 0], 
    { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' }
  );

  const warpAmount = 5 + Math.sin(frame / 20) * 3;

  return (
    <AbsoluteFill className="bg-[#A8DADC] overflow-hidden flex items-center justify-center">
      
      <svg className="absolute w-0 h-0 pointer-events-none">
        <filter id="dreamy-warp">
          <feTurbulence type="fractalNoise" baseFrequency="0.015" numOctaves="1" result="noise" />
          <feDisplacementMap in="SourceGraphic" in2="noise" scale={warpAmount} xChannelSelector="R" yChannelSelector="G" />
        </filter>
      </svg>

      <div className="absolute inset-0 z-0" style={{ transform: `scale(${cameraZoom})`, transformOrigin: 'center center' }}>
        <div className="absolute inset-0 z-0 bg-black">
          {images.length > 0 && (
             <Img 
               src={images[currentImageIndex]} 
               className="w-full h-full object-cover opacity-85" 
               style={{ filter: 'url(#dreamy-warp)', transform: 'scale(1.05)' }} 
             />
          )}
        </div>
        <div className="absolute inset-0 z-0 bg-gradient-to-br from-[#A8DADC] via-[#DFF6FF] to-[#F1FAEE]" style={{ opacity: overlayOpacity }} />
        <div className="absolute inset-0 z-0 pointer-events-none">
          {CUTE_ICONS.map((icon, i) => {
             const floatY = Math.sin((frame + icon.delay) / 25) * 20;
             const floatX = Math.cos((frame + icon.delay) / 35) * 15;
             return (
               <div key={i} className={`absolute opacity-75 ${icon.size} drop-shadow-md`} style={{ top: icon.top, left: icon.left, transform: `translate(${floatX}px, ${floatY}px)` }}>
                 {icon.char}
               </div>
             );
          })}
        </div>
      </div>

      <div className="absolute inset-0 z-[5] bg-white pointer-events-none mix-blend-overlay" style={{ opacity: climaxFlashOpacity }} />

      {/* Âm thanh phát ngay lập tức không bị delay */}
      <Audio src={staticFile('music.wav')} volume={1} />

      {/* --- PHẦN 1: INTRO (Thời gian động khớp chính xác tới mili-giây) --- */}
      <Sequence from={0} durationInFrames={introEndFrame}>
        <div 
          className="absolute inset-0 flex flex-col items-center justify-center z-10 px-8"
          style={{ opacity: titleOpacity, transform: `translateY(${titleFloat}px)` }}
        >
          <div className="flex flex-col items-start text-left max-w-4xl">
            <h1 className="text-4xl md:text-6xl font-sans font-black text-white drop-shadow-[0_5px_15px_rgba(0,0,0,0.3)] mb-6 uppercase tracking-tighter">
              {songTitle}
            </h1>
            <h2 className="text-xl font-bold tracking-[0.4em] text-white/95 drop-shadow-[0_3px_10px_rgba(0,0,0,0.4)] uppercase">
              {artist}
            </h2>
          </div>
        </div>
      </Sequence>

      {/* --- PHẦN 2: LỜI BÀI HÁT (Cắt sạch lời thừa đoạn đầu và đuôi) --- */}
      <div className="absolute inset-0 z-10 pointer-events-none">
        {visibleLyrics.map((line, index) => {
          const startFrame = getTrueStartFrame(line.start);
          
          // Outro fix: Lấy đúng thời lượng AI báo cáo, cộng thêm 15 frame (0.5s) cho chữ đỡ biến mất quá gắt
          let duration = getTrueDurationFrame(line.duration) + 15;

          // Chống đè lên câu tiếp theo: Nếu thời gian hiện câu này chạm vào câu tiếp theo thì rút ngắn lại ngay lập tức
          if (visibleLyrics[index + 1]) {
            const nextStart = getTrueStartFrame(visibleLyrics[index + 1].start);
            if (startFrame + duration > nextStart) {
              duration = Math.max(1, nextStart - startFrame);
            }
          }

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