import React from 'react';
import { spring, useCurrentFrame, useVideoConfig, Img, staticFile, Video } from 'remotion';

export const ThreadCard: React.FC<{ 
  author: string; text: string; avatar?: string; attachedImage?: string; memeMp4?: string;
  likes?: string; comments?: string; reposts?: string; shares?: string; timeAgo?: string;
  reply?: any; parentAudioDuration?: number; 
}> = ({ 
  author, text, avatar, attachedImage, memeMp4, 
  likes = "1.2K", comments = "128", reposts = "45", shares = "12", timeAgo = "5 phút", 
  reply, parentAudioDuration = 0 
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  // Hiệu ứng Pop-up Card & Meme
  const scale = spring({ frame, fps, config: { damping: 14, mass: 0.8 } });
  const memeScale = spring({ frame: frame - 10, fps, config: { damping: 14, stiffness: 200 } });

  // Hiệu ứng xuất hiện của Đứa Con (Trượt lên sau khi Cha đọc xong)
  const childDelay = parentAudioDuration + 15;
  const childOpacity = spring({ frame: frame - childDelay, fps, config: { damping: 20 }, from: 0, to: 1 });
  const childTranslate = spring({ frame: frame - childDelay, fps, config: { damping: 14 }, from: 30, to: 0 });

  const safeAvatar = avatar?.startsWith('http') || avatar?.startsWith('data:') 
    ? avatar : staticFile(avatar || 'avatars/default_avatar.jpg');

  return (
    <div style={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center', gap: '35px', fontFamily: 'system-ui, -apple-system, sans-serif' }}>
      
      <div
        style={{
          transform: `scale(${scale})`,
          backgroundColor: '#101010', color: '#F3F5F7',
          padding: '36px', borderRadius: '28px', width: '920px', height: 'fit-content', 
          border: '1px solid #2B2B2B', boxShadow: '0 25px 50px -12px rgba(0,0,0,0.8)', 
          display: 'flex', flexDirection: 'column', // Đổi sang column để chứa được 2 tầng Cha - Con
        }}
      >
        {/* ================= TẦNG 1: BÌNH LUẬN CHA ================= */}
        <div style={{ display: 'flex', flexDirection: 'row', gap: '20px' }}>
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
            <Img src={safeAvatar} style={{ width: '72px', height: '72px', borderRadius: '50%', objectFit: 'cover' }} />
            {/* Nếu có đứa Con, vẽ sợi chỉ xám nối xuống thẳng tắp */}
            {reply && (
              <div style={{ width: '2.5px', flex: 1, minHeight: '50px', backgroundColor: '#333638', marginTop: '12px', borderRadius: '2px' }}></div>
            )}
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', flex: 1, paddingBottom: reply ? '0' : '10px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginTop: '6px' }}>
              <span style={{ fontSize: '32px', fontWeight: '600' }}>{author}</span>
              <span style={{ fontSize: '28px', color: '#777' }}>{timeAgo}</span>
            </div>
            
            <p style={{ fontSize: '38px', lineHeight: 1.45, margin: '12px 0 0 0', whiteSpace: 'pre-wrap', fontWeight: '400' }}>{text}</p>
            
            {attachedImage && (
              <div style={{ marginTop: '20px', width: '100%', borderRadius: '16px', overflow: 'hidden', border: '1px solid #2B2B2B' }}>
                <Img src={staticFile(attachedImage)} style={{ width: '100%', height: 'auto', maxHeight: '500px', display: 'block', objectFit: 'cover' }} />
              </div>
            )}
            
            {/* Chỉ hiện thanh thả tim ở Cha nếu không có đứa Con nào */}
            {!reply && <InteractionBar likes={likes} comments={comments} reposts={reposts} shares={shares} />}
          </div>
        </div>

        {/* ================= TẦNG 2: BÌNH LUẬN CON ================= */}
        {reply && (
          <div style={{ 
            display: 'flex', flexDirection: 'row', gap: '20px', marginTop: '12px',
            opacity: childOpacity, transform: `translateY(${childTranslate}px)`
          }}>
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
              {/* Avatar con nằm lùi vào trong một chút, kích thước nhỏ hơn */}
              <Img src={staticFile(reply.avatar || 'avatars/default_avatar.jpg')} style={{ width: '56px', height: '56px', borderRadius: '50%', objectFit: 'cover' }} />
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', flex: 1 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginTop: '4px' }}>
                <span style={{ fontSize: '28px', fontWeight: '600' }}>{reply.author}</span>
                <span style={{ fontSize: '24px', color: '#777' }}>{reply.timeAgo || 'Vừa xong'}</span>
              </div>
              
              <p style={{ fontSize: '34px', lineHeight: 1.45, margin: '8px 0 0 0', whiteSpace: 'pre-wrap' }}>{reply.text}</p>
              
              {reply.attachedImage && (
                <div style={{ marginTop: '16px', width: '100%', borderRadius: '14px', overflow: 'hidden', border: '1px solid #2B2B2B' }}>
                  <Img src={staticFile(reply.attachedImage)} style={{ width: '100%', height: 'auto', maxHeight: '400px', display: 'block', objectFit: 'cover' }} />
                </div>
              )}
              
              {/* Thanh thả tim nằm dưới cùng của cụm Cha-Con */}
              <InteractionBar likes={reply.likes || "85"} comments="12" reposts="2" shares="4" />
            </div>
          </div>
        )}
      </div>

      {/* KHỐI MEME POP-UP TRÀN ĐẦY LINH HOẠT BÊN DƯỚI CARD */}
      {memeMp4 && (
        <div style={{
          transform: `scale(${memeScale})`, borderRadius: '20px', overflow: 'hidden',
          boxShadow: '0 20px 40px rgba(0,0,0,0.7)', maxWidth: '920px', maxHeight: '600px',
          display: 'flex', justifyContent: 'center', alignItems: 'center', border: '1px solid #333'
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

const InteractionBar = ({ likes, comments, reposts, shares }: any) => (
  <div style={{ display: 'flex', gap: '32px', marginTop: '24px', color: '#F3F5F7', alignItems: 'center', paddingBottom: '4px' }}>
    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
      <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"></path></svg>
      <span style={{ fontSize: '28px' }}>{likes}</span>
    </div>
    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
      <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"></path></svg>
      <span style={{ fontSize: '28px' }}>{comments}</span>
    </div>
    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
      <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><polyline points="17 1 21 5 17 9"></polyline><path d="M3 11V9a4 4 0 0 1 4-4h14"></path><polyline points="7 23 3 19 7 15"></polyline><path d="M21 13v2a4 4 0 0 1-4 4H3"></path></svg>
      <span style={{ fontSize: '28px' }}>{reposts}</span>
    </div>
    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
      <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><line x1="22" y1="2" x2="11" y2="13"></line><polygon points="22 2 15 22 11 13 2 9 22 2"></polygon></svg>
      <span style={{ fontSize: '28px' }}>{shares}</span>
    </div>
  </div>
);