# DATA-04 — Conversation discovery, evidence and shadow quality

## A — Read-only audit (2026-11-05)

Base `35179ea`, dedicated branch/worktree `codex/data04-conversation-quality`.
All three prior worktrees were clean and remain untouched. Production baseline:
933 readable runtime files, no locked files; private manifest hash
`4897b40301b9452182147d1ea35d5c91c9867ffa47701d525f6ef65e890227e8`.

| Existing component | Confirmed source behavior | Reuse / limitation |
|---|---|---|
| `ScraperService.scrapeThreadsUrl:10` | Drops query; scrolls four times; first card becomes post, remainder comments | Do not reuse this parser as verified replies |
| Same file `:117` | Same-author/DOM-order/previous-author heuristics infer replyTo; 40-char prefix dedup; placeholder avatar/time | Unsafe relationship/identity and missing-data inference |
| `scrapeForYouFeed:158` / `public-discovery.ts` | Controlled public navigation, installed browser, URL allowlist, small budgets; returns first permalinks | Reuse lifecycle/budgeting; order is not HOT ranking |
| `extractPublicThreads:355` | Exact target by unique permalink, labelled controls, time and topic evidence | Reuse exact-post extraction; compact counts may be approximate |
| `public-threads.ts:426` | Context stores own URL/text/author, UNKNOWN type and null parent; explicit unverified relationship | Context is persisted in crawler attempts/session, not verified reply Bronze |
| `crawler-consumer.ts` | Exact root import, checkpoint, Gold V1/V2 shadow | No verified reply collector or relationship graph |
| `crawler-adapter.ts` | Preserves identity evidence/raw fields; no parent invention | Reuse post projection |
| Gold V1/V2 | Single-post lexical/content/context/engagement rules | Retain unchanged; no conversation quality or verified reply sample |
| Studio | Global catalog review and on-demand discovery; Gold feedback separate from production | Extend existing panels, not replace them |
| DATA-03 `production-adapter.ts` | One pinned reviewed source → one initial scene | Source bundle must preserve reply identities; no automatic multi-source handoff |

Reply permalink is sometimes observed in context. Parent/nested hierarchy is **not
verified** by current extraction. Visible counts, time elements and labelled
controls are observations; positional numbers, same author, DOM proximity, absent
time defaults and handle-only parent are not evidence of a reply relationship.

The new strict reader may accept an explicit public structured relationship,
never card proximity. Schema.org defines [Comment.parentItem](https://schema.org/parentItem)
and [CreativeWork.comment](https://schema.org/comment) as parent/comment relationships.
This establishes parser semantics, **not that Threads currently exposes them**.
Whether public Threads pages expose sufficient relationship evidence remains a
LIVE pilot question. No Threads page/API was fetched in checkpoint A.

Production remains THREADS SERIOUS. FUNNY/Compilation/Lyrics are not reactivated.

## Checkpoint status

- A: source audit PASS; historical live reply hierarchy NOT VERIFIED.
- B–G: pending. No LIVE pilot authorized or executed.

## B — Popularity foundation

Versioned multi-signal scorer and comparable-evidence ranking are implemented. Missing values stay null; velocity requires two consistent observations. Sparse candidates preserve observed order and report PARTIAL. Synthetic regression: 3 tests PASS. Public observation adapter is completed with collector checkpoint C. No HOT or viral prediction is claimed.

## C — Strict collection adapter

Public structured Comment.parentItem/comment edges plus DOM own permalink form the only accepted relationship evidence. Missing/conflicting/unrelated/cyclic parents remain unverified; nested chains must reach the exact root. Public collection never claims COMPLETE. Disposable installed browser, 30s/page, <=150 requests, <=4 navigations, <=2 scrolls, <=20 verified replies. Lightweight discovery observes at most six unique candidates; ambiguous card counters are not attributed. Compact approximate counts are excluded from ranking. No live request has run. Seven identity/relationship tests PASS; backend TypeScript exit 0.

## D — Reply Quality V1

Conservative Vietnamese lexical rules separate SUBSTANTIVE/LOW_INFORMATION/SPAM/DUPLICATE/UNCERTAIN, preserving all raw text. Short counterarguments can be substantive; employment/TOEIC alone never classify advertising. Exact and Jaccard near duplicates have separate reasons. Sarcasm and semantics remain human-review limitations. Four quality tests PASS (including emoji, short counterargument, personal experience, duplicate and spam).

## E — Persistent conversation shadow and human selection

Atomic DataStore namespaces now retain run checkpoints, immutable collection/reply observations and revisioned feedback. Existing DATA-01/Gold V1/V2 decisions are pinned and untouched; new roots enter DATA-01 as UNKNOWN and unreviewed. Requests are idempotent, restart resumes saved captures, feedback has stale revision checks. Source bundle retains reply identities/evidence but deliberately has productionApproved=false and handoffEnabled=false. No DATA-03 multi-source production adapter is enabled. Twenty-one DATA04 tests PASS; backend typecheck exit 0. LIVE remains disabled unless explicitly approved and enabled in local runtime. Exact-root extraction reuses existing code with optional bounded mode; default callers retain their previous behavior.
