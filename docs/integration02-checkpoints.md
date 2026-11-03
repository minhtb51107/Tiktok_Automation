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
