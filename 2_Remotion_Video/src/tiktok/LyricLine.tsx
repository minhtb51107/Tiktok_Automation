import React from 'react';
import { useCurrentFrame, interpolate, spring, useVideoConfig } from 'remotion';
import { WordData } from '../data/script';

export interface LyricProps {
  lineStartFrame: number;
  words: WordData[];
  vietnamese: string;
}

export const LyricLine: React.FC<LyricProps> = ({ lineStartFrame, words, vietnamese }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const blockOpacity = interpolate(frame, [0, 10], [0, 1], { extrapolateRight: 'clamp' });

  const overlayScaleX = spring({
    frame,
    fps,
    config: { damping: 15, mass: 1, stiffness: 120 }
  });

  const getTrueWordFrame = (startVal: number) => {
    return startVal < 1000 ? Math.round(startVal * 30) : Math.round(startVal);
  };

  return (
    <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
      
      <div className="flex flex-col items-center justify-center w-full" style={{ opacity: blockOpacity }}>
        
        {/* Nền Đen Mặc Định */}
        <div className="relative bg-black/70 px-6 py-3 mb-3 shadow-lg rounded-none">
          
          {/* Lớp phủ màu trượt */}
          <div 
            className="absolute inset-0 bg-[#E63946] z-0 rounded-none" 
            style={{
              transformOrigin: 'left center', 
              transform: `scaleX(${overlayScaleX})`, 
            }}
          />

          <div className="whitespace-nowrap flex flex-row items-center justify-center relative z-10">
            {words.map((wordObj, index) => {
              const localWordStart = getTrueWordFrame(wordObj.start) - lineStartFrame;
              const isVisible = frame >= localWordStart;

              return (
                <span 
                  key={index}
                  style={{
                    display: 'inline-block',
                    opacity: isVisible ? 1 : 0,
                    transform: `translateY(${isVisible ? 0 : 5}px)`,
                    transition: 'opacity 0.3s ease-out, transform 0.3s ease-out',
                  }}
                  className="mx-[6px] text-white/95 text-xl md:text-3xl font-sans font-black uppercase"
                >
                  {wordObj.text}
                </span>
              );
            })}
          </div>
        </div>

        {/* Lời Tiếng Việt */}
        <div className="text-sm md:text-lg font-light text-white/95 italic uppercase tracking-widest text-center drop-shadow-[0_2px_4px_rgba(0,0,0,0.9)] px-4 mt-2">
          {vietnamese}
        </div>
      </div>

    </div>
  );
};
