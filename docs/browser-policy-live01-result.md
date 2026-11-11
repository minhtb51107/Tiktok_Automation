# browser-policy-live01 — fresh LIVE browser result

2026-11-11, user-approved single browser-only attempt, source checkpoint 70fe399.
**Browser navigation/exact extraction: PASS LIVE. Verified conversation and
production content quality: PARTIAL.** No replay substituted for this result.

## Scope and results

One public search page, keyword `công việc`; one worker, five sequential browser
lifecycles (discovery, two exact-root extractors, two relationship observers).
No retry, Threads Graph API call, token/vault/.env read, TTS, render or publishing.
No login/CAPTCHA/protection bypass. No emergency condition was reached.

Started 2026-11-11T15:51:29.836Z; completed 15:51:59.170Z: **29,334 ms** excluding
the preliminary local resource audit. Five canonical permalink candidates:

1. https://www.threads.com/@gnrtth/post/DeI-TuzEc_9
2. https://www.threads.com/@pngkhatu/post/DaNZphhgU_i
3. https://www.threads.com/@canhchimkhongmuonvo/post/DfbRWnyk2Cr
4. https://www.threads.com/@nvquangas/post/DYgd1gJk7CX
5. https://www.threads.com/@th_tinhh/post/De0p0iJkxfa

Discovery engagement was unavailable for all five. Ranking therefore used the
existing observed-order fallback; this is NOT evidence that these are HOT posts.
The first two were enriched under the approved budget. Exact permalink/author
identity matched for both; post-versus-comment type remains **UNKNOWN**.

| Exact target | Reported replies (observed source label) | Observed context permalink candidates | Parent-verified |
| --- | ---: | ---: | ---: |
| gnrtth / DeI-TuzEc_9 | 126 | 24 | 0 |
| pngkhatu / DaNZphhgU_i | 10 | 13 | 0 |
| Total | Not a collected-reply count | 37 | 0 |

All 37 context permalinks are distinct; 35 have observation text. The exact-root
extractor also retained 22 detailed context cards across its two captures. These
are overlapping observation sets, not 59 comments. No duplicate candidate among
the five discovery URLs; cross-run duplicate rate against production was NOT
MEASURED (no production import). Root image attachments exposed by these captures:
zero; no root image was downloaded and no general media-absence claim is made.

## Parent evidence and quality limitations

The parser did not establish a supported structured parent chain for any context
candidate. All reasons are DOM_CONTEXT_WITHOUT_RELATIONSHIP_EVIDENCE. Available
observations remain OBSERVED_ON_TARGET_PAGE; none became PARENT_VERIFIED. This
does not prove Threads has no parent data under all possible public structures.
No API reply request or new permission was attempted.

The gnrtth question concerns office work in industrial parks. Heuristic score 84,
quote-only narration **ESTIMATED 66–91 seconds**, status READY_FOR_EDITORIAL_REVIEW
as saved by the existing scorer. Four suggested source cards have handles
myhao1103, buiminhhoang1159, unnnhaf, tuan27020. Some appear useful, but the last
starts like an independent multi-part article. Its relationship is unverified:
it must not be presented as a confirmed reply. The context can include related
recommendations; absence of parent evidence cannot distinguish all such cases.

The pngkhatu record is a colleague/relationship reaction; score 64, ESTIMATED
19–26 seconds, NEEDS_EDITORIAL_ENRICHMENT. It is not a demonstrated SERIOUS job
story. Lexical matches and media presence caused low-information/context cards
to be suggested; this is a quality limitation, not human acceptance.

Dates (for example a leading dd/mm/yyyy line) and author chrome remain in some
body/clean projections. Original captures are preserved; no silent text rewrite
or new editorial approval occurred. Existing draft use of observed cards remains
available, with explicit review. The raw heuristic top-candidate count is one;
**qualified parent-verified >=60-second conversations: zero**. Narration duration
is not measured audio. Precision: NOT MEASURED, no human labels.

## Resources and cleanup

| Measurement | Actual sampled value |
| --- | ---: |
| Preflight available physical | 600.81 MiB |
| Minimum available physical | 429.56 MiB |
| Minimum system commit reserve | 4,422.76 MiB |
| Peak summed browser-tree RSS | 643.92 MiB |
| Peak summed private bytes | 528.32 MiB |
| Guard stops | 0 |

RSS can double-count shared pages and these are sampled peaks. Physical minimum
was above 384 MiB throughout recorded samples: this run proves successful browser
collection on the machine, NOT successful operation below 384 or a benchmarked
256 MiB minimum. Do not attribute success solely to lowering the guard.

Each lifecycle closed normally and the guardian closed one residual owned
process afterwards (five forced owned-process closures total). All lifecycle
reports have empty remainingPids, cleanupVerified=true and monitorExited=true.
All 36 sampled owned PIDs were absent in the subsequent read-only existence
check. No Python observer or project lease remained. No external application was
terminated; no Windows/pagefile configuration was changed. Windows OOM evidence
is null, not an inferred OOM event.

### Request telemetry caveat

The three public visits logged 170 / 251 / 163 interception events, including
blocked image/media/font and over-budget requests. The existing handler only
admits requests while the event counter is <=150 and aborts the rest. Thus the
logged field is not the number of actual network requests. Exact-root request
totals are null (unavailable), with one navigation per extraction. Admitted versus
aborted counts and total network traffic were not recorded; do not claim a
measured full-run network count or silently call all interception events network
requests. This instrumentation gap needs an offline fix before the next pilot.

## Local artifacts and verification

Backend Git-ignored folder: `.studio-data/reports/browser-policy-live01/`:

- `approval.json`, single-use `attempt.json`, `before.json`.
- `report.json`: immutable collected captures, source evidence, quality proposals
  and resource/cleanup reports. `candidates.json`: five discovery entries.
- `full-report.md`: all persisted candidate bodies/URLs and both complete draft
  proposals for manual review; no production approval implied.
- `review.json`, `offline-verification.json`, `preservation.json` and
  `artifact-manifest.json` with file size/SHA-256.

Offline reopen checks passed: two exact canonical IDs and author handles match
the source captures, source types remain UNKNOWN, replies remain unverified and
report SHA-256 stayed unchanged while derived reports were generated. No new
Studio session, DATA-01 review, production job or project was created. No browser
was reopened for screenshots; screenshots were NOT CAPTURED in this run.

Production preservation: **933/933** baseline files match bytes and SHA-256,
zero changed/unreadable; baseline manifest hash:
`e19574bf84fc07c88a165aa3958f50e579a93c289b6aeef2c0664c1f35a6c1e7`.
No source code changed during this pilot; no build/Jest rerun was necessary.
The source checkpoint's offline validation was 58 tests plus build/typechecks;
those tests are not counted as new LIVE evidence.

## Next work, without another automatic LIVE attempt

Use these saved captures for offline fixes: keep date/author UI chrome out of
clean projections; separate recommendation/context uncertainty from eligible
discussion selection; record request admission/abortion counts. Inspect supported
public relationship evidence before claiming parent chains. Keep all raw data
and the draft option; no relationship/rights/approval promotion. Another LIVE
attempt requires a fresh user approval and attempt ID. This one is consumed.
