import React from 'react';
import { Img, staticFile } from 'remotion';

interface ThreadsCardProps {
  author: string;
  avatar: string;
  text: string;
  timeAgo: string;
  likes: string | number;
  replies: string | number;
}

export const ThreadsCard: React.FC<ThreadsCardProps> = ({
  author,
  avatar,
  text,
  timeAgo,
  likes,
  replies,
}) => {
  const safeAvatar = avatar?.startsWith('http') || avatar?.startsWith('data:')
    ? avatar
    : staticFile(avatar || 'avatars/default_avatar.jpg');

  return (
    <div style={{
      width: '880px',
      backgroundColor: '#101010', // Nền đen Threads chuẩn
      border: '1px solid #262626', // Viền tối mờ tinh tế
      borderRadius: '24px',
      padding: '30px 35px',
      color: '#ffffff',
      fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif',
      boxShadow: '0 30px 60px rgba(0,0,0,0.8)',
      boxSizing: 'border-box'
    }}>
      <div style={{ display: 'flex', gap: '22px' }}>
        
        {/* Cột Trái: Avatar & Đường chỉ dọc của chuỗi Thread */}
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
          <Img src={safeAvatar} style={{ width: '75px', height: '75px', borderRadius: '50%', objectFit: 'cover' }} />
          <div style={{
            width: '2px',
            flexGrow: 1,
            backgroundColor: '#262626',
            marginTop: '15px',
            borderRadius: '1px',
            minHeight: '40px'
          }} />
        </div>

        {/* Cột Phải: Nội dung bài đăng */}
        <div style={{ flex: 1, minWidth: 0 }}>
          
          {/* Header: Tên người dùng + Thời gian + Nút 3 chấm */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span style={{ fontSize: '30px', fontWeight: '700', color: '#f3f5f7' }}>{author}</span>
            <div style={{ display: 'flex', alignItems: 'center', gap: '15px', color: '#616161', fontSize: '24px', marginLeft: 'auto' }}>
              <span>{timeAgo}</span>
              <svg viewBox="0 0 24 24" style={{ width: '26px', height: '26px', fill: 'currentColor' }}>
                <circle cx="12" cy="12" r="1.5" />
                <circle cx="6" cy="12" r="1.5" />
                <circle cx="18" cy="12" r="1.5" />
              </svg>
            </div>
          </div>

          {/* Nội dung text: Chữ trắng in đậm vừa phải, giữ nguyên xuống hàng */}
          <p style={{
            fontSize: '34px',
            lineHeight: '1.45',
            fontWeight: '600', // Nền đen chữ trắng in đậm chuẩn Drama
            color: '#f3f5f7',
            margin: '12px 0 25px 0',
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-word'
          }}>
            {text}
          </p>

          {/* Hàng nút chức năng tương tác (Tim, Bình luận, Đăng lại, Gửi) */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '30px', color: '#616161' }}>
            {/* Nút Tim */}
            <svg viewBox="0 0 24 24" style={{ width: '30px', height: '30px', stroke: 'currentColor', strokeWidth: 2, fill: 'none' }}>
              <path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z" />
            </svg>
            {/* Nút Bình luận */}
            <svg viewBox="0 0 24 24" style={{ width: '30px', height: '30px', stroke: 'currentColor', strokeWidth: 2, fill: 'none' }}>
              <path d="M21 11.5a8.38 8.38 0 01-.9 3.8 8.5 8.5 0 01-7.6 4.7 8.38 8.38 0 01-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 01-.9-3.8 8.5 8.5 0 014.7-7.6 8.38 8.38 0 013.8-.9h.5a8.48 8.48 0 018 8v.5z" />
            </svg>
            {/* Nút Đăng lại */}
            <svg viewBox="0 0 24 24" style={{ width: '30px', height: '30px', stroke: 'currentColor', strokeWidth: 2, fill: 'none' }}>
              <path d="M17 1l4 4-4 4m4-4H7a4 4 0 00-4 4v3m3 7l-4-4 4-4m-4 4h14a4 4 0 004-4v-3" />
            </svg>
            {/* Nút Chia sẻ */}
            <svg viewBox="0 0 24 24" style={{ width: '30px', height: '30px', stroke: 'currentColor', strokeWidth: 2, fill: 'none' }}>
              <path d="M4 12v8a2 2 0 002 2h12a2 2 0 002-2v-8M16 6l-4-4-4 4M12 2v13" />
            </svg>
          </div>

          {/* Số lượng tương tác ở dưới đáy Card */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', color: '#616161', fontSize: '24px', marginTop: '22px' }}>
            <span>{Number(replies).toLocaleString()} bình luận</span>
            <span>•</span>
            <span>{Number(likes).toLocaleString()} lượt thích</span>
          </div>

        </div>
      </div>
    </div>
  );
};