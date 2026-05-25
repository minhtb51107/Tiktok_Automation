import React from 'react';
import { Composition } from 'remotion';
import { MyComposition } from './Composition';
import { LYRIC_SCRIPT } from './data/script';
import './index.css'; 

export const RemotionRoot: React.FC = () => {
  // Lấy câu hát cuối cùng
  const lastLyric = LYRIC_SCRIPT.length > 0 ? LYRIC_SCRIPT[LYRIC_SCRIPT.length - 1] : null;
  
  // THUẬT TOÁN BẮT LỖI AI CHO ROOT
  const getTrueStartFrame = (start: number) => {
    // Nếu start nhỏ hơn 1000, chắc chắn nó đang là Giây (vì 1000 giây = 16 phút, hiếm có video nào dài vậy)
    return start < 1000 ? Math.round(start * 30) : Math.round(start);
  };

  const getTrueDurationFrame = (duration: number) => {
    return duration < 20 ? Math.round(duration * 30) : Math.round(duration);
  };

  // Tính chính xác số Frame của toàn bộ Video
  const totalDurationFrames = lastLyric 
    ? getTrueStartFrame(lastLyric.start) + getTrueDurationFrame(lastLyric.duration) + 60 
    : 900;

  return (
    <Composition
      id="ProLyricVideo"
      component={MyComposition}
      durationInFrames={totalDurationFrames}
      fps={30}
      width={1080}
      height={1080}
    />
  );
};