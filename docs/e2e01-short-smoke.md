# E2E-01 — PASS technical DRAFT MP4 smoke

Base f655c96, branch codex/e2e01-short-smoke. Run directory:
`D:\LCOM108_NMLT\code\100_bai_code\Tiktok_Automation_e2e01\run-20261107-01`.
No LIVE crawler, scheduler, paid API, model download, publishing or production
write was performed. No unrelated process was killed or pagefile changed.

## Resource audit

OS-visible RAM 5.69 GiB, initially about 639 MiB available. Pagefiles C: 6,114MiB
and D: 16,657MiB; initial usage 856+938MiB. Memory Compression ~780MiB and largest
Chrome processes ~282/158/107MiB RSS. At audit only 3107 listened (owned Node
28668); 3105/3106 were stopped. Another Node was the app's artifact daemon and
was left untouched. Closing unnecessary Chrome tabs/app windows through their UI
is the useful user-controlled recovery option. Stopping the heavily paged 3107
process (~1.5MiB resident at a later sample) would offer little benefit.

Three Kokoro CPU syntheses ran sequentially in one retained worker. Initial
per-scene latency 59.42s / 7.40s / 11.04s; sampled minimum free RAM 340MiB.
The worker was closed before render. Initial speed1.2 timeline was 13.067s;
switching to speed1.0 reused all three base WAVs through FFmpeg (no inference),
producing measured WAV durations 3,115 / 4,217 / 6,445ms. Padding remains the
existing 200ms before/300ms after each scene, not artificial duration extension.

Render concurrency1, 720x1280, 30fps; 460 frames, 15.333333s. Measured renderer
worker runtime 79.018s, including bundle23.962s, browser1.024s, renderMedia49.371s,
AAC encode/mux0.699s. Job timestamps span about93.05s including worker bootstrap.
Average frame pass9.32fps. Sampled process-tree working set max947.54MiB, worker
RSS max375.06MiB, minimum sampled system free RAM335.93MiB; free virtual memory
remained ~9.7GiB or more in render samples. CPU tree last sample ~107.94 CPU seconds;
this is not a system-wide utilization peak. Final free RAM about699MiB.

## Source → Script → Voice → Editor → MP4

A separate session 3bb0b8b3-4fb6-4caf-982c-66ffed921ec9 was cloned from LIVE02
e7e17c42-46d5-43ab-bc73-2ef4066935f5. All original text, raw extraction, source IDs,
locks and unselected content are preserved. The smoke chooses the root and two
school/recruitment-related observed cards by duy_the_homosapiens/chandler.1000.
These are explicit technical DRAFT selections, not human production approval.
Clean projections remove time/reveal UI labels, exclude topic from narration and
omit the smile emoticon from spoken text. Unexpanded abbreviations remain for
editorial review; public context parentage stays OBSERVED_ON_TARGET_PAGE.

Actual Kokoro my_yen audio is DRAFT, approvedAt=null. No spoken/audio/rights
approval was manufactured. Rights remain UNKNOWN. The cached original image is
1080x344 JPEG SHA256 c03981ab1b2b131c7ff80e39a884cc531de0222a9883e01c2d5175ed0052ca13.
Local-image resolution was missing in the preview/export adapter; it now reuses
the validated localSourceMedia URI shared with Source. Scene captions were empty;
they now use narration text and measured audio bounds in the existing timeline
engine. They are scene-level captions, not word-aligned karaoke.

## MP4 evidence

Output under backend/.studio-data/renders/3bb0b8b3-4fb6-4caf-982c-66ffed921ec9/
a2e28fb1-fb14-4641-a3de-d50c973d2c7a/video.mp4 in the run directory.

- H.264/yuv420p, AAC, 720x1280,30fps,460frames,523,475bytes.
- Video15.333333s, audio15.333000s, container15.333333s.
- Scene audio/caption bounds [6,100),[115,242),[257,451) at30fps.
- Decoded AAC vs measured source WAVs: per-scene correlation
  0.9999977/0.9999947/0.9999950; best lags0/-0.333/+0.333ms. Whole-mix raw
  correlation0.727 because independent clips have different submillisecond
  resampling offsets; global lag alone is not a useful per-clip sync verdict.
- PCM RMS0.1648, actual speech not silent. FFmpeg blackdetect found no black span
  >=0.1s. Decoded start/mid/boundary/end frames inspected; original image visible
  in root scene, text/captions remain within canvas, no time/reveal boilerplate.
- Browser MP4 playback without media error, seek all3 scenes, download HTTP200
  exact523475bytes, reload preserves COMPLETED output. Browser did not initiate
  another render or TTS.
- Editor save/reopen and stale revision409 verified; raw/locks retained and
  timeline stays460frames. Session is now revision10; immutable rendered snapshot
  is revision9 (same content/timeline).

## Tests / limits

Backend build/TypeScript PASS; frontend TypeScript/bundle PASS.
test/e2e01-contract.cjs PASS on real manifests: measured duration,3scenes,local
image,caption/audio boundaries,base-cache reuse,immutable sources/locks.
test/source-quality01.cjs PASS replay and temp-store persistence regression.
test/e2e01-browser.cjs PASS actual MP4 playback/seek/download/reopen.
Production baseline933files:0changed,0unreadable. git diff --check PASS.
Full Jest NOT RUN to avoid a new memory-heavy sweep.

PASS applies to the requested15–30s local technical smoke, not FINAL/publishing,
1080p, word-level subtitle timing, comprehensive speech-quality review or rights.
Remote avatars were omitted (no fake replacement); article image is present.
Image text is small at720p; visual polish, abbreviation pronunciation and editorial
quality should be reviewed by the user. No additional render is claimed.

## Studio and reproduction

http://127.0.0.1:3108/studio?session=3bb0b8b3-4fb6-4caf-982c-66ffed921ec9&area=Video%20Studio&step=Render

From this branch's backend directory:

```powershell
node --max-old-space-size=256 scripts/e2e01-runtime.cjs "D:\LCOM108_NMLT\code\100_bai_code\Tiktok_Automation_e2e01\run-20261107-01"
```

Ctrl+C in the owning terminal stops it. Local TTS paths are kept only in the
external sandbox tts.local.json, excluded from Git. Explicit per-item DRAFT
Generate/Regenerate and DRAFT Render can reuse this sandbox; the service serializes
work and closes Kokoro before rendering. No TTS starts on startup. Settings/text
changes invalidate matching audio through existing hashes. FINAL, approvals,
collection, OAuth and publishing are blocked. Existing3107 is preserved.

Artifacts: verification.json, audio-diagnostics.json, tts-memory.json,
speed-memory.json, preview.json, decoded-frames/*.png, browser/*.png,
browser-proof.json plus render snapshot/manifest/log. Models/audio/video/runtime
config and copied source data stay outside Git. Code junctions reference existing
worktree source/scripts; session/audio/render/cache paths stay in the sandbox.
