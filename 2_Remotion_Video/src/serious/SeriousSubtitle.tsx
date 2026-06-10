import React from 'react';
import { interpolate, spring, useCurrentFrame, useVideoConfig } from 'remotion';

export const SeriousSubtitle: React.FC<{ text: string }> = ({ text }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  
  const words = text.split(' ');

  return (
    <div style={{ 
      position: 'absolute', bottom: '12%', width: '100%', padding: '0 80px', 
      display: 'flex', flexWrap: 'wrap', justifyContent: 'center', gap: '15px' 
    }}>
      {words.map((word, index) => {
        // Từng chữ sẽ nảy lên lần lượt, cách nhau 3 frame
        const delay = index * 3;
        const scale = spring({ frame: frame - delay, fps, config: { damping: 12 }, from: 0, to: 1 });
        const opacity = interpolate(frame - delay, [0, 10], [0, 1], { extrapolateRight: 'clamp' });
        
        return (
          <span key={index} style={{ 
            fontSize: '52px', color: '#ffffff', fontWeight: '800', lineHeight: 1.3,
            transform: `scale(${scale})`, opacity,
            textShadow: '0 8px 20px rgba(0,0,0,0.9), 0 0 15px rgba(0, 255, 204, 0.4)',
            backgroundColor: 'rgba(2, 6, 23, 0.65)', padding: '4px 16px', borderRadius: '16px',
            border: '1px solid rgba(0, 255, 204, 0.15)'
          }}>
            {word}
          </span>
        );
      })}
    </div>
  );
};