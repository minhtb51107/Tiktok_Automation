# THREADS-ACQUISITION-05C — LIVE root-cause diagnosis

## Authorized run

Exactly one browser-only attempt ran against
`https://www.threads.com/@gnrtth/post/DeI-TuzEc_9`. It used the existing collector,
one browser/tab, three bounded conversation actions and no retry. It did not call
Threads API, Apify, Qwen, TTS, render or publishing.

- Collector elapsed time: 39.534 seconds.
- Exact-root visit: 23 admitted requests / 156 interception events.
- Enrichment visit: 31 admitted requests / 294 interception events.
- Minimum available RAM: 1,659.29 MiB; both browser cleanups passed.
- Production manifest before/after matched.

## Root cause

**Determined: `NETWORK_CONTENT_TYPE_MISSED`.**

The enrichment browser received two admitted and completed `POST /api/graphql`
responses. Both returned HTTP 200 and parseable JSON with `Content-Type:
text/javascript`. The previous passive observer parsed them for diagnostics but did
not pass them to the structured extractor because they were not labelled with a
JSON content type. One response contained the observed marker `direct_replies`.

This is not evidence that every DOM card has a parent edge, and the diagnostic run
did not persist response bodies. Therefore the already-consumed attempt cannot be
reprocessed into parent relationships. It does prove that conversation-shaped data
reached the public browser and was excluded by the content-type gate.

No GraphQL request was blocked. The 18 blocked XHR requests were 15
`/ajax/bulk-route-definitions/` and three `/ajax/bz` requests after the event budget.
Other blocks were 112 heavy-image blocks, 124 later image event-budget blocks and
seven unsupported-origin scripts. No 401, 403 or 429 response was observed.

## SSR and DOM comparison

All six SSR milestones (`DOMContentLoaded`, before actions, after three actions and
final collection) were identical: 30 scripts, 486,022 bytes, one post node and only
`BarcelonaPostPageTargetQuery`. No late SSR reply payload appeared.

The run materialized 24 full-body DOM cards. All 24 were also present in the earlier
29-card baseline; five baseline cards did not reappear in this bounded run. Only the
root matched the structured nodes because the two GraphQL bodies were diagnostic-
only in this attempt. The result remains zero graph-validated replies, 24 UNKNOWN
cards and no automatic quality selection. Root-only narration is estimated at 7–9
seconds, so this capture is not yet eligible for a 60-second Video DRAFT.

## Minimal correction

The passive observer now accepts parseable JSON delivered as
`text/javascript` or `application/x-javascript` only for already-admitted public
XHR/fetch responses. It still does not replay requests or relax admission policy.
All extracted edges continue through the existing structured extractor and
`collectEvidence()` graph validator. Parseable `text/plain` remains diagnostic-only.

Telemetry also reduces non-HTTP `data:` and `blob:` URLs to constant labels rather
than persisting their content as a pathname.

Targeted regression (four suites / 32 tests) and backend build passed. The fix is
not claimed as LIVE relationship PASS because the single-use run preceded it and
was not retried.

## Studio acceptance

The isolated collection reopens at `http://127.0.0.1:3117/studio?area=Discovery`.
Read-only browser acceptance displayed 24 UNKNOWN cards and the
`NETWORK_CONTENT_TYPE_MISSED` diagnosis. Copy Report produced 14,286 bytes; JSON
and Markdown export passed. The browser emitted no write or external requests.

Ignored runtime artifacts:

- `.studio-data/reports/threads-acquisition05c-live01/report.json`
- `.studio-data/reports/threads-acquisition05c-live01/collection.json`
- `.studio-data/reports/threads-acquisition05c-live01/normalized.json`
- `.studio-data/reports/threads-acquisition05c-live01/browser-evidence.json`
- `.studio-data/reports/threads-acquisition05c-live01/conversation-surface.png`
- `.studio-data/reports/threads-acquisition05c-live01/studio-acceptance.png`
- `.studio-data/reports/threads-acquisition05c-live01/studio-browser-verification.json`
