# SOURCE-QUALITY-02 / MEDIA-NARRATION-01

Base: `8e33831`. Feature branch: `codex/source-quality02-media-narration01`.

## Acceptance status

**PARTIAL — no new narrated MP4 has been validated.** Code/offline and browser OCR
integration pass. The first real Kokoro attempt was safely stopped by the smoke
runner when available RAM fell to 52 MiB. Its ERROR job is preserved, not labelled
AUDIO_READY. A new MP4 reading the image remains required for end-to-end acceptance.
Do not present the previous VID-QUALITY-02 MP4 as this task's output.

## Audit and reuse

- Source quality V1 is retained as a nested snapshot. Its single keyword marker
  could recommend a card without sufficient context; media and engagement were
  absent from ranking. V2 adds bounded lexical/context/reasoning/media/engagement
  components with separate SERIOUS/FUNNY configs. These are explanatory heuristics,
  not semantic understanding, viral prediction or measured accuracy. FUNNY workers
  remain inactive. No ACCEPT, deletion, parent inference or production enqueue.
- Context extraction previously discarded all engagement. New captures only
  attribute labelled controls when their DOM container has one permalink identity.
  Missing/mixed identity or labels remain null. Compact count approximation is
  retained. This parser change has offline tests, **no new LIVE DOM validation**.
  Historical LIVE02 missing engagement is not backfilled or invented.
- Existing cached source media, `speechProjection`, pronunciation overrides,
  number pronunciation, Kokoro worker/cache, speed settings, FFprobe duration,
  timeline engine, Threads image FULL/PAN and renderer are reused. Subtitle default
  remains off. No parallel TTS implementation, model install or dependency change.

## Local OCR and editing contract

`POST /api/studio/sessions/:id/media-ocr/:itemId/:sha` supports:

- `OCR`: session revision + a DOWNLOADED image hash belonging to the item; bounded
  image bytes/pixels, SHA validation, Windows OCR subprocess, 30-second timeout.
  Existing OCR is reused. No URL fetch. Cached root images work; the same item API
  is covered by a **synthetic comment-image assignment** test, not a LIVE comment
  photo capture. New remote comment image caching is not proven by this checkpoint.
- `SAVE`: session/OCR revisions, corrected text, explicit summary, READ_FULL /
  SUMMARIZE / SKIP, confirmReview and reviewer. Raw OCR/text blocks remain separate.
- `APPLY`: explicit action appends reviewed image narration after the item's base
  body, in attachment order; existing item order keeps root before selected context.
  User-modified narration and locks are protected. A lock requires explicit
  replacement confirmation in the API; UI asks users to unlock first. Reapply is
  text-idempotent. Audio becomes stale through the existing hash/settings checks.

Windows.Media.Ocr is installed with English/Chinese, **not Vietnamese**. The actual
saved root image was recognized locally with en-US. Accent errors are substantial;
confidence is null because the API exposes none. Raw OCR starts SKIP/NEEDS_REVIEW.
READ_FULL is offered after explicit review; SUMMARIZE requires a separately edited
summary, not an invented AI summary. No automatic uncertain OCR narration.

The sandbox correction is a visual transcription marked `AGENT_VISUAL`, not user
approval. Screenshot chrome is excluded from the corrected narration, retained in
raw OCR/image. Applied text/revision/image provenance is snapshotted into the
existing StoryboardScene; later OCR edits do not retroactively change that snapshot.
Script Report Markdown/JSON includes OCR records and warns about review status.
Rights remain UNKNOWN; DRAFT generation is not commercial-use authorization.

## Studio integration

The existing Script workspace has an expandable image/OCR panel: source image,
raw ordered blocks, corrected text, mode, manual summary, explicit save/review,
apply-to-spoken, warnings and errors. Normal Script/Voice/Editor/Render operations
continue to use the same session and backend. V2 buckets/reasons/score/known likes
are shown in the existing Source list; no new dashboard or standalone app.

## Evidence

Sequential checks, exit 0 unless stated:

| Check | Result |
| --- | --- |
| Backend Nest build / TypeScript compilation | PASS |
| Frontend `tsc --noEmit` | PASS |
| Studio esbuild bundle | PASS |
| Remotion bundle (existing composition) | PASS |
| `test/media-narration01.cjs` | PASS; actual local OCR + isolated regression storage |
| `test/source-quality01.cjs` | PASS; saved LIVE02 replay, all 8 context cards retained |
| `test/vid-quality02.cjs` | PASS; dictionary/cache/speed/subtitles/timeline preservation |
| `test/vid-pronunciation.cjs` | PASS; overrides/revision/raw/display/locks/audio stale |
| `test/media-narration01-browser.cjs` | PASS; real local browser Script image/OCR/applied text/reopen |
| New real Kokoro synthesis | FAILED_RESOURCE_STOP; worker closed at 52 MiB available |
| New MP4 reading image | NOT RUN; depends on successful measured narration |
| New LIVE crawler / paid API / publishing | NOT RUN, not authorized |
| Full Jest | NOT RUN; targeted regressions above, not a full-Jest PASS claim |

Tests include a short root question, short image comment, popular empty reaction,
low-engagement analysis, missing engagement, duplicates, uncertain OCR, ordered
images, review/locks/revision conflicts, source preservation, save/reopen and audio
invalidation. Synthetic tests are labelled; quality accuracy is NOT_MEASURED.

Production baseline comparison: **933 unchanged / 0 changed / 0 unreadable**.
Baseline SHA-256:
`e19574bf84fc07c88a165aa3958f50e579a93c289b6aeef2c0664c1f35a6c1e7`.

## Local sandbox and recovery

All task runtime data lives outside Git in sibling
`Tiktok_Automation_e2e01/run-media-narration01/` (config, copied audio/media, OCR
proof, correction text, browser screenshot/proof, failed TTS memory samples).
It derives from the saved VID-QUALITY-02 copy, not production. No credentials or
OAuth vault are copied. Browser requests are restricted to loopback/data/blob.

From `1_nest_backend`, with `$run` set to that existing directory:

```powershell
node scripts/e2e01-runtime.cjs $run
# Existing Script URL: http://127.0.0.1:3110/studio?session=<config.sessionId>&area=Video%20Studio&step=Script
# Stop only this runtime with Ctrl+C in its terminal.
```

Do not rerun `init` on an existing run: it refuses overwrite. Local OCR and
AGENT_VISUAL correction/apply phases are explicitly separated. A reviewed
`corrected-image.txt` remains outside Git. No raw source content is embedded in
the reusable smoke script.

Next gate: user frees RAM; remeasure before one sequential TTS attempt. Preserve
the failed attempt's memory log. After valid DRAFT WAV/FFprobe measurement, prepare
the existing preview/timeline, then one 720p concurrency-1 DRAFT export. Verify
decoded frames, image width/aspect, no subtitles, source/audio hashes, AAC-to-WAV
timing, playback/seek and persistence before changing this report to end-to-end PASS.
