# MEDIA-NARRATION-03 — approved DRAFT render acceptance

**PASS: one new local DRAFT MP4 rendered, decoded and exercised in a browser.**
Human approval of OCR, narration quality, content and rights remains pending.
No FINAL/publishing authorization is implied. Base ee0bf02, branch
`codex/media-narration03`. No TTS or crawler ran in this checkpoint.

## Open the new output

- Studio: <http://127.0.0.1:3111/studio?session=5f6318ab-8055-4137-bfd4-b30bf0776323&area=Video%20Studio&step=Render>
- Open video: <http://127.0.0.1:3111/api/studio/sessions/5f6318ab-8055-4137-bfd4-b30bf0776323/renders/ace9783f-63db-4db5-9285-9f57ccfa1f10/video>
- Download: append `?download=1` to the video URL, or click **Download MP4** in
  the completed job. Expand **Playback & manifest** for inline video.

The copied project retains its existing title **MEDIA-NARRATION-02 — reviewed
image DRAFT**. This output is NEW, identified by job
`ace9783f-63db-4db5-9285-9f57ccfa1f10`, not a previous MP4.

Artifacts are outside Git under
`Tiktok_Automation_e2e01/run-media-narration03-render01/`. The MP4 relative to its
`backend/.studio-data` is:

`renders/5f6318ab-8055-4137-bfd4-b30bf0776323/ace9783f-63db-4db5-9285-9f57ccfa1f10/video.mp4`.

SHA-256: `507433eb95bfef7549f54d32209d4bb2afa8a6f2fe31725e9fb2b0fb3fae1e4c`.

## Scope and runtime isolation

Exactly one render was admitted by the single-use `attempt.json`; no automatic
retry. A copy was made from `run-media-narration03-tts01`, including the verified
new root WAV (28.257875 s), two cached comment WAVs and local original image.
Existing RenderStore, StudioJobs, timeline adapter and SeriousTimelinePreview
were used. There is no second renderer or alternative duration calculation.

The approved immutable snapshot has 1,137 frames at 30 FPS; 720 x 1280, H.264/AAC,
yuv420p, concurrency 1, subtitles OFF, original FULL image layout/aspect ratio.
The existing renderer's bounded media caches and one off-thread video worker
were retained. No browser/runtime/model/package was downloaded.

- Pre-render RAM available: **676.24 MiB**; commit **17,363.60 / 28,593.83 MiB**.
  No competing Python/render/collector worker was observed.
- An exclusive lease prevented other heavy Studio operations in this worktree.
  The controller monitored physical RAM/commit at approximately 250 ms and
  requested safe cancellation below **256 / 512 MiB** respectively; 10-minute
  watchdog. Neither emergency stop nor timeout occurred.
- The additional Python process was a lightweight native memory observer,
  **not Kokoro**, and was closed after the render.
- Browser/encoder/render-worker closure completed; subsequent process inventory
  found no `kokoro-studio.py` or `studio-render.cjs` process. The browser used for
  acceptance was opened only afterwards and also closed.
- Studio 3110 stayed HTTP 200 with its original PID **17624**. It was not stopped,
  reconfigured or pointed at another store.
- New Studio 3111 stays bound to loopback, PID **2996**, isolated copied store,
  mode **REAL_DATA_COPY**. No credentials/.env/OAuth vault were copied. HTTP allows
  local save and preview preparation; TTS/render/crawl/approval/publishing are
  denied. The Render button is disabled by the existing safety UI.

## Measured output and performance

| Measurement | Actual |
| --- | ---: |
| Video | H.264, yuv420p, 720 x 1280, 30/1 FPS |
| Video frames | 1,137 |
| Video / audio / container duration | 37.900000 s each |
| Audio | AAC, stereo, 48,000 Hz |
| MP4 bytes | 1,281,612 (about 1.22 MiB) |
| Composition bundle | 24.732 s, new bundle |
| Browser initialization | 1.033 s |
| Frame/renderMedia pass | 119.831 s |
| Encoding time reported inside Remotion | 3.931 s (within the pass) |
| Final AAC encode/mux | 1.571 s |
| Worker main scope | 151.016 s |
| Full Studio job including child bootstrap/cleanup | 166.260 s |
| Controller native observations before-to-after | 167.820 s |
| Average frame-pass FPS | 9.488 |
| Minimum sampled available RAM | 353.09 MiB |
| Sampled peak Node render-worker RSS | 378.24 MiB |
| Sampled peak worker + browser/encoder tree RSS | 786.99 MiB |
| Sampled peak process-tree private bytes | 766.56 MiB |
| Peak sampled system commit | 18,464.85 / 28,593.83 MiB |
| Available RAM immediately after closure | 883.19 MiB |

The RSS/private values are observed samples, not guaranteed native high-water
marks for every child. Memory fluctuates with unrelated apps; this does not
establish a general minimum RAM or long-render reliability guarantee.

## Frame and audio verification

Independent FFprobe and complete FFmpeg decode succeeded. No almost-all-black
interval was detected (blackdetect >=98% black, minimum 0.03 s). Ten PNGs were
decoded at frames **0, 6, 430, 862, 863, 869, 975, 976, 982, 1136** and visually
inspected across the root, both comments and the exact scene boundaries.

| Scene | Start | End exclusive | Voice start |
| --- | ---: | ---: | ---: |
| Root + image | 0 | 863 | 0.200000 s |
| Comment 1 | 863 | 976 | 28.966667 s |
| Comment 2 | 976 | 1137 | 32.733333 s |

The real root image is the full local 1080 x 344 JPEG. Browser preview measured
181.778 x 58.038 px at a 240px-wide player, `object-fit: contain`, transform none;
the natural dimensions/hash agree with source. Exported frames visibly retain
the whole image and text, without cropping or a second inset scaling step.
Dense image text remains small at 720p; readability/possible later zoom is a
human editorial decision. Saved layout was not changed to disguise this.

Subtitles are empty in all three timeline scenes, no subtitle stream exists,
and inspected exported frames show no burned-in captions or safe-area overlay.

Audio was decoded to 16 kHz mono PCM for numerical comparison:

- Full MP4-vs-Remotion mixer waveform correlation: **0.99999436**.
- Original WAV-vs-MP4 correlations >**0.999996** at sampled leading windows and
  >**0.999997** near the end of each source clip.
- Best waveform lag against expected starts: root **0 ms**, comment 1
  **+0.3125 ms**, comment 2 **-0.3125 ms**. This is a bounded sampled waveform
  alignment measurement, not a claim of universal/perceptually perfect sync.
- Root input hash remains the user-approved 591-character hash; no audio was
  synthesized again. Both cached comment files remain hash-identical.

These checks demonstrate the new image-narration WAV is present through its
tail in the MP4. No ASR transcript or human pronunciation approval is claimed.

## Browser acceptance

PASS using one installed browser, sequentially after render:

- Correct copied session, completed job and actual MP4 metadata.
- Unmuted playback, decoded frames and advancing currentTime verified.
- Six seeks across root/comment boundaries and near the end, readyState 4.
- Actual **Download MP4** click saved 1,281,612 bytes; SHA-256 matches the output.
  HTTP byte-range also returned **206**, correct Content-Range and 1,024 bytes.
- Existing Remotion Player loads the image and correct three scene IDs at frames
  6/869/982, without a new job or TTS call.
- Save unchanged Editor settings, prepare preview and reload: copied session
  revision **1 -> 3**, all item/source/OCR/lock/revision fields unchanged. Exactly
  one completed render remains. Before/after preview hash is identical:
  `5b426cfe54644eaee09f6f003fa5801c3653f02753ecf7a4f498c2f2aac40dae`.
- Zero browser page exceptions. Only write requests: sandbox Editor PUT and
  preview prepare POST. No TTS/render/approval/collection request.

Test harness corrections before the final successful browser run: removed an
incorrect hardcoded browser path in favor of the installed executable recorded
by the render; replaced a one-second playback assumption with scroll-to-video
and waiting for actual currentTime advancement. No render was retried.

Screenshots: `browser/render-playback.png`, `browser/render-reopened.png`,
`browser/root-player.png`. Exported frames: `decoded-507433eb95bf/frame-01.png`
through `frame-10.png`. Full measurement reports: `report.json`,
`mp4-verification.json`, `browser-verification.json`; raw worker logs/snapshot
and manifest remain beside the MP4.

## Preservation, limitations and checks

- Original TTS sandbox session remains unchanged, SHA-256
  `bd46d020a1fb880ba4fb42eda4639fa4a6d40b00df1a0d5c301d7f765dacce8f`.
  Original earlier source stays untouched; OCR remains **AGENT_VISUAL**, not
  USER_APPROVED; no spoken/audio/rights/production approval was granted.
- Production **933/933 files unchanged**, zero changed/unreadable, baseline
  `e19574bf84fc07c88a165aa3958f50e579a93c289b6aeef2c0664c1f35a6c1e7`.
- **PARTIAL:** all three remote avatars lack a usable local cache in this source
  snapshot. Offline export uses the existing explicit **?** fallback. No fake
  avatar was created or new remote request made. This render does not claim
  avatar restoration or pixel-perfect Threads fidelity.
- **Pending human review:** pronunciation/meaning of AGENT_VISUAL correction,
  subjective pacing/image readability, content rights. Output remains DRAFT,
  publishable false, FINAL approval/language gates intact.
- Syntax checks for four new CJS scripts, actual render/bundle, independent
  FFprobe/full decode/waveform checks, browser acceptance, preservation and
  `git diff --check` passed. TypeScript/full Jest/frontend rebuild were NOT RUN
  in this checkpoint: core TS/frontend source was not changed. No dependency
  change. Runtime artifacts, copied source, media, profiles and audio/video are
  excluded from Git; only scripts and this report are committed.

## Restart / stop sandbox

From this feature worktree's `1_nest_backend` directory:

`node --max-old-space-size=128 scripts/media-narration03-runtime.cjs`

Do not start a second listener on 3111. Use Ctrl+C in its launch terminal to
stop. For the current detached instance, first verify PID **2996** still belongs
to `media-narration03-runtime.cjs` using Win32_Process before stopping that exact
PID. Do not stop PID 17624 / Studio 3110. No Windows startup service was created.
Frontend bundle served: SHA-256
`9c137ef23862f1e91fb8bf9b96567bd8ce6908e6d574cb3a8c97ebd6c337ab13`.
The single render approval has been consumed; do not invoke render `run` again.
