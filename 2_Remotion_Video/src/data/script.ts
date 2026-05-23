const sec = (seconds: number) => Math.round(seconds * 30);

export interface WordData {
  text: string;
  start: number;
  effect?: 'shake' | 'glitch' | 'glow-gold' | 'throw-away' | 'flash-climax' | 'neon-rainbow';
}

export interface LyricData {
  start: number;
  duration: number;
  words: WordData[];
  vietnamese: string;
}

export const LYRIC_SCRIPT: LyricData[] = [
  {
    start: sec(4.48),
    duration: sec(8.76 - 4.48),
    words: [
      {text:"I",start:4.480000000000002},
      {text:"got",start:5.080000000000001},
      {text:"a",start:5.68},
      {text:"lot",start:5.92, effect: 'shake'},
      {text:"of",start:6.2},
      {text:"my",start:6.34},
      {text:"mind,",start:6.62, effect: 'glitch'},
      {text:"got",start:7.32},
      {text:"some",start:7.5},
      {text:"more",start:7.78, effect: 'glow-gold'},
      {text:"of",start:8.1},
      {text:"my",start:8.28},
      {text:"plate",start:8.46, effect: 'throw-away'}
    ],
    vietnamese: "Đầu óc bộn bề, trăm công nghìn việc đang chờ"
  },
  {
    start: sec(8.76),
    duration: sec(12.52 - 8.76),
    words: [
      {text:"My",start:8.76},
      {text:"baby",start:9.12, effect: 'flash-climax'},
      {text:"got",start:9.54},
      {text:"me",start:9.84},
      {text:"looking",start:10.06},
      {text:"forward",start:10.44, effect: 'neon-rainbow'},
      {text:"to",start:10.86},
      {text:"the",start:11.24},
      {text:"end",start:11.52, effect: 'shake'},
      {text:"of",start:11.78},
      {text:"the",start:12},
      {text:"day",start:12.16, effect: 'glitch'}
    ],
    vietnamese: "Anh/Em yêu khiến em mong chờ từng giây phút cuối ngày"
  },
  {
    start: sec(12.52),
    duration: sec(18.42 - 12.52),
    words: [
      {text:"What",start:12.52},
      {text:"you",start:12.88},
      {text:"say,",start:13.08},
      {text:"you",start:13.92},
      {text:"and",start:14.78},
      {text:"me,",start:14.98},
      {text:"just",start:15.7},
      {text:"forget",start:16.64, effect: 'glow-gold'},
      {text:"about",start:17.1},
      {text:"the",start:17.8},
      {text:"past",start:18.04, effect: 'throw-away'}
    ],
    vietnamese: "Sao anh/em không nói gì? Em và anh/em mình cùng quên hết đi quá khứ nhé"
  },
  {
    start: sec(19),
    duration: sec(23.62 - 19),
    words: [
      {text:"Throw",start:18.779999999999998, effect: 'flash-climax'},
      {text:"it",start:19.08},
      {text:"in",start:19.48},
      {text:"the",start:19.72},
      {text:"trash,",start:19.88, effect: 'neon-rainbow'},
      {text:"what",start:20.24},
      {text:"you",start:20.32},
      {text:"say,",start:20.5},
      {text:"you",start:21.16},
      {text:"and",start:22.2},
      {text:"me",start:22.42}
    ],
    vietnamese: "Quẳng hết vào sọt rác! Anh/em nghĩ sao, em và anh/em?"
  },
  {
    start: sec(23.62),
    duration: sec(27.74 - 23.62),
    words: [
      {text:"Let",start:23.62},
      {text:"the",start:24.08},
      {text:"life",start:24.3},
      {text:"we",start:24.76},
      {text:"never",start:25.02, effect: 'shake'},
      {text:"had,",start:25.38, effect: 'glitch'},
      {text:"like",start:25.68},
      {text:"I",start:25.96},
      {text:"never",start:26.18, effect: 'glow-gold'},
      {text:"thought",start:26.58},
      {text:"we'd",start:27.18},
      {text:"love",start:27.54, effect: 'throw-away'}
    ],
    vietnamese: "Cho cuộc đời ta những gì chưa từng có, như thể em chưa bao giờ nghĩ mình sẽ yêu anh/em vậy"
  }
];