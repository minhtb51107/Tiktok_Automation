import React from 'react';
import { spring, useCurrentFrame, useVideoConfig, Img, staticFile, Video } from 'remotion';

export const ThreadCard: React.FC<{ 
  author: string; text: string; avatar?: string; attachedImage?: string; memeMp4?: string;
  likes?: string; comments?: string; reposts?: string; timeAgo?: string 
}> = ({ author, text, avatar, attachedImage, memeMp4, likes = "1.2K", comments = "128", reposts = "45", timeAgo = "5 phút" }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const scale = spring({ frame, fps, config: { damping: 14, mass: 0.8 } });
  const memeScale = spring({ frame: frame - 10, fps, config: { damping: 12, stiffness: 200 } });

  const safeAvatar = avatar?.startsWith('http') || avatar?.startsWith('data:') 
    ? avatar : staticFile(avatar || 'avatars/default_avatar.jpg');

  return (
    <div style={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center', gap: '30px' }}>
      
      {/* KHỐI 1: THẺ THREAD CARD CHÍNH */}
      <div
        style={{
          transform: `scale(${scale})`,
          backgroundColor: '#181818', color: '#F3F5F7',
          padding: '40px', borderRadius: '24px', width: '900px',
          height: 'fit-content', border: '1px solid #333638',
          boxShadow: '0 20px 40px rgba(0,0,0,0.6)', display: 'flex', flexDirection: 'row', gap: '24px',
        }}
      >
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
          <Img src={safeAvatar} style={{ width: '80px', height: '80px', borderRadius: '40px', objectFit: 'cover' }} />
          <div style={{ width: '3px', height: '100%', minHeight: '60px', backgroundColor: '#333638', marginTop: '16px', borderRadius: '2px' }}></div>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', flex: 1, paddingBottom: '10px' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span style={{ fontSize: '36px', fontWeight: 'bold' }}>{author}</span>
            <span style={{ fontSize: '30px', color: '#777' }}>{timeAgo}</span>
          </div>

          <p style={{ fontSize: '40px', lineHeight: 1.4, margin: '15px 0 0 0', whiteSpace: 'pre-wrap' }}>
            {text}
          </p>

          {attachedImage && (
            <div style={{ marginTop: '20px', width: '100%', overflow: 'hidden', borderRadius: '16px', border: '1px solid #333638' }}>
              <Img src={staticFile(attachedImage)} style={{ width: '100%', maxHeight: '400px', objectFit: 'cover' }} />
            </div>
          )}

          <div style={{ display: 'flex', gap: '40px', marginTop: '35px', color: '#777', alignItems: 'center' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              <svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"></path></svg>
              <span style={{ fontSize: '30px' }}>{likes}</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              <svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"></path></svg>
              <span style={{ fontSize: '30px' }}>{comments}</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              <svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="17 1 21 5 17 9"></polyline><path d="M3 11V9a4 4 0 0 1 4-4h14"></path><polyline points="7 23 3 19 7 15"></polyline><path d="M21 13v2a4 4 0 0 1-4 4H3"></path></svg>
              <span style={{ fontSize: '30px' }}>{reposts}</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center' }}>
              <svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="22" y1="2" x2="11" y2="13"></line><polygon points="22 2 15 22 11 13 2 9 22 2"></polygon></svg>
            </div>
          </div>
        </div>
      </div>

      {/* KHỐI 2: MEME POP-UP TRÀN ĐẦY LINH HOẠT */}
      {memeMp4 && (
        <div style={{
          transform: `scale(${memeScale})`, 
          borderRadius: '16px', overflow: 'hidden',
          boxShadow: '0 10px 30px rgba(0,0,0,0.8)',
          maxWidth: '900px', // Đảm bảo rộng tối đa bằng Card chính
          maxHeight: '600px', // Kích thước thả nổi tùy tỷ lệ ảnh
          display: 'flex', justifyContent: 'center', alignItems: 'center'
        }}>
          {memeMp4.endsWith('.mp4') ? (
            <Video src={staticFile(`memes/${memeMp4}`)} style={{ maxWidth: '100%', maxHeight: '600px', objectFit: 'contain', display: 'block' }} muted/>
          ) : (
            <Img src={staticFile(`memes/${memeMp4}`)} style={{ maxWidth: '100%', maxHeight: '600px', objectFit: 'contain', display: 'block' }} />
          )}
        </div>
      )}
    </div>
  );
};