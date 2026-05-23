// src/data/script.ts

const sec = (seconds: number) => Math.round(seconds * 30);

export interface WordData {
  text: string;
  start: number; 
  // Bổ sung hiệu ứng 'neon-rainbow' vào kiểu dữ liệu
  effect?: 'shake' | 'glitch' | 'glow-gold' | 'throw-away' | 'flash-climax' | 'neon-rainbow'; 
}

export interface LyricData {
  start: number;     
  duration: number;  
  words: WordData[]; 
  vietnamese: string;
}

export const LYRIC_SCRIPT: LyricData[] = [
  // ĐOẠN 1: ÁP LỰC, ĐỜI THƯỜNG
  {
    start: sec(4.48),
    duration: sec(2.7),
    words: [
      { text: "I", start: sec(4.48) },
      { text: "got", start: sec(5.08) },
      { text: "a", start: sec(5.68) },
      { text: "lot", start: sec(5.92) },
      { text: "on", start: sec(6.2) },
      { text: "my", start: sec(6.34) },
      { text: "mind", start: sec(6.62), effect: 'shake' }
    ],
    vietnamese: "Anh có rất nhiều suy nghĩ trong đầu"
  },
  {
    start: sec(7.32),
    duration: sec(1.44),
    words: [
      { text: "Got", start: sec(7.32) },
      { text: "some", start: sec(7.5) },
      { text: "more", start: sec(7.78) },
      { text: "on", start: sec(8.1) },
      { text: "my", start: sec(8.28) },
      { text: "plate", start: sec(8.46), effect: 'glitch' }
    ],
    vietnamese: "Và còn nhiều bộn bề lo toan"
  },
  // ĐOẠN 2: ĐIỂM ĐỔI MOOD (ĐƯỢC CỨU RỖI)
  {
    start: sec(8.76),
    duration: sec(2.1),
    words: [
      { text: "My", start: sec(8.76) },
      { text: "baby", start: sec(9.12), effect: 'glow-gold' },
      { text: "got", start: sec(9.54) },
      { text: "me", start: sec(9.84) },
      { text: "looking", start: sec(10.06) },
      { text: "forward", start: sec(10.44) }
    ],
    vietnamese: "Người yêu ơi, em khiến anh chỉ mong chờ"
  },
  {
    start: sec(10.86),
    duration: sec(1.66),
    words: [
      { text: "to", start: sec(10.86) },
      { text: "the", start: sec(11.24) },
      { text: "end", start: sec(11.52) },
      { text: "of", start: sec(11.78) },
      { text: "the", start: sec(12.0) },
      { text: "day", start: sec(12.16), effect: 'glow-gold' }
    ],
    vietnamese: "đến khoảnh khắc cuối ngày"
  },
  // ĐOẠN 3: LỜI RỦ RÊ TRỐN KHỎI QUÁ KHỨ
  {
    start: sec(12.52),
    duration: sec(1.4),
    words: [
      { text: "What", start: sec(12.52) },
      { text: "you", start: sec(12.88) },
      { text: "say?", start: sec(13.08) }
    ],
    vietnamese: "Em nói gì cơ?"
  },
  // CÂU 4.2: ĐÃ THAY ĐỔI SANG NEON RAINBOW TẠI ĐÂY
  {
    start: sec(13.92),
    duration: sec(1.78),
    words: [
      { text: "You", start: sec(13.92), effect: 'neon-rainbow' },
      { text: "and", start: sec(14.78), effect: 'neon-rainbow' },
      { text: "me", start: sec(14.98), effect: 'neon-rainbow' }
    ],
    vietnamese: "Chỉ có anh và em"
  },
  {
    start: sec(15.7),
    duration: sec(2.72),
    words: [
      { text: "just", start: sec(15.7) },
      { text: "forget", start: sec(16.64) },
      { text: "about", start: sec(17.1) },
      { text: "the", start: sec(17.8) },
      { text: "past", start: sec(18.04), effect: 'glitch' }
    ],
    vietnamese: "Hãy quên đi quá khứ"
  },
  {
    start: sec(18.78),
    duration: sec(1.4),
    words: [
      { text: "Throw", start: sec(18.78) },
      { text: "it", start: sec(19.08) },
      { text: "in", start: sec(19.48) },
      { text: "the", start: sec(19.72) },
      { text: "trash", start: sec(19.88), effect: 'throw-away' }
    ],
    vietnamese: "Vứt bỏ hết tất cả đi"
  },
  {
    start: sec(20.24),
    duration: sec(0.92),
    words: [
      { text: "what", start: sec(20.24) },
      { text: "you", start: sec(20.32) },
      { text: "say?", start: sec(20.5) }
    ],
    vietnamese: "Em nói gì cơ?"
  },
  // CÂU 7.2: ĐÃ THAY ĐỔI SANG NEON RAINBOW TẠI ĐÂY
  {
    start: sec(21.16),
    duration: sec(2.46),
    words: [
      { text: "you", start: sec(21.16), effect: 'neon-rainbow' },
      { text: "and", start: sec(22.2), effect: 'neon-rainbow' },
      { text: "me", start: sec(22.42), effect: 'neon-rainbow' }
    ],
    vietnamese: "Chỉ có đôi ta"
  },
  // ĐOẠN CUỐI: TỰ DO VÀ CLIMAX
  {
    start: sec(23.62),
    duration: sec(2.06),
    words: [
      { text: "Live", start: sec(23.62) },
      { text: "the", start: sec(24.08) },
      { text: "life", start: sec(24.3), effect: 'glow-gold' },
      { text: "we", start: sec(24.76) },
      { text: "never", start: sec(25.02) },
      { text: "had", start: sec(25.38) }
    ],
    vietnamese: "Sống một cuộc đời chưa từng trải qua"
  },
  {
    start: sec(25.68),
    duration: sec(2.06),
    words: [
      { text: "like", start: sec(25.68) },
      { text: "we're", start: sec(25.96) },
      { text: "never", start: sec(26.18) },
      { text: "going", start: sec(26.58) },
      { text: "back", start: sec(27.18), effect: 'flash-climax' }
    ],
    vietnamese: "Và chẳng bao giờ muốn quay đầu lại"
  }
];