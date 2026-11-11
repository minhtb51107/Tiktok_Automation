# DATA-QUALITY-02 — context recovery and editorial quality

Base b6ed69d; implementation branch codex/data-quality02-context-editorial.
Overall: **offline fixes PASS; verified real parent relationships PARTIAL**.
No new Threads LIVE/API, TTS, render, publishing, auto-review or production writes.

## Why legacy returned comments and DATA-04 returned zero verified replies

Legacy ScraperService.scrapeThreadsUrl() scrolls four times, gathers every
data-pressable container, picks uniquePosts[0] and calls uniquePosts.slice(1)
comments. Dedup uses a 40-character prefix. It additionally guesses reply status
from the root author's name, currentParent and a Replying-to handle. A handle is
not a post identity; DOM order is not a parent edge. Its numeric-tail counters,
default timestamp and synthetic avatar fallback also do not establish evidence.
This code is preserved, not reactivated or presented as trustworthy verification.

Current exact extraction matches a canonical permalink/author and retains context
separately. DATA-04 formerly accepted only structured JSON-LD comment/parentItem
chains plus the visible subject permalink. LIVE01 returned 37 observed permalink
candidates, not 37 proven replies. Its stored capture lacks explicit region or
header-parent observations, so none can be retroactively promoted. Restricting a
verified-only list was correct for provenance; hiding all observed cards would
lose the useful legacy editing workflow. This checkpoint keeps both paths apart.

## Real-data audit, all 37 candidates

Input: existing backend reports/browser-policy-live01/report.json. SHA-256:
`f515aeb281aa021d54165d279f3b07292e1371ff9fac41f1348311681c44eca8`.

| Target | Retained candidates | Parent verified | Scoped discussion evidence | Unknown | Recommendation-risk |
| --- | ---: | ---: | ---: | ---: | ---: |
| gnrtth / DeI-TuzEc_9 | 24 | 0 | 0 | 23 | 1 |
| pngkhatu / DaNZphhgU_i | 13 | 0 | 0 | 13 | 0 |

The recommendation-risk card is tuan27020 / DfEvYDZmbdm. Its title identifies a
final part and its body refers to earlier parts: an explainable standalone-series
signal. This is **CONTENT_RISK_HEURISTIC**, not technical proof of a wrong parent.
It is excluded from automatic THREAD_DISCUSSION selection and remains available
for explicit editorial choice or TOPIC_COMPILATION. No handle-specific rule or
date/position cutoff is coded. Other cards may also be recommendations; this
saved evidence cannot resolve them. All 37 stay visible in the derived report,
including one missing-text record previously absent from the scored list.

The record metadata does not prove POST versus COMMENT for either root. Both
remain UNKNOWN. Reported reply totals 126 and 10 are not collected-reply counts.

## Changes

### Clean projections and TTS defaults

source-quality.ts now removes evidenced leading calendar/relative time and the
adjacent header separator/author badge. It matches saved DOM time/label metadata
and distinguishes header text from authored text where the capture provides both.
It does not regex-delete dates/words throughout the body. Ambiguous authored
dates/author phrases are preserved. Existing topic/body handling stays separate.

On these captures, date-prefixed context projections dropped **22 -> 0**. Root
and raw original fields are untouched. New Studio source items initialize clean
display/spoken text; archived edits/locks retain precedence. Existing items are
not silently migrated. Apply clean projection and Restore are explicit actions;
Restore still respects verified topic mapping. Audio cache/revision invalidation
continues through the existing edit path. There is no second TTS pipeline.

### Relationship classes and public evidence

context-classification.ts separates:

- PARENT_VERIFIED: only the existing exact-root chain validator can produce it.
- OBSERVED_RELATIONSHIP_UNVERIFIED: explicitly labelled discussion region tied
  to the exact target; does not assert a direct parent.
- RELATED_OR_RECOMMENDED: an explicit recommendation region, or a separately
  labelled content-risk heuristic requiring review.
- UNKNOWN: no sufficient scoped evidence; still usable in an explicitly selected
  editorial DRAFT, not silently converted into a verified comment.

The new public-context-dom observer reads semantic region labels/labelled-by
headings and the exact target link. It never uses DOM order or proximity as proof.
It can also record a header-scoped Replying-to permalink, the subject's own time
permalink, its author profile and body. A body link, profile-only parent link,
wrong document, ambiguous identity or chain not reaching the exact root cannot
verify a reply. Direct/nested DOM_EXPLICIT_REPLY_TARGET chains are tested without
JSON-LD; existing conflicting structured records are not conveniently overridden.
Library and editorial validators accept the new kind while preserving exact
identity/chain checks. Canonical identity was extracted into a shared pure module;
the existing conversation-evidence export remains compatible.

**These DOM region/header selectors are prepared code, not proven against LIVE
Threads in this checkpoint.** The saved captures contain none of these signals.
No fictitious region or parent edge was backfilled into old raw data.

### Editorial modes and Studio usability

content-selection/2 distinguishes THREAD_DISCUSSION from TOPIC_COMPILATION. The
latter is an editorial grouping label, not activation of the legacy Compilation
workflow. Existing FUNNY/SERIOUS scoring profiles are reused; no legacy production
workflow is enabled. Lexical overlap remains a proxy, not semantic understanding.

Unscoped UNKNOWN cards are proposed for review, not silently assembled into a
thread script. Explicit selected IDs preserve order and can include observed
cards for DRAFT; no new parent/approval gate prevents that use. Recommended-risk
cards can be explicitly chosen with warnings. Empty, spam, duplicate and repetitive
material cannot inflate duration. Contact-CTA detection now recognizes separated
phone digits; employment experience is not rejected merely for mentioning a job.

In Studio Source: one permalink + WITH_CONTEXT returns root and observed cards
through the existing extraction endpoint. Root is initially selected; context
is not. The existing Add Context/checkbox actions select it for Script DRAFT.
Cards now show clean text, immutable original, classification and reasons. The
Source report carries classification alongside the legacy observation label.
The sourceReference POST/COMMENT denotes an editorial card role; it does not
confirm catalog itemType. Catalog review and production approval remain separate.
No DATA-03 verification/approval gate is bypassed.

Offline StudioService replay proves create -> fetch one saved permalink capture
-> display source cards -> explicit selection/edit -> reload with narration lock,
unchanged original and raw extraction -> stale revision rejection. This is an
offline saved-data integration test, not a new browser UI/LIVE scraping test.
The Source extractor's original capture contains 22 detailed cards; the DATA-04
observer supplies additional observations up to 37 in the data report. This
checkpoint does not silently import those extra observations into old sessions
or restore unlimited legacy scrolling.

### Telemetry

Interception events, admitted decisions, blocked decisions and handling failures
are now separate. Admitted means continue() was chosen, not proof of server receipt.
Existing domain/resource/navigation/event budgets are retained. In the synthetic
170-event case, 100 blocked images + 50 admitted scripts + 20 over-budget blocked
scripts yield events=170, admitted=50, blocked=120. Old LIVE telemetry is not
retroactively assigned invented network counts. Resource policy v2 is unchanged.

## Re-evaluation and full report

Derived local files under backend `.studio-data/reports/data-quality02/`:
`input-hash.json`, `preview-selections.json`, `replay.json`, `report.md`,
`preservation.json`. Run `node scripts/data-quality02-replay.cjs` after backend
build to replay the saved file; no network is used. A different capture can be
specified through DATA_QUALITY02_CAPTURE. Raw inputs are never rewritten.

The offline editor proposals are labelled **NOT_USER_APPROVAL**:

- gnrtth: four first-person role/requirements accounts from myhao1103,
  buiminhhoang1159, bbunbo.huee, genz_haudau, ordered by explicit source IDs.
  They address the question more directly than the standalone-series card;
  relationships still UNKNOWN. Clean quote-only estimate **57–79 seconds**.
  It is not certified >=60 seconds and still requires editorial work/review.
- pngkhatu: three short reactions from the actual saved cards, without adding
  context that was not collected. Clean estimate **10–14 seconds**; insufficient
  long-form material. Slang is not interpreted or rewritten into invented facts.

Full originals, clean projections, selected/excluded reasons, source URLs and
both complete draft previews are in report.md, outside Git. The earlier heuristic
66–91-second proposal depended on different/mixed context. A shorter honest
proposal is not padded to hit a duration target. No WAV duration, precision or
improved semantic accuracy is claimed without actual audio/human labels.

## Verification and integration

Local full Jest: **47 suites / 346 tests PASS**, sequential isolated ts-jest,
320 MiB heap; source replay tests read the actual saved LIVE file. CI skips those
three saved-file cases when the private capture is absent; synthetic regressions
still run. The existing native Windows cleanup case is platform-specific.
An earlier synthetic library test used two-character IDs invalid under its
existing identity contract; fixture IDs were corrected without weakening schema.
Frontend strict typecheck also caught a closure nullability issue, fixed without
disabling checks. Backend build, frontend TypeScript, Studio bundle and Remotion
bundle all exited 0. Remotion bundle compilation is not MP4 rendering. No browser
visual smoke was performed or claimed. Final CI status is independent of these
local checks and is reported after the authorized main push.

Production baseline remains **933/933** files matching size and SHA-256; zero
changed/unreadable. Baseline manifest hash:
`e19574bf84fc07c88a165aa3958f50e579a93c289b6aeef2c0664c1f35a6c1e7`.
Capture input hash stayed unchanged; no credentials/session/lock/resource policy
was rewritten. No dependency added, scheduler or external worker started.

Before integration main was 7bca97d, ancestor of b6ed69d with four completed
commits missing: 59c50de, 69d39fb, 70fe399, b6ed69d. The new source checkpoint is
to be fast-forwarded only after local checks; no squash, merge commit, branch
deletion or history rewrite. CI's actual final run/link is recorded in the final
handover and ignored runtime evidence, not presumed from a local build.
