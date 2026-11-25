# Production render performance investigation

Operator session `16479635-7db3-4a4b-87c5-7563395ba4ec`, revision 14.
The original session, measured WAVs and cancelled job were preserved. The
benchmark uses copied inputs and a loopback asset server with one render worker.

| Run | Frames | Remotion renderMedia | Worker wall time | Bundle cache | GOP event |
| --- | ---: | ---: | ---: | --- | --- |
| V1 `1b35b404` | 2,683 | 499.024 s | 553.327 s | Hit | 1 |
| V2 `cb2c203d` | 2,518 | 445.529 s | 485.694 s | Hit | 1 |
| V3 `ab09d2b1` | 1,757 of 1,845 | Interrupted during frame rendering | 2,682.656 s | Hit | 0 |

The V3 StudioJobs execution clock was 2,702.673 s. The worker clock starts
inside the child, after launch. V1/V2 used a video track with the locally
available `backgrounds/source_3.mp4` (current SHA-256
`bc36d4d599b30d12e63c82abd3258efb48843694ab11d489da330439bee58df8`,
case-insensitive). Historical snapshots do not contain a media content hash,
so the matching asset ID and path establish identity, without proving that
its file bytes never changed.

The V3 snapshot has no background tracks, no video media entries and no
scene background ID. `SAVED` was honored. None of its 1,740 persisted events
is a GOP-normalization event. The historical V1/V2 snapshots use the same
Chrome path but different timelines, assets and visuals. The GOP loop was
correctly skipped for V3, so these historical runs cannot isolate a GOP regression.
The current local registry contains numbered `source_*.mp4` background names,
which do not match the automatic gameplay preset's name filter. No gameplay
was added to the original project as part of this task.

V3 minimum recorded physical and virtual availability was about 312 and 524
MiB. V2 recorded about 634 and 5,912 MiB. Process-tree CPU deltas were
about 231 seconds over 2,673 sampled wall seconds for V3, versus 403 over
481 seconds for V2. These samples associate V3 with long waits. They do not
isolate contention, paging or a Chromium stall. The historical worker did
not capture hard faults or paging counters.

The session reports the root's observed placeholder as DEFAULT_AVATAR.
Its independent historical editorial session has a cached custom image.
The two selected replies currently have cache records with the same image
SHA. Their records do not establish that the image is a Threads default
or belongs to a different account. The original session's avatar records,
selection and approval fields were retained. V1.1 already separates
`DQ5e3XWkqIO` eligibility from heuristic recommendation. None of these
observations is evidence of human approval.

The project report joins 16 session-scoped attempts and one linked catalog
attempt. It reports 14 successes, two failures and one cancellation.
2,927,257 ms is the sum of observed stage execution and 16,994,848 ms is
the elapsed span across those attempts, including idle time between stages.
Retry time counts explicit retry attempts for the same stage input.

The cancelled job's frame history showed about 0.62 FPS through the first
scene, 0.67 through the second and 0.81 through the available part of the
third. No scene segment approached the throughput target.

The 45-minute render budget is unchanged. During frame rendering, two
minutes without advancing the frame count triggers RENDER_STALLED even if
the server and worker continue sending samples. An active job exposes
rendered and total frames, throughput, latest worker and frame timestamps,
budget, estimated time remaining and its latest resource sample. The
backend keeps live progress in memory, uses its existing heartbeat for
Operator checkpoints, and persists stage changes plus progress checkpoints
at a coarser cadence. Failed manifests and jobs retain the terminal
classification and measured partial progress.

## Equivalent short benchmark

Both runs used frames 0–149 of the same V3 snapshot. Props SHA-256 was
`9aed8d5947cd976102f2c3705a6823282242f95b9a5e6551378c1b75329bbc23`.
The bundle was cold during the first setup and reused during the second.
Frame timing is the relevant comparison, separate from bundle setup.

| Metric | Before | After |
| --- | ---: | ---: |
| Persisted job events | 160 | 23 |
| Bundle initialization | 18.431 s | 0.002 s |
| Browser initialization | 1.345 s | 0.914 s |
| Frame rendering | 214.698 s | 227.809 s |
| renderMedia throughput | 0.693 FPS | 0.655 FPS |
| Background tracks normalized | 0 | 0 |
| Remotion encoding | 1.628 s | 1.121 s |
| Final AAC muxing | 0.676 s | 0.599 s |
| Worker wall time | 240.606 s | 233.993 s |
| Minimum free physical RAM | 568 MiB | 650 MiB |
| Minimum free virtual memory | 6,538 MiB | 6,900 MiB |
| Peak sampled process-tree working set | 1,018 MiB | 902 MiB |
| Sampled process-tree CPU delta | 31.30 s | 24.55 s |

Both benchmark videos decoded and probed as 720×1280, 30 FPS, 150 frames,
H.264/AAC and 5.000 seconds. Decoded audio hashes matched. Video hashes
differed, with SSIM 0.999997 across the 150 frames. This is a short
equivalence check for the saved V3 configuration, which has BGM but no
gameplay. The event reduction did not recover frame throughput. The frame
stage dominates even with substantially more available virtual memory
than during the timeout. Unique paging or Chromium causes remain unproven.
The 3–5 FPS threshold was not met, so a full acceptance render was not run.

Targeted regression covered render telemetry, Operator Harness and Product
Pipeline. 28 tests and the backend build passed. The original session,
three retained narration assets, manifest, snapshot, log and failed job
matched their saved SHA-256 after the benchmarks.
