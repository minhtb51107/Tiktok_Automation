// src/Root.tsx
import React from 'react';
import { Composition } from 'remotion';
import { MyComposition } from './Composition';

import './index.css'; 

export const RemotionRoot: React.FC = () => {
  // Tổng thời lượng 58 giây x 30 frames/giây
  const totalDuration = 30 * 30; 

  return (
    <>
      <Composition
        id="ProLyricVideo"
        component={MyComposition}
        durationInFrames={totalDuration}
        fps={30}
        width={1080}   // <-- Chuyển thành 1080
        height={1080}  // <-- Chuyển thành 1080 để tạo hình vuông
      />
    </>
  );
};