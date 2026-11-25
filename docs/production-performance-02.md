# Production Performance 02

**Result: gameplay preset restored. Render throughput remains below target.**

The local asset registry recognizes three reviewed Minecraft background clips
(`backgrounds/source_3.mp4`, `source_4.mp4` and `source_8.mp4`). The preset
probes candidates or the administrator's ordered asset list. It preserves
existing editor settings and reports `GAMEPLAY_ASSET_UNAVAILABLE` when a
requested preset has no usable clip. The automatic track covers the measured
timeline and loops when the source range is shorter.

## Matched benchmark

Both runs use the saved revision 14 snapshot, frames 0–59, 720×1280 at 30 FPS,
concurrency 1, and the same installed Chromium, composition, card, avatar,
voice and BGM. They used the same warm bundle. B adds the previously used
`source_3.mp4` with a 5–95 s source range and the existing GOP path.

| Metric | A, no gameplay | B, gameplay |
| --- | ---: | ---: |
| Job ID | `0493da62-6545-4e88-9aa8-5ffe333f563d` | `16e85176-7689-4020-b1b8-19d6c5632b6c` |
| Frame rendering | 82.355 s | 105.190 s |
| Frame-only throughput | 0.729 FPS | 0.570 FPS |
| Throughput over renderMedia | 0.722 FPS | 0.565 FPS |
| GOP preprocessing | 0 | 15.256 s |
| Bundle cache lookup | 2 ms | 2 ms |
| Browser initialization | 0.713 s | 0.857 s |
| Remotion encoding | 0.620 s | 0.890 s |
| Final audio encode/mux | 0.282 s | 0.377 s |
| Worker wall time | 86.629 s | 125.671 s |
| Minimum sampled free physical RAM | ~734 MiB | ~662 MiB |
| Peak sampled worker tree working set | ~934 MiB | ~1,085 MiB |

An initial unmatched B timed out at 58/60 frames with a cache miss and a
shorter benchmark budget. The matched runs completed. Restoring gameplay did
not recover V2 throughput. V2's historical 5.65 FPS was measured on a
different snapshot and is a reference only.

## Capture probes

Each probe uses 12 frames of the same composition on the warm bundle. Fixture
instrumentation times Remotion's screenshot, seek/readiness and asset collection
calls. It ran in the benchmark worker only.

| Probe | FPS over renderMedia | Mean screenshot task |
| --- | ---: | ---: |
| Minimal composition | 1.086 | 826 ms |
| Root card without avatar | 0.852 | 1,092 ms |
| Root card with default avatar fallback | 0.750 | 1,250 ms |
| Reply card without avatar (start frame 800) | 0.748 | 1,252 ms |
| Reply card with local avatar (start frame 800) | 0.740 | 1,263 ms |
| Gameplay only | 0.620 | 1,360 ms |
| BGM only | 1.183 | 757 ms |

The minimal probe averaged 33 ms for seek/readiness and 1.5 ms for asset
collection. Its screenshot task alone consumed about 90% of renderMedia wall
time without card, media or HTTP requests. The gameplay-only probe averaged
181 ms for seek/readiness and 2.4 ms for asset collection. In the matched runs,
A had three local requests and B had five. B's long range request belonged to
the GOP setup. Host samples showed paging activity. They do not identify a
GPU, driver or OS cause. The timing measures the capture call and does not
separate Chromium compositor work from transfer or OS scheduling.

Changing only the existing Remotion screenshot surface switch in the fixture
lowered the mean screenshot time from 1,314 to 244 ms and raised the 12-frame
no-gameplay run from 0.703 to 2.999 FPS. The 60-frame
gameplay run reached 2.643 FPS (2.764 frame-only), but its output was black
and white with no card or motion. The switch was rejected and is absent from
the runtime configuration. The next useful comparison is a bounded Chromium
compositor trace on the same frames, with decoded-frame comparison as a
required check before accepting a capture mode change.

## Output and recovery

A, B and the rejected capture test each produced a decodable 2.000 s MP4
with 720×1280 H.264, AAC and 60 frames at 30 FPS. A and B produced identical
decoded audio hashes. The background crop had 60 distinct frames in B and
one in the rejected test. The B contact sheet shows the original root card,
no external subtitles and moving gameplay. The root reports a default avatar
and two reply records share an avatar hash. This run did not resolve either
identity discrepancy or change the session's selected content. It did not
establish human acceptance, whole-video cadence or end-to-end production PASS.

On the preserved session, query its current revision and use
`visual_defaults` (optionally `gameplay: PRESET`), then `prepare` using
the returned revision. Inspect the persisted background track and preflight
before submitting another render. Do not repeat the full benchmark until a
short segment reaches the target with valid frame content.

On the isolated revision 14 copy, the Harness applied the preset and prepared
revision 16 with 1,845 frames, the existing BGM, gameplay spanning 61,500 ms
and all three current WAV references unchanged. Targeted Jest passed 44 tests
in five suites. The Nest build, frontend TypeScript and Studio bundle passed.
The original session, WAVs and failed render evidence passed all eight hash
checks. The restarted loopback Operator runtime rejected an unauthenticated
request with HTTP 403. The workflow itself was verified against the isolated
copy through the Harness service.
