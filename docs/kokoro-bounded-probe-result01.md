# LOCAL_BOUNDED_PROBE 01 — one approved real attempt

**PASS for this short real TTS probe and valid WAV. Not a general RAM benchmark,
full-image narration acceptance, MP4 acceptance or publication approval.**

Implementation: `a6591ea`, branch `codex/kokoro-bounded-probe`. The user explicitly
approved exactly one attempt. No second model run, render, crawler, paid API,
Windows/pagefile configuration change or external-process termination occurred.

## Scope and outcome

- Input: “Chúng tôi không cần phải xem CV quá kỹ đâu.” (43 characters).
- Mỹ Yến / `my_yen`, 1.3x; CPU; Python 3.14.6, Kokoro-Vietnamese 0.1.0;
  existing model and voicepack.
- One sentence, one cold Kokoro worker, PID 18984. All 261 worker samples have that
  PID. Cache hit false, base cache hit false, synthesisPerformed true. This is not
  a synthetic fixture or cached speech presented as a new generation.
- Guard floors unchanged: physical available 256 MiB, commit reserve 512 MiB.
  Worker deadline 90 seconds; controller total deadline 120 seconds.
- No error, guard stop, allocation failure or timeout was recorded. Normal owned
  worker exit was confirmed; the process is absent and its lease was released.
  Windows event logs were not inspected: no Windows OOM claim is made.
- Execution consent remains distinct from editorial/audio approval. Output is
  `DRAFT_PROBE_NOT_SCENE_AUDIO`; no asset was attached to the full source scene.

## Timing

| Phase | Measured |
| --- | ---: |
| Framework/runtime imports | 10.754 s |
| Model construction/loading, after imports | 47.575 s |
| Synthesis stage (G2P + inference) | 6.866 s |
| Whole worker synthesis call | 65.210 s |
| Controller through owned-worker close | 80.367 s |
| Attempt start through final report write | 81.877 s |

Stage snapshots, not UI initialization metrics, supply these timings. Inference
and complete cold synthesis both stayed within 90 seconds; the whole reported
attempt stayed within 120 seconds. Post-probe WAV verification did not run TTS.

## Memory and system pressure

The first manual check saw 488.54 MiB free. Memory changed before model startup:
the immediate pre-run observer saw 728.44 MiB and the worker-before-import sample
saw 742.43 MiB. **This does not prove a cold start at 489 MiB.**

| Phase | Worker RSS MiB | Worker private MiB | Available system RAM MiB |
| --- | ---: | ---: | ---: |
| Before runtime imports | 20.43 | 13.88 | 742.43 |
| Before model construction | 174.15 | 188.60 | 622.68 |
| Model loaded | 726.32 | 1,066.20 | 331.01 |
| Inference finished | 453.67 | 859.98 | 826.31 |
| After confirmed worker exit | null | null | 1,214.78 |

- Minimum sampled available RAM: **277.61 MiB**, only 21.61 MiB above the guard.
- Native lifetime peak working set/RSS: **755.19 MiB**.
- Maximum sampled private bytes: **1,111.98 MiB**. This is sampled, not an exact
  instantaneous peak. Native peak commit counter: **1,144.05 MiB**.
- System commit before: 18,143.48 / 28,593.83 MiB. Peak observed used:
  19,206.05 MiB. After: 18,089.12 MiB. Minimum sampled commit reserve:
  9,387.78 MiB, well above the 512-MiB guard.
- Pagefile current usage C/D before: 865 / 1,025 MiB; after: 1,095 / 1,313 MiB.
  Total increased 1,890 → 2,408 MiB (+518 MiB). Allocations remained 6,107 and
  16,657 MiB. These are system totals, not a per-worker paging attribution.

Worker/system sampling interval was 250 ms. Global deltas also include other apps.
Page-fault counters include soft faults; no disk-paging rate was benchmarked.
RSS/private memory are different quantities; peak commit is not labelled as an
exact private-resident peak. The after-close observer's own RSS is not Kokoro RSS.

## WAV and verification

- New PCM WAV: `pcm_s16le`, 24,000 Hz, mono; **127,904 bytes**.
- FFprobe duration: **2.663042 seconds**; manifest rounds to **2,663 ms**.
- Peak volume -1.4 dB; mean volume -15.9 dB. Audio is not silent.
- Input hash matches approved text:
  `a9f1c57597611f450c6234f7ca335f91efc758131f3d7e4292ad6f31ebe28d2e`.
- WAV SHA-256:
  `b7a2f83e61645e612ae24f1b15fe9ea4f61ac2282a1e35b713d8d1f22edc54f1`.
- The initial verification used strict equality between decimal seconds and
  rounded manifest milliseconds and rejected a 0.042-ms rounding difference.
  Rechecking with the contract's nearest-millisecond comparison passed. No audio
  was regenerated. Human listening/pronunciation approval remains separate.

Artifacts remain outside Git in sibling
`Tiktok_Automation_e2e01/run-local-bounded-probe01`: approval, durable attempt,
before/checkpoint/report/verification JSON, logs and the WAV under backend/.studio-data.
No audio, model, approval record, credential or raw process dump is committed.

## Preservation and next decision

Production baseline: 933 unchanged, 0 changed, 0 unreadable; baseline SHA-256
`e19574bf84fc07c88a165aa3958f50e579a93c289b6aeef2c0664c1f35a6c1e7`.
The source session hash still matches the approved plan. Raw/original/OCR/locks,
revisions, cached scene audio and source metadata were not changed.

The result supports removing the unsupported 1,536-MiB absolute prohibition.
It does **not** establish a new minimum or show that the full 591-character image
narration is safe: that input has longer sentences and different activation costs.
Keep warnings separate from emergency stops, retain the current guard floors,
prefer additional headroom, and require separate authorization for a longer trial.
No operating threshold was automatically lowered, and no second trial is scheduled.
