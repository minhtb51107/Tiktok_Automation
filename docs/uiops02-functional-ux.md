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

Backend foundation verified: TypeScript/build PASS and 8/8 isolated executable contract checks PASS. These cover UNKNOWN classification, explicit project IDs, full 27-observation export beyond a 25-row page, review history/revision/immutable source, same-author identity, nested parent evidence, independent Gold feedback and configuration-only state transitions. All fixtures are explicitly SYNTHETIC; real-copy browser acceptance remains pending. No LIVE action or production approval occurred.

Focused Jest was initially deferred at 504 MiB available RAM (resource gate); this is not a FAIL or a PASS. Pending: final frontend navigation/theme/layout regression, isolated real-copy browser acceptance and preservation hashes.

Full Jest is conditional on RAM. The previous UI-OPS-01 17-policy / 15-browser / 7-handover results do not establish UI-OPS-02 PASS. No P0 may be declared resolved from component rendering alone.
