# UI-OPS-02 — Information architecture and functional UX

Base: 2530c55, dedicated worktree Tiktok_Automation_uiops02 / codex/uiops02-functional-ux. Original worktrees and production store remain untouched. No LIVE collection, TTS, render, publishing or scheduler dispatch is authorized.

## Checkpoint 1: read-only architecture audit (2026-11-06)

| Screen | Purpose / primary object | Actual API bindings | State / UX findings and overlap |
| --- | --- | --- | --- |
| Dashboard | Catalog overview + current session summary | /data, /sessions, /sessions/:id/jobs, /render | PARTIAL: catalog counts coexist with five-scene metrics; scope must be explicit. CTAs inherit current project selection |
| Discovery | Collection plus manual project Source editing | /data/crawler/*, /threads/*, /sessions/:id/fetch | Overloaded: data collection and project Source share route/state; keyword/history/scheduler buried in tabs |
| Data Review | Catalog decisions | /data/posts/:id, /review, /enqueue, /data/crawler/quality | P0: catalogPostView receives session; Inspector exposes scene/script/audio fields and scene selection. UNKNOWN has no dedicated area |
| Production Queue | DATA-03 ready jobs + existing renders | /data/production/*, /sessions/:id/readiness, /render | Mixed catalog/job/session scopes, overlaps global Video Studio and six-step Render/Review |
| Script / Voice | Project item scripts/audio | /sessions/:id, /script/*, /voice/* | Engines exist; navigation changes global area for each step, making project identity implicit |
| Video Editor | Project timeline/player/media | /sessions/:id/editor, /jobs editor/prepare, /public-assets | P0: global sidebar Canvas + nested Editor; main.tsx defaults missing session to list[0]. Duplicate title/theme controls |
| MP4 / Review | Existing outputs and publishing foundation | /render, /renders/:job/video, /publishing, /tiktok/* | Existing outputs work; new workers locked. Publishing cards carry hardcoded colors conflicting with Light/Dark |
| Settings | Runtime snapshots/theme/mock scheduling references | public-assets, explicit voice-runtime | Partly read-only; theme duplicated with sidebar/header/Editor. Contract preview must not appear operational |

Confirmed source causes:

- `main.tsx`: session load fallback `list[0]?.id`; step-to-area routing sends Script/Voice to Discovery and Render/Publish to Production Queue. Multiple theme controls and global project context leak into catalog routes.
- `DataReviewWorkspace.tsx`: `catalogPostView(row, detail, session)` and session-scene callbacks drive catalog Inspector, including a `CẢNH` label and project editing.
- `ProfessionalEditor.tsx`: local theme state writes studio-appearance and deletes document.dataset.studioTheme on unmount, conflicting with App state. Editor theme selector is a second authority.
- `editor.css`: full Editor hides sidebar and assumes fixed header/nav rows; adding headers without respecting these slots previously overlapped. Sidebar height also follows page flow on catalog screens.
- UI-OPS-01 REAL_DATA_COPY policy blocks data review as well as production approval. Isolation is present, so explicit user content-review writes can be separately enabled without enabling enqueue/production/LIVE.
- DATA-01 review persists last decision and reasons, but has no structured decision history; add an optional version-compatible history, preserving old records without migration.
- DATA-04 verified collections contain identity/evidence; unverified candidates do not. No author/order heuristic can legitimately fill the missing relationship.
- DATA-02 scheduler configuration persists without installing a timer. Public crawler scheduling/dispatch is not an operational contract; UI must distinguish saved collection plans from a running scheduler.

## Implementation and validation checkpoints

At the backend checkpoint, TypeScript/build and 8/8 isolated executable contract checks passed. These cover UNKNOWN classification, explicit project IDs, full 27-observation export beyond a 25-row page, review history/revision/immutable source, same-author identity, nested parent evidence, independent Gold feedback and configuration-only state transitions. All fixtures are explicitly SYNTHETIC. Later real-copy browser results are recorded below. No LIVE action or production approval occurred.

## Delivered behavior

The five sidebar scopes are Dashboard, Discovery / Data Collection, Content Library / Data Review, Video Projects and Settings. Projects have an explicit selector and six project-owned steps: Source, Script, Voice, Video Editor, MP4 Output and Review. Missing/invalid Editor IDs open the selector, never the first stored session. Queue is accessed from Video Projects. Breadcrumbs and step links retain the exact project ID. The legacy global Canvas entry and duplicate project spotlight/theme controls are removed; the existing Antigravity shell and project workspaces remain.

Content Library has independent ROOT / VERIFIED REPLIES / UNKNOWN / HUMAN REVIEW scopes, 25-row pagination, original-source detail, provenance, engagement, Gold V1/V2 and independent review history. Its component has no session/scene inputs. UNKNOWN never becomes POST by inference. Replies require matching canonical identities, complete parent evidence and a chain back to the exact root. Missing real collections are explicitly reported; zero collected replies does not mean zero replies exist.

Sandbox review supports explicit POST/COMMENT confirmation, ACCEPT / REJECT / NEEDS_REVIEW with reason, durable history and stale-revision errors. ACCEPT does not enqueue. Gold feedback, content review, editorial planning and production approval remain different operations. Existing scores, original text and historical shadows are preserved. A shadow may be refreshed explicitly for a changed evaluation revision; it is not approval.

Discovery has Manual, Scheduled, Run History and Queue/Worker sections. Full-run export joins persisted observations and matching evaluations/quality/collections, not the visible page. Markdown, JSON and clipboard copy include missing-data/error states and exclude credentials/raw payloads/private paths. The synthetic 27-observation case proves export beyond one page; browser export uses an actual persisted real-data import run. It does not claim that import was a LIVE discovery run.

Collection plans persist configuration, revision, history and Preview/Pause/Resume/Stop state only. Resume means ARMED_BLOCKED_LIVE; Start is blocked in both UI and API. There is no timer, cron or public-crawler scheduler dispatcher. This capability is PARTIAL / CONFIGURATION_ONLY, not running automation. Official API remains a separate credential-free, blocked source.

App is the only Studio theme authority. Editor no longer writes/deletes theme on mount/unmount. Card appearance remains project-owned. Publishing panels use contrasting shared theme colors. Sidebar stays viewport-sized; Library list/Inspector scroll separately. Editor has one 44px application header, six-step bar and existing editing toolbar without a repeated project title.

## Validation (2026-11-06)

| Check | Result / evidence |
| --- | --- |
| Backend TypeScript and Nest build | PASS, exit 0; executed sequentially before browser acceptance; no backend TS edits afterward |
| Frontend TypeScript | PASS, exit 0; repeated after clipboard-helper integration |
| Studio bundle | PASS, exit 0; pinned JS SHA-256 `123430e6889f516911f5db136fb705f4d8f5de664f0c76350e9303e9ce18ef75` |
| Executable offline contracts | PASS 8/8, exit 0; actual compiled DataEngine/atomic persistence/services in isolated SYNTHETIC temp store |
| Focused Jest safety policy | PASS 20/20, 1 suite, exit 0, 1.397s; ts-jest isolated transpile, V8 heap 256 MiB; separate full TypeScript check retained |
| Initial conventional ts-jest attempt | RESOURCE FAILURE, exit 1: V8 heap 384 MiB exhausted while loading TS graph, before assertions. No application assertion failed; not counted as PASS |
| Full Jest | NOT_RUN_RESOURCE_BLOCKED; old full-suite results are not substituted |
| Browser acceptance | PASS 14/14 bounded checks, real API/persistence, no response mocks; existing real-data copy |
| Clipboard | VERIFIED against persisted full Markdown after CRLF/NFC normalization; neither clipboard contents nor credentials logged |
| Geometry / contrast | PASS 1920×1080 and 1366×768 sidebar/header bounds; Publishing Light/Dark sampled text contrast >=4.5:1 |
| Loaded Library theme regression | PASS 16/16 sampled sidebar/selected-source contrast checks, exit 0; Light/Dark screenshots at both viewports, after existing 180ms color transitions settle |
| Production preservation | PASS 933 files, no unreadable/locked files and zero changes; identical manifest hashes below |
| Copied sessions/assets | PASS all 9 session JSON unchanged; only one copied evaluation changed plus two Gold feedback files and collection-plan.json added |
| LIVE collection / reply semantic accuracy | NOT RUN / NOT MEASURED. No real verified collection in this snapshot; parent/nested correctness tested with labelled SYNTHETIC inputs |

Browser evidence was accumulated across bounded attempts rather than rerunning destructive review actions. First seven checks used Chrome native interactions; later checks reused an existing local Edge CDP endpoint in a new owned incognito context (closed afterward, user tabs untouched). Later controls use real DOM form/click events; clipboard used a measured native pointer click. The runner retains PASS evidence from unchanged modules on the same snapshot with `--continue`. Intermediate failures include resource closure, asynchronous harness waits and initially unavailable clipboard access; these are recorded, not erased. Latest combined report has zero runtime errors and no unexpected failing HTTP responses. No claim of a fresh single-pass run, LIVE replies, or full Jest PASS is made.

Browser checks: missing-ID selector; five navigation scopes/one theme; nine original UNKNOWN records with catalog-only Inspector; independent Gold feedback; three review decisions/reopen; stale revision 409; honest missing-replies state; full exports/copy; configuration persistence without dispatch; all six project steps; theme persistence; Publishing contrast; both viewport layouts; no jobs/enqueue/production or original-source mutations.

Resource observations: final bounded browser attempt had 618 MiB available before, 547 MiB at Editor and 543 MiB afterward. Earlier owned browser was safely closed below 128 MiB; no unrelated application was stopped. Focused Jest started at 589 MiB; its conventional TS transform exceeded its explicit heap, so the lightweight policy-only run replaced that runner, not the separate strict typecheck. No dependency, browser or model download occurred.

Manual screenshot review found two additional defects beyond the initial assertions: the legacy sidebar forced pale text with `!important` in Light mode, and selected catalog body text inherited a muted color. Fixed the originating sidebar colors to shared theme variables, darkened the active purple gradient for white text, and made selected-source text consistently white. A separate read-only `test/uiops02-theme.cjs` now checks the loaded detail (not a loading skeleton), records 16 settled contrast samples and captures both viewports/themes. Earlier supplemental capture attempts stalled on hidden-tab native pointer scheduling; their owned context/process was closed, then the bounded read-only runner completed successfully. These attempts did not write catalog/session data.

## Runtime, evidence and operation

URL: `http://127.0.0.1:3105/studio?area=Data%20Review` (REAL_DATA_COPY).

Worktree: `D:\LCOM108_NMLT\code\100_bai_code\Tiktok_Automation_uiops02`, branch `codex/uiops02-functional-ux`.

Runtime snapshot ID: `2026-11-06T11-41-24-096Z-1a8a0795-e5f3-49a3-a59f-ef6f35d82a3b`. Store is under sibling `Tiktok_Automation_uiops02_acceptance/<snapshot ID>/1_nest_backend/.studio-data`, not production. 204 copied files including frontend/public assets (~205.5 MiB), 9 sessions, 9 catalog posts, 5 pre-existing completed outputs. Outputs are not generated by UI-OPS-02. Credentials/OAuth vaults are excluded; outbound requests and unauthorized workers are blocked.

Local evidence (Git-ignored): backend `.studio-data/reports/uiops02/<snapshot ID>/`. `browser-latest.json` points to the combined 14-check report, geometry/Review screenshots and downloaded export files. `final-captures/` contains loaded Library screenshots; `copy-preservation.json`, `preservation.json` and the before/after manifests prove isolation. Earlier pre-redesign UI evidence remains in the original UI-OPS-01 reports; no fresh before screenshot is fabricated. Screenshots and reports may contain source content and remain local, not pushed.

Production manifest SHA-256 before **and** after: `e19574bf84fc07c88a165aa3958f50e579a93c289b6aeef2c0664c1f35a6c1e7`.

Copied-store baseline manifest SHA-256: `37a052e9aa689edb7cef7c715b0ecaba66e921b2a47630868e4579375e618a8d`.

The browser intentionally confirmed one copied UNKNOWN record as POST and exercised ACCEPT → REJECT → NEEDS_REVIEW. Current copy has one human-confirmed root, eight UNKNOWN and three history entries for that record; final content decision NEEDS_REVIEW, no queue/project creation. This is sandbox testing, not a review decision on production. All 9 existing session files, media, audio, originals and old Gold shadows stayed unchanged.

Restart from this worktree's `1_nest_backend` directory only when 3105 is not already responding:

```powershell
$r = Get-Content .studio-data/reports/uiops02/latest.json | ConvertFrom-Json
node scripts/studio-copy-runtime.cjs (Join-Path $r.run 'isolation.json')
```

This reuses the saved copy/configuration; do not run `studio-copy.cjs` prepare again to restart. Stop the foreground server with Ctrl+C. For a hidden server, fetch `/uiops02-proof` to obtain its PID, verify its command line belongs to this worktree's `studio-copy-runtime.cjs`, then stop **only that process**. Do not stop another port/process by name. The runtime guard accepts intended copied evaluation/session edits on restart but continues hashing immutable source/assets/frontend.

Validation commands: `node test/uiops02-contracts.cjs`; fresh browser harness `node test/uiops02-browser.cjs` (fresh acceptance copy required for initial UNKNOWN assumptions); optional `--reuse-local-browser` creates only an owned isolated context at local CDP 9222. `--continue` is for the existing bounded evidence on the same unchanged code/snapshot, not proof after a code change. Full preservation: `node scripts/studio-copy.cjs verify <report directory>`.

For this reviewed copy, `node test/uiops02-theme.cjs` repeats the read-only loaded-Library contrast/screenshots, using only a newly owned CDP context. The old 14-check report covers behavior/navigation; the later 16-sample report specifically covers the final CSS corrections.

## Status and remaining gates

WORKING: explicit project selection/navigation, catalog scopes/review/history/revisions, independent Gold feedback, full-run export/copy/download, configuration state persistence, shared themes, existing saved project workspaces and local preview boundary.

PARTIAL: collection scheduling is configuration-only; no operational public-crawler dispatcher. Real reply UI cannot be accepted against LIVE parent evidence because this copy has no verified collections. Full Jest remains resource-blocked. Geometry checks cover header/viewport bounds, not a claim that every historical Editor drag/trim/media feature was re-exercised in this task. Prior UI-OPS-01 saved audio/output evidence is retained but not reported as newly generated media.

DISABLED_BY_SAFETY: LIVE crawler/API/OAuth, scheduler dispatch, new TTS/render, enqueue/production approvals, publishing, uploaded-media deletion and new production project creation. Settings provides read-only runtime information; checks needing a live runtime explicitly remain locked.

GO for user review in isolated REAL_DATA_COPY. NO-GO for production writes or autonomous collection. No P0 catalog/scene identity leak or implicit project fallback remains in the covered navigation/review paths; overall verification remains PARTIAL because full Jest and LIVE reply acceptance are not completed. Original worktrees/branches stay unchanged; no merge.

Git checkpoints: `b05de67` audit, `7dc4964` backend review/report/config foundation, final frontend/browser/handover commit follows on the same dedicated feature branch. Exact final SHA/push status is supplied in the conversation to avoid a self-referential commit hash.
