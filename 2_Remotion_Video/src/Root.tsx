import { Composition } from 'remotion';
import { MyComposition } from './tiktok/TiktokComposition';
import { ThreadsComposition } from './threads/ThreadsComposition';

export const RemotionRoot: React.FC = () => {
  return (
    <>
      <Composition
        id="TiktokMusic"
        component={MyComposition}
        durationInFrames={150} 
        fps={30}
        width={1080}
        height={1920}
      />
      
      <Composition
        id="ThreadsTopicVideo"
        component={ThreadsComposition}
        fps={60} // Khớp định dạng chuẩn 60fps
        width={1080}
        height={1920}
        calculateMetadata={({ props }) => {
          if (!props.post) return { durationInFrames: 300 };
          
          // CỘNG THÊM 1 GIÂY NGHỈ SAU MỖI CARD (60fps = 1 giây)
          const PADDING_FRAMES = 60; 
          
          let totalFrames = props.post.durationInFrames + PADDING_FRAMES;
          totalFrames += props.comments.reduce((total, cmt) => total + cmt.durationInFrames + PADDING_FRAMES, 0);
          
          return { durationInFrames: totalFrames };
        }}
        defaultProps={{
          backgroundVideo: "backgrounds/minecraft_parkour.mp4",
          bgm: "bgm/lofi.mp3",
          post: { 
            author: "minhtridev", 
            avatar: "avatars/default_avatar.jpg", 
            text: "Đang test giao diện tự động hóa mẫu...", 
            audioSrc: "", 
            durationInFrames: 120,
            gender: "male", likes: "1.2K", comments: "128", reposts: "45", timeAgo: "5 phút"
          },
          comments: []
        }}
      />
    </>
  );
};