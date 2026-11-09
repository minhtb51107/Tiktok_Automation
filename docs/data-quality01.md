# DATA-QUALITY-01 — bounded discovery and editorial selection

## Delivery status

PARTIAL: offline implementation and saved-real-data replay verified. The new live
benchmark stopped on memory pressure; no 30-post benchmark or five new live
recommendations is claimed. No TTS, render, acceptance, enqueue or publishing ran.

Main integration is separate: merge `150a81c` preserved all 62 feature commits
through `de60514`; documentation `9024636` and typed-test fix `720197e` followed.
GitHub Actions run 42641695706 passed on main. See
`main-integration-20261109.md` for branch/author audit and validation inventory.

## Reuse audit

| Capability | Evidence/status |
| --- | --- |
| Exact root + observed context extraction | REAL PASS on historical LIVE-02 capture; context is not parent verification |
| Root images and reviewed image narration | REAL PASS in prior media workflow; reused here without new OCR/TTS |
| Parent-verified reply collector | PARTIAL: evidence parser exists; replay has zero verified replies |
| Official token validity | REAL PASS: current debug response valid, basic/search scopes present |
| Official broad keyword discovery | PARTIAL: TOP query returned zero rows; advanced access not established |
| New bounded multi-topic coordinator | Offline tests pass; new LIVE attempt resource-blocked before any result |
| SERIOUS/FUNNY selection weights | MOCK/OFFLINE only as quality evaluation; no human accuracy benchmark |
| Human acceptance and production gates | Existing DATA-01/03 retained; no automatic approvals |
| Autonomous editorial commentary | NOT IMPLEMENTED intentionally; quote-only drafts require an editor |

## Implementation and boundaries

`content-discovery.ts` coordinates existing DATA-04 discovery/enrichment, DATA-01
imports and Gold V2 shadow evaluation. One browser operation runs at a time.
Request IDs provide idempotency; atomic checkpoints preserve keyword/target
cursors, capture hashes and selection configuration hash. Explicit resume does
not reopen resource/access/time-budget-blocked attempts. No cron is installed.
Completed root captures enter Bronze through the existing adapter; full observed
cards/replies remain in the persisted collection, not separate fabricated Bronze
posts. Existing review decisions are not changed.

`content-selection.ts` reuses clean projections, Source Quality V2, conversation
quality, exact/near deduplication, image narration and duration estimation.
SERIOUS weights: root 15, discussion 35, coherence 25, hook 10, popularity 5,
topic 10. FUNNY weights: 10/35/20/20/5/10. These are explainable heuristics,
not semantic understanding, confidence probabilities or viral predictions.
Lexical relevance and shared vocabulary are proxies, not proof of relevance.
Missing engagement remains null; popularity alone cannot promote emoji/spam.
Repeated sentences are flagged rather than used to pad estimated duration.

Original text and raw captures remain immutable. Observed cards can enter an
editorial DRAFT with `OBSERVED_ON_TARGET_PAGE` evidence; they are never relabelled
parent-verified. Wrong-root evidence is rejected. UNKNOWN type is retained.
Existing image narration requires matching image hash and review provenance;
AGENT_VISUAL remains AGENT_VISUAL and still requires human review.

Output includes ContentCandidate, quote-only Script DRAFT and proposed
StoryboardScenes. A VideoProject prototype is offered only when source types
permit the existing contract; nothing creates a persisted project automatically.
Source identity, media references, metadata and provenance remain attached.
Estimates target 65–90 seconds, minimum 60; they never become authoritative
timeline/audio durations. Real release duration still requires measured WAV and
the existing timeline engine. Rights remain UNKNOWN.

## API and operation

Base: `/api/studio/data/content-quality`:

- `GET /options`, `GET /runs`, `GET /runs/:id` are read-only.
- `POST /runs` accepts requestId, style, topic, keywords, maxPosts, maxRunMs.
- `POST /runs/:id/resume` resumes only eligible saved attempts.
- Live execution requires `STUDIO_DATA_QUALITY_LIVE_ENABLED=1`, explicit
  `liveApproved: true` and the existing controlled-collection lock. Default OFF.

Limits: 1–8 keywords, 1–50 roots, max 600 seconds configured run budget. Existing
discovery returns at most six candidates per query. Each visit has its existing
request/navigation/time limits; the coordinator checks run budget between
operations, not a hard interrupt of an in-flight operation. Available RAM below
384 MiB closes the owned browser. No unrelated process is stopped.

`scripts/data-quality01-pilot.cjs` prepares the fixed pilot and consumes one
attempt when explicitly run. **That attempt has already been consumed; do not
rerun it automatically.** `scripts/data-quality01-replay.cjs` reads historical
LIVE-02 session data without network access or source writes. It expects the
existing sibling E2E worktree/runtime; it is not a distributable public dataset.

## Actual evidence, 2026-11-09

Official access check made two requests: token debug and one TOP keyword query
with limit two. Token was valid with threads_basic/threads_keyword_search;
expiry was 2027-01-01T19:17:09Z. Search returned zero posts. This does not prove
advanced access approval or denial. No token/secret is stored in this report.

Public discovery attempted one query with one browser: 10 requests, one
navigation, zero scrolls, 6,490 ms browser operation / 6,553 ms coordinator.
Available RAM was 618.31 MiB before launch and reached 329 MiB. The guard stopped
it with CONVERSATION_RESOURCE_BELOW_384MIB. Zero roots, replies or new candidates
were returned. This was RESOURCE_GUARD_STOP, not evidence of Windows OOM or a
Threads access restriction. No retry occurred.

Saved-data replay retained all eight observed cards for DfWJxiID7E5, zero verified
replies and UNKNOWN root type. Text-only material estimated 39–54 seconds.
Including the existing hash-validated AGENT_VISUAL image transcript yielded one
editorial proposal with three comments (wtffff.08h, chandler.1000, minh9111le),
estimated 65–89 seconds at 1.3x. This is not a new LIVE collection, user approval,
measured duration or acceptance of parent relationships. No five candidates were
invented. Precision@5/@10: NOT MEASURED; no suitable human labels.

Local artifacts, Git-ignored, under backend `.studio-data/reports/data-quality01/`:
`access.json`, `pilot-before.json`, `public-access.json`, `pilot-run.json`,
`pilot-summary.json`, `replay.json`, `replay-with-reviewed-image.json`,
`candidates-saved-replay.md`, and `preservation.json`. Full public content remains
in local reports, not source control.

## Validation

- Backend build and frontend TypeScript: exit 0.
- Full offline Jest runtime: 44 suites / 304 tests passed, sequential, 320 MiB
  V8 heap and ts-jest isolated transpilation. New spec independently typechecked.
- Default typed ts-jest at 384 MiB failed allocating V8 heap during the earlier
  CI diagnosis; not misreported as Windows OOM. Main CI passed subsequently.
- New HTTP options/list/error/gate smoke: 200/200/400/403 as expected, zero
  browser/worker/external calls, temporary isolated store closed afterwards.
- Studio and Remotion bundles passed during main integration; no composition or
  frontend feature was replaced by this checkpoint.
- Preservation: all 933 production baseline files matched size and SHA-256;
  zero changed and zero unreadable. Baseline manifest SHA-256:
  `e19574bf84fc07c88a165aa3958f50e579a93c289b6aeef2c0664c1f35a6c1e7`.
  The replay session also retained its original SHA-256. Existing Studios on
  ports 3110 and 3111 both returned HTTP 200 after validation; neither was
  restarted. Final available physical memory was approximately 688 MiB.

Before another live benchmark, free memory or explicitly authorize stopping
identified unused sandbox processes. Do not infer a universal RAM minimum from
this attempt. Recheck headroom, source access and budgets; retain manual review.
