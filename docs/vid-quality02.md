# VID-QUALITY-02 — verified DRAFT video, remaining partial items

Date 2026-11-08 Asia/Saigon. Base a8f33ca; branch codex/vid-quality-02.
All changes use an external copy of E2E01; original LIVE02/E2E01 sessions and
production are not overwritten. No crawler, publishing, paid API or model download.

## P0 results

| Item | Result / evidence |
|---|---|
| Threads card and source metadata | PASS, retained original display/raw and engagement null semantics |
| Attachment width/aspect | PASS MP4 and browser: usable image area ~91% of card width, native1080x344 ratio, FULL has no crop |
| Whole image / zoom-pan | FULL PASS MP4; PAN2x PASS interactive preview/save/reopen, not separately exported |
| Avatar | PARTIAL: all three saved URLs are generic rsrc.php resources, not verified personal avatars; no new profile crawl; explicit ? fallback, no invented avatar |
| Default subtitle off | PASS MP4, all three scene subtitle arrays empty; independent Inspector opt-in tested offline |
| Kokoro / speed | PASS actual generated DRAFT audio and measured variants1.2/1.3/1.4; speed1.3 stored for this sandbox's voice/project/scenes |
| Perceptual default recommendation | PARTIAL:1.3 is a proposed project setting; global1.2 default retained pending user listening review |

ThreadsVisual previously used a180px attachment box, shrinking a landscape image
again with contain. The adapter now carries cached intrinsic image dimensions;
layout budget and renderer use the same aspect-derived height. At a240px preview
the card measured200px wide and image181.78x58.04px. At720 export this corresponds
to ~545px usable image width. The previous180px box constrained the native image
to about377px at720 export. Before/after decoded frames remain in separate runs.
FULL preserves every image pixel; PAN deliberately crops only inside its bounded
image viewport. Inspector provides image mode/zoom/end-pan X/Y controls. No OCR
or interpretation of screenshot contents was performed.

E2E01 had added scene captions unconditionally. They now require
visual.subtitlesEnabled===true. Existing composition/timeline/subtitle contracts
are reused, with no karaoke/forced alignment added.

Speed sample root narration (same cached base):1.2=2609ms,1.3=2404ms,1.4=2236ms.
The1.2/1.4 variants reused base cache without Kokoro inference. All3 scenes at1.3
were FFprobe measured:2404/3263/4861ms. Timeline recalculated to362frames at30fps,
12.066667s. No duration/frames override. DRAFT assets remain unapproved.

## P1 normalization and license audit

Primary sources checked before reuse:

- ViLexNorm corpus README: CC BY-NC-SA4.0, research usage described.
  https://github.com/ngxtnhi/ViLexNorm/blob/main/README.md
- ViSoLex code LICENSE: MIT. Dataset/model rights require separate checking,
  especially derived ViLexNorm resources.
  https://github.com/HaDung2002/visolex/blob/main/LICENSE
- Soe Vinorm code LICENSE: MIT.
  https://github.com/vinhdq842/soe-vinorm/blob/main/LICENSE

No external corpus, code or model was imported. New independently authored
vi-social-speech/1 dictionary handles a small conservative set of abbreviations,
teencode/place/acronym readings. It does not expand a school acronym into an
invented school identity. Lowercase neu and t/đcđ/clm/cmn/đc/k remain review cases.
Script now accepts per-item JSON pronunciation overrides, persisted independently
of raw/display/original. Only TTS input is projected; normalization version and
input hash participate in cache keys. Override save invalidates only matching
changed audio; regression verifies revision and original/display/lock preservation.
Voice and FINAL validation share ambiguity reporting and respect explicit overrides.

AI fallback remains PARTIAL/NOT_IMPLEMENTED for this dictionary path: no paid
provider, new cost budget or new AI execution is claimed. Existing manual HF
proposal path is not used; historical billing blocker remains. Deterministic
projection has a bounded100-entry cache. Unknown cases stay for manual review.
Dictionary breadth is intentionally small; it is not complete Vietnamese semantic
normalization.1.3 pronunciation of acronyms/slang needs human listening acceptance.

## P1 background / music audit

Existing shared code already supports image/video backgrounds, global source
in/out/loop tracks, card LIGHT/DARK, separate BGM gain/timing and per-scene mute.
Legacy EconomicBackground/GridBackground and serious compositions were inspected
in Git history (including328aa6a) and preserved, not reactivated or rebuilt.
New: validated canvas HEX color in Inspector and optional deterministic BGM duck
volume over actual active voice windows (including trims/offsets). Ducking boundary
tests PASS; fade envelopes are not implemented. No BGM asset was attached because
existing external music rights are UNKNOWN. Thus actual BGM mix/rights acceptance
remains PARTIAL; no copyrighted/unknown music was added to the smoke.

## Actual MP4 and verification

Sandbox: D:\LCOM108_NMLT\code\100_bai_code\Tiktok_Automation_e2e01\run-vid-quality02
Session2c6694bd-8d12-494b-bc47-ff3353d28977; render77d07fbb-a105-45ed-8f71-654b129ba2bc.
MP4 under backend/.studio-data/renders/<session>/<render>/video.mp4.

H.264/AAC,yuv420p,720x1280,30fps,362frames,424963bytes. Video/container12.066667s,
audio12.066000s. Decoded frames inspected: source image bigger and complete, no
subtitle, ? avatar fallback, original author/topic/date/body/engagement retained.
Browser played MP4 unmuted without media errors, sought3 scenes and downloaded
exact424963bytes; reload preserved COMPLETED output.
Decoded AAC vs each source WAV: correlation0.9999976/0.9999845/0.9999954,
lags0/-0.333/0ms. This establishes technical mix timing, not subjective speech quality.

Renderer worker55.234s:bundle10.714s,browser1.158s,renderMedia38.808s,mux0.652s.
Average9.33fps,concurrency1. Sampled render free RAM min557.7MiB; sampled process
tree max~777.8MiB RSS. TTS sampled free RAM min365MiB; one worker, then closed.
No system/pagefile changes or unrelated process termination.

Tests: backend build/TypeScript PASS; frontend TypeScript/Studio bundle PASS;
actual Remotion render bundle PASS. Plain offline regression runners
vid-quality02,vid-pronunciation,e2e01-contract,restore01,source-quality01 PASS.
Local browser MP4 playback/seek/download and layout FULL/PAN/save/reopen PASS.
Full Jest NOT RUN due memory budget; synthetic/offline tests are not LIVE audio
or BGM evidence. Production baseline933files:0changed,0unreadable.

Artifacts:verification.json,audio-diagnostics.json,tts-memory.json,preview.json,
decoded-frames/frame-42.png,browser/*,layout-proof/{full-image.png,zoom-pan.png,
measurements.json}. Before:run-20261107-01/decoded-frames/frame-53.png.
No media/audio/model/runtime config included in Git.

Studio: http://127.0.0.1:3109/studio?session=2c6694bd-8d12-494b-bc47-ff3353d28977&area=Video%20Studio&step=Render

Restart from feature worktree backend:

```powershell
node --max-old-space-size=256 scripts/e2e01-runtime.cjs "D:\LCOM108_NMLT\code\100_bai_code\Tiktok_Automation_e2e01\run-vid-quality02"
```

Ctrl+C in its owning terminal stops it. Previous3108/E2E01 remains available.
LIVE collection, approvals and publishing remain disabled; explicit local DRAFT
voice/render operations are available for the sandbox. Production readiness and
commercial media clearance are not claimed.
