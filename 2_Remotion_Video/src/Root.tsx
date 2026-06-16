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
          let totalFrames = props.post.durationInFrames + PADDING_FRAMES;
          // 🔥 Sửa lỗi type cho total và cmt
          totalFrames += props.comments.reduce((total: number, cmt: any) => total + cmt.durationInFrames + PADDING_FRAMES, 0);
          return { durationInFrames: totalFrames };
        }}
        defaultProps={{
          backgroundVideo: "backgrounds/minecraft_parkour.mp4",
          bgm: "bgm/sneaky.mp3",
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
          // 🔥 Sửa lỗi type cho total và chunk
          let totalFrames = props.chunks.reduce((total: number, chunk: any) => total + chunk.durationInFrames, 0);
          totalFrames += 180 + 300; // Cộng Intro (3s) và Outro (5s)
          return { durationInFrames: totalFrames };
        }}
        defaultProps={{
          // 🔥 Đã xóa tiktok_caption thừa
          bgm: "bgm/sneaky.mp3",
          postInfo: { author: "Góc Chữa Lành", avatar: "avatars/default_avatar.jpg", text: "Test nội dung..." },
          chunks: [
            // Cập nhật lại format dummy cho khớp với giao diện Visual Story mới
            { text: "Bạn sẽ cảm thấy vô cùng chênh vênh...", caption: "CHÊNH VÊNH", cardToShow: "post", gifImg: "", audioSrc: "", durationInFrames: 180 }
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