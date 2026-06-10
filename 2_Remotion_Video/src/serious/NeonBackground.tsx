import React from 'react';
import { AbsoluteFill, useCurrentFrame, useVideoConfig } from 'remotion';

export const NeonBackground: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  // Tốc độ cuộn của lưới (Tăng giảm số này để lưới trôi nhanh/chậm)
  const speed = 4;
  const scrollY = (frame * speed) % 100;

  return (
    <AbsoluteFill style={{ backgroundColor: '#020617', overflow: 'hidden' }}>
      
      {/* 1. Bóng sáng ở trung tâm đường chân trời (Horizon Glow) */}
      <div style={{
        position: 'absolute', top: '25%', left: 0, right: 0, height: '50%',
        background: 'radial-gradient(ellipse at center, rgba(0, 255, 204, 0.15) 0%, transparent 70%)',
        zIndex: 1, pointerEvents: 'none'
      }} />

      {/* 2. Lớp phủ đen Gradient che nửa trên để tạo không gian sâu */}
      <div style={{
        position: 'absolute', top: 0, left: 0, right: 0, height: '45%',
        background: 'linear-gradient(to bottom, #020617 50%, transparent)',
        zIndex: 2
      }} />

      {/* 3. Lưới không gian 3D (3D Perspective Grid) */}
      <div style={{
        position: 'absolute', top: '20%', left: '-50%', width: '200%', height: '150%',
        transform: `perspective(600px) rotateX(75deg) translateY(${scrollY}px)`,
        transformOrigin: 'top center',
        zIndex: 0
      }}>
        <div style={{
          position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
          backgroundImage: `
            linear-gradient(to right, rgba(0, 255, 204, 0.4) 2px, transparent 2px),
            linear-gradient(to bottom, rgba(0, 255, 204, 0.4) 2px, transparent 2px)
          `,
          backgroundSize: '100px 100px',
          boxShadow: '0 0 40px rgba(0, 255, 204, 0.3) inset', // Viền phát sáng xung quanh lưới
        }} />
      </div>

    </AbsoluteFill>
  );
};