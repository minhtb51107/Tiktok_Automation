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
