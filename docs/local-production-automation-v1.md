# Local Production Automation V1

Use the official Tiktok_Automation_main workspace and an isolated STUDIO_DATA_ROOT
for a pilot. Start Nest with normal local binding and no other backend owning
that data root. The automation service claims a local OS lock per resolved store.
On Windows it is a named pipe. It is released by the OS on process exit.

## Startup and authorization

The scheduler is dormant unless STUDIO_AUTOMATION_ENABLED=1 and a dedicated
STUDIO_AUTOMATION_TOKEN of at least 32 characters is supplied. Store the token
in local configuration outside Git. The persisted policy defaults to DISABLED.
Operator-only mode denies the separate administration API.

Live production also requires the existing STUDIO_PRODUCT_AUTOMATION_LIVE_ENABLED,
STUDIO_DATA_QUALITY_LIVE_ENABLED and STUDIO_DATA04_LIVE_ENABLED flags and the
existing inference, browser and Kokoro configuration. The startup check performs
local preflight, with discovery and model requests admitted through the existing
runtime guards. For a pilot enable the automation flags only in the intended
isolated runtime. Nest startup never loads the legacy Discord, Hunter, Watcher or
publishing modules.

From `1_nest_backend` in the official workspace, run `npm run build` and then
`npm run start:prod` with the local runtime settings above. Supply the bearer
token to the administering client separately. Read `/status` for the current
revision, save a topic and a pilot limit with `/policy`, then call `/start`.
Use `/stop` to drain before shutting down the backend.

## Local HTTP administration

Send Authorization: Bearer <automation-admin-token> to /api/studio/automation.

- GET /status and GET /policy show revision, mode, day key, counters and blockers.
- PATCH /policy accepts {"requestId":"pilot-policy","revision":0,"policy":{"topics":["công việc"],"dailyVideoLimit":1}}.
- POST /start and /stop accept {"requestId":"unique-action","revision":1}. Use the current policy revision. Stop drains running work.
- GET /videos, /videos/:id, /reviews and /report expose references and daily usage.
- POST /videos/:id/approve or /reject accepts {"requestId":"review-action","version":1}.
- POST /videos/:id/revise accepts {"requestId":"remove-reply","version":1,"sourceId":"verified-reply-id"} and reserves a rerender. Read /report for its checkpoint.
- POST /reviews/:id/resolve accepts requestId, revision and decision. SELECT takes numbers from the immutable snapshot. PRONUNCIATION takes readings with term and reading. Review-before-render supports APPROVE or REJECT.
- GET /videos/:id/versions/:version/artifact streams the saved manifest's MP4 after validating its probe and SHA-256.

For a bounded pilot outside the configured window, set
`"schedule":{"enabled":false,"start":"23:00","end":"07:00"}` while
the policy is DISABLED. `/report` contains the day ledger plus the autonomous
batch records with timestamps, candidate checkpoints and render metrics when
available. Compare numeric model usage against `ai-inference-ledger.jsonl` in
the same data root. Pricing is available only for ledger rows with provider
cost evidence.

The overnight quota follows the local date on which the window opens in
Asia/Ho_Chi_Minh. Quota is consumed by validated videos, failed candidate attempts
and reserved rerenders. AI attempts are debited before transport and linked by
inference ledger ID. A process crash between debit and send conservatively
retains the debit. Files are atomically replaced individually. A durable
reservation precedes dispatch and the scheduler reconciles deterministic job IDs
on restart. There is no multi-file transaction.

The native discovery run still owns discovery and enrichment checkpoints.
The Product Pipeline owns each downstream candidate record and uses the same
source, narration and MP4 checks as the Operator Harness. Automated renders
require SPARSE_STATIC and the saved preset. A rejected or unsupported render
remains an exception, including edits whose duration falls outside 60–90 seconds.
The previous video version is still accessible.

V1 exposes administration through the local API and Discord adapter. The Studio
visual layout is unchanged. Discovery reports its existing aggregate timings;
individual browser stages remain in the discovery run rather than being
reconstructed by the scheduler.

## V1.1 recovery

Browser measurement faults appear under `infrastructure` in `/status` and
`/report`. The diagnostic reference identifies the existing discovery run and
its browser audits. The scheduler requires verified browser cleanup, waits
60 seconds and admits one retry only after the native health probe reads four
consecutive valid samples. Uncertain cleanup, a failed probe or a repeat
incident blocks further dispatch and queues an operator notification. This
recovery has its own counter. Existing daily ledger entries remain intact.

The scheduler gives eligible budget-blocked assessments priority. It uses
the exact saved collection, verifies its integrity and public provenance, and
requires a capture at most 24 hours old for the pilot. A recovery dispatch
references the old batch and adds a new reservation. Earlier provider debits
still apply to the original production day. A checkpoint from V1.1 reuses only
an exact candidate result. V1 history preserves its charges, but does not
contain reusable per-candidate assessments.

When an assessment cannot finish, look for `AI_BUDGET_EXHAUSTED` and the
remaining source IDs in the candidate checkpoint. Individual responses still
use one candidate per provider call with strict source coverage. Configure a
remaining budget through the official policy API. A provider hard cap still
applies independently of the automation daily cap.

## V1.2 editorial cascade

Hard validation and the existing source-quality pass run before provider
admission. AUTO checks exact compatible caches, uses corroborated lexical
evidence where the root policy permits, and gives uncertain topics a bounded
semantic assessment tied to exact source quotes. Positive reply heuristics
remain in shadow mode. The planner escalates replies that occur in competitive
duration-feasible subsets. The evaluator keeps single-reply schema coverage
for its declared scope and leaves other sources explicitly deferred.

The optimizer checks at most eight verified replies and keeps selected
parent context. An estimated 60–90-second plan still requires measured audio
and timeline validation. AUTO may make one correction using already validated
replies, with at most one new narration item, then measures the timeline before
render.

`/report` includes candidate routes, deferred IDs, ledger-backed usage, and
immutable editorial feedback. Feedback applies to the exact source and video
version. Technical failures and unselected replies produce no editorial
feedback events. Exact-compatible saved V1.1 work can recover within its
existing quota without another candidate debit or provider request.

## V1.2.1 Kokoro checkpoint and admission

The Windows runtime samples physical memory and system commit five times over
two seconds before starting Kokoro. Cold admission on this host requires
1,024 MiB physical headroom and 1,792 MiB commit reserve throughout. The
physical threshold includes the previous 713 MiB observed peak worker RSS and
the 256 MiB emergency floor. The commit requirement includes the previous
1,036 MiB observed private usage and the 512 MiB reserve. A retained warm
worker uses a separate 512 MiB physical and 1,024 MiB commit threshold.
Emergency stops remain at 256 MiB physical and 512 MiB commit. These admission
values are local safety margins, not a guarantee against later memory pressure.

Chunks and their manifests live under the session audio root in
`chunks/<synthesisKey>`. Reuse requires the exact ordered input,
model/config/voice fingerprints, processing and runtime versions, and verified
PCM samples and SHA-256. A WAV promoted before its manifest commit is
regenerated. The complete sequence is streamed in order as the same PCM
frames that the former FFmpeg concat produced. The existing FFmpeg speed
processing remains in use, and Studio registers audio only after format,
duration and non-silence validation.

A guard stop parks the exact source, draft and narration input in the original
automation batch. The scheduler checks cleanup, waits 60 seconds and allows
up to three admission probes. A successful probe admits one bounded retry of
the same batch. After three admission denials with no inference retry consumed,
an authorized `POST /start` may include `"retryTtsAdmission":true` once the
host has more headroom. Retry exhaustion and unverified cleanup stay blocked.
The batch report exposes `ttsWait` and admission samples. This workflow leaves
the original candidate reservation and AI ledger in place.

## Standalone V1.2.1 saved-pilot acceptance

Close Codex, Antigravity, the IDE and other applications you do not need.
Open a regular Windows PowerShell window from the Start menu and run the
following from the official repository root. The launcher uses the existing
build and the ignored `1_nest_backend/.studio-data/runtime.local.json`.

```powershell
powershell.exe -NoProfile -File .\1_nest_backend\scripts\production-acceptance.ps1 -Action Start
```

Keep that standalone window open until its report appears. For status or to
drain and stop, run either command below from a second PowerShell window under
the same Windows user. The launcher exits after the backend drains.

```powershell
powershell.exe -NoProfile -File .\1_nest_backend\scripts\production-acceptance.ps1 -Action Status
powershell.exe -NoProfile -File .\1_nest_backend\scripts\production-acceptance.ps1 -Action Stop
```

The default checkpoint is `%TEMP%\production-auto-v121-saved-FAEjyj`. The
launcher checks the exact batch, session and source, measures headroom after
startup, and reads the current revision from the API before requesting the
saved retry. To hold ordinary discovery, it temporarily caps pending reviews
at one while an existing review remains open. The prior cap is restored after
drain. Leave the existing reviews unchanged during acceptance. The supervisor
requests drain as soon as the saved retry is admitted. The attempt and AI
quotas stay in place. Use `-Action Check` to verify startup and headroom with
production disabled.

Each launch writes `backend.stdout.log`, `backend.stderr.log` and
`report.json` under `standalone-acceptance\run-*` in the data root. The most
recent production run is also recorded at
`standalone-acceptance\latest-report.json`. A validated video is written to
`renders\<session-id>\<render-job-id>\video.mp4`. The report records the
artifact only after checking the machine validation, inventory, render strategy
and SHA-256. A blocked run keeps its checkpoint for another explicit admission
request when headroom improves.

## V1.2.2 standalone timeout recovery

For the saved timeout in the standalone pilot, use the same launcher and the
explicit timeout switch after closing development applications.

```powershell
powershell.exe -NoProfile -File .\1_nest_backend\scripts\production-acceptance.ps1 -Action Start -RetryTimeout
```

The launcher sends the exact batch, session, failed item and failure timestamp
under `retryTtsTimeout` with the current policy revision. One authorization is
allowed for that timeout. The prior resource retry, reservation and inference
history remain intact. The runtime checks previous worker exit and checkpoint
identity before admitting another worker. The unchanged Kokoro worker checks
the ordered chunk plan again and regenerates only missing or invalid chunks.

Automatic production audio uses a 240-second synthesis ceiling and a
300-second total scene ceiling, reduced by a shorter enclosing job deadline.
The local probe limits are unchanged. Voice diagnostics include the deadline
policy and observed model-load, synthesis and assembly timing.
`latest-report.json` records the underlying error when no MP4 is produced.

## Discord

Set STUDIO_AUTOMATION_DISCORD_ENABLED=1 only after configuring
STUDIO_AUTOMATION_DISCORD_USER_ID, STUDIO_AUTOMATION_DISCORD_GUILD_ID and
STUDIO_AUTOMATION_DISCORD_CHANNEL_ID and enabling message content for the
existing bot. DISCORD_BOT_TOKEN comes from local configuration. One process
owns the token at a time. Durable command receipts suppress repeated deliveries.
A crash immediately after receipt may require a new explicit message.
Outbox transport uses bounded retries and suppresses mentions.

Use !danhsach for numbered reviews and !xem <video-id> for the exact video
version. Reply to the bot's !xem response for !xoabl, !giu and !bo. !taive sends
only to the configured guild/channel and falls back to an authenticated local
artifact URL for oversized or rejected attachments.

Draft quality checks and human review do not grant publishing permissions.
