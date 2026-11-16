# Product MVP completion acceptance

## Implemented product path

The existing Product Pipeline now exposes one bounded SERIOUS DRAFT batch:

`topic -> public discovery -> bounded enrichment -> relationship validation -> rule quality -> Qwen source-ID filtering -> exact-source DRAFT -> Kokoro -> measured timeline -> Remotion DRAFT MP4`

This is an adapter over the existing ContentDiscovery, ConversationEngine,
Source Quality V2, Hugging Face evaluator, Studio/Kokoro and Remotion services.
It is not a second crawler, TTS engine, renderer or publishing path.

Product constraints are enforced in the backend:

- 1-3 requested DRAFT videos, at most 30 discovered roots and 10 enriched roots;
- SERIOUS, `my_yen`, speed `1.3`, 720x1280, concurrency 1;
- AI can only filter real IDs already selected by rules and verified by the
  conversation graph;
- DRAFT narration contains only root/reply source text. No AI hook,
  commentary, transition or conclusion is materialized;
- measured audio and timeline, rather than estimates, control rendering;
- a timeline outside 65-90 seconds is not rendered;
- automatic selection remains `NEEDS_REVIEW` and never becomes USER_APPROVED,
  rights approval, FINAL or publishing approval;
- durable batch, discovery, conversation, Studio job, audio-cache and render
  records provide idempotency and resume checkpoints.

Studio exposes this as **Video Projects -> Generate Videos** and shows durable
batch status/results. Opening the page performs no crawler, AI, TTS or render.

## Verification before LIVE

- backend build: PASS;
- frontend TypeScript: PASS;
- Studio bundle: PASS;
- targeted product/discovery regression: 23/23 PASS at the implementation
  checkpoint, then 5/5 PASS after the diagnostic fix;
- full backend Jest: 60 suites / 408 tests PASS;
- Studio browser smoke: Generate Videos visible and enabled;
- read-only Studio reopen after acceptance: no POST/PUT/PATCH/DELETE request.

## Authorized integrated LIVE acceptance

Exactly one batch was submitted on 2026-11-16 with:

- topic `công việc`, style SERIOUS;
- target 3 videos;
- 30 root candidate ceiling, 10 enrichment ceiling, 60 minute ceiling;
- Qwen ceiling 40 requests and USD 0.10;
- isolated store `product-mvp-live01/store`;
- initial available physical memory 822.16 MiB and system commit reserve
  5,415.39 MiB.

Batch ID: `e9aa4d25-a3f7-442b-a3dd-dbf2d2e55048`.

The first public discovery navigation stopped after 16.755 seconds with
`CONVERSATION_NAVIGATION_FAILED`. The saved diagnosis is `UNKNOWN` at stage
`DISCOVERY`: no candidate was returned and no root was enriched. The available
evidence does **not** prove login/access blocking, parser failure, OOM or no
results. The older discovery coordinator did not persist the browser audit
callback, so the underlying navigation category is not recoverable from this
attempt.

The attempt was not retried. Because it stopped before a candidate existed:

- new roots: 0;
- enriched roots: 0;
- verified replies: 0;
- AI requests / recorded cost: 0 / USD 0;
- Kokoro audio: 0;
- Remotion renders / new MP4: 0;
- result: `PRODUCT_ACCEPTANCE_FAILED_AT_DISCOVERY`.

The implementation was corrected after this evidence so future runs durably
copy sanitized `PublicAccessAudit` events into the ContentDiscovery checkpoint
and expose discovery errors in the autonomous batch API. This is an
observability correction only; the consumed authorization was not reused.

## Preservation and artifacts

Production remained 933/933 files byte-identical. Before and after manifest
hashes are both:

`feeb27228f7c860372e70a468ab1e4879b0793929c375c661f801608a8bca593`

Ignored runtime evidence is under:

`1_nest_backend/.studio-data/reports/product-mvp-live01`

It includes the isolated store, production manifests and Studio screenshots.
No credential, raw environment file, audio or video is committed.

## Product verdict

`AUTO_VIDEO_MVP_FAIL`

The one-button product integration is implemented and verified offline, but the
authorized LIVE batch produced no source and therefore no new 65-90 second MP4.
The next LIVE authorization should exercise the same batch once with the new
durable navigation telemetry. If public search navigation remains unavailable,
the product cannot meet its autonomous discovery acceptance without a separate,
legally accessible discovery source; saved older captures must not be presented
as new-content acceptance.

## Recovery acceptance LIVE-02 (2026-11-16)

The newly authorized batch used isolated store `product-mvp-live02/store` and
batch ID `5d1398c4-2051-468d-be89-35cf1962dfda`. It did not reuse the consumed
LIVE-01 attempt.

### Discovery root cause and correction

The generic LIVE-01 failure was caused by a product-level observability gap:
Puppeteer exceptions were collapsed into `CONVERSATION_NAVIGATION_FAILED`, so
the saved run could not distinguish a timeout from network, browser, access,
HTTP, parser or resource failure. Discovery now persists a sanitized stage,
category, code, HTTP status, timeout type, safe Chromium cause and navigation
audit. It retries at most once only for an actual timeout or explicitly
transient `ERR_*` network condition; access/CAPTCHA/login, resource, HTTP,
parser and browser failures are never retried.

LIVE-02 proved public discovery itself is working:

- four public search navigations returned HTTP 200 without redirect;
- 23 new canonical candidates were discovered and 10 roots were enriched;
- all searches completed on attempt 1, so transient retry was not exercised;
- 10 collections contained 187 observed context cards in total;
- 23 replies across seven roots passed the existing GraphQL/graph validator;
- no login, CAPTCHA, access block, browser orphan or production mutation was
  observed.

### Product bridge defect found by LIVE data

The first evaluation still selected zero replies because
`selectedReplies()` had not been extended when
`STRUCTURED_PUBLIC_PARENT` was added to `collectEvidence()`. GraphQL replies
were therefore verified in `ThreadCollection` but rejected by editorial
feasibility. The bridge now validates the structured payload hash/source and
exact root document before accepting that evidence kind. It does not infer a
parent from DOM order or semantics.

An explicit resume reuses the saved discovery run and archives earlier
side-effect-free policy results. It never repeats completed sessions or
artifacts. Rule eligibility now exposes all non-spam/non-duplicate verified
replies to Qwen instead of requiring an additional lexical-selection flag.

After this fix, rule quality found 18 useful verified replies across the ten
roots. Only two roots had a source-only maximum estimate of at least 60 seconds:

- `gnrtth / DeI-TuzEc_9`: four verified replies, source-only estimate 52-72s;
- `randomshiettttt / DZ3pkI6k40V`: four verified replies, estimate 48-65s.

Qwen made two provider calls. The `gnrtth` assessment validated and the product
intersection selected the four verified reply IDs. The second response was
provider-successful but failed strict JSON schema validation and was not
retried. Recorded incremental usage was 1,472 input tokens, 402 output tokens
and USD 0.00027312. The durable ledger remains below the 40-request / USD 0.10
acceptance ceiling.

### Voice and MP4 outcome

The product created one isolated DRAFT session
`b9ffc11c-41bc-485c-a50e-fb28396bd0d1` with one exact root and four
`PARENT_VERIFIED` replies. Save/reopen retained revision 7 and all 24 source
items; only those five exact sources were selected. No AI-written hook,
commentary, transition or conclusion was added.

The first voice invocation exposed missing process-local Kokoro paths after a
runtime restart. The existing ignored runtime configuration was then loaded;
Kokoro reported `READY` with Python 3.14.6, `my_yen`, the local model,
voicepack, FFmpeg and FFprobe. Resume reused the existing assessment and DRAFT
without another inference call.

Cold start was nevertheless stopped by the existing emergency guard after
34.493 seconds. The final sample recorded 245.96 MiB available physical RAM,
4,106.81 MiB system commit reserve, worker peak RSS 254.59 MiB and peak private
bytes 271.79 MiB. This is `RESOURCE_GUARD_STOP`, not evidence of Windows OOM.
No retry was made, no valid WAV was saved, and therefore no timeline, render or
new MP4 was claimed.

### LIVE-02 verification

- targeted regressions after the two fixes: 45/45 and 27/27 PASS;
- backend build after each fix: PASS;
- Studio read-only browser smoke: HTTP 200, Generate Videos and the real
  `gnrtth` DRAFT visible, zero POST/PUT/PATCH/DELETE while opening;
- screenshot: ignored artifact `product-mvp-live02/studio-live02.png`;
- production preservation: 933/933 files, no changed, missing or added files;
- no crawler retry, publishing, Apify, production approval or production-store
  write occurred.

LIVE-02 verdict: `AUTO_VIDEO_MVP_PARTIAL`. Discovery, enrichment, structured
reply validation, quality/Qwen selection and persisted DRAFT creation are
WORKING LIVE. Voice is resource-blocked on this machine for this run; MP4 count
is zero, so `AUTO_VIDEO_MVP_PASS` is not met.
