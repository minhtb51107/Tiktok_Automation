import React from 'react';
import { AbsoluteFill, useCurrentFrame, useVideoConfig, spring, interpolate } from 'remotion';

export interface ThreadsProps {
  topicText?: string;
  author?: string;
}

export const ThreadsComposition: React.FC<ThreadsProps> = ({ 
  topicText = "Hôm nay bầu trời thật đẹp, giống như lúc chúng ta mới quen nhau...", 
  author = "@minhtb51107" 
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  // Hiệu ứng nảy (pop-up) mượt mà lúc video bắt đầu
  const scale = spring({ frame, fps, config: { damping: 12 } });
  const opacity = interpolate(frame, [0, 15], [0, 1]);

  return (
    <AbsoluteFill className="bg-slate-900 flex items-center justify-center p-10 font-sans">
      
      {/* Khung bài viết giống giao diện Threads / X */}
      <div 
        className="bg-white rounded-[2rem] p-10 w-full max-w-3xl shadow-2xl flex flex-col"
        style={{ transform: `scale(${scale})`, opacity }}
      >
        <div className="flex items-center gap-4 mb-6">
          <div className="w-16 h-16 bg-gradient-to-tr from-pink-500 to-orange-400 rounded-full"></div>
          <div className="font-bold text-3xl text-black tracking-tight">{author}</div>
        </div>
        
        <div className="text-4xl text-gray-800 leading-relaxed font-medium">
          {topicText}
        </div>
        
        <div className="mt-8 text-gray-400 text-xl font-light">
          Remotion x NestJS Auto System
        </div>
      </div>

    </AbsoluteFill>
  );
};