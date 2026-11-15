# THREADS-ACQUISITION-05 — Structured Response Evidence

## Scope and result

This checkpoint adds passive structured observation to the existing public-browser
collector. It does not add another crawler and it does not issue or replay private
GraphQL requests. The existing order remains:

`public browser navigation -> SSR/network observation -> DOM fallback -> collectEvidence() -> normalized collection`

The implementation is **PASS OFFLINE** and **NOT RUN LIVE**. Earlier `gnrtth`
captures did not persist `data-sjs` script bodies or public network JSON, so their
structured relationships are `NOT_RECOVERABLE_FROM_SAVED_CAPTURE`.

## Implementation

- `conversation-structured.ts` reads bounded
  `script[type="application/json"][data-sjs]` content and detects actual
  `RelayPrefetchedStreamCache` records. Query names are read from the payload; they
  are not assumed.
- A passive `page.on('response')` listener is attached before navigation. It accepts
  only successful JSON responses already loaded from public Threads hosts. It never
  replays a request or reads/stores request headers, cookies or authorization data.
- Persisted diagnostics contain only the endpoint pathname, response class, query
  name, payload SHA-256, observed field names, relationship field names and node
  counts. Query strings and raw payloads are not persisted.
- Structured posts retain exact `pk`/`id`, `code`, author, original text, timestamp,
  canonical permalink, JSON pointer and payload reference hash. Missing fields stay
  null.
- Explicit parent/root fields and a narrowly scoped singleton direct-reply container
  can become relationship candidates. Array order never creates a parent edge.
- All candidates pass through the existing `collectEvidence()` graph validator.
  Canonical root, parent chain, cycles, duplicate/conflicting identity and wrong-root
  rejection therefore use one validator only.
- Structured records and DOM cards merge by canonical subject permalink. Existing
  DOM raw/original evidence is never overwritten.
- Studio Conversation Review shows payload/node/match counts and includes the
  sanitized evidence in Copy/JSON/Markdown collection export.

## Reference implementation review

The MIT-licensed `omkarcloud/threads-scraper` implementation confirms that current
public Threads pages may preload Relay data inside `data-sjs` scripts. Its parser
finds `RelayPrefetchedStreamCache` entries dynamically. Its post parser recognizes
`BarcelonaPostPageDownwardQuery` (`direct_replies`) and
`BarcelonaPostPageUpwardQuery` (`containing_thread`). These names remain hints only:
this project records and acts on them only when they are present in an observed
payload.

References:

- <https://github.com/omkarcloud/threads-scraper/blob/master/threads/ssr.py>
- <https://github.com/omkarcloud/threads-scraper/blob/master/threads/posts.py>
- <https://github.com/omkarcloud/threads-scraper/blob/master/threads/parsers.py>

## Offline verification

- Correct Relay preload fixture: root plus a singleton direct reply is graph
  validated by `collectEvidence()`.
- Multiple `thread_items` without explicit parent fields do not acquire parent IDs.
- Explicit parent chains validate; related collections remain recommendations.
- A same-code root owned by the wrong author cannot authorize a relationship.
- Malformed SSR is ignored and network endpoint query parameters are not retained.
- Targeted conversation regression: 29 tests passed.
- Full backend Jest: 60 suites / 402 tests passed.
- Backend build, frontend strict TypeScript and Studio bundle passed.

## One-use LIVE diagnostic plan (not authorized or executed)

Target: `https://www.threads.com/@gnrtth/post/DeI-TuzEc_9`

- One browser and one tab; 180 seconds; at most four bounded browser actions.
- At most 150 admitted requests, 40 subject cards and two existing permalink-detail
  validations; no retry.
- Existing resource-policy-v2 advisory/emergency guards remain unchanged.
- No API replay, Threads API, Apify, Qwen, TTS, render or publishing.
- Persist the sanitized SSR/network diagnostics, DOM/action snapshots, screenshot,
  graph verdict and resource/cleanup telemetry in a new isolated sandbox.

PASS requires positive structured parent/root evidence that validates to the exact
canonical root and matches real card identities. If payloads exist but contain no
usable relationship fields, the result is `NO_STRUCTURED_PARENT_EVIDENCE`. If no
payload is exposed, the result is `STRUCTURED_SOURCE_UNAVAILABLE`; DOM/membership
fallback remains unchanged. Neither outcome authorizes selector guessing.
