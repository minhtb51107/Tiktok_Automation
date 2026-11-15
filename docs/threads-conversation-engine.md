# Threads Conversation Engine V2.1

Status: offline implementation and saved-capture replay. No new LIVE collection or
paid provider run was performed for this checkpoint.

## V2.1 engineering decision

The only acquisition path remains:

`Public DOM → Card Observations → Relationship Evidence → collectEvidence graph validation → normalizeConversation → existing quality engine`.

Card observation now persists exact subject identity, full authored spans, owned
media/counters, DOM node identity, parent-container path, conversation-container
reference, raw relationship signals, raw card text and capture time. These are
observations, not parent assertions.

The relationship resolver accepts four evidence sources without adding another
graph algorithm: structured JSON-LD, explicit public reply UI, bounded exact
permalink-detail validation and optional provider rows. `collectEvidence()` remains
the sole authority for canonical identity, parent chains, cycle/conflict detection
and wrong-root rejection. An UNKNOWN card does not abort a collection: at most two
non-recommended UNKNOWN subjects are planned for permalink validation; unresolved
items stay UNKNOWN and discovery can continue.

Automatic quality selection remains limited to parent-verified replies. The V2.1
projection also reports `READY_FOR_DRAFT`, `NOT_ENOUGH_CONTENT`, or
`EXCEPTION_REVIEW`, with a 65–90 second text-only estimate clearly marked
non-authoritative. Both `NOT_ENOUGH_CONTENT` and `EXCEPTION_REVIEW` tell
discovery to continue to another source within its configured budget. Unresolved
evidence remains available in the exception queue; narration is never padded or
invented.

## Root cause audit

The old public collection path represented every `/post/` link found inside a
container as an observed candidate. A visible card can contain links to its own
post, a parent/context post, and other UI destinations. In the saved `gnrtth`
capture this produced 26 observations while the exact-target extractor had
materialized only 10 complete cards. The second collector saved a longest-span
text projection for the other observations, but it did not save enough raw DOM to
prove that each URL was the subject of that card. Those 16 projections are not 16
known replies and their subject-card identity is
`NOT_RECOVERABLE_FROM_SAVED_CAPTURE`.

`observePublicDocument()` also retained only the longest `span[dir=auto]` from a
card. That could drop additional authored paragraphs and did not preserve a
structural raw/card projection. `collectEvidence()` correctly refused to promote
those observations because neither JSON-LD `parentItem` nor an explicit,
header-scoped reply target connected them to the exact root.

V2 therefore:

1. resolves a card subject only from its owned `time` permalink;
2. captures all owned body spans, media, labelled engagement and raw card text;
3. keeps subject permalinks separate from other links inside the card;
4. uses canonical identity for deduplication;
5. groups output into parent-verified, observed conversation, related/recommended,
   unknown and incomplete;
6. applies quality ranking after evidence grouping, never as relationship proof;
7. offers a batch verified-quality selection while leaving approval unchanged.

## Evidence policy

`PARENT_VERIFIED` requires a structured parent reference or an explicit
header-scoped public reply target with an exact subject permalink and a chain back
to the canonical root. DOM order, author identity, semantic similarity, keywords
and time proximity remain invalid relationship evidence. Graph validation rejects
cycles, conflicting identities and wrong-root chains.

Cards from a labelled discussion region remain `OBSERVED_CONVERSATION`; cards in a
labelled recommendation region become `RELATED_OR_RECOMMENDED`. Missing or
conflicting evidence goes to exception review instead of disappearing.

## Saved LIVE captures

| Root | Saved evidence | V2 conclusion |
| --- | --- | --- |
| `gnrtth/DeI-TuzEc_9` | 26 legacy observations, 10 complete source cards, 16 legacy text projections, 0 verified | 10 cards remain fully attributable; 16 projections are explicitly incomplete, not replies |
| `baongocghetmatcha/DfWJxiID7E5` | 8 materialized contexts, image, 0 verified | useful editorial material; relationship and AGENT_VISUAL OCR still require review |
| `pngkhatu/DaNZphhgU_i` | 13 subject URLs, 12 materialized contexts, 0 verified | preserved as unknown/incomplete; no parent claim is created |

These captures are not ground truth for reply association. The available evidence
supports root identity and observed-card extraction, but not a positive
parent/reply label. Reply association precision is therefore not reported as an
accuracy percentage. Root match is exact for the three canonical URLs; candidate
quality agreement remains `NOT_MEASURED` until the user supplies labels.

### Offline replay result

| Root | Legacy observations / complete cards | V2 verified | V2 observed-conversation | V2 related | V2 unknown complete | V2 incomplete | Quality recommendations |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| `gnrtth` | 26 / 10 | 0 | 0 | 0 | 10 | 16 | `DeJDn2kCT-g` (84), `DeJMJJmk40q` (58), `DeJMMM6k4fW` (82), all remain UNKNOWN evidence |
| `pngkhatu` | 13 / 12 | 0 | 0 | 0 | 12 | 1 | none |
| `baongocghetmatcha` | 8 / 8 in the content-selection artifact | 0 | not recoverable | not recoverable | not recoverable | not recoverable | candidate score 78, estimated 65–89 s; relationship graph is `NOT_RECOVERABLE_FROM_SAVED_CAPTURE` |

The saved `gnrtth` DOM evidence has no labelled discussion/recommendation region,
so V2 does not retrospectively label its ten complete cards as conversation or
recommendation. A new V2 capture can persist those explicit region observations if
the current public UI exposes an accessible label or test ID. The three `gnrtth`
quality recommendations are content-ranking results only and are not selected for
automatic direct-reply narration because their relationship evidence is UNKNOWN.

### Isolated Studio acceptance

The earlier V2 backend/frontend bundle was run at `127.0.0.1:3111` against a copied
store with LIVE collection disabled and credentials omitted. The Studio displayed
the V2 counts above, retained the 26 canonical subjects in full-run exports,
removed the legacy leading date only from the root display/report projection, and
left the immutable source unchanged. Copy Report, Markdown/JSON export, feedback
save/reopen and Source DRAFT creation were exercised through the browser. The
sandbox feedback remained `NEEDS_REVIEW`; creating the draft did not grant content,
rights, production or publishing approval. The created session contained the root
plus all 26 persisted context rows, with only the two explicitly persisted
editorial selections enabled.

V2.1 was then smoke-tested at `127.0.0.1:3113` with a fresh copied store, LIVE
flags disabled and credential variables omitted. It displayed the saved `gnrtth`
collection as 26 subjects / 10 full cards / 16 incomplete observations / 0
verified replies, showed `EXCEPTION_REVIEW` with the non-authoritative 7–9 second
estimate, and did not auto-select UNKNOWN content. Copy Report contained the exact
root and V2 counts; JSON export downloaded the full 788,461-byte persisted run.
The smoke runtime was stopped after verification.

Current validation completed sequentially: targeted conversation/data-quality
Jest 6 suites / 41 tests, full Jest 57 suites / 387 tests, backend and frontend
TypeScript, Nest build, Studio bundle, and browser Copy/Export smoke. These are
offline/saved-capture results, not a new LIVE collection claim.

## Optional provider comparison

No provider was activated and no credential or dependency was added.

- `parseforge/threads-replies-scraper` advertises `rootPostUrl`, `parentPostId`,
  `parentPostUrl`, depth up to 10, engagement and media. Its Apify listing showed
  pricing from USD 3.40/1,000 results when re-audited on 2026-11-15. It is a hosted Actor, not code
  licensed for copying into this repository. Provider parent fields would still be
  checked for canonical root, unique IDs, acyclic graph and internal consistency.
- `automation_craft/threads-replies-scraper` advertises text, author, time, likes,
  media, depth and parent at USD 0.06/1,000 replies. The listing had no ratings and
  limited usage evidence at audit time, so it is a benchmark candidate rather than
  a trusted source of truth.
- `cleanscrape/threads-scraper` advertises public post/reply collection and media at
  USD 1.19/1,000 posts on the listing (the README also described a USD 1.49 base
  tier). Crucially, its own documentation says `rootPostId` is supplied but the
  immediate `parentPostId` remains null because it is not reliably established.
  It cannot benchmark nested relationship accuracy.

Any future Apify invocation must accept only an explicitly configured actor ID,
maximum cost and result budget. It must store the provider row unchanged, map it
through the same canonical/graph validator, and never trust `parentId` in isolation.
The thin client is implemented but disabled by default. Estimate/status performs no
network request. A paid run additionally requires an ignored backend token, an
explicit single-run approval ID, actor match and a maximum-cost ceiling; returned
rows still pass the existing adapter and `collectEvidence()`.

V2.1 now implements the pure Parseforge schema adapter but still performs no Actor
request. It maps `postUrl`, `parentPostUrl`, `rootPostUrl`, `depth`, author, body,
timestamps, engagement and media into the existing contracts; preserves each raw
row/hash separately; rejects wrong-root, invalid-code, missing-body and conflicting
duplicate rows; and sends accepted candidates through `collectEvidence()`. Exact
provider duplicates are deduplicated. Activation, credentials and billing remain
absent by design.

## THREADS-ACQUISITION-03 LIVE acceptance

The single approved attempt was consumed on 2026-11-15 against
`https://www.threads.com/@gnrtth/post/DeI-TuzEc_9`. It used one browser worker at a
time, no retry, three bounded scroll actions, two permalink detail validations and
finished in 18.7 seconds. The exact-root and conversation visits admitted 23 and
31 requests respectively (155/279 interception decisions); blocked subresources
are not server requests. Minimum available physical memory was 583.22 MiB and
minimum commit reserve 7,514.59 MiB. Peak sampled browser RSS was 707.88 MiB and
cleanup reported no remaining owned process. Production manifest hashes before and
after are identical.

The browser state machine observed 25 exact subjects initially and 30 after the
first action; the next two actions found no new subjects and stopped deterministically.
After excluding the root, 29/29 persisted context cards have authored body text
(30 subjects / 29 non-root full cards; 96.67% when the metric includes all subjects
and the separately sourced root). This improves the legacy baseline of 10 complete
cards and 16 incomplete URL observations. Snapshot merging recorded 85 duplicate
observations without duplicating canonical subjects. No body hyperlink was
materialized as a separate subject.

The public page visually showed the exact root and cards beneath it, but its saved
DOM exposed only the generic `Phần thân cột` region. It exposed no structured
parent reference, explicit `Replying to` relationship, labelled discussion region
or validated permalink parent. Both bounded permalink-detail checks returned
`DETAIL_VALIDATION_FAILED`. Consequently the auditable result is
`PARTIAL_NO_PUBLIC_PARENT_EVIDENCE`: 0 verified replies, 0 explicit observed-
conversation cards, 1 related/recommended classification and 28 UNKNOWN complete
cards. The reported 127 replies is metadata, not a collected count. Deterministic
quality does not auto-select UNKNOWN cards; the resulting 7–9 second root-only
estimate is not enough for a 65–90 second video.

Artifacts are isolated under the ignored
`1_nest_backend/.studio-data/reports/threads-acquisition03-live01` directory. They
include the raw collection, four snapshots, action log, browser evidence,
screenshot, resource telemetry and before/after production manifests. Persistence
save/reopen passed. Raw evidence remains unchanged; timestamp chrome is removed
only from the clean card projection for future captures.

The acceptance artifact must retain root/card metadata, exact subjects, body/media,
DOM node/container paths, raw relationship signals, permalink diagnostics,
screenshot and resource/request telemetry. If neither structured, explicit UI nor
detail evidence yields a positive parent edge, the result is
`NO_PUBLIC_PARENT_EVIDENCE`; selector experimentation stops and the optional
provider benchmark becomes the next separately authorized decision.

The next evidence-producing option is a separately authorized same-URL Parseforge
benchmark. With 20 result items, the current public listing estimate is USD 0.068
at USD 3.40/1,000 results; this is not a billing quote. No Actor request, credit
purchase or provider credential use occurred in this checkpoint.

## THREADS-ACQUISITION-04 conversation membership

Conversation membership is now independent from an immediate parent edge. The
persisted contract records `THREAD_UI_CONFIRMED`, `RECOMMENDED_POST`, or `UNKNOWN`
with the exact root/subject IDs, evidence type, originating browser action,
container reference, and observation timestamp. None of these values changes the
existing relationship graph or creates a `parentId`.

Membership confirmation is deliberately limited to explicit evidence:

- an accessible discussion/recommendation region tied to the exact root;
- a header-scoped public reply relationship; or
- a newly observed card inside the exact root/confirmed-card container after a
  bounded `EXPAND_NESTED` or `LOAD_MORE` action.

Scroll order, author, semantic similarity, and generic same-page presence remain
insufficient. Recommendation evidence wins a conflict to prevent contamination.
Only quality-`RECOMMENDED` parent-verified or `THREAD_UI_CONFIRMED` cards are
eligible for automatic editorial selection. A confirmed conversation card is
described as an opinion in the discussion, never as a direct reply to another card
unless the existing graph validator separately proves that edge. The automatic
selection is ephemeral until a user saves it; it does not change review, rights,
production, TTS, render, or publishing approval.

### Saved `gnrtth` replay

The acquisition-03 artifact still yields 29 full-body non-root cards, 0
parent-verified replies, 0 `THREAD_UI_CONFIRMED`, 1 content-risk related card, and
28 UNKNOWN cards. Its three browser actions were plain scrolls; all cards shared
the generic `Phần thân cột` region and had no explicit relationship signal. Thus
the new code correctly selects 0 cards automatically from this saved evidence.

The `_rachel_darryl` and `h_nah254` card pairs occupy visually suggestive DOM
clusters, but that is not a structural membership assertion and both remain
UNKNOWN. `tuan27020` is excluded by the existing standalone-series content-risk
classification, but its technical membership also remains UNKNOWN rather than
being falsely labelled `RECOMMENDED_POST`.

A positive LIVE acceptance therefore requires a separately authorized capture
that records an explicit discussion surface or an expand/load action tied to the
exact root/card container. The previous single-use LIVE authorization was already
consumed and was not reused for this checkpoint.

### Acquisition-04 offline acceptance and next LIVE plan

The automatic policy is covered at both normalization and DRAFT-bridge layers:
quality-eligible `PARENT_VERIFIED` and `THREAD_UI_CONFIRMED` sources are selected;
`RECOMMENDED_POST` and `UNKNOWN` are not. An explicit exception-review choice may
still use an UNKNOWN source, but its editorial section is persisted as
`UNKNOWN_CONVERSATION_MEMBERSHIP`, with `parentId=null`; it is never presented as a
reply and does not change the saved review decision.

The isolated Studio acceptance at `127.0.0.1:3116` displayed 29/29 full cards,
0 confirmed membership, 1 related-risk card, 28 UNKNOWN and 0 incomplete. No card
was duplicated across the observed and UNKNOWN sections. Copy Report produced a
16,219-byte full-run report; JSON and Markdown exports were 1,023,613 and 16,051
bytes. Feedback save/reopen passed. A browser-triggered Source DRAFT reopened with
one explicitly selected UNKNOWN exception source, `parentId=null`, membership
`UNKNOWN`; this was not an automatic selection or approval.

One new single-use LIVE authorization would use the same canonical `gnrtth` URL,
one browser/tab, at most 180 seconds, four bounded UI actions, 150 admitted network
requests, 40 subject cards, two detail validations, and no retry. The collector
would:

1. open and verify the exact canonical root;
2. snapshot the page and locate only an explicit root-owned `view/show replies` or
   `load more replies` control (never a composer `Reply` button);
3. persist the control label, exact container node, container subject, and snapshot
   before clicking;
4. click once, persist the resulting transition/snapshot, and classify only newly
   materialized descendants of that exact root/confirmed-card container;
5. optionally expand one nested confirmed card within the remaining action budget;
6. separately record explicit recommendation-region labels and reject membership
   conflicts in favor of contamination protection.

PASS requires at least one real card with explicit discussion-region evidence or
an action/container chain rooted at the exact post, while recommendation cards stay
separate and no direct parent is invented. If Threads exposes only generic scroll
content, no root-owned expansion control, or no distinguishable surface, the result
is `NO_PUBLIC_CONVERSATION_MEMBERSHIP_EVIDENCE`; the run stops without selector
guessing. Emergency resource guards and login/CAPTCHA/access-protection stops remain
unchanged. This LIVE run has not been authorized or performed.
