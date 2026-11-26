# Production Performance 03

## Chromium investigation

The benchmark uses the saved IELTS revision 14 snapshot and its three
measured WAVs. The previously successful V2 used the same browser executable
path, but a different timeline and substantially different resource samples.
There is no saved V2 Chromium trace or GPU configuration to compare directly.

One minimal 12-frame run captured eight DevTools screenshot commands and a
Chromium trace. The commands took 181–1,114 ms each and returned the same
7,580-byte base64 payload. The renderer's surrounding screenshot task added
roughly 3–8 ms per command, including client decode and file output. The
trace recorded 33 draw-and-swap tasks totaling about 21 ms and 35 paint
lifecycle tasks totaling about 7 ms. The GPU copy-output tasks totaled about
275 ms, with one 220 ms outlier. These are summed trace events and may
overlap. They leave much of the command latency unaccounted for.

The trace contains a Chromium GPU process. This does not establish that
hardware acceleration ran on a specific adapter. Host samples during the short benchmarks
recorded 20–34% CPU, 22–147 page reads/s, and disk queue length below 0.2.
The experiment does not attribute the rest of the wait to paging, OS
scheduling or browser-side image readback/serialization individually. No
browser security flags were changed.

## Sparse capture design

The planner and ThreadsVisual share the same card layout, pagination and
visibility calculations. Each contiguous visible page produces one
transparent PNG from the existing composition. FFmpeg composites those PNGs
over the existing frame-normalized gameplay slice. The audio-only pass uses
Remotion's original inputs and sequences, collects audio without taking
screenshots and uses Remotion's PCM mixer. The existing AAC mux and output
validation handle the resulting streams.

The supported subset has one muted, full-timeline gameplay track, with
source trim and optional loop, and non-overlapping static Threads cards.
Static local JPEG or PNG attachments and avatars can qualify after a media
probe. The standard renderer handles PAN, GIF/other unverified image formats,
meme animation, subtitles, commentary, multi-track or partial background
coverage, offsets, scene background overrides, and other unsupported shapes.

## Matched saved-session segments

| Segment | Standard worker wall | Sparse worker wall | Speedup | Sparse captures |
| --- | ---: | ---: | ---: | ---: |
| Frames 770–829 | 133.731 s | 27.173 s | 4.92× | 2 |
| Frames 1582–1605 | 59.428 s | 31.190 s | 1.91× | 2 |
| Combined | 193.159 s | 58.363 s | 3.31× | 4 |

The first standard leg incurred 3.689 s bundle initialization. Subtracting
that cost gives 4.79× for the first pair and 3.25× for both pairs. The other
three jobs reused the bundle. In the 60-frame pair, media processing was
109.869 s standard and 6.263 s sparse, including video/audio encoding
after preparation. Sparse captured cards in 2.648 s, collected audio in
1.676 s, mixed in 0.474 s and composited/encoded in 1.463 s.
GOP preparation took 15.399 s standard and 15.987 s sparse; final AAC
muxing took 0.536 s and 0.357 s. It remains a fixed cost on a short range.
Sampled peak process-tree working set in this pair was 1,084 vs. 687 MiB;
minimum sampled physical headroom was 546 vs. 991 MiB. Samples reflect the
host at each run, and process-tree CPU deltas are only estimates.

Both pairs decoded fully with the expected 720×1280 H.264/AAC streams,
30 FPS and exact frame counts. The decoded PCM mix and decoded AAC audio
hashes matched in each pair, covering audio in and out points near both
scene transitions. Gameplay corner crops showed 60/60 and 24/24 distinct
frames. Full-frame average SSIM was 0.947 and 0.957, with luma SSIM near
0.977 in both segments. Gameplay corner average SSIM was 0.983 and 0.978.
The wider card crop averaged 0.897 and 0.926 including color differences;
card-region luma SSIM was 0.974 and 0.976. Contact sheets show the same text,
card geometry, avatar presentation and transition frames. Output retains
ordinary compression and color-conversion differences.

A separate 26-frame fixture used a two-page card with a local static
attachment. Page change, the source loop at frame 400, and card hiding at
405 fell inside the compared segment. It completed in 50.855 s standard /
10.464 s sparse (4.86×). Audio hashes matched and both outputs had 26/26
distinct gameplay crop frames. Full-frame average SSIM was 0.973. The
contact sheets show the attachment on both pages, the wrap to the correct
gameplay position, and the card-free frame.

The worker uses the sparse path in AUTO for eligible 720p/30 DRAFT
snapshots. It checks local still-image formats and the exact normalized
gameplay frame count before choosing the path. The manifest and
Production Run Report record the strategy and reason. The runtime
administrator can force the existing renderer with
`STUDIO_RENDER_STRATEGY=STANDARD_REMOTION`. Neither path automatically
retries a failed render with the other strategy.

## Full IELTS acceptance

The isolated Operator run applied `visual_defaults`, prepared revision 16
and passed preflight using the existing three measured WAVs. Render job
`a2514fa5-9449-4e75-ab12-ac08244edfd5` produced a 61.500 s DRAFT with
1,845 frames at 720×1280/30 FPS, H.264 and AAC. The authenticated download
matched SHA-256
`3a5a53d534ea1c4b20295c5fee0e8f79a5fc6be547a38d6d99b988c8c7795dcc`.

| Full render stage | Time |
| --- | ---: |
| Gameplay GOP preparation | 32.392 s |
| Bundle lookup / browser initialization | 0.003 s / 0.998 s |
| Three transparent captures | 2.963 s |
| Audio collection / PCM mix | 31.331 s / 1.793 s |
| FFmpeg compositing and video encoding | 25.893 s |
| AAC encoding and MP4 muxing | 4.176 s |
| Worker wall time / Operator execution | 110.975 s / 112.679 s |

The worker wall time corresponds to 16.62 output frames/s. Eleven
resource samples recorded peak tree working set 853 MiB and minimum free
physical RAM 940 MiB. The video and audio both start at zero and run
61.500 s. Full decode and all 1,845 presentation timestamp steps passed.
The gameplay crop had 1,845 different frames. The nine-frame contact
sheet covers frames 0, 400, 795, 796, 1100, 1593, 1594, 1750 and 1844,
including both exact card changes. The original gameplay begins near-black
and fades in over its first fraction of a second; the first card remains
visible through that source fade. FFmpeg measured the final audio at
-18.2 dB mean and -3.0 dB peak. The two matched scene transition samples
and the loop/visibility fixture establish audio equivalence to the prior
path at those boundaries. The full artifact is machine validated.

Targeted Jest passed 46 tests in six suites. Nest build, frontend
TypeScript and Studio bundle passed. The Production Run Report returned
the saved `SPARSE_STATIC` decision for the acceptance job. All eight
preservation hashes matched for the original revision 14 session, WAVs
and failed render evidence. The loopback Operator runtime was restarted
using its existing data root. Authenticated API acceptance used the
isolated copy.

## Operator handoff

Read the current revision, apply `visual_defaults` with `gameplay: PRESET`,
then call `prepare` using the returned revision. Check render preflight
and call `render` using the prepared revision and a new request ID. The
job response exposes the DRAFT artifact; the project report includes the
render strategy and reason. All three existing measured WAVs are reusable.

The selected root is `coreofp` (`DQ4AzKbiM3H`). The saved observation
reports a default avatar and the local root cache is unavailable. The
selected replies `ivandre00486` (`DVjJWVeiVbD`) and `giza.ta`
(`DQ4scjikuQd`) report the same JPEG SHA-256. The cached file matches
that hash. This validates the cache bytes, with author ownership of the
shared photo unresolved. The workflow preserves the saved presentation and
keeps human acceptance pending.
