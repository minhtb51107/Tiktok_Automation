import React from 'react';
import { AbsoluteFill, Series, Audio, Sequence, staticFile, Video } from 'remotion';
import { BigCaption } from './BigCaption';
import { ThreadsCard } from './ThreadsCard';

interface SeriousProps extends Record<string, unknown> {
  chunks: any[];
  bgm: string;
  postInfo: any;
  backgroundVideo?: string;
}

export const SeriousComposition: React.FC<SeriousProps> = ({
  chunks,
  bgm,
  postInfo,
  backgroundVideo = "backgrounds/source_1.mp4"
}) => {

  let cleanVideoPath = backgroundVideo || "backgrounds/source_1.mp4";
  cleanVideoPath = cleanVideoPath.replace(/^(public\/|\/public\/)/, '').trim();

  // =========================================================================
  // 🎯 THUẬT TOÁN: GỘP CÁC CHUNK PHẲNG THÀNH "CẢNH" TRỰC QUAN (VISUAL SCENES)
  // =========================================================================
  const visualScenes: any[] = [];
  let currentScene: any = null;
  let totalElapsedFrames = 0;

  chunks.forEach((chunk, index) => {
    const duration = Math.max(chunk.durationInFrames, 30);

    // Định danh Cảnh độc nhất: 'post' hoặc 'comment-tên_tác_giả'
    const sceneKey = chunk.cardToShow === 'comment'
      ? `comment-${chunk.commentInfo?.author}`
      : `post`;

    // Nếu là cảnh mới hoặc đổi người nói, tạo một Block Cảnh mới
    if (!currentScene || currentScene.sceneKey !== sceneKey) {
      currentScene = {
        sceneKey,
        cardToShow: chunk.cardToShow,
        startFrame: totalElapsedFrames,
        durationInFrames: 0,
        // Lấy thông tin hiển thị chuẩn (Ưu tiên lấy bài gốc fullText cho bài Post)
        author: chunk.cardToShow === 'post' ? postInfo.author : chunk.commentInfo?.author,
        avatar: chunk.cardToShow === 'post' ? postInfo.avatar : chunk.commentInfo?.avatar,
        timeAgo: chunk.cardToShow === 'post' ? (postInfo.timeAgo || '2 giờ') : (chunk.commentInfo?.timeAgo || '15 phút'),
        likes: chunk.cardToShow === 'post' ? '12.5K' : (chunk.commentInfo?.likes || '2.4K'),
        replies: chunk.cardToShow === 'post' ? '430' : (chunk.commentInfo?.comments || '85'),
        // TEXT HIỂN THỊ: Nếu là Post thì lấy FULL bài viết gốc (sửa lỗi băm chữ!)
        // Nếu là Comment thì cộng dồn toàn bộ các câu của tác giả đó lại thành 1 đoạn văn dài!
        text: chunk.cardToShow === 'post' ? postInfo.text : (chunk.commentInfo?.text || '')
      };
      visualScenes.push(currentScene);
    } else {
      // Nếu cùng một người đang nói tiếp các câu sau, ta nối chữ lại (Dành cho Comment dài)
      if (chunk.cardToShow === 'comment' && chunk.commentInfo?.text) {
        currentScene.text += " " + chunk.commentInfo.text;
      }
    }

    // Cộng dồn thời gian gộp cảnh
    currentScene.durationInFrames += duration;
    totalElapsedFrames += duration;
  });

  return (
    <AbsoluteFill style={{ backgroundColor: '#000000' }}>

      {/* LAYER 0: Video nền Satisfying */}
      <AbsoluteFill>
        <Video src={staticFile(cleanVideoPath)} style={{ width: '100%', height: '100%', objectFit: 'cover' }} muted loop />
      </AbsoluteFill>

      {/* LAYER 1: Nhạc nền BGM */}
      {bgm && (
        <Audio src={bgm.startsWith('http') ? bgm : staticFile(bgm.replace(/^(public\/|\/public\/)/, ''))} volume={0.12} loop />
      )}

      {/* =========================================================================
          LAYER 2: HIỂN THỊ CARD THREADS TĨNH (CHẠY SONG SONG - KHÔNG BỊ UNMOUNT)
          ========================================================================= */}
      {visualScenes.map((scene, i) => (
        <Sequence key={`scene-${i}`} from={scene.startFrame} durationInFrames={scene.durationInFrames}>
          <div style={{ position: 'absolute', top: '38%', left: '50%', transform: 'translateX(-50%)', zIndex: 20 }}>
            <ThreadsCard
              author={scene.author}
              avatar={scene.avatar}
              text={scene.text} // Chữ dài trọn vẹn đứng im re gánh tạ!
              timeAgo={scene.timeAgo}
              likes={scene.likes}
              replies={scene.replies}
            />
          </div>
        </Sequence>
      ))}

      {/* =========================================================================
          LAYER 3: LUỒNG ÂM THANH AI VÀ CHỮ SUB DẬP DỒN (CHẠY NỐI TIẾP THEO CHUNK)
          ========================================================================= */}
      <Series>
        {chunks.map((chunk: any, index: number) => (
          <Series.Sequence key={`audio-${index}`} durationInFrames={Math.max(chunk.durationInFrames, 30)}>
            <AbsoluteFill style={{ justifyContent: 'center', alignItems: 'center' }}>

              {/* Âm thanh AI Kokoro đọc từng câu nối đuôi nhau liên tục */}
              {chunk.audioSrc && (
                <Audio src={staticFile(chunk.audioSrc.replace(/^(public\/|\/public\/)/, ''))} />
              )}

              {/* Chữ Sub bự dập dồn (Caption) thay đổi liên tục theo giọng đọc */}
              {chunk.caption && (
                <div style={{ zIndex: 10, position: 'absolute', inset: 0 }}>
                  <BigCaption text={chunk.caption} />
                </div>
              )}

            </AbsoluteFill>
          </Series.Sequence>
        ))}
      </Series>

    </AbsoluteFill>
  );
};
