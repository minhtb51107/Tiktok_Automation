import React from 'react';
import { AbsoluteFill, Audio, Series, staticFile, Video } from 'remotion'; 
import { ThreadCard } from './ThreadCard';

type ThreadProps = {
  backgroundVideo: string;
  bgm: string;
  post: { 
    author: string; avatar: string; text: string; audioSrc: string; durationInFrames: number; 
    gender?: string; attachedImage?: string; sfx?: string; memeMp4?: string;
    likes?: string; comments?: string; reposts?: string; timeAgo?: string 
  };
  comments: Array<{ 
    author: string; avatar: string; text: string; audioSrc: string; durationInFrames: number; 
    gender?: string; attachedImage?: string; sfx?: string; memeMp4?: string;
    likes?: string; timeAgo?: string 
  }>;
};

export const ThreadsComposition: React.FC<ThreadProps> = ({ backgroundVideo, bgm, post, comments }) => {
  if (!post) return null;

  // Thời gian Card nán lại trên màn hình sau khi đọc xong (60 frames = 1 giây)
  const PADDING_FRAMES = 60;

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
          
          <Series.Sequence durationInFrames={post.durationInFrames + PADDING_FRAMES}>
            <ThreadCard 
              author={post.author} text={post.text} avatar={post.avatar} 
              attachedImage={post.attachedImage} memeMp4={post.memeMp4}
              likes={post.likes} comments={post.comments} reposts={post.reposts} timeAgo={post.timeAgo} 
            />
            {post.audioSrc && <Audio src={staticFile(post.audioSrc)} />}
            {post.sfx && <Audio src={staticFile(`sfx/${post.sfx}`)} volume={0.2} />}
          </Series.Sequence>

          {comments.map((cmt, idx) => (
            <Series.Sequence key={idx} durationInFrames={cmt.durationInFrames + PADDING_FRAMES}>
              <ThreadCard 
                author={cmt.author} text={cmt.text} avatar={cmt.avatar} 
                attachedImage={cmt.attachedImage} memeMp4={cmt.memeMp4}
                likes={cmt.likes} timeAgo={cmt.timeAgo} 
              />
              {cmt.audioSrc && <Audio src={staticFile(cmt.audioSrc)} />}
              {cmt.sfx && <Audio src={staticFile(`sfx/${cmt.sfx}`)} volume={0.2} />}
            </Series.Sequence>
          ))}
          
        </Series>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};