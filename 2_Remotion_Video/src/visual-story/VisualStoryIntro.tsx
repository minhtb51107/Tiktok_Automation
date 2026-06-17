import React from 'react';
import { AbsoluteFill, Img, spring, useCurrentFrame, useVideoConfig } from 'remotion';

export const VisualStoryIntro: React.FC<{ author: string, avatar: string, text: string, postInfo: any }> = ({ 
  author, avatar, text, postInfo 
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const headerOpacity = spring({ frame, fps, config: { damping: 20 }, from: 0, to: 1 });
  const cardScale = spring({ frame: frame - 5, fps, config: { damping: 15 }, from: 0.8, to: 1 });
  const cardOpacity = spring({ frame: frame - 5, fps, config: { damping: 20 }, from: 0, to: 1 });
  const boxScale = spring({ frame: frame - 12, fps, config: { damping: 12 }, from: 0.8, to: 1 });
  const boxOpacity = spring({ frame: frame - 12, fps, config: { damping: 20 }, from: 0, to: 1 });

  return (
    <AbsoluteFill style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'space-between', padding: '100px 0 80px 0', fontFamily: 'system-ui, sans-serif' }}>
      
      {/* HEADER: MindRevol Branding */}
      <div style={{ width: '100%', padding: '0 60px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', opacity: headerOpacity, zIndex: 30 }}>
        <div style={{ display: 'flex', flexDirection: 'column', backgroundColor: '#1e1f22', padding: '12px 28px', borderLeft: '6px solid #5865F2', borderRadius: '8px' }}>
          <span style={{ color: '#949ba4', fontSize: '18px', fontWeight: 700, letterSpacing: '2px' }}>NGUỒN BÀI VIẾT</span>
          <span style={{ color: '#ffffff', fontSize: '26px', fontWeight: 900, letterSpacing: '1px' }}>THREADS</span>
        </div>
        <div style={{ backgroundColor: '#5865F2', padding: '16px 32px', borderRadius: '12px', boxShadow: '0 10px 25px rgba(88, 101, 242, 0.4)' }}>
          <span style={{ color: '#ffffff', fontSize: '24px', fontWeight: 900, letterSpacing: '2px' }}>MINDREVOL NETWORK</span>
        </div>
      </div>

      {/* THẺ BẰNG CHỨNG CỦA MINDREVOL */}
      <div style={{ 
        transform: `scale(${cardScale})`, opacity: cardOpacity,
        backgroundColor: '#313338', border: '4px solid #1e1f22', borderRadius: '28px', width: '900px', padding: '40px',
        boxShadow: '0 30px 60px rgba(0,0,0,0.6)', display: 'flex', flexDirection: 'column', gap: '20px', zIndex: 20
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '20px' }}>
          <Img src={avatar} style={{ width: '70px', height: '70px', borderRadius: '50%', objectFit: 'cover' }} />
          <div>
            <div style={{ fontSize: '30px', fontWeight: '800', color: '#fff' }}>{author}</div>
            <div style={{ fontSize: '22px', color: '#949ba4' }}>{postInfo?.timeAgo || '2 giờ trước'}</div>
          </div>
        </div>
        <p style={{ fontSize: '36px', lineHeight: 1.5, color: '#dbdee1', fontWeight: '600', margin: 0 }}>{text}</p>
      </div>

      {/* KHUNG CÂU HỎI (HOOK) - MÀU INDIGO TO PURPLE CỦA APP MINDREVOL */}
      <div style={{
        transform: `scale(${boxScale})`, opacity: boxOpacity,
        width: '940px', height: '480px', backgroundColor: '#1e1f22',
        border: '4px solid #2b2d31', borderRadius: '32px', padding: '16px',
        boxShadow: '0 40px 70px rgba(0,0,0,0.8)', zIndex: 20
      }}>
        <div style={{
          width: '100%', height: '100%', borderRadius: '20px',
          background: 'linear-gradient(135deg, #5865F2 0%, #a855f7 100%)', // Chuyển từ Cam -> Tím Indigo
          display: 'flex', justifyContent: 'center', alignItems: 'center', padding: '40px'
        }}>
          <h1 style={{
            color: '#FFFFFF', fontSize: '64px', fontWeight: 900, textAlign: 'center',
            lineHeight: 1.3, margin: 0, textTransform: 'uppercase', letterSpacing: '2px',
            textShadow: '0 10px 20px rgba(0,0,0,0.3)'
          }}>
            CHÚNG TA CÓ ĐANG<br/>ĐÁNH ĐỔI SỨC KHỎE<br/>ĐỂ LẤY TIỀN LƯƠNG KHÔNG?
          </h1>
        </div>
      </div>

    </AbsoluteFill>
  );
};
