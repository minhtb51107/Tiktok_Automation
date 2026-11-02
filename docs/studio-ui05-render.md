# Studio UI-05 — local MP4 render

Studio still uses one loopback Nest backend serving React. Start with
`npm run studio:start` in `1_nest_backend` after building backend and Studio.
No render, TTS, AI, scraper or publishing runs at startup. Dependencies and the
existing installed browser are reused; there is no runtime/model auto-download.

## Operations shared by people and agents

- `GET /api/studio/sessions/:id/render`: current saved revision, deterministic
  preview request, validation gates and retained render manifests.
- `POST /api/studio/sessions/:id/jobs`: `{operation:"render",input:{revision,
  mode:"DRAFT"|"FINAL",preset:"1080P"|"720P",requestId,frameRange?}}`.
  Frame range is inclusive and bounded by the unchanged timeline; omit for full.
  It does not override composition duration, FPS or the timeline engine.
- Existing job GET/cancel operations provide durable progress and cancellation.
  Shared jobs use SUCCEEDED; the render manifest/UI maps this to COMPLETED.
- `GET /api/studio/sessions/:id/renders/:jobId/manifest` and `/video` load a
  retained artifact; `/video?download=1` downloads it. Failed/cancelled jobs are
  not served as completed outputs. Session/job identifiers cannot traverse paths.

The Render workspace shows project revision, frame count, duration, audio coverage,
resolution, mode, gates, jobs and download/playback. Copy Report and JSON export
describe persisted manifests/jobs. Double submissions with the same request key
deduplicate; each intentional new render gets a new requestId and output directory.

## One timeline, one composition

The existing `buildStudioPreview` and timeline engine produce the same
`VideoPreviewProps` used in the Player. A small isolated Remotion registration
imports **SeriousTimelinePreview itself**, not a second renderer or legacy module.
The worker stores the immutable input snapshot, revision, timeline/props hashes,
settings, measured output and warnings under ignored `.studio-data/renders/`.
Scene order, enabled flags, appearance, card/media placement, pagination, audio,
global background source ranges/loop/overrides and BGM remain in those props.

The worker resolves local API media URLs for the browser without copying the public
directory. A source-fingerprinted bundle is cached with an empty public directory.
Renderer/bundler are resolved from Remotion's existing frontend installation to
match its exact version. Browser executable existence is checked explicitly and
browser-download hooks fail closed.

Selected GIF memes use the same frame-clocked WebCodecs ImageDecoder canvas in
Player and render, rather than trusting a screenshot of an animated `<img>`.
Compressed GIFs are bounded to 10 MB, 24 MP and 1000 frames; only one decoded frame
is held by the component at a time. Missing ImageDecoder/invalid GIF fails export
instead of silently flattening it. Local GIF data is transported inline during
render to avoid cross-origin fetch problems; original assets are not changed.

## Approval and resource gates

Missing/stale narration blocks export. DRAFT permits unapproved narration but is
labelled in manifest/MP4 metadata and always `publishable:false`. FINAL requires
explicit current spoken/audio approvals and no unresolved language/topic review.
No route here approves audio or triggers publishing; the future publishing stage
needs its own gate even for FINAL exports.

Render jobs share the existing FIFO queue and session mutation lock. An idle Kokoro
model is closed before render; direct concurrent voice operations are refused.
Concurrency is one, media caches are bounded, parallel encoding is disabled and
the worker has a 768 MiB V8 heap setting (not a total-process RAM limit). Windows
process-family working/private bytes and system free RAM/virtual memory are sampled.
Low physical **and** virtual memory requests cancellation. Source videos stream;
the whole long source video is not decoded into RAM.

Cancel signals reach Remotion and the final mux subprocess. The worker closes its
browser in finally; parent disconnect also requests cancellation. A watchdog limits
the job. Jobs are not automatically retried after errors/restarts. Intermediates,
old outputs and user assets are retained rather than broadly deleted.

## Export bugs found by real measurements

The installed renderer's AAC path compressed its exact mix to ADTS and copied it
into MP4. The first real export had a **42.7–43 ms** waveform delay across all five
voices and BGM, despite correct stream metadata. Its source uses libfdk AAC/ADTS,
which loses priming information in that intermediate. The worker now asks the
**same Remotion mixer** for lossless WAV alongside H.264 video, then encodes AAC
directly into MP4 using FFmpeg, preserving encoder delay/edit-list metadata. It
does not offset or rebuild any timeline track. The fixed 5-second smoke measured
0 ms lag and approximately 0.988 correlation for the tested narration window.

Player inherited panel typography while the independent bundle did not. Measured
base typography (12px / 1.45) is now explicit inside ThreadsVisual, preserving
Editor geometry without modifying saved layouts. This is distinct from the card's
user-controlled body font size/line height.

## Deliberate limitations

- Remote avatars/images are not fetched by this offline worker. Missing remote
  content is disclosed, not fabricated. For full fidelity, provide local source
  media before FINAL review. Original metadata URLs remain unchanged.
- Saved background duration/source range is never silently stretched when new
  narration expands the timeline. Render warns about coverage gaps. Extend/loop
  deliberately in Editor if the desired background should cover the whole video.
- No automated semantic/voice quality approval, word-level forced alignment,
  loudness normalization/ducking, output deletion UI or publishing is implemented.
- Original Threads screenshot comparison remains a separate manual quality gate.

Actual build, browser, MP4/FFprobe, waveform and frame evidence is stored locally in
ignored `.studio-data/reports/ui05/`. Unit tests are offline; they are never used as
proof of live TTS, browser fidelity or a valid MP4.
