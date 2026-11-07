# LIVE-03 — BLOCKED_RESOURCE / PARTIAL delivery

Approved target: https://www.threads.com/@baongocghetmatcha/post/DfWJxiID7E5
Branch codex/live03-bounded-collection, base 2c19d47. Date 2026-11-07.

## Actual LIVE evidence

One run attempted; no retry. Canonical metadata read succeeded, then available
RAM was below 384 MiB immediately after disposable browser launch. The collector
closed the browser and retained capture/error files. No target DOM navigation,
scroll, comment card, verified reply, quality suggestion or new Studio project
was produced. Elapsed capture time: 3,790ms. Root evidence is only
PUBLIC_CANONICAL_METADATA. Reported reply count is null, never copied from the
user's earlier 692 count. Exact minimum RAM at the stop was not persisted by the
first version: only RESOURCE_BELOW_384MIB is evidenced; it must not be invented.
Pre-development sample: about 448 MiB available. Post-run sample: about 493 MiB.
No peak/CPU measurement was collected. No CAPTCHA/login bypass or credentials.

External artifacts:
`D:\LCOM108_NMLT\code\100_bai_code\Tiktok_Automation_live03\run-20261107-01`
contains capture.json, error.json, report.json and report.md. Capture SHA256:
9608700a9e08b54159923e3feaad4d6c9b7731336cfe2538e75008eb180c9c19.

The collector extension is explicit opt-in; ordinary extraction callers keep their
existing behavior. It adds bounded scroll snapshots/rawInnerText, memory checks
and deadline, immutable capture before project mapping, and separate quality
suggestions (max 20). All materialized cards remain available, not automatically
selected. A later small correction records exact RAM in the stop result for future
runs; that correction was compiled but not used to retry this approved run.
Successful 4-scroll budget enforcement and current structural parser behavior
remain NOT_LIVE_VALIDATED because the browser was stopped before those stages.

## Offline and browser verification

Backend TypeScript/build exit 0. SOURCE-QUALITY real LIVE02 capture replay PASS:
all 8 bodies/URLs, immutable originals, projections, quality flags, temporary-store
selection/save/reopen/revisions. Local browser regression on existing 3107 PASS:
Copy 8 full bodies, JSON/Markdown export, 9 compact cards and 3 low-value filter
results; no exceptions. These results use LIVE02, not newly collected LIVE03 data.
Full Jest NOT RUN on this low-memory machine. No new TTS/render/publish.
Production preservation: 933 files compared, 0 changed, 0 unreadable.

Existing Studio remains:
http://127.0.0.1:3107/studio?session=e7e17c42-46d5-43ab-bc73-2ef4066935f5&area=Video%20Studio&step=Source
Its project/session was not replaced. LIVE03 has no new Studio acceptance result.

## Quality report scope

LIVE03: observed comments 0; genuinely related comments NOT_MEASURED; good/bad
examples unavailable. Parent verification was not the reason for stopping.
For reference only, saved LIVE02 has 8 observed contexts, 2 recommended,
3 needs-review, 3 low-value under deterministic V1. The employer-experience
comment by wtffff.08h and argument by minh9111le are lexical recommendations;
the short 'cười vl' reaction is low-information. These are old sample observations,
not new LIVE03 discoveries or human quality labels. No accuracy/recall claim.

## E2E-01 readiness and short plan

PARTIAL / NO-GO for immediate heavy execution. Existing LIVE02 draft is usable
without parent-verification approval; actual editorial selection remains human.

1. User chooses meaningful observed cards and checks original quotes/provenance.
   Apply clean projection and edit narration; keep uncertainty/rights UNKNOWN.
2. Save/reopen and verify the selected script, order and revisions. Approve only
   the spoken text the user actually reviewed; technical DRAFT is not publication.
3. After separate TTS permission and resource check, one Kokoro worker generates
   DRAFT audio. Validate FFprobe duration, text hashes, playback and stale settings.
4. Editor uses the same timeline contract, assets/background/voice; check scene
   boundaries, then after separate render permission run concurrency-1 short DRAFT
   smoke before a full MP4. Compare FFprobe/decoded frames/audio with Preview.

Dependencies: stable available RAM >=384 MiB while launching a browser (a larger
buffer is preferable), valid existing Kokoro/browser/FFmpeg runtime, explicit script
selection, meaningful narration and local media readiness. No background scheduler,
auto-ACCEPT/enqueue, publishing or commercial-rights approval is implied. No further
LIVE retry is authorized by this document.
