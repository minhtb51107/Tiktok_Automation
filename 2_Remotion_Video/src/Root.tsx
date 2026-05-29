import React from 'react';
import { Composition, getInputProps } from 'remotion';

// Import cả 2 giao diện
import { MyComposition as TiktokComposition } from './tiktok/TiktokComposition'; // Tên hàm trong file cũ của bạn là MyComposition
import { ThreadsComposition } from './threads/ThreadsComposition';
import { LYRIC_SCRIPT } from './data/script';
import './index.css'; 

export const RemotionRoot: React.FC = () => {
  const inputProps = getInputProps();

  // ==========================================
  // TÍNH TOÁN THỜI GIAN CHO TIKTOK
  // ==========================================
  const lastLyric = LYRIC_SCRIPT.length > 0 ? LYRIC_SCRIPT[LYRIC_SCRIPT.length - 1] : null;
  const getTrueStartFrame = (start: number) => start < 1000 ? Math.round(start * 30) : Math.round(start);
  const getTrueDurationFrame = (duration: number) => duration < 20 ? Math.round(duration * 30) : Math.round(duration);

  const tiktokTotalDuration = lastLyric 
    ? getTrueStartFrame(lastLyric.start) + getTrueDurationFrame(lastLyric.duration) + 60 
    : 900;

  // ==========================================
  // ĐÓNG GÓI PROPS TỪ BACKEND TRUYỀN SANG
  // ==========================================
  const tiktokProps = {
    imageList: (inputProps.imageList as string[]) || [],
    songTitle: (inputProps.songTitle as string) || "THIS IS WHAT FALLING IN LOVE FEELS LIKE",
    artist: (inputProps.artist as string) || "JVKE"
  };

  const threadsProps = {
    topicText: (inputProps.topicText as string) || "Nội dung Threads mặc định nếu chưa có text",
    author: (inputProps.author as string) || "@tiktok_automation"
  };

  return (
    <>
      {/* 1. MẪU VIDEO DÀNH CHO TIKTOK LYRICS */}
      <Composition
        id="ProLyricVideo"
        component={TiktokComposition}
        durationInFrames={tiktokTotalDuration}
        fps={30}
        width={1080}
        height={1080} // Gốc của bạn đang là video vuông 1080x1080
        defaultProps={tiktokProps}
      />

      {/* 2. MẪU VIDEO DÀNH CHO THREADS TOPIC */}
      <Composition
        id="ThreadsTopicVideo"
        component={ThreadsComposition}
        durationInFrames={300} // Đặt mặc định độ dài video Threads là 10 giây (300 frames)
        fps={30}
        width={1080}
        height={1920} // Video Threads/Tiktok thường dùng khổ dọc 9:16
        defaultProps={threadsProps}
      />
    </>
  );
};