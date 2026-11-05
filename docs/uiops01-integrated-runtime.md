# UI-OPS-01 — Integrated real-data-copy Studio

Handover: 2026-11-06 (Asia/Saigon). Dedicated worktree `Tiktok_Automation_uiops01`, branch `codex/uiops01-integrated-runtime`, based on DATA-05 `0cad497`.

**Overall checkpoint: PARTIAL.** The isolated UI acceptance paths are working; this is not full production readiness. Full Jest was stopped when available RAM reached 57 MiB and is **NOT_RUN_RESOURCE_BLOCKED** for a completed regression. No earlier full-suite result is substituted.

## Recovery and runtime audit

All WIP survived. Actual recovery inventory: 15 tracked frontend files modified and six new source/test files before this report. No reset, clean, stash, source merge or restoration was required. Source remains DATA-05 plus safety/runtime integration, not a new Studio implementation. Antigravity layout/CSS, DATA-01/02/03/04/05, timeline and renderer were retained.

| Port | Observed runtime | Worktree branch / source checkpoint | Storage/frontend |
| --- | --- | --- | --- |
| 3000 | Not listening (`ECONNREFUSED`) | No active server to attribute | No active frontend/store |
| 3101 | Not listening (`ECONNREFUSED`) | Historical INTEGRATION-03 test only | No active frontend/store |
| 3102 | DATA-04 SYNTHETIC, Node PID 29300 at audit | `Tiktok_Automation_data04`, `codex/data04-conversation-quality`, HEAD `faeb9b4` | Separate `Tiktok_Automation_data04_acceptance/...-29300` store/frontend copy |
| 3103 | DATA-05 SYNTHETIC, Node PID 5492 at audit | `Tiktok_Automation_data05`, `codex/data05-editorial-production`, HEAD `0cad497` | Separate `Tiktok_Automation_data05_acceptance/1793891637695-5492` copy; tones, not primary Studio |
| 3104 | UI-OPS-01 REAL_DATA_COPY | New UI-OPS branch; exact current startup SHA via `/api/studio/runtime` | Verified external real-data copy; primary acceptance URL below |

Old synthetic servers were not repointed or overwritten. Their running build versions are identified by worktree/proof manifests and served hashes, not a fictional embedded Git tag. At audit, served JS SHA-256: 3102 `7dcf27bfb78afc38c04f7330790570e2c2fa2c434bdb58ca0d31aa933be5d12f`; 3103 `b639fbc348347278c8126251d0b1fd174c17676be823f8e3684d01ecebcf24a8`. Both matched their runtime bundle copies.

### Why the frontend was confusing

Nest serves `/studio`, `/studio/app.js` and `/studio/app.css` by resolving `../2_Remotion_Video` against **process CWD** (`StudioController`). The Node source worktree alone does not identify the frontend or DataStore: acceptance launchers change CWD to a sandbox and copy bundles there. Editing/building another worktree does not update that served copy. `/app.js` is not the bundle URL.

The new launcher records CWD, store, source branch/SHA, frontend SHA and source-dirty status. The Studio banner displays `REAL_DATA_COPY`, current startup source SHA and frontend hash prefix. REAL source provenance does not imply live freshness, confirmed POST type, factual correctness, rights or approval. SYNTHETIC and UNKNOWN remain separate.

## Exact primary runtime

Open:

`http://127.0.0.1:3104/studio?session=35b8a880-b8b5-49ec-be42-0991228eb45e&area=Video%20Studio&step=Video%20Editor`

The existing primary copy is under:

`../Tiktok_Automation_uiops01_acceptance/2026-11-05T16-11-41-841Z-f97de846-d2b6-4ee0-b1c6-a3b94fdc346b/1_nest_backend/.studio-data`

The report/config directory in the UI-OPS backend is:

`.studio-data/reports/uiops01/2026-11-05T16-11-41-841Z-f97de846-d2b6-4ee0-b1c6-a3b94fdc346b/`

`latest.json` points to it. All these paths/artifacts remain Git-ignored, not source-control content.

The verified snapshot contains **9 catalog posts, 9 sessions, 9 Gold V2 rows, session-owned existing audio/media, referenced public assets, terminal progress history and 5 existing COMPLETED MP4s**: 204 copied files, 205.52 MiB. The earlier approximately 54 MiB snapshot did not yet contain completed outputs/history; it was preserved. No synthetic catalog or tone fixture was injected. Completed videos were produced before UI-OPS-01; this task did not render them.

Copying excludes `.env`, Threads API/OAuth vaults, TikTok accounts/tokens, browser profiles, model weights, caches, logs and render-worker snapshots. JSON credential-like keys fail copying closed. All copied files initially matched source SHA-256. There is no live-storage junction. Only dependencies use existing node_modules junctions; no dependency was installed or upgraded.

## Functionality matrix

`WORKING` below means the named path was exercised against the real copy, not that every control passed production acceptance. `PARTIAL` covers missing inputs/unexercised side effects. Buttons having handlers alone are not proof of functionality.

| Workspace/function | Classification | Actual evidence / restriction |
| --- | --- | --- |
| Dashboard catalog/readiness/navigation | WORKING / PARTIAL | Actual nine-record catalog and pending counts; no invented main catalog. Not an independent production-readiness certification |
| Data Review list, source links, identity, original records | WORKING | 9/9 UI cards and canonical links; API post/Bronze/Gold compared to copied persisted JSON; UNKNOWN types retained |
| Data Review ACCEPT/REJECT/queue approval | DISABLED_BY_SAFETY | Explicit disabled controls and server 403. No real approval or enqueue performed |
| Gold V1/V2 comparison and reports | WORKING | Nine persisted V2 rows, V1/evaluation snapshots read without recomputation |
| Gold feedback mutation | DISABLED_BY_SAFETY | Quality feedback remains separate from production approval; no labels changed |
| Discovery options, topic/budget fields, history/report reads | WORKING / PARTIAL | Actual local API; no new collection to validate LIVE discovery |
| One-Click Crawler start/resume | DISABLED_BY_SAFETY | No on-open crawling; server rejects POST before worker dispatch |
| Official Threads collector / OAuth verification | DISABLED_BY_SAFETY | Separate from crawler, no token copied; local auth is BLOCKED_AUTH. Production OAuth state is not tested or modified |
| Scheduler/cron | DISABLED_BY_SAFETY | OFF; configure/resume blocked |
| DATA-04 Replies/Conversation Quality | PARTIAL | No verified conversation collection exists in this real copy. UI states missing input; no synthetic replies substituted, no claim of zero replies on Threads |
| DATA-05 Editorial Planning | PARTIAL / DISABLED_BY_SAFETY | Code/API retained. No verified source bundle to create a real plan; no source fabrication, approval or project creation |
| DATA-03 Ready Queue / production history | WORKING reads; writes DISABLED_BY_SAFETY | Actual backend ready count 0 and production jobs 0; opening creates nothing |
| Script display/spoken editing, save/reopen | WORKING | Actual UI save, persisted revision and reopen. originalText stays immutable; change was restricted to copy |
| Script conservative offline normalization | PARTIAL | Existing local API allowed; full quality workflow not rerun here. Live Hugging Face is blocked |
| Voice existing Kokoro audio playback | WORKING | Actual stored non-fixture DRAFT audio streams; HTML audio clock advanced. No new TTS; no listening/semantic-quality claim |
| Voice runtime availability / new generation | DISABLED_BY_SAFETY | Stored preflight is historical, not new runtime verification; Generate/preflight/settings/Approve Audio disabled in copy |
| Editor/timeline/preview/media assignment | WORKING / PARTIAL | Actual five-scene audio/media preparation, frame seeking, saved local Editor update. Entire advanced editing suite not rerun |
| Asset upload/recategorize/physical deletion | DISABLED_BY_SAFETY | Visible restrictions, server fails closed. Existing assets are not removed |
| Existing MP4 outputs/history/download | WORKING | 5 previously COMPLETED files copied by hash; all return HTTP 206, video/mp4 and MP4 ftyp signature. No new render or new full-file A/V quality benchmark |
| New DRAFT/FINAL render | DISABLED_BY_SAFETY | Workspace/report reads retained; start/cache-remote buttons blocked |
| Publishing | MOCK / DISABLED_BY_SAFETY | Existing foundation retained; no account/token copied, no OAuth, transfer or publish |
| Settings theme | WORKING | Actual theme control exercised |
| Settings voice/version fallbacks | WORKING (fixed) | Removed invented fallback version/names. Cached runtime explicitly labeled, unknown fields NOT_VERIFIED |
| Autopilot schedule examples | MOCK | Explicit SIMULATED/CONTRACT PREVIEW; fixed Gold threshold text labeled design reference, not actual rule |
| BGM automatic ducking/fade | NOT_IMPLEMENTED | Existing Inspector explicitly says gain only; no fake control added |
| Enabled visible buttons without any input handler | No BROKEN structural case found | Inventory records click/pointer/mouse/key handlers, disabled state and labels. This is not proof of each business action |

## Safety and persistence

`scripts/studio-copy-policy.cjs` is a fail-closed **acceptance-mode** boundary, not a replacement for application approval/authorization logic. Allowed writes are explicit local session creation/save, Editor save/prepare and conservative offline Script proposal/decision. Live scrape/metadata, AI, preflight/TTS, media mutation, data/production approvals, enqueue, OAuth, scheduler, render and publishing are rejected before dispatch. Backend external HTTP/fetch is also blocked; inherited credentials are removed. The browser acceptance blocked external media, without downloading replacements.

Only local Editor preparation jobs ran; they are not production jobs, TTS or render. Original source references, locks and existing audio files remain present. Restart allows expected mutable session edits while revalidating original immutable copied media/data/frontend. No production source or other worktree is repointed.

Production before/after: **933 files, zero changes**, manifest hash:

`e19574bf84fc07c88a165aa3958f50e579a93c289b6aeef2c0664c1f35a6c1e7`

Copied-store baseline manifest SHA-256:

`37a052e9aa689edb7cef7c715b0ecaba66e921b2a47630868e4579375e618a8d`

Verified copy changes: only primary session JSON and two local Editor-preparation job files, no removed/unexpected files. Catalog/Bronze/evaluations/other eight sessions unchanged. Detailed private artifacts: `copy-integrity.json`, `preservation.json`, `runtime-audit.json` (written on graceful stop), `api-audit.json`, `browser-report.json`, `policy-jest.log`, screenshots.

## Verification and resource limits

| Check | Result |
| --- | --- |
| Frontend TypeScript + Studio bundle | PASS, exit 0 |
| Backend TypeScript + build | PASS, exit 0 |
| Relevant policy Jest | 1 suite / 17 tests PASS, exit 0; explicit deny/allow tests |
| Browser acceptance | 15/15 PASS; actual Nest/API/persistence/installed Chrome, no mocked catalog responses |
| Recovery handover smoke | 7/7 PASS on final bundle; exact UI original text for all nine posts, existing voice playback, disabled Voice approvals/generation, actual Editor playback and five exact seeks after restart, 1920/1366 toolbar geometry, five visible MP4 download links, no page-open mutation |
| Existing MP4 download probe | 5/5 HTTP 206 and MP4 signature |
| Production/copy integrity | PASS as above; no inaccessible production file in scope |
| `git diff --check` | PASS; normal Windows line-ending notices only |
| Full Jest | NOT_RUN_RESOURCE_BLOCKED for completed run; previous attempt stopped, never reported PASS |
| Threads LIVE / new TTS / new render / publishing | NOT RUN |

Full Jest reached 57 MiB available RAM (owned Jest process approximately 1.46 GiB private bytes); it was stopped without killing user applications. A missing explicit Jest globals import in the new policy spec was fixed; the targeted suite then passed. Browser samples in retained final report: 616 MiB before, 585 MiB during preview, 632 MiB after. Driver RSS 49–71 MiB, not total Chromium memory. Heavy tests/build/browser ran sequentially. No attempt to force a full run by disabling strict checks or installing dependencies.

Browser evidence: `dashboard-real-copy.png`, `review-real-copy.png`, `voice-real-copy.png`, `editor-real-copy.png`, `settings-real-copy.png` in the run directory. Tests include save/reopen, existing audio playback, exact copied identities, missing conversation truthfulness, disabled workers, no hidden page-open writes and actual backend 403 responses. They do not establish current LIVE source availability, fresh Kokoro readiness, every editing gesture, full MP4 decode fidelity or production operation.

Recovery smoke artifacts: `handover-smoke.json`, `handover-voice.png`, `handover-editor.png`, `handover-editor-1920.png`, `handover-editor-1366.png`. Final available RAM samples were 665 MiB before, 627 MiB in preview and 1,122 MiB after browser close. The extra guard covers multiline Voice approval/settings controls as well as Generate. Visual inspection also caught the added runtime banner disrupting the existing three-row Editor grid: the badge now belongs inside the existing toolbar, with its details in a popover and isolated native details spacing. Bounding boxes verify that it stays in the toolbar row, above navigation, and that Editor begins below navigation without horizontal overflow at both viewports. To retain copied edits, rebuilt JS/CSS and isolation manifests were updated only after archiving preceding frontend/config revisions under `frontend-before-*`; no session/media was replaced. Final served bundle SHA-256: `e5438899b04f722446e9af215e18eaadeb1ebdd67c6e523080b4437fdb66bc96`. Run `node test/uiops01-handover.cjs` for the read-only smoke.

## Start, restart and stop

Run from `Tiktok_Automation_uiops01/1_nest_backend`, using the existing snapshot (do not rerun the copy command to reopen edits):

```powershell
$studioRun = Get-Content .studio-data/reports/uiops01/latest.json | ConvertFrom-Json
node scripts/studio-copy-runtime.cjs (Join-Path $studioRun.run 'isolation.json')
```

If already running on 3104, use the existing server. The startup branch/SHA and exact served hash are inspectable at `/api/studio/runtime`. Ctrl+C in the owning terminal shuts it down and writes the audit; restart preserves copied local session edits. Do not use `npm start` in the original repository for this acceptance instance.

If that terminal is unavailable, identify the exact owned process before stopping:

```powershell
$studioProcessId = (Invoke-RestMethod http://127.0.0.1:3104/uiops01-proof).pid
$studioProcess = Get-CimInstance Win32_Process -Filter "ProcessId=$studioProcessId"
if ($studioProcess.CommandLine -like '*studio-copy-runtime.cjs*' -and
    $studioProcess.CommandLine -like '*Tiktok_Automation_uiops01*') {
    Stop-Process -Id $studioProcessId
}
```

Stop only after pending local saves finish. No Windows service/startup task is installed.

New copies are optional, uniquely named and preserve older snapshots: `node scripts/studio-copy.cjs`. Verify production with `node scripts/studio-copy.cjs verify <run-directory>`. Rebuilding source frontend does not silently replace a running snapshot's bundle; use a fresh verified snapshot for a new build. Existing dependencies/browser are reused.

## Before production GO

This checkpoint is usable for **isolated real-copy editing and review inspection**, not a GO for production writes. Remaining gates: sufficient resources for broader regression; separately approved real-store rollout; verified conversation collection and human editorial inputs; fresh runtime/auth checks only when authorized; separately controlled inference/render; independent rights/content/audio approvals. No live crawler, production token, automatic ACCEPT/enqueue or publishing is authorized by this handover.

Source changes: three `scripts/studio-copy*.cjs` launch/copy/policy files; `studio-copy-policy.spec.ts`; actual browser harness; shared RuntimeSafety banner/hook; existing workspace safety controls, honest Settings/Dashboard labels and empty conversation state. No dependency, renderer, scoring algorithm, source dataset or legacy workflow was replaced. Commit/push SHA is reported in the conversation after this report is committed.
