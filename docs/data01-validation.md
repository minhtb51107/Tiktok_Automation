# DATA-01 measured handover — 2026-11-02

## Actual data run (not synthetic, not new collection)

Read-only import used saved selected targets from the existing SERIOUS session,
revision 112. No Threads/AI/social API, crawl, browser, model, TTS or render was run.
The existing raw extraction was projected through the same `DataEngine` used by
the local Studio API. The first real run completed with five posts, five Bronze
observations, five validated Silver records and five scored Gold records. Import
again reused the completed run; counts and transition histories did not increase.

| Saved target | Heuristic score / 100 | Effective eligibility | Review evidence |
|---|---:|---|---|
| ledo.duta | 75.29 | NEEDS_REVIEW | UNKNOWN entity type |
| twice_._not | 76.43 | NEEDS_REVIEW | UNKNOWN entity type; ambiguous term đcđ |
| quyenminh.le | 82.61 | NEEDS_REVIEW | UNKNOWN entity type; terms clm/cmn |
| dang.hoang88 | 75.47 | NEEDS_REVIEW | UNKNOWN entity type |
| minggthuan | 69.46 | NEEDS_REVIEW | UNKNOWN entity type |

These are experimental rule points, not measured quality percentages. No source
was classified ADVERTISEMENT, no source was deleted, no human decision was applied,
and zero items were automatically qualified/enqueued. Risk-keyword labels only
request review; they do not establish a policy violation or expand slang.

All five extractor payloads explicitly retain UNKNOWN post/comment type. Their
permalinks identify external Threads IDs; the Studio's internal POST hint is not
used as proof of entity type. Confirmation is required before accepting them.
For the first target, Bronze retains its original 84-character capture; Silver
uses the existing verified topic mapping to obtain a 68-character body and header
topic. Raw data is unchanged. No first-line topic guessing is performed.

Precision@10: **NOT MEASURED**. There are five real candidates, no explicit quality
ground truth and no user-labelled top ten. The synthetic calculation test (7/10)
is a unit test of arithmetic, not an accuracy result on real Threads data.

## Verification results

| Check | Evidence / status |
|---|---|
| Backend TypeScript | `tsc --noEmit --incremental false`, exit 0 |
| Backend build | `npm run build`, exit 0 |
| Frontend TypeScript | `tsc --noEmit`, exit 0 |
| Studio frontend build | `npm run studio:build`, exit 0 |
| Offline full Jest | 24 suites / 124 tests, exit 0 |
| DATA-01 subset | 32 tests included in that full pass |
| Existing regression | All prior 92 tests retained/passing |
| Real data import twice | 5 posts / 5 observations; completed run reused |
| Cold read after backend restart | API reads previously persisted engine data |
| Local HTTP integration | Import/list/filter/detail/history/JSON roundtrip pass |
| Optimistic concurrency | Stale review HTTP 409, no decision applied |
| Production gate | Unreviewed data enqueue HTTP 400; no real queue entries |
| Request origin | Untrusted origin HTTP 403, no import executed |
| Source preservation | Hashes of main session plus eight older sessions unchanged |
| Editor / Render | Same FIT preview snapshot hash; retained MP4 HEAD 200 with original byte length |
| Publishing | BLOCKED_AUTH, liveTransferEnabled=false; no account connection |
| Git diff check | Exit 0 |
| Browser/visual Data Library smoke | NOT RUN: DATA-01 resource constraint; no browser launched |
| New TTS/MP4 / social publication | NOT RUN; outside DATA-01 scope |

The initial HTTP harness expected 200 for a POST; Nest correctly returned 201.
The harness expectation was corrected and the HTTP checks passed. A recovery
review guard was added and tested so a saved but unfinished validation checkpoint
cannot be manually accepted before processing resumes.

Tests use explicitly marked SYNTHETIC TEST DATA in isolated temporary directories
for invalid records, exact/near duplication, commercial narratives, normalization,
idempotency, concurrency, checkpoint failures/restart, source integrity, scoring,
manual review/revision, DRAFT queue contracts and Precision@10. No synthetic record
is inserted into the real project or represented as a real Threads sample.

## Runtime resources and safety

First isolated five-observation run:

- Persisted wall elapsed: 392 ms; sampled active processing: 379.9905 ms.
- Observed process RSS peak at checkpoints: 41,701,376 bytes (about 39.8 MiB).
- CPU delta: 125 ms user + 94 ms system. These describe the isolated Node engine,
  not the total Studio backend, machine usage or an exhaustive OS memory peak.
- Sixteen local data files occupied 83,726 bytes at measurement time. Media/audio
  was referenced, not loaded/copied into the data namespace.

Builds/tests ran one heavy task at a time; no new dependency/model was installed.
Heavy checks were temporarily paused when an available-RAM sample fell near 3 MiB
and paging was high, then continued after recovery to roughly 600–700 MiB. V8 heap
was capped at 768 MiB for later validation commands; that is not a total process
RAM limit. No OOM was observed and no unrelated process was killed.

A separate backend from `Tiktok_Automation_studio_v2` was observed and left alone.
The main repo's port ownership was confirmed by a unique local probe appearing in
its own backend PID log before restarting only that process. Studio is retained
at `http://127.0.0.1:3000/studio`. No import/task is triggered on startup.

## Review interface and API

Open `/studio?session=<existing-session-id>&step=Data`, or select the project then
Data Library. It offers Bronze/Silver/Gold views, paginated status filters, score
breakdown/reasons, duplicate/quarantine evidence, observation history, explicit
Accept/Reject/Needs Review with revision checks, manual DRAFT enqueue and persisted
run/resume status. Copy Report and JSON export are generated from persisted API
data. UI compilation is verified; visual/browser usability is not claimed tested.

Operations under `/api/studio/data`:

- `POST /import-session` with `sessionId`; no remote collection.
- `GET /?state=&page=`, `GET /posts/:id`.
- `GET /posts/:id/observations/:bronze` and `/evaluations/:evaluation`.
- `POST /runs/:id/resume`.
- `POST /posts/:id/review` with revision/decision/reason/confirmedType.
- `POST /posts/:id/enqueue` with revision; `GET /posts/:id/production-input`.

Humans and future callers use these same operations. The production adapter reuses
ContentSource/ContentCandidate, preserves original/display case and sets spokenText
to null for a subsequent Script review. It starts no production workflow.

## Source changes and local evidence

New backend files in `src/data-engine`: contracts.ts, config.ts, rules.ts,
store.ts, engine.ts, studio-adapter.ts, data-engine.spec.ts, data.controller.ts.
StudioModule registers the safe data service/controller. Frontend adds
DataWorkspace.tsx/data.css and a Data Library navigation entry in main.tsx.
AGENTS.md records the SERIOUS-only development stream. The foundation and measured
handover are in docs/data01-foundation.md and this document.

All real records, source payloads, generated bundles and logs stay Git-ignored.
Detailed evidence is under `.studio-data/reports/data01/`: before.json,
real-dataset.json, http-integration.json and backend logs. No session/media/model,
credential, raw post text or runtime dataset is part of the source checkpoint.

## DATA-02 boundaries

1. Review target identity/type and collect explicit quality labels for at least ten
   representative items; then measure Precision@10 and tune rules/weights.
2. Add source capture adapters only when separately authorized; retain observation
   timestamps/availability and avoid treating edited UI text as source truth.
3. Implement queue consumer/claim/reconcile/dequeue behavior and reviewed creation
   of new VideoProjects, preserving superseded queue snapshots and stage approvals.
4. Define score refresh/expiry, human override history UX and cross-session lineage
   policy; current import identity includes its saved provenance/revision.
5. Benchmark larger catalogues before adding indexes/storage changes: V1 uses
   single-writer local JSON and disk scans for deduplication/listing. It does not
   claim large-scale, multi-process transactions or semantic paraphrase detection.

DATA-01 establishes a working, auditable offline foundation. It does not establish
calibrated content quality, visual UI acceptance, automatic production or publishing
readiness. Rights remain UNKNOWN.
