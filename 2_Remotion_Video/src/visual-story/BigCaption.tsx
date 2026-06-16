import React from 'react';
import { spring, useCurrentFrame, useVideoConfig, interpolate } from 'remotion';

export const BigCaption: React.FC<{ text: string }> = ({ text }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  
  // Hiệu ứng mượt mà trượt lên kết hợp Blur sang Nét
  const translateY = spring({ frame, fps, config: { damping: 15 }, from: 80, to: 0 });
  const blur = interpolate(frame, [0, 12], [15, 0], { extrapolateRight: 'clamp' });
  const opacity = spring({ frame, fps, config: { damping: 20 }, from: 0, to: 1 });

  return (
    <div style={{
      position: 'absolute', top: '15%', left: 0, right: 0,
      display: 'flex', justifyContent: 'center', alignItems: 'center',
      transform: `translateY(${translateY}px)`, opacity, filter: `blur(${blur}px)`,
    }}>
      <h1 style={{
        fontSize: '135px', 
        fontWeight: 900, // font-black chuẩn trang chủ MindRevol
        fontFamily: 'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
        color: '#ffffff', // Chỉ để màu trắng tinh khôi theo yêu cầu của sếp
        textAlign: 'center', 
        width: '90%',
        textTransform: 'uppercase', // Viết HOA toàn bộ
        lineHeight: 1.05, 
        letterSpacing: '-0.05em', // tracking-tight ép khít chữ tạo độ mạnh mẽ
        margin: 0,
        textShadow: '0px 15px 35px rgba(0,0,0,0.5)' // Bóng đổ tối nhẹ phía sau để tách chữ khỏi nền lưới nếu trùng
      }}>
        {text}
      </h1>
    </div>
  );
};