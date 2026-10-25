import { Composition } from 'remotion';
import { MyComposition } from './tiktok/TiktokComposition';
import { ThreadsComposition } from './threads/ThreadsComposition';
import { SeriousComposition } from './serious/SeriousComposition'; // BẮT BUỘC IMPORT
import { VisualStoryComposition } from './visual-story/VisualStoryComposition';
import { DUMMY_STORY_DATA } from './visual-story/dummyData';

export const RemotionRoot: React.FC = () => {
  return (
    <>
      <Composition
        id="TiktokMusic"
        component={MyComposition}
        durationInFrames={150} 
        fps={30} width={1080} height={1920}
      />
      
      <Composition
        id="ThreadsTopicVideo"
        component={ThreadsComposition}
        fps={60} width={1080} height={1920}
        calculateMetadata={({ props }) => {
          if (!props.post) return { durationInFrames: 300 };
          const PADDING_FRAMES = 60; 
          const INTRO_DURATION = 180; // Cộng thêm 180 frame của trạm Intro vào tổng thời lượng
          
          let totalFrames = INTRO_DURATION + props.post.durationInFrames + PADDING_FRAMES;
          totalFrames += props.comments.reduce((total: number, cmt: any) => total + cmt.durationInFrames + PADDING_FRAMES, 0);
          return { durationInFrames: totalFrames };
        }}
        defaultProps={{
          backgroundVideo: "backgrounds/minecraft_parkour.mp4",
          bgm: "bgm/sneaky.mp3",
          theme: "compilation", // "compilation" hoặc "drama"
          hookText: "TIÊU ĐỀ THU HÚT THẢO LUẬN",
          post: { author: "minhtridev", avatar: "avatars/default_avatar.jpg", text: "Đang test...", audioSrc: "", durationInFrames: 120 },
          comments: []
        }}
      />

      {/* 🔥 ĐĂNG KÝ XƯỞNG SERIOUS VÀO ĐÂY */}
<Composition
         id="SeriousAdviceVideo"
         component={SeriousComposition}
         fps={60} width={1080} height={1920}
         calculateMetadata={({ props }) => {
           if (!props.chunks) return { durationInFrames: 600 };
           let totalFrames = props.chunks.reduce((total: number, chunk: any) => total + chunk.durationInFrames, 0);
           return { durationInFrames: totalFrames };
         }}
         defaultProps={{
           backgroundVideo: "backgrounds/minecraft_parkour.mp4", // Loop mặc định
           bgm: "bgm/lofi.mp3", // Đổi sang lofi cho đúng chất sếp cần
           postInfo: { author: "Gốc Chính", avatar: "avatars/default_avatar.jpg", text: "Nội dung test..." },
           chunks: [
             { text: "Bấm nút thử nghiệm luồng...", cardToShow: "post", audioSrc: "", durationInFrames: 180, commentInfo: { author: "Gốc Chính", avatar: "avatars/default_avatar.jpg", text: "Nội dung test..." } }
           ]
         }}
       />

      <Composition
        id="VisualStoryNewsReel"
        component={VisualStoryComposition}
        durationInFrames={530} 
        fps={60}
        width={1080}
        height={1920}
        defaultProps={{ data: DUMMY_STORY_DATA }}
      />
    </>
  );
};