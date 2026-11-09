# DATA-02C — On-demand discovery and Gold V2 shadow

Backend-only integration for Antigravity. No frontend/worktree changes, timers,
model download, new dependencies, automatic ACCEPT or production enqueue.

## Audit and method selection

V1 uses exact Vietnamese phrase boundaries, combined commercial signals, context,
discussion, length suitability, freshness and engagement. Weights live in
`data-engine/config.ts`. Its topic vocabulary missed `đi làm` and `đồng nghiệp`.
Its review result may reflect explicit user actions; the V1 comparison records
the persisted evaluation/revision, not a reconstructed historical score.

| Method | Decision |
|---|---|
| Expanded phrase rules | Implemented: cheap, explicit matched phrases; no probability/accuracy claim |
| Vietnamese expansion | Implemented in `gold-v2.ts`: WORK/LIFE/FAMILY; NFC/token boundaries; source text is not rewritten |
| TF-IDF | Deferred: corpus-fitted vocabulary/IDF needs a pinned corpus/version for reproducible comparison |
| BM25 | Deferred: useful query relevance ranker, not a substitute for context/safety/rights validation |
| Local multilingual embeddings | Deferred: no model download or RAM benchmark; current laptop already has low free RAM |
| Supervised learning | Deferred until explicit labels and a held-out evaluation set exist |

Primary references reviewed:
- [scikit-learn TF-IDF](https://scikit-learn.org/stable/modules/generated/sklearn.feature_extraction.text.TfidfVectorizer.html)
- [Robertson/Zaragoza: BM25 and Beyond](https://doi.org/10.1561/1500000019)
- [Sentence Transformers multilingual models](https://www.sbert.net/docs/sentence_transformer/pretrained_models.html)
- [Google: gathering labelled classification data](https://developers.google.com/machine-learning/guides/text-classification/step-1)

No benchmark or quality improvement is inferred from these documents. No Python
ML packages or models were installed.

## One-click contract

Base `http://127.0.0.1:3000/api/studio/data/crawler`, standard `{success,data}`
envelope. Browser callers send loopback Origin. Scripts use the same API.

1. `GET /options`: topic labels/default search keywords, default/max limit 2,
   one browser worker, scheduler disabled, Gold version.
2. `POST /runs`:

```json
{"mode":"SEARCH","topic":"WORK","limit":2,"requestId":"client-generated-UUID"}
```

`topic`: WORK/LIFE/FAMILY/ALL. SEARCH supports an explicit `keyword` override;
otherwise a concrete topic supplies its default keyword. ALL requires a keyword.
`limit`: integer 1–2; larger requests rejected, not silently clamped. FEED and
URLS remain supported. URLS accepts at most two URLs and rejects a limit smaller
than the supplied distinct URLs. Old requests without new fields remain valid.
Topic selects vocabulary expansion, while shared SERIOUS terms remain available.

3. POST returns after bounded processing. While awaiting it, poll `GET /runs`
   then `GET /runs/:id` every ~1–2 seconds. Persist requestId client-side BEFORE
   POST. Reusing the same requestId/input never launches a second run. BUSY is
   HTTP 409. After refresh, show existing runs; do not create another UUID and run.
4. `GET /runs/:id/report`: discovered/captured/matched/unresolved, newPosts,
   duplicates, Bronze/Silver/Gold/quarantine, elapsedMs, warnings/errors, and
   `quality.buckets` + persisted V1/V2 comparison snapshots.
5. `POST /runs/:id/resume`: explicit recovery. No refetch of captured targets;
   DATA-01 import and shadow snapshots are idempotent. Completed and access-blocked
   runs do not restart collection. No automatic retries through an access gate.

Checkpoint stages: DISCOVERY → EXACT_TARGET → DATA01_IMPORT → GOLD_SHADOW →
WAITING_HUMAN_REVIEW. One live browser at a time, one scroll; existing discovery
navigation timeout 20 s, <=4 main navigations and <=200 discovery resource
requests. Exact-target extraction uses its existing finite limits. These are
per-stage bounds, not measured total network request counts. Execution/resume
stops starting uncaptured targets after 180 s; already in-flight work is bounded
by its own timeout. Studio's operation mutex excludes AI/TTS/render/source work;
an idle retained Kokoro worker is closed before controlled collection.

`errors` counts unresolved captures plus a run-level failure event; it is not a
count of distinct failed URLs. Use unresolved and error separately for UI labels.
Elapsed is audit wall-clock time since initial run creation, including downtime;
it is not an active CPU-time metric. Discovery may return fewer than the limit,
and web results do not guarantee recently published content.

## Quality and review API

| Method | Path | Result |
|---|---|---|
| POST | `/quality/evaluate` | `{postId,evaluationId,topic?}`; pinned existing evaluation → immutable shadow; no crawl |
| GET | `/quality?topic=WORK&page=0&bucket=NEEDS_REVIEW` | Current-revision results, 25/page, bucket totals |
| GET | `/quality/:id` | Full comparison snapshot plus feedback history |
| POST | `/quality/:id/feedback` | Independent human label, reason, stale-revision/idempotency checks |
| GET | `/quality/metrics?topic=WORK` | Precision@10, confusion IDs or NOT_MEASURED |
| GET | `/schedule` | Disabled legacy cadence; no timer activated |

Feedback body:
```json
{"revision":0,"requestId":"feedback-UUID","decision":"NEEDS_REVIEW","reason":"Need to confirm target type"}
```
`revision` is feedbackRevision (initially 0), not session revision. Decisions:
ACCEPT/REJECT/NEEDS_REVIEW. Reason required, <=1000 chars. Same requestId/input is
idempotent. Changed input conflicts; stale evaluation or feedback revision returns
409. Each event is immutable. No real feedback is synthesized by the pilot.

Feedback is a *quality label*, NOT production approval. Explicit production review
still uses DATA-01 `POST /api/studio/data/posts/:id/review` and its target-type /
revision checks; enqueue is a separate deliberate operation. Neither is called
automatically here. Existing review decisions are left untouched.

Buckets are recommendations, independent of user labels:
- GOLD_CANDIDATE: score >=65 with sufficient signals; still requires human review.
- NEEDS_REVIEW: unknown identity/type/language, ambiguity, policy, short context,
  difficult voice input, or uncertain commercial intent.
- LOW_PRIORITY: absent topic evidence or score <40 without stronger review gates;
  reversible ranking/visibility recommendation, not deletion.
- REJECTED: exact duplicate, combined ad signals or repetitive spam; retained.
- QUARANTINED: validation failure, **no V2 score**. Not low content quality.

Weights/thresholds/version are centralized in `gold-v2.ts`; V1 weights are reused.
Each result includes config hash, processing version, asOf, score breakdown,
reasons, voice warnings and V1 comparison. UNKNOWN metadata stays UNKNOWN/null;
high score never overrides target verification or rights. No model/LLM involved.

## Persistence, feedback and evaluation

Reuse existing atomic DataStore, adding only `gold-shadows/` and `gold-feedback/`
record kinds under ignored `.studio-data/data-engine`. No database/infrastructure.
Shadow key pins evaluation ID/revision + config hash. Old V1 and Bronze files are
never overwritten by shadow evaluation. Old shadows stay inspectable after a
new observation, but default list/metrics omit stale evaluations.

Precision@10 needs ten distinct ranked posts with explicit ACCEPT/REJECT labels
for the entire top ten. NEEDS_REVIEW/unlabelled are not negative truth. Confusion
counts require complete binary labels for the current topic sample. False
positive = proposed GOLD_CANDIDATE + REJECT label; false negative = non-candidate
+ ACCEPT label. Quarantined records are excluded from ranking metrics. These
sample metrics do not prove generalization; supervised learning must use a
separate held-out set. No 70% quality or improvement claim without ground truth.

Source/raw snapshots remain available even for rejected/low-priority records.
No archive/delete migration is performed. Frontend can hide buckets using the
filter; default DATA-01 remains intact. Future permanent hide preferences can be
added without dropping dedup evidence.

## Verification evidence

Verified 2026-11-03, sequential low-RAM execution:

| Check | Actual result |
|---|---|
| Backend TypeScript | PASS, exit 0 |
| Backend build | PASS, exit 0 |
| Full offline Jest | 30 suites / 195 tests PASS, exit 0 |
| LIFE search, limit 2 | LIVE COMPLETED; 2 discovered / 2 exact matches / 2 new posts |
| Bronze / Silver / Gold / quarantine | 2 / 2 / 2 / 0 |
| Search elapsed | 16,632 ms |
| Fresh fetch of first target | LIVE 0 new posts / 1 duplicate observation; 4,514 ms |
| V1/V2 on current nine stored posts, ALL profile | 3 scores differ; all nine NEEDS_REVIEW |
| User labels / Precision@10 / confusion | 0 / NOT_MEASURED / NOT_MEASURED |
| Completed run replay from new process | COMPLETED in 10 ms; no browser call |
| Fault recovery | Offline injected shadow/import/capture failures, no duplicate post or re-fetch |
| Invalid limit / foreign Origin | HTTP 400 / 403; no collection launched |
| Preservation | All 41 pre-task JSON files hash-identical, including all nine sessions |
| Frontend | NOT RUN / unchanged; no Antigravity worktree edits |

LIFE pilot run:
`ea9e40bb66c724ef8ae3ae9cf7ceabbdad67cd022a29da19105f63f8414f2dde`.
Sources:
- https://www.threads.com/@e.nho.kia/post/DdeLNPlCd5J
- https://www.threads.com/@0care1212/post/DeTqyE2E-Jc

Both matched via DOM_PERMALINK; extraction completeness PARTIAL. Pilot V1→V2
scores: 68.78→68.78 and 40.87→65.87. Higher lexical relevance is **not measured
quality improvement**. Unknown target type and other review flags remain, so
neither becomes an approved production item. No real feedback/ACCEPT was written.

Available physical RAM samples were approximately 423–642 MiB during this task;
not a continuous peak-memory/CPU benchmark. No model inference/render or concurrent
browser workers were started. Studio remains loopback-only, scheduler disabled,
rights UNKNOWN and publishing locked. Runtime evidence stays ignored under
`.studio-data/reports/data02c`; do not commit it.

Before expanding: have a human inspect source identity/type and label candidates;
collect at least ten fully labelled ranked items before reporting Precision@10.
Integrate the above API into Antigravity's UI without enabling collection on mount.
