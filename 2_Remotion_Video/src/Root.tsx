import { Composition } from 'remotion';
import { MyComposition } from './tiktok/TiktokComposition'; // File nhạc cũ của bạn
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
        fps={60} // ĐÃ NÂNG LÊN 60 FPS: Khớp định dạng chuẩn với background, video xuất ra siêu mượt
        width={1080}
        height={1920}
        calculateMetadata={({ props }) => {
          if (!props.post) return { durationInFrames: 300 };
          const totalFrames = props.post.durationInFrames + props.comments.reduce((total, cmt) => total + cmt.durationInFrames, 0);
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
            durationInFrames: 120, // 2 giây hiển thị mặc định ở cấu hình 60fps
            gender: "male", likes: "1.2K", comments: "128", reposts: "45", timeAgo: "5 phút"
          },
          comments: []
        }}
      />
    </>
  );
};