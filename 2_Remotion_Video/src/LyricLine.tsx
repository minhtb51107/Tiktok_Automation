// src/LyricLine.tsx
import React from 'react';
import { useCurrentFrame, interpolate } from 'remotion';
import { WordData } from './data/script';

export interface LyricProps {
  lineStart: number;
  words: WordData[];
  vietnamese: string;
}

export const LyricLine: React.FC<LyricProps> = ({ lineStart, words, vietnamese }) => {
  const frame = useCurrentFrame();

  const blockOpacity = interpolate(frame, [0, 10], [0, 1], { extrapolateRight: 'clamp' });
  const isNeonLine = words.some(w => w.effect === 'neon-rainbow');

  return (
    <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
      
      <div className="flex flex-col items-center justify-center w-full" style={{ opacity: blockOpacity }}>
        
        <div className={isNeonLine ? "mb-4" : "bg-black/70 px-6 py-3 mb-3 shadow-lg"}>
          <div className="whitespace-nowrap flex flex-row items-center justify-center">
            {words.map((wordObj, index) => {
              const localWordStart = wordObj.start - lineStart;
              const isVisible = frame >= localWordStart;
              const activeFrames = Math.max(0, frame - localWordStart);

              let effectStyle: React.CSSProperties = {
                display: 'inline-block',
                opacity: isVisible ? 1 : 0,
                transform: `translateY(${isVisible ? 0 : 5}px)`,
                transition: 'opacity 0.3s ease-out, transform 0.3s ease-out',
              };
              
              // Mặc định các chữ khác đều ép viết hoa (uppercase)
              let effectClass = "text-white/95 text-xl md:text-3xl font-sans font-black uppercase"; 

              if (isVisible && wordObj.effect) {
                switch (wordObj.effect) {
                  case 'shake':
                    const shakeX = Math.sin(activeFrames * 2) * 3;
                    const shakeY = Math.cos(activeFrames * 3) * 2;
                    effectStyle.transform = `translate(${shakeX}px, ${shakeY}px)`;
                    effectClass = "text-white text-xl md:text-3xl font-sans font-black uppercase";
                    break;

                  case 'glitch':
                    effectStyle.textShadow = activeFrames % 4 < 2 
                      ? '3px 0 rgba(255,0,0,0.7), -3px 0 rgba(0,255,255,0.7)' 
                      : 'none';
                    effectStyle.transform = `skewX(${Math.sin(activeFrames) * 10}deg)`;
                    effectClass = "text-white text-xl md:text-3xl font-sans font-black uppercase";
                    break;

                  case 'glow-gold':
                    effectClass = "text-[#FDE047] drop-shadow-[0_0_15px_rgba(250,204,21,0.6)] text-xl md:text-3xl font-sans font-black uppercase";
                    break;

                  case 'throw-away':
                    const fallY = Math.pow(activeFrames, 1.5) * 0.5; 
                    const spin = activeFrames * 3;
                    effectStyle.transform = `translateY(${fallY}px) rotate(${spin}deg)`;
                    effectStyle.opacity = interpolate(activeFrames, [0, 20], [1, 0], { extrapolateRight: 'clamp' });
                    effectClass = "text-gray-400 text-xl md:text-3xl font-sans font-black uppercase"; 
                    break;

                  case 'flash-climax':
                    const climaxScale = interpolate(activeFrames, [0, 5, 20], [1.5, 1.1, 1], { extrapolateRight: 'clamp' });
                    effectStyle.transform = `scale(${climaxScale})`;
                    effectStyle.filter = `brightness(${interpolate(activeFrames, [0, 10], [2, 1])})`;
                    effectClass = "text-white drop-shadow-[0_0_20px_rgba(255,255,255,1)] text-xl md:text-3xl font-sans font-black uppercase";
                    break;

                  case 'neon-rainbow':
                    const hue = (activeFrames * 5) % 360;
                    effectStyle.color = `hsl(${hue}, 100%, 75%)`;
                    
                    // ÁP DỤNG FONT BÚT MÁY VÀO STYLE
                    effectStyle.fontFamily = "'Dancing Script', cursive";
                    
                    effectStyle.textShadow = `
                      3px 3px 0px rgba(0, 0, 0, 1),
                      -2px -2px 0px rgba(0, 0, 0, 1),
                      2px -2px 0px rgba(0, 0, 0, 1),
                      -2px 2px 0px rgba(0, 0, 0, 1),
                      0 0 12px hsl(${hue}, 100%, 70%),
                      0 0 25px hsl(${hue}, 100%, 60%),
                      0 0 50px hsl(${hue}, 100%, 50%)
                    `;
                    
                    // LƯU Ý: Đã bỏ 'uppercase', tăng size lên 5xl/7xl để chữ viết tay nhìn rõ nét và mềm mại
                    effectClass = "text-5xl md:text-7xl font-bold tracking-normal";
                    break;
                }
              }

              return (
                <span 
                  key={index}
                  style={effectStyle}
                  // Đã gỡ bỏ class uppercase ở đây để chữ viết tay có thể nối nét với nhau
                  className={`mx-[6px] ${effectClass}`}
                >
                  {wordObj.text}
                </span>
              );
            })}
          </div>
        </div>

        {/* LỜI TIẾNG VIỆT */}
        <div className="text-sm md:text-lg font-light text-white/95 italic uppercase tracking-widest text-center drop-shadow-[0_2px_4px_rgba(0,0,0,0.9)] px-4 mt-2">
          {vietnamese}
        </div>
      </div>

    </div>
  );
};