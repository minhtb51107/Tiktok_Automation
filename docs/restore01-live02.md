# RESTORE-01 LIVE-02

Approved target: https://www.threads.com/@baongocghetmatcha/post/DfWJxiID7E5

One explicit bounded read completed on 2026-11-07. No retry/discovery/search,
TTS, inference, render, scheduler or publishing was executed.

## Actual result

- Exact target matched by DOM permalink, source ID DfWJxiID7E5.
- One root plus **8 observed context cards**, with original text, author, own
  permalink, media references and observation timestamp persisted.
- Root type UNKNOWN; 0 PARENT_VERIFIED replies. No semantic or parent claim is
  inferred from DOM order. Observed context may include unrelated content.
- Context defaults unselected; selecting it is a draft editorial choice only.
- JPEG attachment downloaded and decoded: 1080x344, 50,842 bytes, SHA-256
  c03981ab1b2b131c7ff80e39a884cc531de0222a9883e01c2d5175ed0052ca13.
- OCR NOT_RUN, rights UNKNOWN.
- Capture/materialization/media elapsed 6,934 ms. Available RAM about 598 MiB
  before and 913 MiB after capture. Peak RAM was not measured.

Saved actual data is external to Git:
`D:\LCOM108_NMLT\code\100_bai_code\Tiktok_Automation_restore01_live02\run-20261107-01`.
Files include capture.json (complete actual extractor response), result.json,
backend/.studio-data session/media, browser-proof.json and screenshots.

Session: e7e17c42-46d5-43ab-bc73-2ef4066935f5, revision 4 after a reversible
selection/save/reopen test. Only the root remains selected; all 8 context cards
are left for the user to select. No approvals or production jobs were created.

## Studio

URL: http://127.0.0.1:3107/studio?session=e7e17c42-46d5-43ab-bc73-2ef4066935f5&area=Video%20Studio&step=Source

From this worktree's backend directory:

```powershell
node --max-old-space-size=256 scripts/restore01-runtime.cjs "D:\LCOM108_NMLT\code\100_bai_code\Tiktok_Automation_restore01_live02\run-20261107-01"
```

Use Ctrl+C in its owning terminal to stop. All network access is disabled after
capture. Only local session selection/text/editor saves and editor preparation
are permitted. The runtime uses a new cwd/store, strips credentials and blocks
new collection, approvals, TTS, render and publishing. The existing 3106 pilot
and 3105 REAL_DATA_COPY are not replaced.

## Verification

- Actual browser: 9 Source cards, 9 evidence labels, local 1080px attachment loaded,
  Script navigation PASS. Screenshots source.png and script.png in the sandbox.
- Actual HTTP session selection/save/reopen PASS, original texts preserved.
  Temporary technical selection was restored; no context remains selected.
- Offline Studio persistence regression PASS.
- Backend build (TypeScript included), frontend TypeScript/bundle PASS.
- git diff --check PASS.
- Production baseline: 933 files compared, 0 changed, 0 unreadable.
- TTS/render and full Jest NOT RUN; this task does not claim their LIVE success.

RESTORE observed-card collection/storage/display: PASS LIVE for this bounded
sample. Strict DATA04 parent-verified conversation acceptance remains PARTIAL.
The draft can be edited using the existing Script/Voice/Editor contracts; actual
generation/export requires separate permission. No further LIVE run is automatic.
