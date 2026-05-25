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
    "start": 4.52,
    "duration": 4.24,
    "vietnamese": "Tôi có nhiều thứ trong đầu, lại thêm việc phải lo.",
    "words": [
      {
        "text": "I",
        "start": 4.52
      },
      {
        "text": "got",
        "start": 5.1
      },
      {
        "text": "a",
        "start": 5.68
      },
      {
        "text": "lot",
        "start": 5.92,
        "effect": "flash-climax"
      },
      {
        "text": "of",
        "start": 6.2
      },
      {
        "text": "my",
        "start": 6.34
      },
      {
        "text": "mind,",
        "start": 6.62,
        "effect": "glitch"
      },
      {
        "text": "got",
        "start": 7.32
      },
      {
        "text": "some",
        "start": 7.5
      },
      {
        "text": "more",
        "start": 7.78
      },
      {
        "text": "of",
        "start": 8.1
      },
      {
        "text": "my",
        "start": 8.28
      },
      {
        "text": "plate",
        "start": 8.48,
        "effect": "neon-rainbow"
      }
    ]
  },
  {
    "start": 8.76,
    "duration": 3.76,
    "vietnamese": "Em yêu khiến tôi mong chờ được hết ngày.",
    "words": [
      {
        "text": "My",
        "start": 8.76
      },
      {
        "text": "baby",
        "start": 9.12,
        "effect": "glow-gold"
      },
      {
        "text": "got",
        "start": 9.54
      },
      {
        "text": "me",
        "start": 9.84
      },
      {
        "text": "looking",
        "start": 10.06
      },
      {
        "text": "forward",
        "start": 10.44,
        "effect": "shake"
      },
      {
        "text": "to",
        "start": 10.86
      },
      {
        "text": "the",
        "start": 11.24
      },
      {
        "text": "end",
        "start": 11.52
      },
      {
        "text": "of",
        "start": 11.78
      },
      {
        "text": "the",
        "start": 12
      },
      {
        "text": "day",
        "start": 12.16
      }
    ]
  },
  {
    "start": 12.52,
    "duration": 5.9,
    "vietnamese": "Em nghĩ sao, anh và em, hãy cứ quên đi quá khứ.",
    "words": [
      {
        "text": "What",
        "start": 12.52
      },
      {
        "text": "you",
        "start": 12.88
      },
      {
        "text": "say,",
        "start": 13.08
      },
      {
        "text": "you",
        "start": 13.92
      },
      {
        "text": "and",
        "start": 14.78
      },
      {
        "text": "me,",
        "start": 14.98
      },
      {
        "text": "just",
        "start": 15.7
      },
      {
        "text": "forget",
        "start": 16.64,
        "effect": "throw-away"
      },
      {
        "text": "about",
        "start": 17.1
      },
      {
        "text": "the",
        "start": 17.8
      },
      {
        "text": "past",
        "start": 18.04,
        "effect": "glitch"
      }
    ]
  },
  {
    "start": 19,
    "duration": 4.62,
    "vietnamese": "Vứt hết vào thùng rác đi, em nghĩ sao, anh và em?",
    "words": [
      {
        "text": "Throw",
        "start": 18.79,
        "effect": "glitch"
      },
      {
        "text": "it",
        "start": 19.08
      },
      {
        "text": "in",
        "start": 19.48
      },
      {
        "text": "the",
        "start": 19.72
      },
      {
        "text": "trash,",
        "start": 19.88,
        "effect": "throw-away"
      },
      {
        "text": "what",
        "start": 20.24
      },
      {
        "text": "you",
        "start": 20.32
      },
      {
        "text": "say,",
        "start": 20.5
      },
      {
        "text": "you",
        "start": 21.16
      },
      {
        "text": "and",
        "start": 22.2
      },
      {
        "text": "me",
        "start": 22.42
      }
    ]
  },
  {
    "start": 23.62,
    "duration": 4.12,
    "vietnamese": "Hãy sống cuộc đời ta chưa từng có, như tôi chưa bao giờ nghĩ mình sẽ yêu.",
    "words": [
      {
        "text": "Let",
        "start": 23.62
      },
      {
        "text": "the",
        "start": 24.08
      },
      {
        "text": "life",
        "start": 24.3
      },
      {
        "text": "we",
        "start": 24.76
      },
      {
        "text": "never",
        "start": 25.02,
        "effect": "flash-climax"
      },
      {
        "text": "had,",
        "start": 25.38
      },
      {
        "text": "like",
        "start": 25.68
      },
      {
        "text": "I",
        "start": 25.96
      },
      {
        "text": "never",
        "start": 26.18
      },
      {
        "text": "thought",
        "start": 26.58
      },
      {
        "text": "we'd",
        "start": 27.18
      },
      {
        "text": "love",
        "start": 27.54,
        "effect": "glow-gold"
      }
    ]
  }
];
