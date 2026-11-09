# Kokoro resource gate V2 and LOCAL_BOUNDED_PROBE

Supersedes the **policy**, not the historical results, of MEDIA-NARRATION-02.
Base `088a3d7`; implementation branch `codex/kokoro-bounded-probe`.

**No Kokoro benchmark has run. Awaiting a separate explicit user approval.**

## Corrected gate

1,536 MiB cold headroom and 384 MiB warm headroom are advisory warnings. Neither
is a required amount of free RAM or a benchmarked capacity limit. In particular,
512 MiB is no longer rejected just for being below 1,536 MiB. Ordinary explicit
LOCAL generation retains warnings and emergency monitoring; there is no auto-TTS
at startup. The agent must not use ordinary generation to bypass the user's
approval requirement for the proposed experiment.

Preflight performs static module/file/voicepack checks, FFmpeg/FFprobe discovery,
and reports `STATIC_ONLY` with `IMPORTS_UNVERIFIED`. READY means configuration
readiness, not successful heavy imports, loaded model or LIVE speech. Missing
dependencies/model/voicepacks remain genuine blockers. Studio shows this distinction.
Actual framework imports happen in the single speech worker, not a duplicate
Torch-importing preflight child. Cache keys, dictionary, pronunciation overrides,
voice/speed/atempo, measured duration and LOCAL/CLOUD routing are unchanged.

Emergency guards are independent: physical RAM below 256 MiB or system commit
reserve below 512 MiB stops the owned worker. These are conservative operational
floors, not a claim about the model's minimum memory. We do not lower them in this
checkpoint. No Windows/pagefile settings or external processes are changed.

## Evidence and limits

Saved E2E-01 and VID-QUALITY-02 traces contain minima of 340 and 365 MiB respectively
(first samples 579 and 694 MiB). They have no worker RSS, so minimum observed free
RAM is not necessarily cold-start free RAM. MEDIA-NARRATION-01's 52-MiB termination
was a runner guard stop, not proven Windows OOM. The prior 1,536-MiB prohibition
was unsupported by these data and has been removed.

We still cannot infer a general minimum, safe RSS cap or throughput from these
logs. Until an approved real probe supplies measurements, operating thresholds
remain provisional. After one probe, recommendations must be limited to that
machine, cold/warm state, short text, model, voice and speed; no automatic tuning.

## Bounded mode

`scripts/local-bounded-probe.cjs` uses the existing `KokoroRuntime.generate` and
the same Python Kokoro worker. It is not another TTS pipeline or cloud service.

- One cold worker, one input, maximum 160 Unicode characters. Proposed input is
  the first reviewed image sentence, 43 characters. Mỹ Yến, 1.3x, DRAFT probe.
- Model deadline 90 seconds; controller total deadline 120 seconds, followed by
  bounded owned-process exit confirmation and diagnostic collection.
- No render, crawling, scheduler or publishing. A lease blocks TTS/render/collection
  and write operations in the updated Studio while the probe runs. Startup checks
  refuse other Python/heavy project workers and unresolved queued/running jobs.
  Older worktrees and independently launched apps are not an OS-wide mutex: the
  operator must keep their heavy workflows idle. The runner never kills them.
- `attempt.json` uses exclusive creation, so refresh/double-run cannot retry the
  same plan. No recovery loop or automatic second attempt. A different plan still
  needs another explicit approval. Lease cleanup only removes the runner's own
  PID/token; if owned exit cannot be confirmed, the lease is retained for review.
- Files live in a dedicated sibling sandbox. No source/session/editor changes;
  no scene audio assignment. The output purpose is `DRAFT_PROBE_NOT_SCENE_AUDIO`,
  not complete image narration and not editorial/audio/publishing approval.

The existing worker already splits sentences. No new chunker, model, dependency
or modified synthesis algorithm was introduced. Cache identity is unchanged;
the probe explicitly forces an uncached output in its own unique session folder
so a cache hit cannot be reported as a cold-start benchmark.

## Approval boundary

From `1_nest_backend`:

```powershell
node scripts/local-bounded-probe.cjs $probeDirectory prepare
node scripts/local-bounded-probe.cjs $probeDirectory refresh
```

Prepare/refresh only read saved reviewed text and collect light diagnostics.
They never create approval, attempt, audio or a model worker. Init refuses overwrite.
The dedicated directory must be a direct child of `Tiktok_Automation_e2e01` with
a `run-local-bounded-probe...` name.

After disclosing current physical RAM, commit/pagefiles, text, budgets and risk,
wait for the user's actual confirmation. Only then may the operator write
`approval.json` with `confirmed:true`, scope `LOCAL_BOUNDED_PROBE`, matching planId,
SHA-256 of parsed/serialized plan and disclosure, inputHash, evidence
`EXPLICIT_USER_CONFIRMATION`, and a current `authorizedAt`. Consent expires after
30 minutes. It is execution consent only. There is deliberately no auto-approve
command or generated approval template with true values.

```powershell
# NOT AUTHORIZED until that separate real confirmation and matching approval exist:
node scripts/local-bounded-probe.cjs $probeDirectory run
```

The runner rechecks source hash, resource conditions, active workers/jobs and
configuration before inference. Emergency conditions prevent starting regardless
of approval. Run without approval refuses before creating an attempt or worker.

## Measurements and failure classification

Before/after system snapshots include physical available RAM, memory load, commit
used/available/limit, pagefile allocations/usage, and project/other process evidence.
The lightweight observer's own RSS is labelled `OBSERVER_NOT_KOKORO`.

Worker sampling every 250 ms captures current RSS/private bytes, native lifetime
peak working set/commit, sampled private-memory peak and cumulative page faults.
Page-fault count includes soft faults: it is not a measured disk-paging rate.
Snapshots separate runtime import, model construction and inference. After closing,
worker exit is confirmed; nonexistent worker RSS is null, not fabricated as zero.
System before/after deltas include other apps and cannot all be attributed to Kokoro.
Sampling/timeouts are best-effort under Windows pressure, not a guarantee that the
desktop can never become temporarily unresponsive.

| Category | Required evidence |
| --- | --- |
| RESOURCE_GUARD_STOP | Our explicit physical/commit/monitor safety stop |
| ALLOCATION_FAILURE | MemoryError, recognized allocator/OSError, or specific no-memory/commit-limit exit status |
| TIMEOUT | Our model/command/controller/exit deadline expired |
| WINDOWS_OOM_EVIDENCE | Reserved for independently verified Windows evidence associated with the worker/time window |
| UNKNOWN | Other protocol/model/process errors; no unsupported inference |

An exit, low available RAM, or an arbitrary error containing “OOM” does not prove
Windows OOM. Windows event collection is not fabricated: the runner initially
records no such evidence. On unexplained exit, inspect relevant OS records before
changing UNKNOWN; absence/inaccessibility of those logs remains a limitation.
Specific no-memory and commitment-limit statuses are checked against
[Microsoft's NTSTATUS definitions](https://learn.microsoft.com/en-us/openspecs/windows_protocols/ms-erref/596a1078-e883-4972-9bbc-49e60bebca55);
they indicate allocation/commit failure, not proof of Windows terminating a worker.

Actual allocator exception type/codes are sanitized; source text is not treated as
code, and a ValueError quoting “CUDA out of memory” is not allocator evidence.
Failed Voice jobs retain category/hash and bounded current-attempt diagnostics;
reports never turn an unsuccessful run into AUDIO_READY.

## Offline verification

- Backend build/typecheck, warning-vs-emergency policy and bounded worker protocol.
- MOCK success at 512 MiB, allocation failure, commit guard, unexpected exit and
  timeout. These are protocol tests, **not Kokoro inference or RAM benchmarks**.
- Missing approval refuses before attempt/worker; invalid approval/length refused.
- Probe lease refuses collection/render before their callbacks/source loading.
- Native allocation classifier, memory helper and Python syntax without Torch import.
- Existing audio cache/FFprobe, job persistence and source/locks/revision regressions.
- Frontend check/bundle verifies the explicit STATIC_ONLY/warning presentation.

Runtime plans, approvals, attempts, telemetry and WAVs stay outside Git. No credential,
model weight, production data or media is staged. Historical source/session data
and the 933-file production baseline must be hash-checked before/after the real probe.

Executed offline in this checkpoint: backend build, frontend TypeScript and Studio
bundle exit 0; seven targeted Node scripts passed (bounded mock protocol, missing
approval, isolation, prior resource/cache/job/integrity regressions). Native Python
allocation classification/syntax passed without Torch. Full Jest and a real model
benchmark were not run. HTTP confirms the live sandbox advertises policy V2.
The production baseline comparison reports 933 unchanged, 0 changed, 0 unreadable.

## Next decision

The proposed experiment is ready for review, **not benchmark PASS**. Report a fresh
snapshot and request approval. After one authorized attempt, report cold-start,
inference, peak RSS/private/commit, emergency/deadline outcome, WAV/FFprobe result,
and after-close measurements. Recommend an operating range only from that evidence;
do not turn a single short probe into a universal minimum or MP4 acceptance claim.
