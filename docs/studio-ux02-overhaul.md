# UX-02 — Creative Operations Studio Visual Overhaul (Stage 1 & Stage 2)

- **Worktree**: `D:\LCOM108_NMLT\code\100_bai_code\Tiktok_Automation_studio_v2`
- **Branch**: `design/studio-v2`
- **Stage 1 Checkpoint**: `e1541ec` (App Shell / Navigation + Chromatic Bento Dashboard)
- **Stage 2 Scope**: `Data Review` (Priority #1) → `Discovery` (Priority #2) → `Production Queue` (Priority #3)
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

## 2. Stage 1 Summary: Information Architecture & Chromatic Bento Dashboard (`e1541ec`)

- **Eliminated Duplicate Navigation**: The 6-step horizontal bar (`1. Nguồn bài → 6. Xuất bản`) and top job drawer are completely hidden on `Tổng quan Studio`, `Nguồn bài Threads` (`Discovery`), `Duyệt dữ liệu`, `Kho Video & Hàng đợi`, and `Cấu hình`, appearing only inside the manual Video Studio (`Script`, `Voice`, `Editor`, `Render`, `Publish`).
- **Removed Legacy Workflows from Active UI**: `FUNNY`, `COMPILATION`, and `LYRICS` are removed from active navigation while preserving all historical sessions on disk.
- **Content-First Dashboard**: Answers the 4 primary user questions in <3 seconds via 4 color-drenched Bento cards, a live 9:16 phone-bezel video preview, a 4-stage pipeline, and 5 tactile Threads source cards.

---

## 3. Stage 2 Overhaul: `Data Review → Discovery → Production Queue`

### Priority 1: Data Review (`DataReviewWorkspace.tsx`)
Replaced the technical admin `<table>` with a user-centric **Threads Post Card & Split Review Studio**:
- **Visual Threads Post Cards**: Each card displays the author's real avatar (`item.avatarUrl` with fallback initials), display name, `@handle`, topic tag (`#công việc tphcm`), published date (`📅 Đăng ngày 08/08/2026` from `DATA-01` Bronze `publishedAt`), word count, Kokoro audio duration (`🎙 3.5s`), engagement metrics (`♥ 10.5K · 💬 355 · ↻ 284`), and a semantic status badge (`⏳ Cần bạn duyệt`, `✓ Đạt chuẩn`, `🎬 Trong hàng đợi`, `✕ Đã từ chối`).
- **Two View Modes (`Xem nhanh (Thẻ)` vs. `Xem chi tiết & Lịch sử`)**:
  - **Quick Scan Grid (`Xem nhanh (Thẻ)`)**: Multi-column responsive card grid for rapid scanning and batch selection.
  - **Split Detail Studio (`Xem chi tiết & Lịch sử`)**: Left column shows visual post cards; right column shows a sticky 3-tab Inspector (`🎯 Vì sao & Duyệt`, `✍ Lời đọc & Hiển thị`, `🕒 Lịch sử`).
- **Plain-Language Diagnostic Explanations (Zero Technical Jargon Dump)**:
  - Every card surfaces two scannable visual rows: **`Điểm mạnh:`** (green pills: `✓ Điểm cấu trúc & nội dung tốt (75/100)`, `✓ Độ dài nhịp đọc tốt (15 từ)`, `✓ Tương tác cao (10.5K lượt thích)`) and **`Cần kiểm tra:`** (amber/danger pills: `⚠ Chưa xác nhận loại bài (Bài gốc hay Bình luận)`, `⚠ Phát hiện từ viết tắt / tiếng lóng (clm, đcđ...)`).
  - Inside the detail drawer, all 6 `DATA-01` Gold breakdown metrics (`Độ khớp chủ đề mục tiêu`, `Độ đầy đủ ngữ cảnh`, `Sức hút thảo luận`, `Độ phù hợp nhịp đọc Video`, `Độ mới bài viết`, `Tương tác cộng đồng`) are rendered as visual progress bars with Vietnamese explanations.
- **Explicit 3-Decision Controls + Confirmation Modal**:
  - Each card and the detail drawer include an inline Entity Type segmented selector (`Bài gốc` / `Bình luận`) and 3 tactile decision buttons (`✓ Chấp nhận`, `⏳ Cần xem lại`, `✕ Từ chối`).
  - Every data-affecting review action opens a confirmation dialog (`[data-testid="review-confirm-modal"]`) with preset Vietnamese review reasons, custom note input, and explicit confirmation before calling `POST /api/studio/data/posts/:id/review`.
- **Multi-Select Batch Review (No Auto-Approval)**:
  - Users can select multiple cards via checkboxes or `Chọn tất cả đang lọc`, opening a floating Batch Review Bar (`[data-testid="batch-review-bar"]`) that requires explicit confirmation before applying `ACCEPT`, `NEEDS_REVIEW`, or `REJECT` across selected posts.
- **Review & State Transition History**:
  - The `🕒 Lịch sử` tab fetches `GET /api/studio/data/posts/:id` (`fetchData01PostDetail`) and displays a chronological timeline (`[data-testid="review-history-timeline"]`) of every state transition (`DISCOVERED → VALIDATED → SCORED → QUALIFIED/REJECTED`) and human review decision.

### Priority 2: Discovery (`DiscoveryWorkspace.tsx`)
Replaced the raw scraper form with a transparent, extensible **3-Mode Threads Discovery Hub**:
- **Mode 1 — Direct URLs & Manual Input (`🔗 Dán Link & Nhập bài trực tiếp`)**:
  - Works immediately with one primary CTA (`🚀 Bắt đầu Thu thập & Đưa vào Duyệt`), multi-URL badge counter, topic tag input, comment limit selector (`1–10`), context mode toggle, and manual fallback post composer.
- **Mode 2 — Official Threads Keyword Collector (`🔍 Từ khóa & Threads API` — Connected to `DATA-02`)**:
  - Queries `GET /api/studio/threads/auth/status` (`fetchThreadsDiscoveryState`).
  - Explicitly surfaces the live connection state (`CHƯA KẾT NỐI THREADS API — BLOCKED_AUTH`), lists the 4 required `.env` keys (`THREADS_APP_ID`, `THREADS_APP_SECRET`, `THREADS_REDIRECT_URI`, `THREADS_ACCESS_TOKEN`) and 2 required OAuth scopes (`threads_basic`, `threads_keyword_search`), provides a multi-keyword tag builder, and disables `POST /api/studio/threads/collect` when credentials are missing so the UI **never fakes an active crawler**.
- **Mode 3 — Future Collection Schedule (`🗓 Lịch thu thập tự động` — Connected to `DATA-02 Scheduler`)**:
  - Queries `GET /api/studio/threads/scheduler` and saves real configuration via `POST /api/studio/threads/scheduler/configure` (interval selector `1h / 3h / 6h / 12h / 24h`, minimum inventory target, review backlog pause limit, and scheduled keyword tags) while clearly stating that background crawling stays paused until `THREADS_ACCESS_TOKEN` is connected and the user explicitly enables it.
- **Visual Collected Posts Grid**:
  - Displays the 5 collected Threads posts as visual cards below the Discovery Hub with direct navigation to `Chuyển sang Duyệt dữ liệu (5 bài) →`.

### Priority 3: Production Queue (`OperationsWorkspaces.tsx` — `ProductionQueueWorkspace`)
Redesigned the technical job log into a **3-Zone Visual Video Production Board**:
- **Zone 1 — Exported MP4 Videos (`🎬 Video MP4 Đã xuất`)**:
  - Renders each exported `.mp4` inside a 9:16 vertical video preview card (`<video preload="metadata" muted playsInline>`), paired with resolution (`1080×1920 · 30fps`), file size (`93.1 MB`), render elapsed duration (`534.7s`), `DRAFT — Chưa duyệt xuất bản` safety badge, and direct `⬇ Tải MP4` / `↗ Xem toàn màn hình` actions.
- **Zone 2 — Active Video Production Storyboard (`🎞 Bản dựng Hiện tại — 5 cảnh nối tiếp`)**:
  - Visualizes the active project's 5 scenes as a horizontal storyboard strip showing scene readiness (`5/5 cảnh đã có giọng đọc Kokoro · 100% SẴN SÀNG`), individual scene duration (`3.5s`, `10.5s`, `30.3s`, `23.2s`, `9.6s`), author avatar, and script excerpt, with CTAs to open the 9:16 Canvas (`Mở Bàn dựng 9:16`) or render a new MP4 (`Xuất bản nháp MP4 mới`).
- **Zone 3 — Technical Pipeline Jobs (`⚙ Nhật ký Tác vụ Kỹ thuật`)**:
  - Displays FIFO backend jobs with category filter pills (`RENDER`, `EDITOR`, `VOICE`, `MEDIA`, `SCRIPT`), visual progress bars, elapsed time, an expandable **Diagnostics & Warning Drawer** (`🔍 Xem 12 ghi chú` / `Ẩn chi tiết`), and a safe **Retry / Inspect** action (`↻ Chuyển tới Kết xuất Video MP4 để kiểm tra / chạy lại`) that preserves all session data.

---

## 4. Verification Evidence & Codex Handoff Notes

### Automated + Visual Browser Verification (`s2-validation-evidence.json`)
- **TypeScript & Bundle Build**: `npx tsc --noEmit` (0 errors) and `npm run studio:build` (`studio-dist/app.js` 2.1mb, `studio-dist/app.css` 117.5kb).
- **Responsive Viewports (`0px` Horizontal Overflow)**:
  - Verified across `1920×1080` (Dark & Light), `1366×768`, `768×1024`, and `390×844` across all 3 Stage 2 screens (`Data Review`, `Discovery`, `Production Queue`).
- **Interactive Browser Verification**:
  - Verified Quick Grid vs. Split Detail mode switching, multi-select Batch Review Bar (`batchBarVisible: true`), Review Confirmation Modal (`confirmModalVisible: true`), Review & Transition History timeline (`historyTimelineSteps: 3`), Discovery 3-mode tabs (`showsBlockedAuth: true`, `showsScopes: true`), and Production Queue diagnostics drawer (`jobDiagnosticsExpanded: true`).
- **Session Immutability**:
  - Reference session `35b8a880-b8b5-49ec-be42-0991228eb45e.json` SHA-256 remained `add3e11415f1868136bdf0fa373d4417009cd963dde7086e24833fcdeaeb084d` (`sessionUnmodified: true`).

### Optional Backend Contract Enhancements for Codex
All Stage 2 screens work today against existing `DATA-01` (`/api/studio/data/*`) and `DATA-02` (`/api/studio/threads/*`) contracts. Two optional enhancements for future backend iterations:
1. **Batch Review Endpoint (`POST /api/studio/data/posts/batch-review`)**: Currently, batch review in `DataReviewWorkspace.tsx` executes sequential `POST /api/studio/data/posts/:id/review` calls so it works immediately with `DATA-01`. A single atomic batch endpoint would reduce disk writes when reviewing 20+ posts at once.
2. **Author Avatar URL in `DATA-01` Bronze Record**: `DATA-01` Bronze currently stores `authorHandle` and `authorDisplayName`, while the cached avatar URL lives in the Studio session's `source.items[].authorAvatarUrl`. `studio-v2-adapter.ts` joins them automatically; persisting `authorAvatarUrl` inside `DATA-01` Bronze will keep avatars available even for standalone keyword-collected posts before they are attached to a session.
