# MEDIA-NARRATION-03 — one approved long DRAFT TTS result

**Actual local TTS: PASS. Overall image-narration MP4: PARTIAL, render NOT RUN.**
The user explicitly approved one attempt after preflight commit 299a0b8.
Branch: `codex/media-narration03`. This is a new WAV, not the earlier short probe
or an old MP4. Execution began 2026-11-08 17:59 UTC (Nov 9 local time).

## Executed scope

- Exactly one Kokoro worker, PID **17180**, one import/model construction and one
  synthesis request using the existing installed splitter: **6 chunks**, largest
  195 characters. No second TTS pipeline or external rechunking.
- Approved normalized input: **591 characters**, SHA-256
  `87ceca9ebeb418e37537166eaf89624df49bb7ab1eb089ffd1b0acb17756f7f5`.
- Voice **my_yen**, CPU, speed **1.3** through existing cached-base/atempo pipeline.
  Root + image synthesized freshly; two comment WAVs reused unchanged by hash.
- Runtime caps: cold-start/synthesis 240 s, full TTS 300 s. Emergency floors
  unchanged: physical available <256 MiB or commit reserve <512 MiB. No retry,
  emergency stop, allocation failure or timeout occurred. No inference was run
  during verification or the subsequent mock tests.
- Owned worker closure was awaited. The PID was subsequently absent and the
  exclusive lease released. No unrelated process was stopped.

## Measured time and memory

| Measurement | Actual |
| --- | ---: |
| Imports | 5.161 s |
| Model construction | 11.956 s |
| Synthesis including existing G2P/sentence loop | 64.855 s |
| Worker request including WAV write | 81.999 s |
| TTS controller through confirmed worker closure | 83.574 s |
| Peak native worker RSS | 934.18 MiB |
| Sampled peak private bytes | 1,176.40 MiB |
| Native peak process commit | 1,176.40 MiB |
| Minimum available physical RAM, all recorded measurements | 370.39 MiB |
| Peak observed system commit | 18,804.73 / 28,593.83 MiB |
| Minimum observed commit reserve | 9,789.10 MiB |

Immediately before execution: available RAM **777.95 MiB**, system commit
**17,529.96 / 28,593.83 MiB**; no competing Python/render/collector worker observed.
After confirmed model closure: available RAM **1,064.86 MiB**, system commit
**17,702.70 / 28,593.83 MiB**. A later lightweight observation showed **528.80 MiB**
available and commit **17,672.14 / 28,593.83 MiB**, illustrating background
fluctuation; remeasure before any approved render.

Pagefile allocation was unchanged: C/D **6,107 / 16,657 MiB**. Current usage
before: **778 / 882 MiB**; after: **968 / 1,210 MiB**. No pagefile/Windows changes.
Page faults include soft faults and are not proof of disk paging or Windows OOM.
The worker's periodic-only summary gives a physical minimum of 370.93 MiB;
370.39 above also includes its explicit model boundary measurements. Sampled
private/system extrema can miss brief spikes; native RSS/process commit have
OS-maintained high-water marks. This one result establishes no universal minimum
RAM, reliability guarantee or long-job benchmark.

## New WAV verification

- `pcm_s16le`, mono, **24,000 Hz**, **28.257875 seconds**, **1,356,456 bytes**.
- Existing manifest duration: **28,258 ms**, matches rounded FFprobe duration.
- Full decode/volumedetect exit 0: mean **-15.1 dB**, peak **-0.1 dB**; not silent.
- WAV SHA-256 before/after independent verification:
  `22c5032474106cc4e6834db68a113197b891af3f1d87b60154b76680a89f0a57`.
- Manifest text hash matches the approved input; cache key matches the planned
  item/text/dictionary/model/voice/speed key. `synthesisPerformed: true`,
  `cacheHit: false`, asset status GENERATED, purpose **DRAFT**, approvedAt null.
- This verifies the synthesis input and a non-silent decoded waveform, not an
  independently transcribed or human-approved reading. Human semantic listening
  and image-narration MP4 acceptance are still pending. No ASR/model was added.

## Timeline prepared, not rendered

The existing pure editor/timeline adapter consumes the new measured WAV and the
two cached comment WAVs. **30 FPS, 1,137 frames, 37.9 seconds**, three scenes:

| Scene | Start frame | End exclusive | Frames |
| --- | ---: | ---: | ---: |
| Root + image narration | 0 | 863 | 863 |
| Selected context comment 1 | 863 | 976 | 113 |
| Selected context comment 2 | 976 | 1137 | 161 |

All scene subtitle arrays are empty; existing FULL image/aspect ratio/layout
settings are unchanged. Missing audio = 0, DRAFT render blockers = 0. FINAL
approval/language-review blockers remain; no approval was granted automatically.
37.9 s is a technical DRAFT timeline, not a >60-second release claim.

Next approval, if desired: one **720 x 1280, 30 FPS, concurrency 1, H.264/AAC
DRAFT render** of this measured snapshot, subtitles OFF. Recheck memory/commit,
existing runtime/store and local assets first; no TTS retry or synthesis during
render. Stop if resource conditions are unsafe. Render/playback/download and
image/frame acceptance remain NOT RUN; this report does not authorize them.

## Artifacts and preservation

All runtime artifacts remain outside Git under:
`Tiktok_Automation_e2e01/run-media-narration03-tts01/`:

- `approval.json`, single-use `attempt.json`, `before.json`, `checkpoint.json`,
  `run.log`, `report.json`, `verification.json`, `preview-props.json` and
  `production-preservation.json`.
- New WAV relative to its `backend/.studio-data`:
  `audio/5f6318ab-8055-4137-bfd4-b30bf0776323/assets/55bf56cd990291162188b0a2f95bb3891b4a5424847365035d93dbb79f98b6d3.wav`.
- Isolated session retains the source session ID. Its session revision becomes
  **1** from audio persistence; every item/revision/lock/OCR/source selection and
  saved Editor settings compare equal to the source. The original session stays
  at revision **0**, SHA-256 unchanged:
  `10104f02d0b0d0f5cf22db7aad4f510cf04b2a96807cba570a03b8495dc57138`.
- OCR remains **AGENT_VISUAL**, not USER_APPROVED. Context evidence remains
  OBSERVED_ON_TARGET_PAGE. Rights/approvals are not promoted.
- Production preservation: **933/933 unchanged, zero changed/unreadable** against
  baseline `e19574bf84fc07c88a165aa3958f50e579a93c289b6aeef2c0664c1f35a6c1e7`.
- Existing Studio PID 17624 / port 3110 was left running on MEDIA-NARRATION-02.
  It has not been silently switched to the new store. The new WAV can be opened
  directly; render-stage sandbox serving is a separate next step.

## Verification and source changes

New scripts reuse StudioService.voiceAction, KokoroRuntime, existing cache,
resource policy, FFmpeg/FFprobe and prepareEditor. They do not expose a public
permission endpoint or import the production application at startup.

Commands run sequentially, all exit **0**:

- `node --check scripts/media-narration03-tts.cjs`
- `node --check scripts/media-narration03-verify.cjs`
- `node --max-old-space-size=128 scripts/media-narration03-tts.cjs check`
- The single approved `...media-narration03-tts.cjs run` (attempt consumed).
- `node --max-old-space-size=128 scripts/media-narration03-verify.cjs` (repeatable
  read/FFprobe verification only; also checks cached comment bytes and worker exit).
- `node --max-old-space-size=128 test/media-narration03.cjs` (OFFLINE/MOCK only).
- `...media-narration01-preserve.cjs .../run-media-narration03-tts01`.
- `git diff --check` and proposed-file secret scan.

Backend/frontend TypeScript, bundles and full Jest were **NOT RERUN** this turn:
no TypeScript/frontend/renderer source changed. No crawler/API credentials,
scheduler, render, publishing or production mutation was used. Only these two
source scripts and this report are committed, no runtime/session/audio data.
