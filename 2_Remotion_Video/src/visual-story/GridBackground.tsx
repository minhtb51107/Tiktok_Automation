import React from 'react';
import { AbsoluteFill, useCurrentFrame, useVideoConfig } from 'remotion';

export const GridBackground: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  // Tạo ra 15 vì sao nhấp nháy tĩnh (dùng Math.sin để tính độ nhấp nháy theo frame)
  const stars = Array.from({ length: 15 }).map((_, i) => ({
    top: `${(Math.sin(i * 123) * 40) + 50}%`,
    left: `${(Math.cos(i * 321) * 40) + 50}%`,
    size: Math.abs(Math.sin(i * 456)) * 10 + 5,
    offset: i * 10,
  }));

  return (
    <AbsoluteFill style={{ 
      // Gradient dọc y hệt Landing Page Dark Mode
      background: 'linear-gradient(to bottom, #0e0e16, #1a1b41, #2e3192)',
      overflow: 'hidden',
      fontFamily: 'system-ui, sans-serif'
    }}>
      
      {/* Lưới kỹ thuật chìm (Blueprint Grid) */}
      <div style={{
        position: 'absolute', inset: 0,
        backgroundImage: `
          linear-gradient(rgba(255,255,255,0.05) 1px, transparent 1px), 
          linear-gradient(90deg, rgba(255,255,255,0.05) 1px, transparent 1px)
        `,
        backgroundSize: '64px 64px',
      }} />

      {/* Ánh sáng Không gian (Space Glows) */}
      <div style={{
        position: 'absolute', top: '10%', right: '-10%', width: '600px', height: '600px',
        backgroundColor: 'rgba(99, 102, 241, 0.15)', // Indigo
        borderRadius: '50%', filter: 'blur(150px)',
      }} />
      <div style={{
        position: 'absolute', bottom: '10%', left: '-10%', width: '700px', height: '700px',
        backgroundColor: 'rgba(236, 72, 153, 0.12)', // Pink
        borderRadius: '50%', filter: 'blur(150px)',
      }} />

      {/* Các vì sao nhấp nháy */}
      {stars.map((star, i) => {
        const opacity = (Math.sin((frame + star.offset) / (fps / 2)) + 1) / 2 * 0.6 + 0.1;
        return (
          <div key={i} style={{
            position: 'absolute', top: star.top, left: star.left,
            width: `${star.size}px`, height: `${star.size}px`,
            backgroundColor: '#ffffff', borderRadius: '50%',
            opacity, filter: 'blur(2px)', boxShadow: '0 0 10px rgba(255,255,255,0.8)'
          }} />
        );
      })}

      {/* Branding Dọc (Vertical Text) */}
      <div style={{
        position: 'absolute', left: '30px', top: '0', bottom: '0',
        display: 'flex', flexDirection: 'column', justifyContent: 'center',
      }}>
        <span style={{
          color: 'rgba(99, 102, 241, 0.4)', // text-indigo-500/40
          fontWeight: 'bold', fontSize: '18px', letterSpacing: '0.4em',
          writingMode: 'vertical-rl', transform: 'rotate(180deg)',
          textTransform: 'uppercase'
        }}>
          MINDREVOL • CONNECT THE UNIVERSE
        </span>
      </div>
      
      {/* Watermark khổng lồ bên phải */}
      <div style={{
        position: 'absolute', right: '0', top: '50%', transform: 'translateY(-50%)',
      }}>
        <span style={{
          color: 'rgba(255, 255, 255, 0.02)',
          fontWeight: '900', fontSize: '180px', lineHeight: 1,
          writingMode: 'vertical-rl',
        }}>
          STORIES
        </span>
      </div>

    </AbsoluteFill>
  );
};