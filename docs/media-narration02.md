# MEDIA-NARRATION-02 — resource diagnosis and guarded continuation

Base `ed9da9e`; branch `codex/media-narration02`. **PARTIAL / E2E BLOCKED_RESOURCE.**
The user chose to continue offline and hand over the blocker if RAM remained low.
No new Kokoro inference, Threads request, model download, render or publishing ran.

## A. Resource findings

- OS-visible physical RAM: 5,829 MiB (5.69 GiB). Observed available RAM fluctuated
  roughly 225–1,064 MiB, below the conservative cold-start budget used below.
- Pagefiles: C 6,107 MiB + D 16,657 MiB allocated. A later snapshot used about
  1,304 MiB of pagefiles; system commit about 16,621 / 28,594 MiB. Physical pressure,
  not exhausted commit capacity, is the immediate constraint. No Windows/pagefile
  changes were made.
- Initially no project Node/Python worker existed and no Studio was reachable on
  3105–3110. The persistent Node PID 31440 was a Codex artifact daemon, not Studio.
  Browser processes belonged to user apps and were not stopped. Aggregate browser
  working sets were roughly 0.6–0.9 GiB; shared pages mean this is NOT a guaranteed
  amount reclaimable by closing them. Memory Compression was also substantial.
- Consequently, there was no old sandbox we could stop to recover RAM. Only the
  sandbox created by this task was gracefully reloaded after confirming zero jobs;
  no pre-existing process was terminated.
- TCP enumeration on this machine sometimes omitted a running loopback listener.
  The audit now records TCP evidence and independent sequential HTTP probes. An
  empty TCP list alone must not be called proof that a server is stopped.
- After startup, HTTP on 3110 responds as E2E01_SANDBOX, scheduler OFF; 3105–3109
  probes were unreachable. Win32_Process does not expose CWD: external-process
  CWD is explicitly null/unverified. Our launcher config uses
  `run-media-narration02/backend` and executes `process.chdir` before listen;
  this is launcher evidence, not a remote PEB inspection.

### Old failure: verified versus inferred

The immutable trace has 14 samples over 13.124 seconds: available RAM 675 → 52 MiB.
The old runner closed its owned worker below 128 MiB, producing `worker closed`.
There is **no recorded worker RSS or completed-model snapshot**, so it is not
possible to reconstruct that peak or claim Windows killed it with OOM.

The installed KModel constructor creates modules, then loads the CPU checkpoint
and copies state dictionaries. The checkpoint is 327,224,779 bytes. Simultaneous
parameters/checkpoint/framework allocations are a plausible contributor; file
size is not an exact RSS measurement. Do not modify the external installed package
or claim sentence splitting fixes cold model initialization.

## B. OCR quality

Installed Windows OCR languages remain en-GB, en-US, zh-Hans-CN; no Vietnamese
engine was available. Tesseract was not installed. A local alternative is the
[Tesseract engine](https://tesseract-ocr.github.io/tessdoc/Installation.html) with
[`vie` trained data](https://tesseract-ocr.github.io/tessdoc/Data-Files), optionally
`tessdata_fast`. Engine/license support is documented; Vietnamese quality and RAM
on this laptop are **NOT MEASURED**. No new OCR runtime/model was installed.

The actual cached 1080×344 image was visually inspected again. Existing en-US raw
OCR was compared with the saved AGENT_VISUAL correction, body only with normalized
quotes/whitespace: CER 25.75%, WER 88.24% (536 reference characters). This one-image
comparison is accent-sensitive and uses an agent reference, **not human ground
truth or a benchmark accuracy claim**. Confidence stays null. Raw OCR, corrected
text and their hashes are unchanged; AGENT_VISUAL is not user/publication approval.

The first new audit file had invalid character statistics because a diagnostic
Python subprocess decoded UTF-8 stdin using its Windows default. That audit is
superseded. The audit now forces UTF-8 and asserts Python/Node code-point counts
match; it did not change the existing TTS transport, which already used UTF-8.

## C. Changes to the existing TTS pipeline

No second worker/engine, chunker, normalization dictionary or audio cache was built.
Installed Kokoro already calls `split_text`, synthesizes sequentially under
`torch.no_grad`, then merges with its existing crossfade. AST-only inspection of
the actual normalized inputs (no Torch import) found:

| Input | Characters | Existing sentence chunks | Longest chunk |
| --- | ---: | ---: | ---: |
| Root body + corrected image | 591 | 6 | 195 characters |
| Selected comment 1 | 57 | 1 | 57 characters |
| Selected comment 2 | 96 | 1 | 96 characters |

Character counts are not phoneme counts or measured duration. Further splitting
was not justified by these inputs and would not reduce model-loading memory.

Implemented in the existing runtime:

- Native Windows own-process RSS/private memory, peak working set, available RAM
  and system commit, with no psutil dependency or process enumeration.
- Bounded 250-ms sampling, model-before/model-after snapshots on successful load,
  input length and sentence statistics. No text, credentials or filesystem paths
  are included in telemetry. Successful asset manifests retain metrics. Failed
  Voice jobs retain input hash/length and at most 16 current-attempt samples;
  old-attempt samples are excluded. Copy Voice Report uses the same job data.
- Cold-start 1,536 MiB, warm-start 384 MiB, safety stop below 256 MiB. These are
  conservative **operational guards, not measured minimum RAM or a process RAM
  cap**. Native and Node monitors stop only the owned worker. Heavy preflight
  imports require 768 MiB; below that, static inspection explicitly reports
  BLOCKED_RESOURCE without pretending imports/model inference were verified.
- Resource-only blocking does not prohibit matching cached WAV/base reuse.
  Cache miss is blocked before synthesis. Text/voice/speed/dictionary/model keys,
  FFmpeg atempo and real FFprobe duration validation remain unchanged.
- Child errors immediately release the owned worker instead of retaining a failed
  model until idle timeout. Python bytecode is ignored by Git, not deleted.

**Full-model RSS before/after and inference latency remain NOT MEASURED.** The
native helper's approximately 16-MiB probe RSS is Python-only, not Kokoro RSS.

## D. Acceptance and preservation

A new sandbox was cloned from MEDIA-NARRATION-01, without credentials or OAuth
vault. Root, image and two context items remain selected, Mỹ Yến 1.3x, subtitles
OFF. Root image aspect/dimensions, raw/original/display, locks, revisions, OCR and
provenance match the source copy. Context evidence is not promoted to parent proof.

Two EXISTING DRAFT comment WAV durations were rechecked: 3,263 and 4,861 ms.
Resource-blocked cache reuse of the 3,263-ms WAV passed actual FFprobe/volume
validation without starting a model. These are not new image-narration audio.
The root's new spoken text has no matching generated audio; render correctly
blocks that stale/missing asset. No new MP4 exists. Playback/seek/download of a
new image-narration MP4 are **NOT RUN**, not PASS.

| Verification | Result |
| --- | --- |
| Final backend build/TypeScript | PASS, exit 0 |
| Python AST + native own-process measurement | PASS; no Torch import |
| `media-narration02.cjs` test | PASS; MOCK protocol/guards, real static inspect/native probe |
| `media-narration02-cache.cjs` test | PASS; existing real WAV + FFprobe, zero new synthesis |
| `media-narration02-job.cjs` test | PASS; MOCK failed job persistence, real service cache reuse |
| `media-narration02-integrity.cjs` test | PASS; source/layout/locks and missing-audio gate |
| VID-QUALITY-02 / pronunciation regressions | PASS, exit 0 |
| Frontend typecheck, new browser smoke/full Jest | NOT_RUN_RESOURCE_BLOCKED; no frontend changes |
| New TTS / new MP4 | NOT_RUN / BLOCKED_RESOURCE |
| Local Studio API and bundle HTTP response | PASS; no job created by opening/reading |

A transient test invoked before build finished could not find dist; rerun after
build passed. A new Array.at call was replaced for the existing TS library target;
the final build passed without relaxing checking or changing compiler libraries.

Production: 933 baseline files unchanged, 0 changed, 0 unreadable. Baseline hash:
`e19574bf84fc07c88a165aa3958f50e579a93c289b6aeef2c0664c1f35a6c1e7`.
MEDIA-NARRATION-01 session, OCR proof and failure trace hashes also remain unchanged.

## Artifacts and continuation

Runtime files stay outside Git in sibling `Tiktok_Automation_e2e01/run-media-narration02`:
config, copied session/audio/image, timestamped audit/test JSON and preservation JSON.
Use the latest audit with HTTP probes and 591 root input characters; the earlier
802-character audit is invalid/superseded, retained for traceability.

From `1_nest_backend`, `$run` is that directory:

```powershell
node scripts/e2e01-runtime.cjs $run
node scripts/media-narration02.cjs $run audit
# Only after independently checking sufficient headroom:
node scripts/e2e01-smoke.cjs $run tts
node scripts/e2e01-smoke.cjs $run preview
```

Open the config's session ID on port 3110 at `area=Video%20Studio&step=Script`.
Stop only the terminal/server you launched with Ctrl+C; do not kill an old PID
without verifying its identity. Init refuses an existing directory.

Next acceptance: free physical RAM, remeasure, one sequential root/image DRAFT
synthesis (reuse two valid comment assets), measured duration → existing timeline
→ one 720×1280 concurrency-1 DRAFT render. Inspect image frames, no subtitles,
spoken image text, AAC timing, playback/seek/download. If resource guard trips,
preserve its diagnostics and stop. Do not retry automatically or label this
checkpoint E2E PASS. Rights/production approval/publishing remain unchanged.
