import React from 'react';
import { Img, spring, useCurrentFrame, useVideoConfig } from 'remotion';

export const StoryCard: React.FC<{ info: any }> = ({ info }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const scale = spring({ frame, fps, config: { damping: 14, mass: 0.8 }, from: 0.9, to: 1 });
  const opacity = spring({ frame, fps, config: { damping: 20 }, from: 0, to: 1 });

  if (!info) return null;

  return (
    <div style={{
      transform: `scale(${scale})`, opacity,
      backgroundColor: '#ffffff', // Nền trắng hoàn toàn tạo tương phản cực mạnh với không gian tối
      border: '1px solid rgba(0,0,0,0.08)',
      borderRadius: '28px', // Bo góc tinh tế
      width: '880px', 
      padding: '45px', 
      color: '#000000', // Chữ đen sâu dễ đọc
      boxShadow: '0 30px 60px rgba(0,0,0,0.6), 0 4px 12px rgba(0,0,0,0.1)',
      fontFamily: 'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif'
    }}>
      {/* Header tác giả */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '20px', marginBottom: '25px' }}>
        <Img src={info.avatar} style={{ width: '80px', height: '80px', borderRadius: '50%', objectFit: 'cover' }} />
        <div>
          <div style={{ fontSize: '32px', fontWeight: '800', color: '#000000' }}>{info.author}</div>
          <div style={{ fontSize: '24px', color: '#71717a', marginTop: '4px' }}>{info.timeAgo || 'Vừa xong'}</div>
        </div>
      </div>

      {/* Nội dung text chia sẻ thật */}
      <p style={{ 
        fontSize: '42px', 
        lineHeight: 1.5, 
        fontWeight: '600', 
        margin: 0, // Đã dọn dẹp margin dưới vì không còn thanh interaction bar nữa
        color: '#18181b',
        whiteSpace: 'pre-wrap'
      }}>
        {info.text}
      </p>

      {/* ĐÃ LƯỢC BỎ TOÀN BỘ THANH ĐĂNG LẠI, TIM, SHARE THEO CHỈ ĐẠO CỦA SẾP ĐỂ TỐI GIẢN UI */}
    </div>
  );
};
