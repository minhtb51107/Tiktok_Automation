import React from 'react';
import { Img, spring, useCurrentFrame, useVideoConfig, staticFile } from 'remotion';

export const MemeIllustration: React.FC<{ src: string }> = ({ src }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  
  // Animation: Pop In
  const scale = spring({ frame, fps, config: { damping: 12, mass: 0.6 }, from: 0.5, to: 1 });

  return (
    <div style={{
      position: 'absolute', bottom: '8%', left: 0, right: 0,
      display: 'flex', justifyContent: 'center', alignItems: 'center',
    }}>
      <Img 
        src={staticFile(src)} 
        style={{ 
          transform: `rotate(-3deg) scale(${scale})`, // Xoay nghiêng nhẹ tạo cảm giác dán sticker
          maxHeight: '450px', borderRadius: '16px', 
          border: '8px solid white', boxShadow: '0 20px 50px rgba(0,0,0,0.9)' 
        }} 
      />
    </div>
  );
};