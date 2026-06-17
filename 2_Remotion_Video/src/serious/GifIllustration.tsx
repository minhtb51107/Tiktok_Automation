import React from 'react';
import { Video, spring, useCurrentFrame, useVideoConfig, staticFile } from 'remotion';

export const GifIllustration: React.FC<{ src: string }> = ({ src }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  
  const scale = spring({ frame, fps, config: { damping: 12, mass: 0.6 }, from: 0.5, to: 1 });

  if (!src) return null;

  const videoSrc = src.startsWith('http') ? src : staticFile(src);

  return (
    <div style={{
      position: 'absolute', bottom: '8%', left: 0, right: 0,
      display: 'flex', justifyContent: 'center', alignItems: 'center',
      zIndex: 30
    }}>
      <div style={{
        transform: `rotate(-2deg) scale(${scale})`, // Hơi nghiêng cho phá cách
        borderRadius: '16px', 
        border: '6px solid #1e1f22', // Viền chuẩn MindRevol
        boxShadow: '0 20px 50px rgba(0,0,0,0.8)',
        overflow: 'hidden',
        height: '380px', // Khống chế chiều cao để không che mất thẻ Comment phía trên
        backgroundColor: '#000'
      }}>
        <Video 
          src={videoSrc} 
          style={{ height: '100%', objectFit: 'cover' }} 
          loop 
          muted 
        />
      </div>
    </div>
  );
};
