# DATA ACQUISITION V3.1 — Content Supply Bottleneck Resolution

## 1. Root-Cause Diagnosis (Audited from V3 LIVE `data-acquisition-v3-live01`)

| Bottleneck | V3 Evidence | V3.1 Fix |
| --- | --- | --- |
| **SSR 30-script truncation** | All 7 V3 roots capped at `scriptCount = 30` (`observeStructuredSsrScripts().slice(0, 30)`), dropping late-streamed `BarcelonaPostPageDownwardQuery`, `BarcelonaPostPageUpwardQuery`, and `BarcelonaLoggedOutRelatedPostsWWWQuery` scripts (indices 30–47). | Scan up to 150 `script[type="application/json"][data-sjs]` tags, prioritize scripts with Relay/conversation markers while preserving the 2 MB/script & 5 MB total byte cap. |
| **Nested `reply_to_post_id` missed** | `diagnostics` logged `relationshipFields: ["reply_to_post_id"]`, yet `postFromObject()` only read top-level `row.reply_to_post_id` instead of `row.text_post_app_info.reply_to_post_id` (and did not cross-index `pk` vs `pk_userid`). Result: 0 nested replies, 101 `UNKNOWN`. | Extract `text_post_app_info.{reply_to_post_id,parent_post_id,root_post_id}` and index both `pk` and `id` (`pk_userid`) with strict uniqueness conflict checks; extend `targetDirectReplyContainerEvidence()` to root-verified `SSR_RELAY` containers and add passive NDJSON parsing for `/api/graphql`. |
| **Pre-enrichment candidate ranking** | `rankCandidates()` enriched 1–5 word captions (`Y-CONCERT`, `Concert ❌`, `Chủ động trong công việc:))`) while skipping substantive 32-word discussion `@gnrtth/post/DeI-TuzEc_9` (128 replies / 430 likes). | Added `supplyFeasibility()` blending cleaned root length (penalizing `< 8`-word captions and date-only posts), reported reply volume + reply-to-like discussion density, discussion prompt signals, expanded `DISCOVERY_TOPICS` relevance, freshness, and author diversity. |
| **`THREAD_UI_CONFIRMED` dropped in selection** | `selectConversation()` and `ProductPipelineService` ignored `collection.membershipEvidence`, treating exact-root confirmed conversation members as `UNKNOWN`. | Admit exact-root `THREAD_UI_CONFIRMED` members (`rootId === identity.id`, non-recommended) for editorial DRAFT with `parentId: null`, prioritized after `PARENT_VERIFIED`, never promoted to direct replies; keep `UNKNOWN` and `RECOMMENDED_POST` strictly excluded. |
| **Scroll-to-bottom & resource churn** | `0.85 * innerHeight` scroll steps stopped after 3 unchanged actions before reaching the bottom fold on tall pages; redundant `observeStructuredSsrScripts` ran on every unchanged scroll; single-root failures aborted runs. | Increase scroll step to `1.6 * innerHeight`, track `reachedBottom` before counting unchanged scroll stops, expand Vietnamese/English public load-more selectors (excluding login/app prompts), skip redundant SSR transfers on unchanged actions, isolate per-root recoverable failures, and checkpoint after each root. |

## 2. Public Pagination & Official Threads Graph API Boundaries

- **Why `has_next_page=true` stops anonymously**: Even after reaching the bottom fold and checking all legitimate public UI controls (excluding login/app gates), Threads anonymous public web pages serve the initial SSR downward page (~15–20 replies) plus initial `/api/graphql` batch and do not expose further anonymous pagination controls without signing in. We do **not** replay private GraphQL cursors or bypass access gates.
- **Official Meta Threads Graph API (`/{media-id}/conversation` & `/{media-id}/replies`)**:
  - Requires OAuth scopes `threads_basic` + `threads_read_replies`.
  - Scoped to **the authenticated user's own posts**; Meta does not grant arbitrary reading of third-party users' conversation trees via `/conversation`.
  - `GET /keyword_search` requires Meta App Review and is rate-limited for discovery, not arbitrary deep reply pagination of other accounts.
- **Alternative data paths (for user decision — not activated automatically)**:

| Option | Licensing / Compliance | Est. Cost | Reply Coverage | Trust / Provenance |
| --- | --- | --- | --- | --- |
| **Current V3.1 public browser (default)** | Public web read, no login/bypass | \$0 | 8–20 verified direct + nested replies/root (0 `UNKNOWN`, 3/5 roots >= 60s) | High — `collectEvidence()` graph validation |
| **Authenticated own-account Threads Graph API** | Official Meta OAuth (`threads_read_replies`) | \$0 | Full pagination on **own** posts only | Highest — official API |
| **Authorized external provider (existing `adaptParseforgeCollection` adapter)** | Third-party provider TOS + explicit user approval | Paid per run / dataset | Deeper pagination on public threads | Medium — must still pass `collectEvidence()` |

## 3. V3 vs V3.1 LIVE Acceptance Evidence

Artifact directory (isolated store, no Qwen/TTS/render/publishing): `1_nest_backend/.studio-data/reports/data-acquisition-v31-live01/report.json`.

| Metric | V3 Baseline (7 roots) | V3.1 LIVE (5 roots, `công việc`) |
| --- | ---: | ---: |
| Verified replies (total) | 23 (3.3/root) | **66 (13.2/root)** |
| Verified direct replies | 23 | **45** |
| Verified nested replies | 0 | **21** |
| Confirmed conversation members (`THREAD_UI_CONFIRMED`) | 3 extra | **70 total** (66 verified + 4 branch members) |
| `UNKNOWN` cards | 101 | **0** |
| `RECOMMENDED_POST` excluded | 0 | **23** (0 leaks into selection) |
| Rule-quality eligible | 13 | **56** |
| Rule-selected | 4 | **16** |
| Duration-feasible roots (`>= 60s`) | 0 / 7 | **3 / 5** (`@chang_chang72` 84–115s, `@gnrtth` 69–95s, `@annieraye_` 45–61s) |
| Minimum physical RAM | 250.03 MiB (`RESOURCE_GUARD_STOP`) | **686.45 MiB** (`COMPLETED`, all cleanups verified) |
