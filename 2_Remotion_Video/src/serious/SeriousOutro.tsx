import React from 'react';
import { AbsoluteFill, spring, useCurrentFrame, useVideoConfig } from 'remotion';

export const SeriousOutro: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  // Hiệu ứng Zoom và Hiện dần
  const opacity = spring({ frame, fps, config: { damping: 20 }, from: 0, to: 1 });
  const scale = spring({ frame, fps, config: { damping: 12 }, from: 0.8, to: 1 });

  return (
    <AbsoluteFill style={{ justifyContent: 'center', alignItems: 'center', zIndex: 10 }}>
      <div style={{ 
          opacity, transform: `scale(${scale})`, display: 'flex', flexDirection: 'column', alignItems: 'center', 
          backgroundColor: 'rgba(15, 23, 42, 0.85)', padding: '60px 100px', borderRadius: '40px', 
          border: '1px solid rgba(0, 255, 204, 0.3)', boxShadow: '0 20px 50px rgba(0,0,0,0.5)' 
      }}>
        <h1 style={{ color: '#00ffcc', fontSize: '60px', fontWeight: '900', letterSpacing: '2px', textShadow: '0 0 30px rgba(0, 255, 204, 0.6)' }}>
          CẢM ƠN BẠN ĐÃ LẮNG NGHE
        </h1>
        <p style={{ color: '#e2e8f0', fontSize: '36px', marginTop: '30px', fontWeight: '500' }}>
          Hãy chia sẻ bài học của bạn dưới bình luận nhé!
        </p>
      </div>
    </AbsoluteFill>
  );
};