# THREADS-ACQUISITION-05B — Missing Structured Replies Diagnostics

## Evidence from LIVE-01

The existing `threads-acquisition05-live01` capture proves the following:

- `page.on('response')` was attached before `page.goto()`.
- The final SSR read happened after `drivePublicConversation()`, not merely at
  `DOMContentLoaded`.
- The final page contained 30 bounded `data-sjs` scripts. One Relay payload was
  `BarcelonaPostPageTargetQuery` and yielded the exact root. No saved final script
  exposed Downward/Upward query names or explicit relationship fields.
- The network parser accepted one JSON response: `/data/manifest.json`. It had no
  post or relationship node.
- DOM snapshot merging retained 29 full-body context cards.
- The request counter recorded 31 admitted and 248 blocked interception events on
  the enrichment visit, but LIVE-01 did not persist request paths, admission reasons,
  content types, statuses, completion or parser skip reasons.

Consequently LIVE-01 cannot distinguish a non-JSON GraphQL response, an aborted
request, a late SSR insertion, an unrecognized schema, or a public-access limitation.
Its correct diagnosis is **INCONCLUSIVE**, not `PUBLIC_ACCESS_LIMITED` and not a
parser bug.

The detailed telemetry applies to the enrichment browser visit that produces the
29 context cards. The earlier exact-root metadata pass remains separately bounded
and count-audited; it is not silently presented as response-level evidence.

## Instrumentation added

No admission rule or relationship parser was changed. The existing passive observer
now records bounded, sanitized metadata:

- request pathname, method, resource type, admitted/blocked decision and exact
  policy reason;
- response status, content type, declared length, request completion/failure and
  parser accept/skip reason;
- body hash and known conversation marker names only for bounded textual XHR/fetch
  diagnostics; response bodies are not persisted;
- SSR script count, total bytes, hashes and observed Relay query names at
  `DOMContentLoaded`, before actions, after every browser action and final
  collection;
- an evidence-derived diagnosis:
  `SSR_LATE_INSERTION`, `NETWORK_CONTENT_TYPE_MISSED`,
  `STRUCTURED_SCHEMA_UNRECOGNIZED`, `PUBLIC_ACCESS_LIMITED`,
  `NO_STRUCTURED_EVIDENCE`, `INCONCLUSIVE`, or positive structured evidence.

`NO_STRUCTURED_EVIDENCE` is deliberately conservative: it is not returned while an
admitted request is unfinished, when response/SSR telemetry is absent, or when a
potentially relevant XHR/fetch/script/document request was blocked by event,
navigation or unsupported-origin policy. Those states remain `INCONCLUSIVE`.

Query strings, cookies, authorization headers, request/response bodies and browser
session state are not stored. A parseable JSON body delivered with a non-JSON content
type is diagnostic-only and is not silently fed to the relationship parser.

## Answers before the next LIVE run

1. **Which Threads responses did the browser actually receive?** LIVE-01 can prove
   only one accepted network JSON response (`/data/manifest.json`) plus final SSR
   scripts. It did not preserve a complete response inventory.
2. **Was an SSR/response skipped?** Possibly, but LIVE-01 lacks the metadata required
   to prove why. The new instrumentation will distinguish policy blocks, status,
   content type, size, body read, JSON parse, duplicate and capture limits.
3. **Did relationship data exist in observed responses?** None existed in the
   persisted accepted JSON or final SSR payloads. The state of skipped responses is
   unknown.
4. **What should change?** Run the instrumented diagnostic first. Change the parser
   only for `STRUCTURED_SCHEMA_UNRECOGNIZED`; reconsider content-type handling only
   for `NETWORK_CONTENT_TYPE_MISSED`; change access/source strategy only when the
   evidence shows `PUBLIC_ACCESS_LIMITED` or `NO_STRUCTURED_EVIDENCE`.

## Proposed single-use LIVE diagnostic — not authorized or executed

Target: `https://www.threads.com/@gnrtth/post/DeI-TuzEc_9`

- one browser worker/tab, 180 seconds, at most four actions;
- at most 150 admitted requests, 40 cards and two existing permalink validations;
- no retry and unchanged resource/admission guards;
- isolated store, sanitized telemetry and screenshot;
- no Threads API, Apify, Qwen, TTS, render or publishing.

PASS for diagnosis requires complete request/response telemetry for admitted
conversation navigation and SSR milestones through final collection. Reply
association passes only if an explicit relationship candidate validates through the
existing `collectEvidence()` graph validator. Zero verified replies remains a valid
diagnostic outcome.

## Offline verification

- Targeted Jest: 4 suites / 30 tests PASS.
- Full Jest checkpoint: 60 suites / 405 tests PASS. After the final conservative
  classifier guard, the affected 4-suite/30-test regression and backend build were
  rerun and passed.
- Backend build: PASS.
- Frontend strict TypeScript and Studio bundle: PASS.
- Tests cover admission reasons, content-type-missed JSON, SSR query milestones,
  endpoint query redaction and evidence-derived diagnosis.
- Studio read-only smoke on the isolated LIVE-01 store: PASS. It displayed 29 full
  cards, 28 UNKNOWN and one related card, reported unavailable historical response
  and SSR-milestone telemetry, and classified the historical cause as
  `INCONCLUSIVE`.
- Copy Report contained the root and a context identity; JSON and Markdown export
  passed. Page viewing emitted no POST/PUT/PATCH/DELETE or external request.
- Isolated store hash stayed
  `cdfa3e11d7d0a4ab12316ea32a24c3fd6e4142fe36f3798b8a33eea479fa7d05`.
  Production remained 933 files with hash
  `046cd0acd4337500ab0d298672d870d2d07c72d68ea2467568a833f6f55d03f4`.
