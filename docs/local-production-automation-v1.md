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
