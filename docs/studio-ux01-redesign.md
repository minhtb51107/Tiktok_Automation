# UX-01 — TikTok Automation Studio V2: Product Experience Redesign & Frontend Engineering

- **Branch**: `design/studio-v2`
- **Reference Session**: `35b8a880-b8b5-49ec-be42-0991228eb45e` (`Untitled project`, 5 Threads items, 5 Kokoro voices, 7 render records, 50 historical jobs)
- **Target Workflow**: `Threads Discovery → Data Processing → Content Evaluation → Production Queue → Video Generation → Quality Assurance → Draft Output`

---

## 1. Baseline UX Audit & Root-Cause Findings

Before editing any frontend code, the live Studio application was booted against the real reference session (`35b8a880-b8b5-49ec-be42-0991228eb45e`) and audited across 6 viewports (`1920×1080`, `1366×768`, `1024×768`, `768×1024`, `390×844`, `360×800`).

### Quantitative Baseline Telemetry

| Step / Area | Viewport `1920×1080` Height | Viewport `360×800` Height | Horizontal Overflow (`360×800`) | Critical Defect Observed |
| :--- | ---: | ---: | :---: | :--- |
| **1. Source** | `5,642 px` | `7,797 px` | **YES (`362 > 360`)** | 50 job rows + stage reports + 5 full Threads cards stacked vertically with no Scene Focus filter; `TopicEditor` existed in codebase (`VisualControls.tsx`) but was never mounted. |
| **2. Script** | `4,095 px` | `6,342 px` | No | All 5 normalization cards + ambiguity chips + raw/display/spoken textareas stacked simultaneously without a single-scene focus jumpbar. |
| **3. Voice** | `5,520 px` | `8,051 px` | No | 8 sample audio players + 5 scene narration cards + technical trace details stacked into an 8,000px wall on mobile. |
| **4. Video Editor** | `1,080 px` (locked) | `800 px` (crushed) | Clipping inside grid | Fixed 3-column grid (`242px minmax(0,1fr) 288px` = `530px` min) crushed the center 9:16 canvas to `80px` wide at `390×844` and `360×800`, overlapping the Inspector. Top step nav overlapped `.editor-jobs` ("All stage jobs"). |
| **5. Render** | `2,953 px` | `4,363 px` | No | Render job history and stage reports lacked a dedicated Production Queue view separating active/historical jobs from retained MP4 drafts. |
| **6. Publish** | `2,713 px` | `4,539 px` | No | Safety gates (`BLOCKED_APP_APPROVAL`, `UNKNOWN` rights) were buried below 50 historical job entries. |

### Root-Cause UX Issues Identified & Resolved

1. **Extreme Vertical Scrolling (`5,520px – 8,051px`)**:
   - *Cause*: `ProgressPanel` (rendering up to 50 historical jobs) and `StageReportPanel` were expanded above the workspace on every non-editor step, and `Source`, `Script`, and `Voice` rendered all 5 scenes vertically with no focus filter.
   - *Fix*: Collapsed `ProgressPanel` + `StageReportPanel` into a single compact top status drawer (`All stage jobs (50) · Standby`) and added a **Scene Focus Jumpbar** (`All scenes (5)` vs. `#1..#5`) on `Discovery (Source)`, `Script`, and `Voice`, reducing single-scene inspection height on `Source` from **`5,642 px` to `2,895 px` (-48.7%)**.
2. **Numeric-Only Inspector Controls Instead of Direct Scrubbing**:
   - *Cause*: `EditorInspector.tsx` required typing raw integers/floats into 8 separate `<input type="number">` fields (`Card X`, `Card Y`, `Card width`, `Card scale`, `Card padding`, `Font size`, `Line height`, `Section gap`).
   - *Fix*: Paired all 8 layout/typography properties with synchronized `<input type="range">` sliders + numeric inputs (`v2-slider-num`) for immediate visual scrubbing alongside direct canvas drag/resize.
3. **Crushed 9:16 Canvas on Tablet/Mobile (`768×1024`, `390×844`, `360×800`)**:
   - *Cause*: `.editor-panels` forced 3 columns simultaneously regardless of viewport width.
   - *Fix*: Added a responsive mobile/tablet pane switcher (`Scenes & Assets` | `9:16 Canvas` | `Inspector`) at `≤900px`, giving the 9:16 canvas 100% width on mobile and eliminating all horizontal overflow (`scrollWidth === clientWidth` across all 24 viewport×view combinations).
4. **Missing Operations IA (Dashboard, Medallion Data Review, Production Queue, Settings)**:
   - *Cause*: The legacy UI only exposed a 6-step manual wizard (`Source → Script → Voice → Video Editor → Render → Publish`) without an operations console for automated pipeline health, Bronze/Silver/Gold/Quarantine data triage, or FIFO queue management.
   - *Fix*: Introduced the 6-area primary navigation (`Dashboard`, `Discovery`, `Data Review`, `Production Queue`, `Video Studio`, `Settings`) while preserving the 6-step workflow bar for 100% backward compatibility.
5. **Fragmented Theme Experience**:
   - *Cause*: `Video Editor` had a dark/light dropdown, while `Source`, `Script`, `Voice`, `Render`, and `Publish` were hardcoded to light mode (`#f6f7fb`).
   - *Fix*: Unified the CSS custom-property token system (`html[data-studio-theme="DARK" | "LIGHT"]`) with a global header toggle (`☀ Light` / `☾ Dark`) synchronized with the editor theme selector.

---

## 2. Functional Preservation Inventory

Every existing user-facing capability was audited against the reference session (`35b8a880-b8b5-49ec-be42-0991228eb45e`, SHA-256 `add3e11415f1868136bdf0fa373d4417009cd963dde7086e24833fcdeaeb084d`) and verified to remain intact.

| Category | Capability | Status | Implementation / Verification Notes |
| :--- | :--- | :---: | :--- |
| **Project & Workflow** | Switch 6 workflow steps (`Source`..`Publish`) | `REGRESSION TESTED` | Preserved in top workflow bar + synchronized with 6 primary IA areas. |
| **Project & Workflow** | Switch between 6 IA areas (`Dashboard`..`Settings`) | `VERIFIED` | New sidebar IA in `main.tsx`. |
| **Project & Workflow** | Select existing session (`35b8a880...` + 8 others) | `REGRESSION TESTED` | Sidebar session list preserved; switching loads full session cleanly. |
| **Project & Workflow** | Create new `THREADS / SERIOUS` project (`+`) | `EXISTING` | Preserved in sidebar header. |
| **Project & Workflow** | Legacy workflows (`FUNNY`, `COMPILATION`, `LYRICS`) | `VERIFIED` | Disabled in UI with `Legacy` badge; existing sessions/code preserved untouched. |
| **Project & Workflow** | Save / Reopen session + Revision increment | `REGRESSION TESTED` | `Save project` (`Ctrl+S`) persists to `.studio-data/:id.json`. |
| **Project & Workflow** | Unsaved changes indicator (`Unsaved changes` / `Saved locally`) | `REGRESSION TESTED` | Verified in browser automation: dragging card flips state to `Unsaved changes`. |
| **Project & Workflow** | Undo / Redo (`Ctrl+Z`, `Ctrl+Y`, toolbar buttons) | `REGRESSION TESTED` | Verified in browser automation: Undo restores `cardY` and returns state to `Saved locally`. |
| **Project & Workflow** | `DRAFT` vs. `FINAL` approval safeguards | `REGRESSION TESTED` | Preserved across Script, Voice, Render, and Publish gates. |
| **Discovery & Source** | Up to 5 Threads URLs + `TARGET_ONLY` / `TARGET_AND_REPLIES` | `REGRESSION TESTED` | Preserved in `Discovery` (`Source`). |
| **Discovery & Source** | Per-URL retry (`Retry URL`), remove, resolution diagnostics | `REGRESSION TESTED` | Preserved in `Discovery` (`Source`). |
| **Discovery & Source** | Immutable original text (`originalText`) & provenance | `REGRESSION TESTED` | Read-only in both `Discovery` and `Data Review` drawer; never overwritten. |
| **Discovery & Source** | Editable `text` (Card Display) & `spokenText` (TTS) + Restore | `REGRESSION TESTED` | Available in `Discovery` and `Data Review` drawer with `MANUAL_LOCKS` badges. |
| **Discovery & Source** | Topic label override (`TopicEditor`) | `MOVED/REDESIGNED` | Restored and mounted inside each `Discovery` item's review details (`POST /api/studio/sessions/:id/topic/:itemId`). |
| **Script** | AI Normalization vs. Offline Deterministic Fallback | `REGRESSION TESTED` | Preserved in `ScriptWorkspace.tsx` + added Scene Focus jumpbar. |
| **Script** | Ambiguous / slang token warning pills (`5,6 quận`, `t`, `clm`) | `REGRESSION TESTED` | Surfaced in `Script`, `Dashboard` exceptions, and `Data Review` table. |
| **Script** | Accept / Edit / Reject AI proposal & `Approve spokenText` | `REGRESSION TESTED` | Preserved in `ScriptWorkspace.tsx`. |
| **Voice (Kokoro)** | List 5 Kokoro voices (`Diễm Trinh`, `Hưng Thịnh`, `Mai Linh`, `Mạnh Dũng`, `Mỹ Yến`) | `REGRESSION TESTED` | Verified in `Voice` and `Settings` (`5 voices ready`). |
| **Voice (Kokoro)** | Voice sample generation & per-scene/batch DRAFT synthesis | `REGRESSION TESTED` | Preserved in `VoiceWorkspace.tsx` + added Scene Focus jumpbar. |
| **Voice (Kokoro)** | Native `<audio controls>` playback for samples & scene narration | `REGRESSION TESTED` | 13 `<audio>` elements verified with valid `/api/studio/sessions/:id/audio/:aid` URLs. |
| **Voice (Kokoro)** | Cache hit/miss status, speed (`0.5×–3.0×`), technical trace | `REGRESSION TESTED` | Preserved in `VoiceWorkspace.tsx`. |
| **Video Studio** | Scene selection, enable/disable checkbox, `↑`/`↓` reorder | `REGRESSION TESTED` | Verified in `ProfessionalEditor.tsx`: clicking scene #2 seeks to `Frame 119 / 2390 · 3.97s`. |
| **Video Studio** | Direct 9:16 canvas drag, corner resize, center snap guide | `REGRESSION TESTED` | Verified in browser automation (`cardY` dragged from `288` to `364`). |
| **Video Studio** | Safe-area overlay toggle (`Safe areas`) | `REGRESSION TESTED` | Preserved in canvas header bar. |
| **Video Studio** | Remotion `<Player>` preview playback, frame seek, play/pause | `REGRESSION TESTED` | Preserved in `ProfessionalEditor.tsx`. |
| **Video Studio** | Multi-track Timeline (`Threads`, `Meme / GIF`, `Voice`, `SFX`, `BGM`, `Background`) | `REGRESSION TESTED` | All 6 tracks and 14 clips verified with click/drag/trim/split/zoom (`0.5×–3×`). |
| **Threads Card** | Avatar, username, topic, date, engagement counts, Light/Dark | `REGRESSION TESTED` | Rendered inside `Threads Post.tsx` on the 9:16 Remotion canvas. |
| **Threads Card** | Position, width, scale, padding, font size, line height, gap | `MOVED/REDESIGNED` | Enhanced in `EditorInspector.tsx` with 8 synchronized range sliders + number inputs. |
| **Media & Audio** | Asset Library category filters (`ALL`, `MEME`, `BG`, `SFX`, `BGM`), search, upload | `REGRESSION TESTED` | Preserved in `EditorAssetPanel.tsx` (`113 public assets` + `2 session media items`). |
| **Media & Audio** | Assign Meme/GIF, Background (`CONTINUOUS`/`SCENE`), Fit/Trim/Loop, SFX, BGM | `REGRESSION TESTED` | Preserved in `EditorAssetPanel.tsx` and `EditorInspector.tsx` (`Card`, `Meme`, `BG`, `Voice`, `SFX`, `BGM` tabs). |
| **Render** | Prepare preview, Render MP4 (`1080p`/`720p`), cancel, progress, download, reports | `REGRESSION TESTED` | Preserved in `RenderWorkspace.tsx` and surfaced in `Production Queue`. |
| **Publishing** | Safety gates (`BLOCKED_APP_APPROVAL`, `UNKNOWN` rights, disabled live transfer) | `REGRESSION TESTED` | Verified in `PublishWorkspace.tsx` and `Dashboard` (`liveTransferDisabled: true`). |

---

## 3. Exploration of Three Distinct Design Directions

### Direction A — Precision Workspace (Linear / Raycast / DaVinci Resolve Utility Inspired)
- **Visual Direction**: High-density technical workspace with ultra-crisp `1px` borders, tabular monospace numerals, compact status pills, and keyboard-first navigation.
- **Color System**: Deep slate-obsidian (`#0d0f14` background, `#141720` surface, `#262b38` hairlines, `#6c59e0` indigo accent).
- **Typography**: Inter / Segoe UI (`12px–13px` body) paired with JetBrains Mono / Consolas for frame counters, durations, and hashes.
- **Pros**: Maximum information density; zero wasted vertical space; ideal for triage tables and multi-track timelines.
- **Trade-offs**: Can feel overly austere for visual media preview if not balanced with generous canvas framing.

### Direction B — Modern Creative Studio (CapCut Pro / Descript / Frame.io Inspired)
- **Visual Direction**: Canvas-centric NLE layout where the 9:16 vertical video preview commands the center stage, surrounded by tactile scrubbers, visual asset thumbnails, and floating contextual tools.
- **Color System**: Neutral darkroom charcoal (`#111318` canvas surround, `#181b22` panels, vibrant violet/cyan track coding).
- **Typography**: Clean geometric sans-serif with bold section headers and visual sliders instead of raw numeric forms.
- **Pros**: Superior direct manipulation (`drag`, `resize`, `scrub`) and visual confidence when fine-tuning Threads cards.
- **Trade-offs**: Poor fit for batch data triage, duplicate detection, or monitoring 50 background pipeline jobs.

### Direction C — Intelligent Operations Console (Dagster / Prefect / Vercel Observability Inspired)
- **Visual Direction**: Pipeline-first control room emphasizing DAG stage health, Medallion data quality tiers (`Bronze / Silver / Gold / Quarantine`), worker concurrency telemetry, and exception queues.
- **Color System**: High-contrast semantic status palette (`Emerald #10b981` Success, `Amber #f59e0b` Warning, `Red #ef4444` Failed, `Rose #f43f5e` Blocked, `Purple #a855f7` Needs Review, `Blue #3b82f6` Running) on adaptive Light/Dark surfaces.
- **Typography**: Structured KPI numerals (`26px` tabular bold), uppercase micro-labels (`10px`, `0.5px` tracking), and scannable master-detail tables.
- **Pros**: Aligns directly with the product's strategic shift from manual editing to automated video production and exception handling.
- **Trade-offs**: Lacks deep frame-accurate NLE ergonomics if applied uniformly to the Video Studio step.

---

## 4. Recommended Hybrid Architecture: "Adaptive Operations & Precision NLE"

**Selection Rationale**: TikTok Automation Studio V2 has two distinct operational modes:
1. **Batch Pipeline & Quality Triage (`Dashboard`, `Discovery`, `Data Review`, `Production Queue`, `Settings`)**: Best served by **Direction C (Intelligent Operations Console) + Direction A (Precision Workspace)**—giving operators immediate visibility into Medallion tiers, ambiguity exceptions, FIFO queue state, and low-RAM guardrails.
2. **Exception Repair & Visual Fine-Tuning (`Video Studio`)**: Best served by **Direction B (Modern Creative Studio) + Direction A (Precision Workspace)**—locking the viewport to `100vh` (`overflow: hidden` on desktop) with a dedicated 3-zone NLE (`Scenes/Assets` | `9:16 Canvas` | `Contextual Inspector with Range Sliders`) + bottom `Multi-Track Timeline`.

---

## 5. Design System Specification (`studio.css` & `editor.css`)

### 5.1 Design Tokens (Adaptive Dark & Light Themes)

```css
html[data-studio-theme="DARK"] {
  --v2-bg: #0d0f14;
  --v2-surface: #141720;
  --v2-surface-2: #1b1f2b;
  --v2-border: #262b38;
  --v2-text: #f1f5f9;
  --v2-muted: #94a3b8;
  --v2-accent: #7c66ff;
  --v2-accent-soft: rgba(124, 102, 255, 0.16);
}

html[data-studio-theme="LIGHT"] {
  --v2-bg: #f4f6fb;
  --v2-surface: #ffffff;
  --v2-surface-2: #eef2f8;
  --v2-border: #dde3ee;
  --v2-text: #0f172a;
  --v2-muted: #5b6478;
  --v2-accent: #4c3bcf;
  --v2-accent-soft: rgba(76, 59, 207, 0.1);
}
```

### 5.2 Semantic Status & Medallion Tokens
- **`SUCCESS`**: `rgba(16, 185, 129, 0.16)` bg / `#10b981` text (`READY`, `SUCCEEDED`, `LIVE DATA`)
- **`WARNING`**: `rgba(245, 158, 11, 0.16)` bg / `#d97706` text (`PARTIAL`, `AMBIGUITY`, `CANCELLED`)
- **`FAILED`**: `rgba(239, 68, 68, 0.16)` bg / `#ef4444` text (`FAILED`, `ERROR`)
- **`RUNNING`**: `rgba(59, 130, 246, 0.16)` bg / `#3b82f6` text (`RUNNING`, `QUEUED`)
- **`BLOCKED`**: `rgba(244, 63, 94, 0.16)` bg / `#f43f5e` text (`BLOCKED`, `LOCKED`, `STRICT`)
- **`NEEDS_REVIEW`**: `rgba(168, 85, 247, 0.16)` bg / `#a855f7` text (`NEEDS_REVIEW`, `WAITING_REVIEW`, `[SIMULATED / CONTRACT PREVIEW]`)
- **Medallion Tiers**: `.tier-gold` (`#facc15` / `#ca8a04`), `.tier-silver` (`#cbd5e1` / `#64748b`), `.tier-bronze` (`#fbbf24` / `#b45309`), `.tier-quarantine` (`#f87171` / `#dc2626`).

---

## 6. Information Architecture (6 Core Areas)

1. **`Dashboard` (`DashboardWorkspace.tsx`)**:
   - 6-card KPI summary (`Collected Posts`, `Qualified Gold/Silver`, `Narration Coverage`, `Production Queue`, `Completed Drafts`, `Safety & Publishing`).
   - Interactive 6-node Pipeline Health Flow (`01 Threads Discovery` → `06 Publishing Gate`) where clicking any stage navigates directly to its workspace.
   - `Actionable Exceptions & Quality Gates` list (surfacing scenes with ambiguous Vietnamese tokens or unapproved spoken text) + `Worker & Hardware Resource Telemetry` (Kokoro 0.1.0, CPU 1.2×, Concurrency 1, 768 MiB V8 heap limit).
2. **`Discovery` (`main.tsx` + `VisualControls.tsx`)**:
   - Multi-URL Threads input (`TARGET_ONLY` / `TARGET_AND_REPLIES`), per-URL status/retry/diagnostics, Scene Focus jumpbar (`All items (5)` or `#1..#5`), immutable original text vs. editable display/spoken text, and restored `TopicEditor`.
3. **`Data Review` (`DataReviewWorkspace.tsx`)**:
   - Medallion tier filter bar (`All`, `Gold`, `Silver`, `Bronze`, `Quarantine`) + real-time text search.
   - Master-detail evaluation table with quality score (`0–100`), narration duration, ambiguity lock badges, `Accepted` / `Excluded` toggle, `↑`/`↓` ordering, and a right-hand inspection drawer.
4. **`Production Queue` (`OperationsWorkspaces.tsx`)**:
   - `Retained Video Drafts` grid for `.studio-data/renders` MP4 outputs with direct `Download MP4` and `Open Stream` links.
   - Filterable `FIFO Job Queue` (`ALL`, `RENDER`, `EDITOR`, `VOICE`, `MEDIA`, `SCRIPT`) showing job ID, operation, progress units, elapsed seconds, diagnostics count, and quick stage jump.
5. **`Video Studio` (`ProfessionalEditor.tsx`, `EditorInspector.tsx`, `EditorTimeline.tsx`, `EditorAssetPanel.tsx`)**:
   - Full-viewport 3-zone NLE on desktop + responsive 3-pane switcher (`Scenes & Assets` / `9:16 Canvas` / `Inspector`) on tablet/mobile.
   - Direct canvas manipulation + 8 range-slider/number-input pairs in Inspector + 6-track timeline.
6. **`Settings` (`OperationsWorkspaces.tsx`)**:
   - Real Kokoro runtime preflight telemetry, public asset inventory by category (`113 assets`), low-RAM worker guardrails, global Dark/Light switcher, and clearly badged `[SIMULATED / CONTRACT PREVIEW]` autopilot discovery schedule rules.

---

## 7. Build, Typecheck, Browser Validation & Test Results

- **Frontend Bundle (`2_Remotion_Video`)**:
  - `npm run studio:build` → **PASS** (`studio-dist/app.js` `1.9mb`, `studio-dist/app.css` `45.7kb`, exit code `0`).
  - `npx tsc --noEmit` → **PASS** (exit code `0`, zero TypeScript errors).
- **Real Browser & Responsive Validation (`http://127.0.0.1:3010/studio`)**:
  - Verified across all 6 viewports (`1920×1080`, `1366×768`, `1024×768`, `768×1024`, `390×844`, `360×800`) on `Dashboard`, `Data Review`, `Discovery`, and `Video Studio`: **`hasHorizontalOverflow: false` on 24 / 24 checks**.
  - `pageErrors`: `[]` (0 uncaught runtime errors).
  - Reference session `35b8a880-b8b5-49ec-be42-0991228eb45e.json` SHA-256 before and after browser validation: `add3e11415f1868136bdf0fa373d4417009cd963dde7086e24833fcdeaeb084d` (**100% unmodified**).

---

## 8. Tested vs. Untested Matrix

| Area / Feature | Verification Method | Status | Evidence |
| :--- | :--- | :---: | :--- |
| **6-Area IA Navigation & 6-Step Bar** | Live Chrome (`Puppeteer`) + Visual Screenshots | `PASS` | All 6 IA views and 6 workflow steps render with 0 page errors. |
| **Responsive Layout (6 Viewports)** | Live Chrome (`1920×1080` down to `360×800`) | `PASS` | `scrollWidth === clientWidth` across all 24 viewport checks. |
| **Data Review Medallion Triage** | Live Chrome + Real Session `35b8a880` | `PASS` | Correctly classifies `3 Gold` (`100/100`) and `2 Silver` (`82/100`, `52/100` due to ambiguous terms). |
| **Scene Focus Jumpbar (Scroll Reduction)** | Live Chrome DOM Measurement | `PASS` | Reduces `Source` page scroll height from `5,642 px` to `2,895 px`. |
| **Video Studio Scene Select, Drag & Undo** | Live Chrome Pointer Events | `PASS` | Scene #2 seeks to `Frame 119 / 2390 · 3.97s`; drag updates `cardY` `288 → 364` (`Unsaved changes`); Undo restores `Saved locally`. |
| **Inspector Dual Range + Number Controls** | Live Chrome DOM Inspection | `PASS` | 8 synchronized range sliders + number inputs verified in `EditorInspector`. |
| **Kokoro Voice Playback & Asset URLs** | Live Chrome DOM Inspection | `PASS` | 5 voices listed; 13 `<audio>` elements wired to `/api/studio/sessions/:id/audio/:aid`. |
| **Retained MP4 Drafts & Download Links** | Live Chrome DOM Inspection | `PASS` | 7 render jobs listed; completed MP4 download link verified. |
| **Publishing Safety Gates** | Live Chrome DOM Inspection | `PASS` | `BLOCKED_APP_APPROVAL`, `UNKNOWN` rights block, and disabled live transfer verified. |
| **Live Threads Scraping / Live Kokoro Synthesis / Full MP4 Render** | Existing Session Artifacts Used (No Heavy Re-run) | `NOT RUN` | Per `AGENTS.md` low-RAM / non-destructive rules, existing session `35b8a880` audio/MP4 artifacts were inspected rather than triggering new heavy scrapes/renders. |

---

## 9. Backend API & Contract Requests for Codex

No backend files were modified in `design/studio-v2`. To transition the `[SIMULATED / CONTRACT PREVIEW]` elements in `Discovery`, `Data Review`, and `Settings` to persisted backend state in future sprints, the following additive contract extensions are proposed for Codex:

1. **Persisted Medallion Evaluation Metadata (`ContentItem.evaluation`)**:
   - Currently, `studio-v2-adapter.ts` computes `tier` (`GOLD | SILVER | BRONZE | QUARANTINE`), `qualityScore` (`0–100`), and `duplicateGroupId` deterministically on the client from `item.text`, `item.spokenText`, `session.script.items`, and `session.voice.sceneAudio`.
   - *Request*: Persist `evaluation?: { tier: 'BRONZE' | 'SILVER' | 'GOLD' | 'QUARANTINE'; score: number; duplicateGroupId?: string; reviewerDecision?: 'ACCEPTED' | 'REJECTED' | 'NEEDS_REVIEW'; quarantineReason?: string }` on `StudioSession` (`1_nest_backend/src/video-pipeline/contracts.ts`).
2. **Discovery Source Profiles & Rate-Limit Telemetry (`GET /api/studio/discovery/sources`)**:
   - Currently, `Discovery` and `Settings` display a clearly badged `[SIMULATED / CONTRACT PREVIEW]` table for saved Threads topic queries (`threads.com/tag/cong-viec-tphcm`, `threads.com/tag/kinh-te-vi-mo`).
   - *Request*: Add a read/write local JSON store for saved discovery queries, last fetch timestamp, cooldown/rate-limit window, and manual trigger endpoint (`POST /api/studio/discovery/run-source`) while keeping startup auto-scrape strictly `OFF`.
3. **Lightweight Worker Memory Telemetry (`GET /api/studio/runtime-preflight`)**:
   - *Request*: Include `process.memoryUsage().rss` and `os.freemem()` in `StudioRuntimePreflight` so the `Dashboard` hardware card can display live MB utilization alongside the static `768 MiB` V8 heap limit.

---

## 10. UX-02 Roadmap

1. **UX-02.1 — Keyboard Command Palette & Timeline Shortcuts**:
   - Add `Ctrl+K` quick-jump palette (jump to scene `#1..#5`, toggle theme, filter Gold/Silver, jump to frame) and `Space` / `J` / `K` / `L` shuttle shortcuts in `Video Studio`.
2. **UX-02.2 — Batch Data Review Actions & Diff View**:
   - Add multi-select batch `Accept All Gold`, side-by-side inline character diff (`originalText` vs. `spokenText`), and one-click duplicate cluster resolution once Codex adds `ContentItem.evaluation`.
3. **UX-02.3 — Waveform & Phoneme Scrubbing in Timeline**:
   - Render lightweight canvas amplitude bars inside the `Voice` and `BGM` timeline clips using Web Audio API peaks cached per audio ID.
