# Production Harness V1

## Start the operator runtime

Run the existing Nest backend from the backend directory after `npm run build`.
Use a dedicated loopback port and an isolated copy of the Studio data root. Stop
other heavy workers first. Set the following variables in the launcher environment.

| Variable | Value |
| --- | --- |
| `STUDIO_OPERATOR_ONLY` | `1` enables the restricted API on this process |
| `STUDIO_OPERATOR_TOKEN` | A dedicated random secret, at least 32 characters |
| `STUDIO_DATA_ROOT` | Absolute path to the isolated Studio data root |
| `PORT` | A free loopback port |
| `STUDIO_OPERATOR_COLLECTION` | `1` authorizes bounded public collection, subject to the existing `STUDIO_DATA_QUALITY_LIVE_ENABLED` gate |
| `STUDIO_OPERATOR_AI` | `1` authorizes evaluation within the existing provider configuration and inference budget |
| `STUDIO_OPERATOR_TTS` | `1` authorizes local DRAFT narration |
| `STUDIO_OPERATOR_RENDER` | `1` authorizes local DRAFT rendering with the listed presets |

Start with `node dist/main.js`. Leave the four execution flags unset for saved
source inspection and preparation without those side effects. Send the secret
only as an Authorization bearer header. Nest success responses wrap the
payload in `data`. MP4 and WAV routes return binary data.

The backend denies regular Studio and publishing routes in Operator mode.
While Remotion runs, the same loopback server serves only the exact GET/HEAD
media paths referenced by the validated render snapshot. Treat the runtime as
a trusted local host and keep each isolated root under a single backend process.
DEVELOPER access remains the repository's normal development environment.
Give an Operator agent only a restricted HTTP tool for this base URL and give
its runtime neither repository write access nor a general shell. The backend
cannot remove tools granted by the host. The same process cannot host the
regular Studio UI while in Operator mode.

## Tool reference

The base is `/api/studio/operator`. Read `GET /tools` for the active contract,
allowlist, input keys, result shapes and execution budgets. Mutations are
`POST /call/<tool>`. Every mutation requires a unique `requestId` within the
tool and session scope. Session mutations require the current `revision`.

| Tool | Input beyond requestId | Checkpoint and effect |
| --- | --- | --- |
| search | query | Public search, 10 candidates, within the browser budget |
| collect | searchId, url | Collect the selected search-result permalink, using the existing collector and evidence validator |
| evaluate | collectionId | Evaluate via the existing AI ledger. Output contains assessment ID and provider usage when available |
| create_draft | collectionId, replyIds | Save a source project with a root and a subset of quality-eligible verified replies. Pass an empty array for root-only. Editorial approval remains pending |
| visual_defaults | sessionId, revision; optional gameplay (`PRESET` or `OFF`) | Apply the SERIOUS preset using the reviewed local asset registry. `OFF` opts out of automatic gameplay selection and preserves saved tracks |
| restore_cached_avatars | sessionId, revision | Reuse saved, hash-verified avatars for exact author/post identities. Use the returned revision for the next stage |
| normalize | sessionId, revision | Apply deterministic speech normalization and list uncertain terms |
| pronunciation | sessionId, revision, itemId, term, reading | Update one existing term's pronunciation without changing original/display text |
| audio | sessionId, revision, itemId | Create or reuse current measured DRAFT WAV for a selected scene |
| prepare | sessionId, revision | Require current WAVs and build the measured timeline |
| render | sessionId, revision, optional preset | Require a current conforming timeline. Render a DRAFT with `720P` (default, 30 FPS), `1080P30` or `1080P60`. The manifest, probe and MP4 SHA-256 are checked again at download |

Use a separate request ID for each preset. Omitted preset and explicit
`720P` use the same job keys as existing 720P clients. For a 30 FPS saved
timeline, 60 FPS output requires sparse rendering with supported static
cards and gameplay. Unsupported conversion fails with
`RENDER_FPS_CONVERSION_UNSUPPORTED`. The standard renderer operates at
the saved timeline FPS.

Backend acceptance on the copied IELTS revision 22 returned `DRAFT_READY`
through the authenticated Operator render endpoint at 1080×1920, 60 FPS
and 3,690 frames over 61.500 seconds. The download matched the accepted
SHA-256. Both streams start at zero and the decoded AAC matches the existing
Argon benchmark. The saved timeline remains at 1,845 frames and 30 FPS.
Standalone Studio currently provides 720P and legacy Full HD choices.

Read `/collections` for saved collection IDs and `/collections/:id` for the root,
verified replies, quality and eligibility.
Each selection row separates `eligible`, `recommended` and
`rejectionReasons`. The matching saved AI assessment is advisory. Send only
the reply IDs actually selected by the Operator or user. Draft creation and
preview preparation in Operator mode use the local avatar cache.
Read `/assessments/:id` for an existing evaluation. `/projects` lists up to 50
local projects. `/projects/:id` returns source, editor and timeline summary
including avatar state, normalization and current audio IDs.
`/projects/:id/audio/:asset` plays the retained WAV. For early pronunciation
review, generate one existing scene first and listen to it. There is no
arbitrary-text or clipped-sample route. Use `/projects/:id/preflight` before
render and review the exact blockers. The API exposes a timeline summary and a
completed video download, without an interactive Remotion player in Operator mode.

## Progress and recovery

The state and report for each stage live in the existing StudioJobs store.
Read `GET /jobs/:id` or `GET /jobs?sessionId=<session>`. Omit sessionId for
discovery, collection, evaluation and create-draft attempts. Save returned IDs
in your task context. Use a bounded polling deadline and read the persisted
result again on reconnect. Checkpoint transitions use the existing queue.
`POST /jobs/:id/cancel` uses native cancellation. A non-interruptible operation
finishes its current atomic work before cancellation.

An identical request reopens its job. Successful identical stage inputs can
also reuse their job under a new request ID. Changing the payload under the
same request ID is rejected. There is at most one explicit retry for identical
stage inputs after a failed attempt. Read the failed or interrupted job first.
Failed jobs expose `errorCode`, `errorMessage`, `failedStage`, `retryable`
and `recommendedRecovery`. The diagnostic uses fixed text so runtime paths,
credentials and upstream error bodies remain private. For a recoverable job,
use a new request ID with the same other inputs to take the remaining attempt.
Historical results keep their original timestamps and attempt counts.
For stale revision or a quality/access/resource blocker, resolve the blocker
before continuing. A render interrupted before completion restarts at the
render stage. There is no frame-level resume. Reopen the session and keep
current valid WAVs. Existing video outputs are retained.

The report includes job/attempt and session, stage, timing, revision, heartbeat,
events, cache outcome when available and stage result. Queue wait and observed
execution are separate from wall time. A gap or an abandoned running record
only signals suspected interruption. AI uses existing provider usage, audio
uses the measured WAV, and render uses native resource samples. Unknown
hardware metrics or costs stay absent. GET /projects/:id/report aggregates recent
project and linked catalog checkpoints. Retain job IDs for older attempts or
catalog operations that failed before yielding a collection ID. There is no
persisted pause command.

The render contract rejects non-verbatim scenes, intro/outro and external
subtitles, and requires measured current audio plus local media. An evidenced
Threads default avatar is valid. Report an unavailable avatar separately. A
completed render remains DRAFT with `MACHINE_VALIDATED` and human acceptance
pending. Visual/layout and pronunciation review remain human checks.

For a SERIOUS project that needs gameplay, call `visual_defaults` with the
current revision and a new request ID. Call `prepare` with the returned
revision to rebuild coverage from the current WAVs. Check the background
track and its loop flag in the prepared project's summary. Existing editor
choices, including a disabled track, retain their settings. The runtime
administrator can configure an ordered comma-separated list of approved
local public asset IDs in `STUDIO_SERIOUS_GAMEPLAY_ASSET_IDS`. A requested
preset with no usable local clip returns `GAMEPLAY_ASSET_UNAVAILABLE`.

## Offline acceptance

Backend Nest build, frontend TypeScript and Studio bundle passed. The targeted
run covered Production Harness, Product Pipeline, Speech Normalizer and
Publishing (161 tests). Replay the loopback browser check from the backend
directory with `node scripts/operator-browser-smoke.cjs <saved-session-json>`.
It uses one copied session, denies unauthenticated requests and Publishing,
checks a permitted job submission, rejects an out-of-order revision, and
reopens the same recorded job after restarting the test backend. It compares
the copied session to its original and closes its own browser and server.

This acceptance covers the API and persisted workflow in a local browser.
Live collection, inference, Kokoro execution, and new MP4 output were outside
the acceptance run. The browser check does not measure audio or render fidelity.

## V1.1 audio acceptance

Two original attempts failed before inference with `Unknown Kokoro voice`.
The new session had no runtime voice declarations when settings were validated.
V1.1 runs preflight first and records FFprobe duration evidence on the asset.

One real audio request against an isolated copy produced job
`fe359150-85a2-4ff3-abce-73d1f36d2115` and asset
`7c19ebe8-5977-4c44-abce-0448cf0b758c`. The authenticated WAV download measured
7.863542 seconds by a second FFprobe check. The session copy finished at
revision 8 and the original stayed at revision 6. Asset purpose was DRAFT
and the matching input hash and item revision were verified. This checks
execution and artifact identity. Pronunciation still requires listening review.

## Operator prompt for Antigravity

> You are the Operator for SERIOUS/VERBATIM_THREADS/1. Use the configured
> allowlisted HTTP tool and base URL. Start with GET /tools and use the
> capabilities enabled by the runtime. Read an existing project with GET
> /projects/:id or use search and collect when authorized. Prefer saved
> collection IDs when provided. Inspect the collection, read eligible verified
> reply IDs and select a coherent subset that adds information. An eligible
> root alone is valid. Discard unrelated or unverified context. Existing AI
> assessments may inform selection. Ignore any generated hook or script
> suggestions. Record selected IDs and the selection reason from the run report.
>
> Use create_draft, normalize, then inspect the three text layers and review
> uncertain terms. Propose a pronunciation using pronunciation only for an
> existing term with a known meaning. Rerun normalization after changes.
> Generate one audio scene and request listening review when pronunciation is
> uncertain. Generate other selected audio scenes only after the relevant
> blockers are resolved. Use visual_defaults if requested, prepare, and check
> preflight. Submit render only when authorized and preflight is ready.
>
> Keep each job ID and current revision. Poll the job endpoint with a bounded
> deadline, stop on a blocked or failed stage, and read the report before any
> explicit retry. Reopen existing projects and reuse current WAVs. Retrieve
> the authenticated artifact URL from the completed job. Report stage times,
> failures, cache observations and missing measurements along with the artifact.
> Leave human acceptance pending. Never create commentary, filler, external
> subtitles, alternate source text, rights declarations, FINAL renders, or
> public posts. Use no shell, repository edits, environment changes, or Git.
