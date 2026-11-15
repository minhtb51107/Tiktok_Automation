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

## LIVE acceptance 01

Target: `https://www.threads.com/@gnrtth/post/DeI-TuzEc_9`

The explicitly authorized single attempt completed without retry. It used one
browser worker at a time, three bounded conversation actions, 54 admitted requests
across the exact-root and enrichment visits, and no API replay, Threads API, Apify,
Qwen, TTS, render or publishing.

Result: **PARTIAL_NO_STRUCTURED_PARENT_EVIDENCE**.

| Measurement | LIVE result |
| --- | ---: |
| `data-sjs` SSR payloads parsed | 30 |
| Relay payloads with a post node | 1 |
| Observed Relay query | `BarcelonaPostPageTargetQuery` |
| Network JSON payloads | 1 (`/data/manifest.json`) |
| Structured post nodes | 1 (the exact root) |
| Structured-to-DOM identity matches | 1 (the exact root) |
| Full-body DOM context cards | 29 |
| Structured parent/root relationship fields | 0 |
| Graph-validated replies | 0 |
| Related/recommended cards separated by existing engine | 1 |
| Quality `RECOMMENDED` cards | 9 |
| Eligible automatic selections | 0 |

No observed payload contained `BarcelonaPostPageDownwardQuery`,
`BarcelonaPostPageUpwardQuery`, `direct_replies`, `containing_thread`,
`reply_threads`, `thread_items`, `reply_to_post_id`, `parent_post_id` or
`root_post_id`. The target payload did expose root-oriented fields such as
`direct_reply_count`, `is_reply`, `reply_to_author` and `root_post_author`, but none
provided an edge for the 29 DOM context identities. The network JSON response was a
web manifest, not conversation data.

Therefore the existing DOM fallback retained all 29 full-body cards, but 28 remain
UNKNOWN and one is related/recommended. The quality engine still identifies nine
textually promising cards, yet none may be auto-selected as a direct conversation
source without membership/relationship evidence. The authoritative editorial
outcome remains `EXCEPTION_REVIEW`; root-only material estimates 7–9 seconds, not a
video over 60 seconds.

The collector portion took 18.445 seconds. Production preservation manifests made
the complete command longer; both browser visits reported cleanup success. Minimum
available RAM observed by the browser guard was 1,972.6 MiB. The production
933-file manifest remained unchanged.

Artifacts are under ignored runtime storage:

- `.studio-data/reports/threads-acquisition05-live01/report.json`
- `.studio-data/reports/threads-acquisition05-live01/collection.json`
- `.studio-data/reports/threads-acquisition05-live01/normalized.json`
- `.studio-data/reports/threads-acquisition05-live01/browser-evidence.json`
- `.studio-data/reports/threads-acquisition05-live01/conversation-surface.png`
- `.studio-data/reports/threads-acquisition05-live01/studio-acceptance.png`

The isolated collection reopens in Studio and Copy Report plus JSON/Markdown export
passed without mutation or background collection. This LIVE result does not justify
another speculative DOM selector or a claim of reply-association PASS.
