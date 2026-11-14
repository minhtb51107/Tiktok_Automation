# Threads Conversation Engine V2

Status: offline implementation and saved-capture replay. No new LIVE collection or
paid provider run was performed for this checkpoint.

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

The current backend/frontend bundle was run at `127.0.0.1:3111` against a copied
store with LIVE collection disabled and credentials omitted. The Studio displayed
the V2 counts above, retained the 26 canonical subjects in full-run exports,
removed the legacy leading date only from the root display/report projection, and
left the immutable source unchanged. Copy Report, Markdown/JSON export, feedback
save/reopen and Source DRAFT creation were exercised through the browser. The
sandbox feedback remained `NEEDS_REVIEW`; creating the draft did not grant content,
rights, production or publishing approval. The created session contained the root
plus all 26 persisted context rows, with only the two explicitly persisted
editorial selections enabled.

Validation completed sequentially: targeted conversation/data-quality Jest 24/24,
pipeline regressions 39/39, full Jest 56 suites / 380 tests, backend and frontend
TypeScript, Nest build, and Studio bundle. These are offline/saved-capture results,
not a new LIVE collection claim.

## Optional provider comparison

No provider was activated and no credential or dependency was added.

- `parseforge/threads-replies-scraper` advertises `rootPostUrl`, `parentPostId`,
  `parentPostUrl`, depth up to 10, engagement and media. Its Apify listing showed
  pricing from USD 1.70/1,000 results when audited. It is a hosted Actor, not code
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

An optional Apify adapter should accept only an explicitly configured actor ID,
maximum cost and result budget. It must store the provider row unchanged, map it
through the same canonical/graph validator, and never trust `parentId` in isolation.
It remains `NOT_IMPLEMENTED` until the user authorizes a paid benchmark and chooses
a provider.

## LIVE acceptance still required

The new DOM projection must be checked against one separately approved public URL.
Acceptance measurements are: exact root match, subject cards, materialized body and
media rate, parent-verified chains, related-post exclusion, missing-body count,
wrong-root contamination and cleanup/resource telemetry. Reported reply count is
never substituted for collected replies.
