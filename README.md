🤖 TikTok/Shorts Automation & Video Generation Pipeline
📖 Overview
This project is an advanced, fully automated pipeline designed for generating, rendering, and publishing short-form videos (TikToks, YouTube Shorts, Instagram Reels). It seamlessly integrates data scraping, AI-powered content curation (OpenAI, Gemini), Text-to-Speech (TTS), precise audio transcription (Whisper), and programmatic video rendering using Remotion.

The system is built to operate hands-free: it hunts for trending topics, writes the scripts, generates the media, renders the video, and uploads it directly to social media platforms.

🏗 Architecture & Project Structure
The project is structured as a monorepo containing three main components:

1_nest_backend/ (The Brain): A robust NestJS backend that orchestrates the entire workflow. It manages cron jobs, web scraping, AI processing, database interactions (Prisma), file generation, and automated uploading.

2_Remotion_Video/ (The Engine): A React-based Remotion project responsible for visually rendering the videos. It accepts parameterized inputs (audio tracks, word-level timestamps, JSON scripts, visual assets) from the backend and produces highly engaging, dynamic .mp4 files.

3_Storage_Assets/ (The Cache): A dedicated storage directory for intermediate and temporary assets such as generated audio, background music, Whisper JSON transcripts, and output videos.

✨ Detailed Features & Workflow Pipeline
The automation follows a strict, multi-step pipeline triggered by backend workers:

1. Data Harvesting (Watcher & Auto-Hunter)
Automated background services scrape trending topics, dramatic stories, or serious discussions from platforms like Threads.

Dedicated workflow modules handle different content types (e.g., threads-drama, threads-compilation, threads-serious, tiktok-lyrics).

2. AI Content Processing (AI Module)
Integrates multiple LLM providers (OpenAI, Google Gemini, Groq) to process and rewrite raw scraped content into engaging, retention-optimized video scripts.

The AI dynamically selects appropriate visual assets (memes) and sound effects (SFX) based on the context, using predefined references (meme_dictionary.json and sfx_dictionary.json).

3. Voice & Subtitles (TTS & Whisper)
Converts the AI-generated script into natural-sounding voiceovers using Text-to-Speech (TTS) engines.

Passes the generated audio through Whisper (OpenAI) to extract highly accurate, word-level timestamps. This data is saved as JSON/SRT files to synchronize dynamic text animations in the video.

4. Programmatic Video Rendering (Remotion Runner)
The backend triggers the Remotion CLI, injecting the generated audio, timestamps, and script data as React props.

Dynamic Compositions Supported:

Threads Format: Visualizes social media posts with typing/reading animations and meme pop-ups.

Serious/B-roll Format: Features cinematic text, neon backgrounds, and engaging B-roll footage.

TikTok Lyrics: Trendy, aesthetic music-lyric visualizers.

Automatically applies background music (BGM), synchronized sound effects (SFX), and visual transitions.

5. Automated Publishing (TikTok Upload & Discord Notification)
Utilizes automated browser scripts to handle the complex process of uploading the final .mp4 directly to TikTok, complete with auto-generated captions and hashtags.

Sends real-time workflow logs, error reports, and success notifications to a designated Discord channel via Webhooks.

🚀 Getting Started
Prerequisites
Node.js (v18 or v20 LTS recommended)

FFmpeg (Crucial: Must be installed and added to your system's PATH. Both Remotion and Whisper rely on it for media processing).

Git

1. Backend Setup (1_nest_backend)
Navigate to the backend directory and install dependencies:

Bash


cd 1_nest_backend
npm install
Create a .env file in the 1_nest_backend directory and configure your keys:

Đoạn mã


# Database
DATABASE_URL="file:./prisma/dev.db" # Or your PostgreSQL connection string

# AI Providers
OPENAI_API_KEY="your_openai_key_here"
GEMINI_API_KEY="your_gemini_key_here"
GROQ_API_KEY="your_groq_key_here"

# Notifications
DISCORD_WEBHOOK_URL="your_discord_webhook_url"
Initialize the Prisma database and start the server:

Bash


npx prisma db push
npm run start:dev
2. Video Renderer Setup (2_Remotion_Video)
Open a new terminal window, navigate to the Remotion directory, and install dependencies:

Bash


cd 2_Remotion_Video
npm install
To launch the Remotion Studio and preview your video templates in the browser:

Bash


npm start
🛠 Tech Stack
Core Backend: NestJS, TypeScript, Prisma ORM.

Video Generation: Remotion, React, Tailwind CSS.

AI & ML: OpenAI API, Google Gemini, Groq, Whisper.

Automation: Puppeteer / Playwright, FFmpeg.

📝 Future Improvements (TODO)
[ ] Build a frontend Dashboard to manage campaigns, templates, and view rendered videos manually.

[ ] Expand auto-upload capabilities to YouTube Shorts and Instagram Reels APIs.

[ ] Add multi-language generation support.
