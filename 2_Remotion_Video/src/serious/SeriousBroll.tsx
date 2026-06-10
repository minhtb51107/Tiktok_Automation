import React from 'react';
import { AbsoluteFill, OffthreadVideo, spring, useCurrentFrame, useVideoConfig } from 'remotion';

export const SeriousBroll: React.FC<{ brollUrl: string }> = ({ brollUrl }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  // Hiệu ứng Fade In và Zoom nhẹ khi chuyển cảnh
  const opacity = spring({ frame, fps, config: { damping: 20 }, from: 0, to: 1 });
  const scale = spring({ frame, fps, config: { damping: 100 }, from: 1.1, to: 1 }) + (frame * 0.0005); // Zoom out rất chậm

  return (
    <AbsoluteFill style={{ justifyContent: 'center', alignItems: 'center', opacity }}>
      <div style={{
        width: '90%', height: '60%', position: 'absolute', top: '8%',
        borderRadius: '32px', overflow: 'hidden',
        boxShadow: '0 20px 50px rgba(0, 255, 204, 0.1), 0 0 0 1px rgba(255, 255, 255, 0.1)',
      }}>
        {brollUrl ? (
          <OffthreadVideo 
            src={brollUrl} 
            style={{ width: '100%', height: '100%', objectFit: 'cover', transform: `scale(${scale})` }} 
            muted 
          />
        ) : (
          <div style={{ width: '100%', height: '100%', backgroundColor: '#1e293b', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <span style={{ color: '#64748b' }}>Không tìm thấy Video B-Roll</span>
          </div>
        )}

        {/* Lớp phủ đen nhẹ để chữ không bị chói */}
        <div style={{ position: 'absolute', inset: 0, backgroundColor: 'rgba(0, 0, 0, 0.2)' }} />
      </div>
    </AbsoluteFill>
  );
};