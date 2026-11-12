# DATA-QUALITY-03 — Functional Discovery & Thread Collection

## Scope and safety

This checkpoint changes the existing conversation collector, DATA-04 review and
Studio. It does not add another crawler or TTS/render path. Validation replays the
persisted `data-quality02-live-smoke01/collection.json`; no new Threads request is
made. Runtime artifacts, sessions and media remain ignored and are not committed.

## Root cause and implementation

- Discovery read only `aria-label`, while the exact-target extractor also read the
  adjacent SVG `title`. Public search cards therefore retained permalinks but lost
  counters. The shared parser now reads structurally scoped button controls from a
  card and stores `raw`, `normalized`, `approximate`, `source`, and `observedAt`.
- Compact Vietnamese values such as `1,2K`, `16,8K` and `1M` are normalized for
  ranking without discarding their approximate flag. A card with multiple
  permalink identities still cannot donate counters to any post.
- Ranking supports `HOT` (available observed signals) and `RECENT` (observed
  publication time), plus a minimum known-interaction threshold. Unknown totals
  remain reviewable; they are not converted to zero. Sparse evidence is labelled
  `PARTIAL`, never “verified HOT”.
- The saved collection contained 26 target-page observations but only 10 full
  Source cards. `observedContextViews()` canonical-deduplicates both layers: the 10
  full cards win (retaining media/counters), and the other 16 remain honest
  observation-only records. No record is promoted to `PARENT_VERIFIED`.
- Studio exposes all observed records with quality/relation reasons. A human may
  select them for an editorial DRAFT. `RELATED_OR_RECOMMENDED` records are not
  recommended automatically, and no selection changes DATA-01 review, rights,
  production approval, enqueue, TTS, render or publish state.
- The full-run report endpoint exports every candidate, enriched collection,
  persisted observed context and human selection—not only the current page/root.

## Offline evidence

- Saved LIVE replay: 10 materialized cards + 26 observations → 26 unique context
  permalinks, all retained; 0 parent-verified.
- The known independent `tuan27020` series card remains
  `RELATED_OR_RECOMMENDED` and is not auto-selected.
- Explicit selection creates a reopenable Studio DRAFT with 27 Source records
  (one root + 26 context), while only the root and explicitly selected context are
  selected for Script.
- Browser smoke on an isolated store showed 26 observed cards, saved a selection,
  fetched a `FULL_RUN` report containing 26 contexts, and navigated to the created
  Script DRAFT. Evidence is written under ignored runtime path
  `.studio-data/reports/data-quality03-offline/`.
- This is `PASS OFFLINE`, not a new LIVE discovery result. Existing saved capture
  provenance remains immutable.

## Bounded LIVE acceptance plan (not executed)

Run only after a separate single-use approval:

1. Topic/keyword: `công việc`; public browser only, one worker, no API fallback.
2. One search page (a second page only when the first produces no canonical
   candidates); at most 10 unique candidate permalinks.
3. Rank by requested `HOT`/`RECENT` mode and enrich at most three roots,
   sequentially. Never run TTS/render/publishing concurrently.
4. Budget: at most four navigations, six total scroll/load-more actions, 600
   interception events and 150 admitted network requests, 240 seconds total, no
   automatic retry.
5. RAM policy v2: 384 MiB is advisory. Emergency stop remains physical available
   RAM below 256 MiB or system commit reserve below 512 MiB. Close only the owned
   browser process tree and verify cleanup.
6. Stop on login, CAPTCHA, access block, rate limit, identity mismatch, deadline,
   resource emergency or cleanup failure.
7. Acceptance output: actual candidate/root counts, exact per-card raw/normalized
   engagement observations, selected ranking reasons, materialized/observed/
   parent-verified context counts, duplicate rate, and explicit Script DRAFT
   selection. Missing evidence stays `UNKNOWN`.

Precision and the ability to produce 60–90 seconds remain `NOT_MEASURED` until a
human labels the candidates and measured audio exists. Estimated narration time is
advisory only.
