# UX-02 — Creative Operations Studio Visual Overhaul (Stage 1: App Shell & Dashboard)

- **Worktree**: `D:\LCOM108_NMLT\code\100_bai_code\Tiktok_Automation_studio_v2`
- **Branch**: `design/studio-v2`
- **Baseline Checkpoint**: `7f8db07`
- **Reference Session**: `35b8a880-b8b5-49ec-be42-0991228eb45e` (SHA-256 `add3e11415f1868136bdf0fa373d4417009cd963dde7086e24833fcdeaeb084d`, unmodified)

---

## 1. Visual Analysis of Reference Images & 3 Design Directions

### Reference Image Breakdown
1. **Reference 1 (`media_1793640206948_750068b6.png`) — Split-Surface Studio Shell**:
   - Features an obsidian dark sidebar (`#121216`) paired with a high-contrast content surface, a tactile 3D spotlight card (*"Meet Gabriel at the International Library"* with a dimensional 3D book illustration and pill CTAs), and pastel semantic event blocks (`#b8dcff` sky, `#98e6b4` mint, `#cdb8ff` lavender, `#ffe18d` buttercup, `#ffb8dc` rose).
2. **Reference 2 (`media_1793640219039_7a5ed65e.png`) — Expressive Chromatic Dark Bento**:
   - Features a deep charcoal workspace (`#16161d`) with saturated, color-drenched cards where the card background itself carries semantic meaning (`#fce068` buttercup, `#8fa0ff` periwinkle, `#ff8ad8` flamingo, `#8ec8ff` sky) with dark ink (`#121218`) typography inside the colored cards.
   - Includes a diagonal striped progress bar (`Complete 3/5`) with an inline checklist, a bottom `Team Insights` vertical pill bar chart, an active violet gradient sidebar pill (`#6d5dfc`), a bottom `☀ / 🌙` theme dock, and a dashed `+ Add New Project` card.
3. **Reference 3 (`media_1793640229377_2a9d994b.png`) — Editorial Warm Light Bento**:
   - Features an airy alabaster canvas (`#f7f6f9`) with warm sand (`#fbe8ce`), acid-lime (`#d4fc79`), and soft lavender (`#e7e4ff`) rounded containers (`24px` radius) and high-contrast ink pill buttons (`#0e0e14`).

### 3 Proposed Visual Directions
| Direction | Concept | Pros | Cons | Verdict |
| :--- | :--- | :--- | :--- | :--- |
| **Direction A: Split-Surface Editorial** (Ref 1 + Ref 3) | Dark glass sidebar + bright editorial canvas with pastel timeline blocks | High readability for text-heavy review | Bright main canvas can cause eye fatigue during long 9:16 video preview sessions | Integrated as the **Light Theme (`[data-theme="light"]`)** |
| **Direction B: Chromatic Bento Studio** (Ref 2 + Ref 1 + Ref 3) | Deep obsidian shell + color-drenched semantic Bento cards (Periwinkle, Buttercup, Flamingo, Mint) + live 9:16 phone bezel + tactile 3D SVG illustrations + warm sand/lavender light mode | Answers the 4 core operational questions in <3 seconds; strong visual personality; eliminates flat gray rectangles | Requires disciplined typography contrast inside colored cards (`#121218` ink on pastel/vivid fills) | **Selected Primary Direction** (Dark default + Editorial Light toggle) |
| **Direction C: Spatial Glass Canvas** | Floating translucent panels over a full-bleed background | Futuristic aesthetic | Competes with Remotion 9:16 video canvas and degrades performance on low-RAM machines | Rejected |

---

## 2. Information Architecture & Navigation Redesign

### Eliminating Duplicate Navigation
- **Problem in V2**: The sidebar and the 6-step horizontal bar (`1. Nguồn bài → 6. Xuất bản`) plus a top job drawer appeared simultaneously on every screen, creating visual clutter and redundant navigation.
- **V3 Solution**:
  - On **Dashboard**, **Duyệt dữ liệu (`data-review`)**, **Hàng đợi (`production-queue`)**, and **Cài đặt (`settings`)**, the 6-step bar and top job drawer are **completely hidden**.
  - Contextual step pills (`.v3-contextual-steps`) appear **only** when the user enters manual studio workflows (`Khám phá Threads` or `Xưởng Video`).

### Removing Legacy Workflows from Active UI
- Removed **FUNNY**, **COMPILATION**, and **LYRICS** completely from the sidebar, project creation flows, and active navigation.
- All historical session files and legacy code on disk remain untouched.

---

## 3. Content-First Dashboard (Zero Information Dump)

The redesigned Dashboard (`DashboardWorkspace.tsx`) answers the 4 primary user questions immediately via **Row 1 — 4 Chromatic Bento Cards**:
1. **Hệ thống đang làm gì?** → **Periwinkle Card (`Đang dựng tự động`)**: Shows the active Threads pipeline (`5 cảnh nối tiếp · 87.3 giây · Giọng Kokoro am_adam`) with a 3D-style megaphone/waveform illustration and one-click `Mở Xưởng Video →`.
2. **Có điều gì cần tôi xử lý?** → **Buttercup Card (`5 bài cần bạn duyệt`)**: Shows the author avatar stack, plain-language explanation (*"Xác nhận loại bài viết & kiểm tra 2 bài có từ viết tắt"*), and `Duyệt 5 bài ngay →`.
3. **Có video nào đã hoàn thành?** → **Mint Card (`1 Video MP4 hoàn chỉnh`)**: Shows the completed `93.1 MB · 1080×1920 · 30fps` draft video with `▶ Xem & Tải MP4`.
4. **Tôi cần nhấn vào đâu để tiếp tục?** → **Flamingo Card (`Tiến độ công việc · 3/5 bước`)**: Features the Ref 2 diagonal striped progress bar, an interactive 5-step checklist highlighting the exact current action (`[!] Duyệt 5 bài DATA-01`), and `Làm bước tiếp theo →`.

### Visual Components in Row 2 & Progressive Disclosure in Row 3
- **Live 9:16 Phone-Bezel Video Preview**: Streams the real rendered MP4 (`/api/studio/sessions/35b8a880.../renders/b5a16c6d.../video`) inside a tactile phone frame with direct play/pause and download controls, paired with a 4-stage interactive pipeline (`Thu thập → Chấm điểm → Giọng đọc → Xuất MP4`) and a real 5-scene Duration & Score pill bar chart.
- **5 Tactile Source Post Cards**: Displays the 5 real Threads posts with cached local author avatars, `@handle`, topic pill, `Cần duyệt · XX.Xđ` badge, quoted excerpt, audio duration chip, and contextual actions (`Duyệt bài`, `Lời đọc`).
- **Progressive Disclosure Footer (`<details>`)**: Technical metadata (Session UUID, SHA-256 audio hashes, Remotion composition IDs) is tucked inside a collapsible `Chi tiết kỹ thuật` drawer at the bottom of the page.

---

## 4. DATA-01 Accuracy Investigation & Fix

### Why Studio V2 Showed `3 Gold / 2 Silver` vs. `DATA-01` Showing `5 NEEDS_REVIEW`
1. **Root Cause**:
   - Branch `design/studio-v2` was created before `DATA-01` commits `d0ad9b2` and `d7927ba` landed on `feature/threads-serious-studio`.
   - In V2 (`7f8db07`), `studio-v2-adapter.ts` computed a client-side heuristic (`estimateQualitySignals`) from the session JSON and labeled 3 posts `Gold` and 2 posts `Silver`.
2. **Actual `DATA-01` Engine Truth**:
   - In `1_nest_backend/src/data-engine/engine.ts` and `.studio-data/reports/data01/real-dataset.json`, **Bronze → Silver → Gold** are sequential pipeline layers (`5 Bronze observations → 5 Silver normalized → 5 Gold scored`), not quality tiers.
   - Inside the Gold catalog (`/api/studio/data`), all **5 posts** have `state: "SCORED"` and `eligibility: "NEEDS_REVIEW"` (`counts: { SCORED: 5 }`, `qualifiedRatio: 0`):
     - `post-2f890f3aa63f` (`@phuonglinh.916`, score `75.29`) — `NEEDS_REVIEW` (`entityType: UNKNOWN`)
     - `post-174f139f7276` (`@h_anh206`, score `76.43`) — `NEEDS_REVIEW` (`entityType: UNKNOWN`)
     - `post-5fa03c6812ca` (`@m_nhon07`, score `82.61`) — `NEEDS_REVIEW` (`entityType: UNKNOWN`)
     - `post-9474ca15dc13` (`@quyenminh.le`, score `75.47`) — `NEEDS_REVIEW` (`entityType: UNKNOWN` + `POLICY_RISK` slang `clm/cmn`)
     - `post-bf74566ab8a2` (`@twice_._not`, score `69.46`) — `NEEDS_REVIEW` (`entityType: UNKNOWN` + `POLICY_RISK` slang `đcđ`)
3. **Fix Implemented**:
   - Connected `studio-v2-adapter.ts` (`fetchData01Catalog`) and `DataReviewWorkspace.tsx` directly to `GET /api/studio/data`, `POST /api/studio/data/posts/:id/review`, and `POST /api/studio/data/import-session`.
   - Replaced the misleading `3 Gold / 2 Silver` count with the real `DATA-01` status (`5 bài cần duyệt / 0 đủ chuẩn tự động`) and explicit provenance badges (`REAL DATA`, `NEEDS REVIEW`, `NOT CONNECTED`, `MOCK DATA`).
