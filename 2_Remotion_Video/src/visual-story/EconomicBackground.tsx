import React from 'react';
import { AbsoluteFill, useCurrentFrame, interpolate } from 'remotion';

export const EconomicBackground: React.FC = () => {
  const frame = useCurrentFrame();

  const gridTranslateY = (frame * 0.8) % 100;

  return (
    <AbsoluteFill style={{ backgroundColor: '#1c0000', overflow: 'hidden' }}>
      
      {/* LỚP 1: GRADIENT ĐỎ ĐẬM -> ĐỎ SÁNG CẢNH BÁO */}
      <div style={{
        position: 'absolute', inset: 0,
        background: 'radial-gradient(circle at 50% 40%, #5A0000 0%, #2A0000 70%, #150000 100%)'
      }} />

      {/* LỚP 2: GRID NGHIÊNG CONG 3D (PERSPECTIVE RETRO TECH) */}
      <div style={{
        position: 'absolute', inset: 0,
        perspective: '400px',
        transformOrigin: 'center bottom',
        opacity: 0.15
      }}>
        <div style={{
  position: 'absolute', width: '200%', height: '200%',
  top: '-50%', left: '-50%',
  backgroundImage: `
    linear-gradient(rgba(255,255,255,0.15) 2px, transparent 2px), 
    linear-gradient(90deg, rgba(255,255,255,0.15) 2px, transparent 2px)
  `,
  backgroundSize: '80px 80px',
  transform: `rotateX(55deg) translateY(${gridTranslateY}px)`, // Giữ lại đúng 1 chữ transform
}} />
      </div>

      {/* LỚP 3: BIỂU ĐỒ CỘT (BAR CHART) + MAP CHẠY NGẦM Ở ĐÁY VIDEO */}
      <div style={{
        position: 'absolute', bottom: '5%', left: '5%', right: '5%',
        height: '350px', opacity: 0.08, display: 'flex', alignItems: 'flex-end', gap: '15px'
      }}>
        {/* Vẽ biểu đồ cột mô phỏng dữ liệu phân tích tài chính */}
        {[40, 70, 55, 90, 60, 110, 85, 130, 95, 150, 120, 175, 140, 210].map((height, i) => {
          const wave = Math.sin(frame * 0.05 + i) * 10; // Cột nhấp nhô nhẹ theo thời gian
          return (
            <div key={i} style={{
              flex: 1,
              height: `${height + wave}px`,
              backgroundColor: '#ffffff',
              borderRadius: '6px 6px 0 0',
            }} />
          );
        })}
      </div>

      {/* Viền Vignette tối bốn góc để tập trung ánh sáng vào trung tâm */}
      <div style={{
        position: 'absolute', inset: 0,
        background: 'radial-gradient(circle, transparent 20%, rgba(0,0,0,0.6) 100%)'
      }} />
    </AbsoluteFill>
  );
};
