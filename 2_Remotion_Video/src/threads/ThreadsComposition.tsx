import React from 'react';
import { AbsoluteFill, Audio, Series, Sequence, staticFile, Video } from 'remotion'; 
import { ThreadCard } from './ThreadCard';
import { ThreadsIntro } from './ThreadsIntro';

type ThreadProps = {
  backgroundVideo: string;
  bgm: string;
  theme?: 'compilation' | 'drama'; // Luồng nội dung
  hookText?: string;               // Tiêu đề động do AI tạo ra
  post: { 
    author: string; avatar: string; text: string; audioSrc: string; durationInFrames: number; 
    gender?: string; attachedImage?: string; sfx?: string; memeMp4?: string;
    likes?: string; comments?: string; reposts?: string; shares?: string; timeAgo?: string 
  };
  comments: Array<{ 
    author: string; avatar: string; text: string; audioSrc: string; durationInFrames: number; 
    parentAudioDuration?: number; 
    gender?: string; attachedImage?: string; sfx?: string; memeMp4?: string;
    likes?: string; comments?: string; reposts?: string; shares?: string; timeAgo?: string;
    reply?: any; 
  }>;
};

export const ThreadsComposition: React.FC<ThreadProps> = ({ 
  backgroundVideo, 
  bgm, 
  post, 
  comments,
  theme = 'compilation',
  hookText = 'BẠN NGHĨ SAO VỀ ĐIỀU NÀY?'
}) => {
  if (!post) return null;

  // Thời gian Card nán lại trên màn hình sau khi đọc xong (60 frames = 1 giây)
  const PADDING_FRAMES = 60;
  const INTRO_DURATION = 180; // Thời lượng phần Intro (3 giây ở mức 60fps)

  return (
    <AbsoluteFill style={{ backgroundColor: '#111' }}>
      
      {/* Video nền */}
      <AbsoluteFill>
        <Video 
          src={staticFile(backgroundVideo)} 
          style={{ width: '100%', height: '100%', objectFit: 'cover', position: 'absolute', top: 0, left: 0 }} 
          muted 
        />
      </AbsoluteFill>

      {bgm && <Audio src={staticFile(bgm)} volume={0.05} loop />}

      <AbsoluteFill style={{ justifyContent: 'center', alignItems: 'center' }}>
        <Series>
          
          {/* TRẠM 0: INTRO ĐẦU VIDEO (3 GIÂY) */}
          <Series.Sequence durationInFrames={INTRO_DURATION}>
            <ThreadsIntro 
              author={post.author}
              avatar={post.avatar.startsWith('http') ? post.avatar : staticFile(post.avatar)}
              text={post.text}
              timeAgo={post.timeAgo}
              hookText={hookText}
              theme={theme}
            />
          </Series.Sequence>
          
          {/* TRẠM 1: BÀI VIẾT GỐC */}
          <Series.Sequence durationInFrames={post.durationInFrames + PADDING_FRAMES}>
            <ThreadCard {...post} />
            {post.audioSrc && <Audio src={staticFile(post.audioSrc)} />}
            {post.sfx && <Audio src={staticFile(`sfx/${post.sfx}`)} volume={0.2} />}
          </Series.Sequence>

          {/* TRẠM 2: DANH SÁCH BÌNH LUẬN (CÓ THỂ CÓ CON) */}
          {comments.map((cmt, idx) => (
            <Series.Sequence key={idx} durationInFrames={cmt.durationInFrames + PADDING_FRAMES}>
              
              {/* Card hiển thị UI đã bao bọc cả Cha lẫn Con bên trong */}
              <ThreadCard {...cmt} />
              
              {/* Âm thanh Cha */}
              {cmt.audioSrc && <Audio src={staticFile(cmt.audioSrc)} />}
              {cmt.sfx && <Audio src={staticFile(`sfx/${cmt.sfx}`)} volume={0.2} />}

              {/* Âm thanh Con (Dùng thẻ Sequence để Delay, chờ Cha đọc xong + nghỉ 15 frames) */}
              {cmt.reply && cmt.reply.audioSrc && (
                <Sequence from={(cmt.parentAudioDuration || 0) + 15}>
                  <Audio src={staticFile(cmt.reply.audioSrc)} />
                </Sequence>
              )}

            </Series.Sequence>
          ))}
          
        </Series>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};