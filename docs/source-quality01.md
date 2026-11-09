# SOURCE-QUALITY-01

Branch codex/source-quality-01 from 205ab9b. Offline only; no new source request.

## Findings and fixes

- stage-report.ts mapped records[0] only; context was counted but its bodies were
  absent. sourceCards now includes root plus every saved context with original
  text, author, URL, selected/materialized state, media and relationship evidence.
  Original/extracted text remains immutable. Quick Markdown contains all full
  bodies with concise metadata; full Markdown and JSON retain analysis/evidence.
- StageReportPanel used the same verbose Markdown for Copy and had no Markdown
  download. Copy now uses quick SOURCE Markdown plus clipboard fallback; both
  Markdown and JSON exports remain available.
- public-threads.ts joined all span[dir=auto] descendants, mixing time/controls
  into body. The separate body projection now excludes structural time, button,
  role-button, author/permalink and topic links. Raw content/spans stay intact.
  Saved captures use a separate advisory projection based on stored timestamp
  labels / DOM-time provenance and terminal reveal-control labels. It never
  changes saved display/spoken edits automatically. Applying the projection is
  an explicit user edit with existing locks/revision behavior.
- Source cards were fully expanded. They are now compact with expandable detail,
  explicit quality reasons, all/recommended/low-value filters and select/deselect
  visible controls. A heuristic never prevents draft use or deletes a card.

## Quality V1

Deterministic length/missing content, exact duplicate, lexical Jaccard near
duplicate (>=0.9, >=8 distinct tokens), root lexical overlap and argument/experience
markers. Known/missing provenance is explicit. Short clear counterarguments may
be recommended. Lexical relevance and dialogue markers do not establish semantic
understanding, actual parentage, engagement or confidence probabilities.

LIVE02 replay: 8 context cards retained; 2 RECOMMENDED, 3 NEEDS_REVIEW, 3 LOW_VALUE.
No deletion/selection/approval is implied. Root remains UNKNOWN, all 8 context
relationships OBSERVED_ON_TARGET_PAGE, parent-verified count 0.

Counts distinguish observed (9 including root), materialized (9), selected (1),
excluded from current selection (8), unmaterialized context (0), verified parent
(0). Crawl time comes from persisted attempt.elapsedMs (4,837ms); Studio import
time comes from sourceRun (2ms, offline replay of captured response). These are
different operations, not a single live crawl duration. Report read/assembly is
measured separately at request time. No retrospective peak resource claim.

## Verification

- Backend build/TypeScript exit 0; frontend TypeScript/bundle exit 0.
- test/source-quality01.cjs: actual saved capture replay PASS. Asserts all 8 full
  texts and URLs in both reports, raw/session preservation, clean root projection,
  quality edge cases, selection/save/reopen and revision in temporary store.
- test/source-quality01-browser.cjs: actual local browser PASS. Copy includes
  all 8 full bodies/URLs, JSON and Markdown download validate, 9 cards collapsed,
  low-value filter shows 3; no browser exceptions. Browser requests restricted to
  loopback. No HTTP response mock used.
- Production baseline 933 files, 0 changed, 0 unreadable. Existing session untouched.
- Full Jest and actual new Threads DOM parse NOT RUN. No live quality/recall claim.

Example real quick report (all 8 bodies) and exports are outside Git at:
`D:\LCOM108_NMLT\code\100_bai_code\Tiktok_Automation_restore01_live02\run-20261107-01\source-quality01\quick.md`
with full.md/report.json and per-browser-run downloaded reports/screenshots.

Studio remains http://127.0.0.1:3107/studio?session=e7e17c42-46d5-43ab-bc73-2ef4066935f5&area=Video%20Studio&step=Source
using the existing restore01-runtime.cjs isolated runtime. No credentials copied.

## Separate LIVE-03 proposal — NOT AUTHORIZED / NOT RUN

One exact target DfWJxiID7E5; one browser; 60s total, <=150 requests, <=2 main
navigations, <=4 bounded scroll/load-more actions, <=40 observed candidate cards,
retain <=20 candidates with explicit heuristic ranking plus original observed
order. No minimum reply count or coverage promise. Snapshot cards at each step,
dedup by own permalink, preserve full raw payload and checkpoint before ranking.
Stop for login/CAPTCHA/access protection, deadline/request/card budget or <384MiB
available RAM. Do not traverse recommended posts or invent parent evidence. No
retry/extra target/approval/enqueue/TTS/render/publish. Require separate user
authorization before any source access. The 692 UI count supplied by the user is
not a verified reply sample or a coverage denominator for this offline checkpoint.
