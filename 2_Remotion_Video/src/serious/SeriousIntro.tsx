import React from 'react';
import { AbsoluteFill, Img, spring, staticFile, useCurrentFrame, useVideoConfig } from 'remotion';

export const SeriousIntro: React.FC<{ author: string, avatar: string }> = ({ author, avatar }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  // Hiệu ứng nảy và mờ dần khi xuất hiện
  const translateY = spring({ frame, fps, config: { damping: 15 }, from: 80, to: 0 });
  const opacity = spring({ frame, fps, config: { damping: 20 }, from: 0, to: 1 });
  const scale = spring({ frame, fps, config: { damping: 12 }, from: 0.85, to: 1 });

  return (
    <AbsoluteFill style={{ justifyContent: 'center', alignItems: 'center', zIndex: 10 }}>
      <div style={{ 
        transform: `translateY(${translateY}px) scale(${scale})`, 
        opacity, 
        display: 'flex', 
        flexDirection: 'column', 
        alignItems: 'center',
        width: '100%',
        padding: '0 40px'
      }}>
        
        {/* Avatar phát sáng */}
        <Img src={staticFile(avatar)} style={{ 
            width: '320px', height: '320px', borderRadius: '50%', objectFit: 'cover',
            border: '8px solid #00ffcc', 
            boxShadow: '0 0 60px rgba(0, 255, 204, 0.6), inset 0 0 20px rgba(0, 255, 204, 0.4)' 
        }} />
        
        {/* Tiêu đề chính siêu lớn */}
        <h1 style={{ 
          color: '#ffffff', 
          fontSize: '96px', 
          fontWeight: '900', 
          marginTop: '60px', 
          marginBottom: '30px',
          textAlign: 'center',
          fontFamily: 'system-ui, -apple-system, sans-serif',
          letterSpacing: '3px', 
          textShadow: '0 10px 40px rgba(0,0,0,0.9)' 
        }}>
          {author.toUpperCase()}
        </h1>
        
        {/* Hộp phụ đề kèm Nút Play */}
        <div style={{ 
          display: 'flex', 
          alignItems: 'center', 
          backgroundColor: 'rgba(2, 6, 23, 0.7)',
          padding: '20px 50px',
          borderRadius: '50px',
          border: '2px solid rgba(0, 255, 204, 0.4)',
          boxShadow: '0 10px 30px rgba(0, 0, 0, 0.5), 0 0 20px rgba(0, 255, 204, 0.15)'
        }}>
          {/* Nút Play SVG */}
          <svg width="45" height="45" viewBox="0 0 24 24" fill="#00ffcc" style={{ marginRight: '20px' }}>
            <path d="M8 5v14l11-7z"/>
          </svg>
          <p style={{ 
            color: '#00ffcc', 
            fontSize: '36px', 
            fontWeight: '700',
            margin: 0, 
            letterSpacing: '3px', 
            textTransform: 'uppercase' 
          }}>
            VÀ NHỮNG LỜI KHUYÊN DÀNH CHO BẠN
          </p>
        </div>

      </div>
    </AbsoluteFill>
  );
};