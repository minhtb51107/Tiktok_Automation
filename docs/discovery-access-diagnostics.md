# Discovery access diagnostics and pending small pilot

## Phase A: integrated

Remote graph was rechecked: origin/main 720197e, origin/codex/data-quality01
7bca97d, ahead/behind 0/1. Worktree was clean. Main fast-forwarded and pushed to
7bca97d without a new merge commit or author/history changes. Backend build
exit 0; related offline regression 5 suites / 70 tests passed. One initial test
command named a nonexistent conversation.spec.ts (command failure, not a failing
product test); the corrected evidence/engine test paths passed.

Further diagnostics are on codex/discovery-access-diagnostics, not yet on main.

## Phase B: actual causes versus unknowns

Path: keyword -> public discovery -> canonical permalink ranking -> existing
exact-root extractor -> second public-document visit -> JSON-LD parent evidence
-> DATA-01 import/Gold shadow -> editorial candidate. The current content-quality
coordinator uses the browser provider. Official API collection is a separate
existing collector; automatic API-first/fallback routing is not implemented.

The consumed DATA-QUALITY-01 browser attempt was RESOURCE_GUARD_STOP: available
RAM 618.31 -> 329 MiB, 10 requests, one navigation, zero scrolls, 6.49 seconds.
No permalink was returned. That evidence does not establish a parser bug, login
wall, rate limit or absence of posts. The approximately 289 MiB available-RAM
drop includes activity outside the owned browser; browser RSS/private peak was
NOT MEASURED and must not be inferred from this difference. The 384 MiB browser
floor is unchanged. No Windows/pagefile change or process termination occurred.

Existing browser optimizations already blocked image/media/font requests and
used a disposable profile, bounded requests/time and finally-close. New changes:
reuse the initial blank tab instead of opening a second tab, bypass service
workers, disable extensions and request renderer-process-limit=1. These do not
disable Chromium security/site isolation and do not guarantee one OS process.
RAM reduction is NOT MEASURED until an approved probe. The extractor and the
relationship observer still launch separate sequential browsers: cross-stage
session reuse is not implemented or claimed. A longer-lived shared browser could
avoid repeated cold-start but may retain memory; benchmark before adopting it.

New fixed diagnostics distinguish RESOURCE_GUARD_STOP, ACCESS_EMPTY,
PARSER_FAILURE, NO_RESULTS, RATE_LIMIT and UNKNOWN. An explicit no-results heading
can establish NO_RESULTS; missing selectors alone remain UNKNOWN. A visible
post-link container with zero parsed canonical candidates is PARSER_FAILURE.
Known login/protection responses are ACCESS_EMPTY with the original fixed access
error retained; this label does not mean the page has no posts. Partial extractor
metadata can no longer hide a resource/access/429 stop and cause another visit.
Old checkpoints are not rewritten or retroactively relabelled.

### Official API

The saved real check (2026-11-09) showed a valid token with threads_basic and
threads_keyword_search, expiry 2027-01-01T19:17:09Z. The exact saved response was
`{"data":[]}`: no paging, error, or proof of public search approval. Query was
`chuyện đi làm`, TOP, limit 2, no date/author filter. No new authenticated request
was made in this checkpoint. Revalidation is needed in the next approved pilot.

Provider uses graph.threads.com/v1.0/keyword_search, Bearer header, UTF-8 q and
TOP/RECENT. It now explicitly sends search_mode=KEYWORD (TAG supported by the
provider argument), and requests is_reply/has_replies. Previously apiInput could
read is_reply but provider did not request it: UNKNOWN was retained correctly,
but root/comment typing could not benefit from that API field. Field support is
mock-verified here, not newly live-verified. API numeric IDs remain separate from
permalink shortcodes; neither is replaced by an author handle.

Collector now persists sanitized per-page search diagnostics. Empty success is
ACCESS_EMPTY, cause/publicAccess UNKNOWN, not permission denial. It never invents
paging. Existing paging follows only an observed, validated cursor; the saved
empty page has none. A cursor is not proof that all public posts are searchable.

Meta's official sample repository explains standard versus advanced keyword
access and the need for App Review for broader public coverage:
https://github.com/fbsamples/threads_api/issues/72 . This is a plausible
explanation, not an app-specific approval lookup. Token scopes alone cannot
prove advanced access. Direct developer documentation returned HTTP 429 to the
documentation reader; that is not a Threads Graph API rate-limit result. The
official collection is https://www.postman.com/meta/threads/collection/dht3nzz/threads-api .

## Phase C: parent evidence

Existing collectEvidence requires the exact root identity, a public reply
permalink, matching author, original body and structured JSON-LD parentItem or
comment relationship pointing to the exact root or an already verified nested
chain. Evidence retains document hash, pointer, subject URL and parent URL.
Same author, DOM order and proximity are not evidence. Missing parent, missing
permalink and unverified nested chains retain separate rejection reasons and
observed content. No evidence standard or human approval changed.

The saved eight context cards still have zero parent-verified replies; they can
remain editorial draft observations with manual review, not verified discussion.
Current OAuth scopes do not include threads_read_replies. Public JSON-LD coverage
is unproven for new targets. An official replies adapter and broader read access
must not be claimed from the current keyword provider, which has no replies
route. Do not equate Graph numeric parent IDs with shortcode IDs; an official
adapter would require a verified native-ID/permalink mapping for the whole chain.

## Phase D: proposed single-use pilot — NOT RUN / pending approval

New request ID: discovery-access-02 (the previous attempt stays consumed).
Three independent observations; stop without retry on access protection,
authentication/permission/rate-limit error, resource guard or exhausted budget.

1. API access probe: at most six requests, sequential, at most 60 seconds.
   One token debug, then `công việc` and `gia đình` each with TOP and RECENT,
   KEYWORD, limit 2 (at most eight initial rows). Reserve one request, limit 2,
   for an actual observed safe cursor; cap API rows at ten total. Do
   not follow empty pages or manufacture a cursor. If a known own-post keyword is
   available, replace one search with that control; do not create a control post.
   Record HTTP/code, row counts, paging presence and sanitized raw pages. Never
   print credentials. An all-empty matrix remains ACCESS_EMPTY/UNKNOWN, not proof
   of global NO_RESULTS or advanced approval.
2. Only after API preflight, browser fallback if API yielded fewer than five
   distinct roots and public access is
   permitted: one browser worker/tab, no TTS/render, same 384 MiB floor and 250 ms
   guard. Two keyword pages maximum, at most five distinct canonical candidates.
   Keep combined API/browser distinct candidates at ten maximum; dedup before
   enrichment. Enrich at most two roots initially (five discovered roots is the small-pilot
   scope; it is not five complete conversations). Each existing visit: at most
   30 seconds, 150 requests; exact-root extractor at most 20 seconds. Discovery
   one scroll/page; enrichment two scrolls/root, max 20 verified replies/root.
   Maximum six browser launches sequentially: two discovery + two extractor +
   two relationship visits. Media cache has its existing separate bounded HTTP
   policy; include those requests in the report. Total operation budget 180
   seconds checked between operations; existing per-operation deadlines bound
   in-flight work. No automatic extension, retries or extra targets.
   Sample available RAM/commit and owned process-tree RSS/private bytes before,
   during and after; no external process is stopped. A blank-page footprint
   measurement must consume this same approved browser attempt, not a hidden
   preliminary live run. If guard stops, do not try another query/browser.
3. Quality evaluation runs offline on those saved captures: root identity,
   observed versus parent-verified counts, duplicates, scores/reasons and full
   quote-only draft text, maximum five proposals. Missing data remains UNKNOWN;
   >=60 seconds is ESTIMATED until actual WAV/timeline measurement. No human
   precision claim without labels, no acceptance/enqueue/TTS/render/publish.

Use a fresh isolated pilot folder inside existing ignored reports storage; do
not clone production sessions or OAuth vaults. Read credentials through the
existing authorized local configuration only, with no writes to production.
Mark attempt consumed before the first external API/browser operation and keep
all subsequent checkpoints on that attempt. The API-first routing described
above is an explicit pilot sequence, not an automatic production fallback.

No new roots, replies, duplicates or candidates were collected this checkpoint.
Therefore live duplicate ratio and new >=60-second candidate count are NOT
MEASURED. No replay is substituted for live acceptance.

## Validation and resources

New diagnostics/serialization tests are OFFLINE/SYNTHETIC. Regression covers
missing parent, nested chain, same-author/different-post, idempotency, recovery,
unchanged approvals and persisted empty-response diagnostics. Browser RAM
optimization and updated API fields still need the approved real probe.

Full offline Jest: 45 suites / 319 tests PASS, 63.895 seconds, runInBand with
320 MiB heap and isolated ts-jest transpilation. Backend TypeScript/build checked
separately, exit 0. Both changed spec files independently typechecked with the
Node type environment explicitly provided to the standalone compiler, exit 0.
No frontend or renderer changes; no new browser visual/RAM benchmark.
Production preservation: all 933 baseline files matched SHA-256 and size, zero
changed/unreadable; manifest hash
`e19574bf84fc07c88a165aa3958f50e579a93c289b6aeef2c0664c1f35a6c1e7`.
Sanitized verification artifact stays ignored at backend
`.studio-data/reports/discovery-access-diagnostics/preservation.json`.
Existing Studio endpoints on ports 3110/3111 returned HTTP 200 without restart;
these continue serving their existing runtime bundles, not this new branch.

Resource snapshot: available 721 MiB; commit 20,728,045,568 / 29,982,801,920 bytes
(about 19,768 / 28,594 MiB). Largest observed working sets included memory
compression 465.5 MiB, Chrome PID 11716 312.8 MiB, ChatGPT PID 20952 228.9 MiB.
These are observations, not permission to terminate them. Pagefiles unchanged:
C: allocated 6107 MiB / used 1093 MiB; D: allocated 16657 MiB / used 1613 MiB.
No browser/Kokoro launched here; no new footprint benchmark claimed.
