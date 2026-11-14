# AI-EDITORIAL-02 — conversation intelligence recovery

Date: 2026-11-14 (Asia/Saigon)

## Outcome

AI-EDITORIAL-02 is **PASS OFFLINE / PARTIAL LIVE**.

- The content-quality decision and immutable relationship evidence are separate.
- A model may recommend an observed context, but the stored result remains
  `SELECT_REQUIRES_HUMAN_REVIEW`; it is never upgraded to
  `PARENT_VERIFIED`.
- Missing optional quality dimensions remain `null` and Studio renders them as
  `UNKNOWN`. Relevance and usefulness remain required schema fields.
- Feasibility is computed from validated candidate decisions and the existing
  deterministic narration estimator. It is not a second free-form model summary
  and is not measured audio.
- An accepted editorial selection can create an immutable Script DRAFT through
  `propose-reviewed`. The proposal stores the exact feedback revision and source
  IDs. A new read endpoint lets Studio reopen the latest proposal after refresh.
- AI feedback, Script DRAFT review and history remain independent of production
  approval. No operation ACCEPTs source data, enqueues production, runs TTS,
  renders, or publishes.

## Evidence model

The backend attaches evidence from the persisted collection, not from model
output:

| Evidence | Editorial behavior |
| --- | --- |
| `PARENT_VERIFIED` | Model may return `SELECT_VERIFIED`. |
| `OBSERVED_RELATIONSHIP_UNVERIFIED` | Model may select, but the result becomes `SELECT_REQUIRES_HUMAN_REVIEW`. |
| `RELATED_OR_RECOMMENDED` | Kept distinct; normally review or exclude. |
| `UNKNOWN` | Requires review; absence is never converted to evidence. |

Legacy `ai-content/1` assessments are projected at read time using the current
collection evidence. The persisted assessment and capture are not rewritten.
Missing v2 quality fields are returned as `null` rather than fabricated scores.

## LIVE recovery evidence and budget

The persisted AI-AGENT-01 acceptance report proves:

- 42 inference requests;
- provider-reported cost USD `0.00498084`;
- two valid LIVE assessments: `gnrtth` (26 candidates) and `pngkhatu`
  (12 candidates);
- both v1 assessments contain only `REVIEW` decisions: SELECT 0, REVIEW 38,
  EXCLUDE 0;
- one Qwen Script DRAFT for `gnrtth`, estimated 7–10 seconds.

Three AI-EDITORIAL-02 attempts reached Hugging Face and stopped on strict schema
validation. They persisted only isolated input stores, not provider metrics or a
report. Therefore their exact request count and cost cannot be reconstructed.
The defensible project-wide request range is 45–87 (42 persisted plus at least
one and at most the configured candidate calls for each failed attempt). This is
**NOT_MEASURED**, not an actual usage claim. No further inference request was made
during recovery because the exact total could not be verified against the
100-request budget.

The v2 model schema therefore has no valid LIVE assessment. It remains PARTIAL;
offline schema, identity and evidence regressions pass.

## Editorial reference candidate

The persisted `gnrtth` editorial reference selects these real source IDs:

- `DeJDn2kCT-g`
- `DeJMMM6k4fW`
- `DeJby5QI9d6`
- `DeJOhgZgauo`

All four are observed on the target page and require human relationship review.
None is parent-verified. Root plus these source texts contain 1,202 characters
and 276 estimator tokens. The existing estimator at speed 1.3 reports 58–80
seconds (`ESTIMATED`, non-authoritative). This demonstrates plausible material,
not a finished 65–90 second script and not measured narration.

No new Qwen Script DRAFT was created. The only persisted Qwen proposal remains
the 7–10 second v1 draft. Calling it a completed long-form candidate would be
incorrect.

## Studio acceptance

An isolated copy of `live-acceptance04` was served with the Hugging Face
credential deliberately absent. Browser acceptance verified:

- opening Studio performs only GET requests and never calls AI automatically;
- v1 sources render as `OBSERVED_RELATIONSHIP_UNVERIFIED` or
  `RELATED_OR_RECOMMENDED` from persisted evidence;
- absent quality dimensions render as `UNKNOWN`;
- context checkboxes, feedback save, and Script DRAFT edit are functional;
- feedback and script revisions survive reload;
- the latest proposal is loaded by assessment after refresh;
- approval remains pending and production approval remains false.

Runtime evidence is ignored local data under
`1_nest_backend/.studio-data/reports/ai-editorial02/studio-acceptance01/`.
It must not be committed.

## API additions

- `POST /api/studio/data/ai/assessments/:id/propose-reviewed`
  - explicit LIVE confirmation required;
  - requires feedback decision `ACCEPT`, exact revision, and at least one selected
    existing source ID;
  - idempotent by assessment, selection revision and request ID.
- `GET /api/studio/data/ai/assessments/:id/latest-proposal`
  - read-only;
  - returns the latest persisted proposal or `null`.

## Validation

- AI/editorial targeted Jest: 4 suites, 38 tests PASS.
- Backend Nest build: PASS.
- Frontend TypeScript (`tsc --noEmit`): PASS.
- Studio bundle: PASS.
- Browser isolated save/reopen: PASS.
- Full Jest: NOT COMPLETED — the sequential process reached the explicit 512 MiB
  Node heap cap after about 61 seconds. This was a resource failure, not a test
  assertion, and it was not retried.
- LIVE v2 assessment: PARTIAL (`AI_SCHEMA_INVALID`; no validated result).
- Qwen 65–90 second Script DRAFT: NOT RUN (budget ledger not verifiable).
- TTS/render/publishing/crawler: NOT RUN by scope.

## Next action

Before another Qwen request, record a provider-independent durable request ledger
at reservation and completion time, including failed schema responses. Reconcile
that ledger with Hugging Face usage. Only then run one bounded reviewed-proposal
request. If successful, the final gate still requires human source review and
measured audio duration; estimated text duration is not release evidence.
