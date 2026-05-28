import React from 'react';
import { Composition, getInputProps } from 'remotion';
import { MyComposition } from './Composition';
import { LYRIC_SCRIPT } from './data/script';
import './index.css'; 

export const RemotionRoot: React.FC = () => {
  const lastLyric = LYRIC_SCRIPT.length > 0 ? LYRIC_SCRIPT[LYRIC_SCRIPT.length - 1] : null;
  
  const getTrueStartFrame = (start: number) => {
    return start < 1000 ? Math.round(start * 30) : Math.round(start);
  };

  const getTrueDurationFrame = (duration: number) => {
    return duration < 20 ? Math.round(duration * 30) : Math.round(duration);
  };

  const totalDurationFrames = lastLyric 
    ? getTrueStartFrame(lastLyric.start) + getTrueDurationFrame(lastLyric.duration) + 60 
    : 900;

  const inputProps = getInputProps();
  const finalImageFiles = (inputProps.imageList as string[]) || [];
  
  // Đọc tên bài hát và tác giả từ CLI props, nếu không có thì lấy giá trị mặc định mẫu
  const songTitle = (inputProps.songTitle as string) || "THIS IS WHAT FALLING IN LOVE FEELS LIKE";
  const artist = (inputProps.artist as string) || "JVKE";

  return (
    <Composition
      id="ProLyricVideo"
      component={MyComposition}
      durationInFrames={totalDurationFrames}
      fps={30}
      width={1080}
      height={1080}
      defaultProps={{
        imageList: finalImageFiles,
        songTitle: songTitle,
        artist: artist
      }}
    />
  );
};