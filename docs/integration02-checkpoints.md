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
