import React from 'react';
import { useCurrentFrame, useVideoConfig } from 'remotion';

export const KaraokeSubtitle: React.FC<{ words: any[] }> = ({ words }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const currentTime = frame / fps; // Tính xem video đang chạy ở giây thứ mấy

  if (!words || words.length === 0) return null;

  return (
    <div style={{
      position: 'absolute', bottom: '30%', left: 0, right: 0,
      display: 'flex', justifyContent: 'center', alignItems: 'center',
      flexWrap: 'wrap', gap: '12px', padding: '0 60px', zIndex: 40
    }}>
      {words.map((w, i) => {
        // Kiểm tra xem chữ này có đang được đọc tại giây hiện tại không?
        const isActive = currentTime >= w.start && currentTime <= w.end;
        const isPast = currentTime > w.end;
        
        // Chữ chưa đọc thì mờ, chữ đang đọc/đã đọc thì sáng
        const opacity = currentTime >= w.start ? 1 : 0.4;
        
        // Đổi màu chữ đang đọc sang Indigo (Màu chuẩn của MindRevol)
        const color = isActive ? '#5865F2' : '#ffffff'; 

        return (
          <span key={i} style={{
            fontSize: '52px', 
            fontWeight: '900', 
            fontFamily: 'system-ui, sans-serif',
            color: color, 
            opacity: opacity,
            textShadow: '0 5px 15px rgba(0,0,0,0.8)', // Bóng đổ tối để tách khỏi nền
            transition: 'all 0.1s ease-out',
            transform: isActive ? 'scale(1.15)' : 'scale(1)', // Đang đọc thì chữ bự lên một chút
            display: 'inline-block'
          }}>
            {w.word}
          </span>
        );
      })}
    </div>
  );
};