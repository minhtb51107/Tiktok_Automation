# MEDIA-NARRATION-03 — preflight and approval plan

Status: **PREFLIGHT PASS / E2E PARTIAL / WAITING FOR LONG-TTS APPROVAL**.
Base b19b789, branch `codex/media-narration03`. No new synthesis, render, crawl,
approval or publishing was performed. The short probe result is not long-text
acceptance. No old MP4 is being presented as this task's output.

## Verified saved inputs

The read-only source is the MEDIA-NARRATION-02 sandbox session
`5f6318ab-8055-4137-bfd4-b30bf0776323`, revision 0. Source SHA-256:
`10104f02d0b0d0f5cf22db7aad4f510cf04b2a96807cba570a03b8495dc57138`.
All nine saved records remain intact, with root and two context items selected.
Context evidence remains OBSERVED_ON_TARGET_PAGE, not parent-verified.

Root item `a3f51095-aa63-485d-94a9-bb979a3900ec` has 582 spoken characters,
591 after the existing speech dictionary/number projection. Input SHA-256:
`87ceca9ebeb418e37537166eaf89624df49bb7ab1eb089ffd1b0acb17756f7f5`.
Neither its matching base nor speed-1.3 cache exists. The existing installed
Kokoro sentence splitter produces six chunks, maximum 195 characters; it runs
inside one synthesis/model instance. Do not add an external chunking pipeline.

The two selected comment caches were hash-checked and FFprobed: PCM signed
16-bit, mono, 24 kHz, durations **3.262667 s** and **4.860625 s**. They require no
new inference. Stop and revise the plan if their inputs/settings/cache change.
Cache identity still includes item, projected text, dictionary/number version,
voice, model/device and speed (speed variant retains the base cache).

Root image SHA-256:
`c03981ab1b2b131c7ff80e39a884cc531de0222a9883e01c2d5175ed0052ca13`.
The downloaded JPEG is 1080 x 344; its bytes match the OCR provenance. Visual
inspection compared the saved Vietnamese correction with the actual image.
The applied image narration matches OCR revision 1 and corrected text exactly.
Raw OCR remains Windows.Media.Ocr/en-US, confidence null, with missing-Vietnamese
language/confidence warnings. Correction remains **AGENT_VISUAL**, READ_FULL,
not USER_APPROVED. Technical DRAFT execution does not approve its content.

Original/display/raw text, revisions, locks, image and saved layout are unchanged.
All three scenes retain FULL image mode and subtitles OFF.

## Resource evidence and risk

Preflight snapshot 2026-11-08 17:51:43 UTC (Nov 9 local):

- OS-visible physical: 5,829.03 MiB; available **657.62 MiB**.
- System commit: **17,721.36 / 28,593.83 MiB**, reserve 10,872.47 MiB.
- Pagefile allocation C/D: 6,107 / 16,657 MiB; usage 787 / 883 MiB.
- No Kokoro, render or collector worker was observed. Only Studio 3110 was
  reachable in 3105–3110: E2E01_SANDBOX, owned Node PID 17624. It was not restarted.
- Memory Compression ~850 MiB; browser aggregate RSS ~747 MiB, including shared
  pages. These are observations, not guaranteed reclaimable capacity. No other
  process was stopped and no Windows/pagefile setting was changed.

Probe01 measured imports 10.754 s, model construction 47.575 s, short synthesis
6.866 s, total 81.877 s. Minimum available RAM was 277.61 MiB; peak native RSS
755.19 MiB and sampled private bytes 1,111.98 MiB. It leaves only 21.61 MiB above
the 256 MiB emergency floor at the lowest observation. Longer sentences can
increase activations and paging; a 43-character probe cannot establish safety
or minimum RAM for the 591-character request.

Planning estimate only: approximately **90–210 seconds** for the new TTS task,
with substantial uncertainty. Linear extrapolation of the probe audio suggests
~37 seconds of root narration and roughly ~46 seconds with cached comments and
padding, but neither is a measured duration or acceptance claim.

## Proposed execution requiring separate authorization

1. Re-measure physical/commit/pagefiles and active owned workers immediately
   before execution; reject conflicting work. Take a new sandbox copy, preserve
   source hashes, bind exact input hash and revision to a single-use approval.
2. Generate root + image only, **my_yen, CPU, speed 1.3**, DRAFT. Reuse existing
   dictionary, pronunciation overrides, splitter, StudioService and cache.
   A single worker/model handles all six internal chunks. No parallel work or
   automatic retry. Use cached comments without synthesizing them again.
3. Proposed **worker cold-start + synthesis cap 240 s; entire TTS cap 300 s**,
   including processing/validation. The probe remains at 90/120 seconds.
   1,536 MiB remains advisory, not a hard minimum. Physical <256 MiB or commit
   reserve <512 MiB still emergency-stops the owned worker. Native monitoring
   remains 250 ms; bounded sample retention now covers the entire longer limit.
4. Record stages, RSS/private/native peaks, physical minimum, commit, pagefiles,
   elapsed times and failure category; do not infer Windows OOM from guard stop.
   Verify WAV SHA-256, FFprobe, non-silence and listen to image narration. No
   automatic content/audio approval. Stop after failure; do not retry.
5. Await owned Kokoro shutdown and re-measure resources. **Request separate
   render approval after the measured WAV/timeline exists.** Reuse existing
   timeline/Remotion at 720 x 1280, 30 FPS, H.264/AAC DRAFT, concurrency 1,
   subtitles OFF, original image aspect ratio. No render was authorized here.
6. On authorization, verify new output frame/voice/image content, measured
   timeline, seek/playback/download. Never substitute an old MP4 as evidence.

The internal approved-batch option has a hash-bound deadline and is not exposed
as a new public HTTP permission. Normal TTS architecture/cache and probe guards
are retained. Existing Studio runtime still runs the previous loaded JS; use the
verified new build in the approved task controller, not concurrent servers.

## Artifacts and checks

Local-only plan directory, outside Git:
`Tiktok_Automation_e2e01/run-media-narration03-plan-1794160303822/`.
It contains full exact inputs in `plan.json` and `production-preservation.json`.
Plan SHA-256:
`e860b8308c2aa3da2811acf7eb5314b524224ac7bbab51f8a18fbe95845c409c`.
No secrets, local runtime configuration, source session, image or audio is staged.

Run preflight again (read-only source, a fresh unique plan directory):
`node --max-old-space-size=128 scripts/media-narration03-preflight.cjs`
from `1_nest_backend`. It does not import Torch or synthesize/render.

All these commands were run sequentially with exit code **0**:

- `npm run build` (backend TypeScript compilation).
- `node --max-old-space-size=128 test/media-narration03.cjs`: MOCK protocol
  worker reuse, long approval/deadline/hash rejection and unchanged emergency/probe limits.
- `node --max-old-space-size=128 test/local-bounded-probe.cjs`: MOCK
  allocation/unknown/commit guard/timeout classification and owned exits.
- `node --max-old-space-size=128 test/media-narration02-cache.cjs`: existing
  real cached WAV + FFprobe, inference explicitly forbidden by test.
- `node --max-old-space-size=128 test/media-narration02-integrity.cjs`: saved
  source/locks/revisions, OCR provenance, subtitles OFF, stale-root export blocked.
- `node --max-old-space-size=128 test/media-narration02.cjs`: MOCK runtime,
  static preflight, emergency guard, text/voice/speed/dictionary cache regression.
- Production preservation: **933/933 unchanged, zero changed, zero unreadable**;
  baseline hash `e19574bf84fc07c88a165aa3958f50e579a93c289b6aeef2c0664c1f35a6c1e7`.
- `git diff --check`.

Frontend/renderer are unchanged; full Jest/browser/MP4 acceptance were NOT RUN
in this preflight. Long TTS and new MP4 remain **NOT RUN / WAITING APPROVAL**.
