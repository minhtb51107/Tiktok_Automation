import React from 'react';
import { AbsoluteFill, Audio, Series, staticFile, Video } from 'remotion'; // Quay lại với Video
import { ThreadCard } from './ThreadCard';

type ThreadProps = {
  backgroundVideo: string;
  bgm: string;
  post: { 
    author: string; avatar: string; text: string; audioSrc: string; durationInFrames: number; 
    gender?: string; attachedImage?: string; 
    likes?: string; comments?: string; reposts?: string; timeAgo?: string 
  };
  comments: Array<{ 
    author: string; avatar: string; text: string; audioSrc: string; durationInFrames: number; 
    gender?: string; attachedImage?: string; 
    likes?: string; timeAgo?: string 
  }>;
};

export const ThreadsComposition: React.FC<ThreadProps> = ({ backgroundVideo, bgm, post, comments }) => {
  if (!post) return null;

  return (
    <AbsoluteFill style={{ backgroundColor: '#111' }}>
      
      {/* SỬ DỤNG THẺ <Video> TIÊU CHUẨN: 
          Bỏ OffthreadVideo để dập tắt lỗi 'No frame found'. 
          Khung hình đã được FFmpeg ép mượt ở Backend nên dùng thẻ này vẫn sẽ mượt mà không bị giật.
      */}
      <AbsoluteFill>
        <Video 
          src={staticFile(backgroundVideo)} 
          style={{ width: '100%', height: '100%', objectFit: 'cover', position: 'absolute', top: 0, left: 0 }} 
          muted 
          // Không cần 'loop' vì video đã được cắt dài hơn bài viết 3 giây.
        />
      </AbsoluteFill>

      {/* Nhạc nền loop bình thường */}
      {bgm && <Audio src={staticFile(bgm)} volume={0.05} loop />}

      <AbsoluteFill style={{ justifyContent: 'center', alignItems: 'center' }}>
        <Series>
          
          <Series.Sequence durationInFrames={post.durationInFrames}>
            <ThreadCard 
              author={post.author} text={post.text} avatar={post.avatar} 
              attachedImage={post.attachedImage} 
              likes={post.likes} comments={post.comments} reposts={post.reposts} timeAgo={post.timeAgo} 
            />
            {post.audioSrc && <Audio src={staticFile(post.audioSrc)} />}
          </Series.Sequence>

          {comments.map((cmt, idx) => (
            <Series.Sequence key={idx} durationInFrames={cmt.durationInFrames}>
              <ThreadCard 
                author={cmt.author} text={cmt.text} avatar={cmt.avatar} 
                attachedImage={cmt.attachedImage} 
                likes={cmt.likes} timeAgo={cmt.timeAgo} 
              />
              {cmt.audioSrc && <Audio src={staticFile(cmt.audioSrc)} />}
            </Series.Sequence>
          ))}
          
        </Series>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};