# INTEGRATION-02 checkpoint log

## Checkpoint 1 — Preservation and isolation

- Original Codex HEAD `90451cf`, original design HEAD `66b8d59`; both clean.
- New worktree/branch `codex/integration-01-studio-v2` starts from `90451cf`.
- Verified runtime snapshot: 933 files, 508,694,633 bytes. Every copied file was
  SHA-256 compared to its source; manifest hash:
  `0c373e9cb730a10f76f4ccb3b21915333bd282aa8f6265c317990feb0b326453`.
- Backup and its private manifest are outside Git. No credentials/runtime files
  are staged. Restore is deliberate copying from that snapshot with services
  stopped; no restore is performed in this task.
- Isolated backend CWD and `.studio-data` belong to the integration worktree,
  port 3100. No `.env`, token vault, runtime configuration, session or real audio
  was copied into this test store. The store is not linked to the live store.
- Only installed dependency directories are reused via junctions; no install or
  version changes. Source worktrees remain untouched. No second live-store writer.
- Snapshot verification PASS. Proceed to source merge; data-writing workflow
  integration remains gated on checkpoint 3 regression.

## Checkpoint 2 — Source merge

- Merged design `66b8d59` into the integration branch only. Resolved `main.tsx`
  around the Antigravity shell, preserving Codex's DATA-01 technical library as
  a collapsed advanced view and old `step=Data` links into Data Review.
- Backend/frontend TypeScript, backend build and Studio frontend bundle PASS,
  exit 0, sequential execution. Dependency and lockfiles unchanged.
- No data workflow was exercised. Existing P0 identity/type defects are still
  explicitly pending checkpoint 3. Source merge PASS does not imply integration
  acceptance or permission to use real data.

## Checkpoint 3 — P0/data contract gate

- Removed handle fallback; canonical HTTPS source identity and sourcePostId must
  agree. Ambiguous matches fail closed. UNKNOWN is preserved, including batch
  defaults; ACCEPT requires deliberate POST/COMMENT confirmation.
- CatalogPostView is independent of SessionSceneView. Data Review projects every
  current catalog page, even without an open session; edits only target an exact
  linked scene. Page navigation is real, not a session filter.
- Browser-safe shared payload gates distinguish quality-feedback revision from
  DATA-01 evaluation revision. Gold feedback never grants production approval.
- Regression gate PASS: 3 suites / 29 tests (identity, UNKNOWN, catalog scope,
  feedback, stale revisions, DATA-03 idempotency/recovery). Backend build and
  frontend TypeScript/Studio bundle PASS, exit 0.
- All 63 pre-existing session/Data Engine files remain hash-identical against
  checkpoint 1. P0 gate is cleared for further isolated synthetic integration;
  real-data access still waits for checkpoint 6 GO/NO-GO and user decision.

## Checkpoint 4 — Discovery integration

- One-Click DATA-02C, run history/polling/report, V1/V2 comparison, quality buckets
  and independent feedback now use actual backend APIs. Official API collector
  remains a separate source. No POST or crawl on mount.
- Persisted request intent and immediate click locks prevent accidental duplicate
  collection on retries/refresh. No automatic resume through an access block.
- Scheduler mutation controls are disabled in this pilot. Both collector paths
  share Studio's operation mutex. Browser-safe DTOs avoid importing server/service
  dependency graphs into frontend type checking.
- Backend/frontend TypeScript and Studio bundle PASS. Contract/crawler regression:
  2 suites / 15 tests PASS. Browser workflow acceptance is pending checkpoint 6;
  no LIVE collection, AI, TTS or render was triggered by this checkpoint.

## Checkpoint 5 — DATA-03 and authoritative readiness

- Added Ready Queue / Production Jobs inside the Antigravity production workspace.
  Create uses the queued evaluation's IDs/revision and a persistent requestId;
  explicit retry uses the existing resume endpoint. No implicit ACCEPT/enqueue.
- Job success opens the actual materialized session. Queue → Script/Voice/Editor
  navigation no longer stays trapped in the Queue router branch.
- Added backend session readiness, shared with DATA-03 readiness: checks item
  revision, text/hash, voice/speed, number-reading version and session-owned audio
  file. Existing UI consumes authoritative asset IDs/approval states. No FINAL or
  publishing approval is inferred. Global catalog actions cannot open/edit an
  unrelated current session.
- Backend build and frontend TypeScript PASS; focused regression 4 suites / 28
  tests PASS (including stale audio and DATA-03 idempotency/recovery). All executed
  sequentially. Browser/save/reopen acceptance remains pending checkpoint 6.

## Checkpoint 6 — Browser end-to-end regression (SYNTHETIC runtime)

Recovery: the reported "9 uncommitted files" did not exist in any worktree (all three
clean, reflog and loose objects checked). Checkpoint 6 was therefore implemented from
`ef5cc78`; nothing from Codex was lost or overwritten.

Runtime and safety:
- `1_nest_backend/test/synthetic-runtime.cjs` boots the real Nest modules on
  `127.0.0.1:3100` inside the integration worktree only. It refuses to start with a
  `.env`, scrubs every credential-like variable, keeps all dormant feature flags off and
  replaces only the public crawler source with a local synthetic fixture (mode `MOCK`).
  It can inject one extraction failure through `.studio-data/synthetic-fail-once`.
- `1_nest_backend/test/integration02-e2e.cjs` drives the real Studio bundle in headless
  Chrome (one worker). Run: start the runtime, then `node test/integration02-e2e.cjs`
  (`E2E_ONLY_D=1` re-runs groups D/Z against an existing synthetic store).
- No real crawl, AI, TTS, render or publishing request is possible; the suite asserts
  that no such request or job is issued.

Defects found by the browser run and fixed (scope: integration UI, no redesign):
1. Pipeline-QUALIFIED posts were shown as "Đạt chuẩn (Đã duyệt)" / "Sẵn sàng dựng" and
   offered the enqueue action before any user ACCEPT (the backend correctly refused).
   Now such posts show "Đạt ngưỡng tự động · Chưa được bạn duyệt", the enqueue action is
   hidden with an explanation until an explicit ACCEPT exists (`isUserAccepted`).
2. Synthetic observations were labelled "REAL DATA". The catalog now exposes
   `synthetic` per row (from `bronze.provenance.synthetic`); cards show `SYNTHETIC` and the
   header shows a synthetic/mock warning.
3. The "Duyệt dữ liệu" navigation badge counted scenes of the open session. It now shows
   the catalog-wide pending-review count (`pendingReviewCount`), equal to the Data Review tab.

Results (`e2e-final`, clean synthetic store): 38/38 browser checks PASS —
A Discovery 10, B Data Review 8, C DATA-03 9, D UI regression 8, Z global 3.
Evidence includes: refresh/mount never crawl; double-click creates one run; injected
failure + Resume re-fetches only the failed URL and never duplicates imports; Gold V2 view
per canonical permalink; UNKNOWN stays UNKNOWN (explicit POST/COMMENT confirmation);
stale revision and API failure surfaced in the modal; same-author posts never confused;
Ready Queue only after explicit ACCEPT + enqueue; double-click/retry create exactly one
project; `productionOrigin`, source reference and original text preserved; stale audio is
not counted ready; DRAFT never shown as FINAL; editor save → reload keeps edits; idle pages
do not poll aggressively.

Technical gates: backend and frontend `tsc --noEmit` exit 0, `nest build` exit 0, Studio
bundle exit 0, Jest `--runInBand` 34 suites / 217 tests PASS (new: catalog provenance,
pending-review count, explicit-ACCEPT gate).

Observations (not defects, recorded for the real-data decision):
- Opening the Voice workspace runs a read-only runtime preflight job (`voice-runtime`);
  it never loads a model or synthesizes.
- Saving in the editor runs `editor/prepare` (preview preparation, no render). With real
  data this may touch source images; not exercised here.
- `Saved locally` appears a few frames before the app-level dirty flag settles; an
  immediate reload can show the browser "leave page" prompt. Cosmetic race.
- The Data Review state label for QUALIFIED now reads "tự động hoặc đã được bạn duyệt".

Real-data integrity: SHA-256 manifest of the original `.studio-data` (933 files,
508,694,633 bytes, aggregate `9cee8c1a02eca632352c52b02715d4328ba49acf8df13f2a4609fdd6f4cbc632`)
taken before and after the run: 0 differences. Three live log files held open by the
running real backend could not be read and are recorded as `LOCKED` in both manifests.
Source worktrees `90451cf` and `66b8d59` remain clean.

Not verified: any LIVE crawl of Threads, Official API collection with a real token, real
Kokoro/TTS generation inside the integrated Studio, FINAL render and publishing, and
behaviour with real media/avatar downloads.
