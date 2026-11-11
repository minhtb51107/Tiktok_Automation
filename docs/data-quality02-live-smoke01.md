# DATA-QUALITY-02 LIVE smoke 01

Date: 2026-11-12 (Asia/Saigon). Target:
`https://www.threads.com/@gnrtth/post/DeI-TuzEc_9`.

This was one explicitly approved, browser-only, single-use attempt. It used no
Threads API, user profile, cookie vault, TTS, render, acceptance or publishing.
There was no retry.

## Result

The exact root was matched and the current public target page was collected.
The page exposed 27 permalink cards: the root plus 26 unverified context URLs.
The bounded exact Source extractor materialized the root plus 10 context cards.
All 10 Source URLs were also present in the prior `browser-policy-live01`
capture; that prior capture contained 24 observed URLs and the same 10 Source
cards. Its immutable report hash remained
`f515aeb281aa021d54165d279f3b07292e1371ff9fac41f1348311681c44eca8`.

The root displayed a reported reply count of 126. That value is page metadata,
not the number collected or verified.

| Evidence result | Count |
| --- | ---: |
| Context URLs observed on target page | 26 |
| Context cards materialized for Studio Source | 10 |
| Explicit labelled discussion regions | 0 |
| Explicit reply-header relationships | 0 |
| Parent-verified replies | 0 |
| DOM-proven recommendation regions | 0 |
| Content-risk recommendation exclusions | 1 |
| Remaining UNKNOWN observations | 25 |

The one content-risk exclusion is `tuan27020 / DfEvYDZmbdm`: its title and body
identify it as a multi-part standalone series. This is a review heuristic, not
parent evidence and not proof of its placement in a recommendation region.

## Selector diagnosis

The live DOM did not provide the semantic structures required by the new
observer:

- no `section` or `role=region` with an exact discussion/recommendation label;
- no card-header link labelled `Replying to` or `Đang trả lời`;
- all 27 cards had one permalink and a timestamp, but their controls did not
  expose a relationship label.

The screenshot visibly shows a Threads `Thread` page, target-context cards and
a public login prompt. Visual adjacency, DOM order, author, date and topic are
not promoted to parent evidence. Consequently zero parent-verified replies is
the correct result. The observer needs a future bounded LIVE inspection of
stable thread-rail/container attributes before it can safely classify these
cards as `OBSERVED_RELATIONSHIP_UNVERIFIED` by structure. This attempt is not
reused for that work.

## Studio acceptance

The saved collection was replayed offline into an isolated Studio store. Studio
created 11 items (root plus 10 context cards). A context card was selected as a
technical DRAFT-selection smoke, saved and reopened. Raw extraction and
`originalText` remained byte-for-byte equivalent, and no acceptance state was
created. The 16 additional URL observations are retained in the conversation
collection but are not materialized by the bounded Source extractor, so full
26-card Source import remains PARTIAL.

The first post-collection acceptance attempt failed because the standalone
runner had not loaded `reflect-metadata` before constructing `StudioService`.
The browser collection had already completed and was not repeated. The runner
was corrected, and the Studio acceptance was recovered offline from the
immutable saved collection.

## Resources and cleanup

- Preflight: 634.75 MiB physical RAM available; 4,589.78 MiB commit reserve.
- Exact-root pass: 5,829 ms; minimum 348.57 MiB available; peak owned-browser
  RSS/private bytes 553.71/404.22 MiB.
- Enrichment pass: 5,087 ms; minimum 437.88 MiB available; peak owned-browser
  RSS/private bytes 646.07/503.75 MiB.
- Whole attempt: 13,433 ms.
- Both browser trees: zero remaining owned PIDs. One owned child in each tree
  required forced cleanup; no external process was targeted.
- Resource policy v2 issued one advisory and no emergency stop. There is no
  Windows OOM evidence.

## Artifacts

Git-ignored sandbox:
`1_nest_backend/.studio-data/reports/data-quality02-live-smoke01/`.

- `collection.json`: immutable saved LIVE collection.
- `dom-evidence.json`: sanitized DOM observations; no cookies/storage/tokens.
- `target-page.png`: public-page screenshot.
- `report.json`: comparison, evidence counts, resource and Studio acceptance.
- `studio-store-final/`: isolated technical save/reopen session.

No top-level production session file was modified during the attempt. The old
LIVE capture hash above is unchanged.
