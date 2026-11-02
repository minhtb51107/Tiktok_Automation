# DATA-02 — official Threads discovery (backend only)

## Boundary and current gate

Only Threads SERIOUS feeds this pipeline. Existing Studio frontend, sessions,
media, legacy workflows and the `design/studio-v2` worktree are untouched.
No scraping fallback, LLM, TTS, rendering, posting or startup collection.

OAuth and live pilot remain **BLOCKED_AUTH / NOT RUN** until a real HTTPS
callback is configured, the user grants access, and token verification succeeds.
An App Secret is NOT a Threads User Access Token. A secret disclosed in chat must
be rotated in Meta and entered locally, never copied from chat into source.

## Configuration and token handling

Backend starts with working directory `1_nest_backend` and reads its `.env`
through `dotenv/config`; existing process variables take precedence. Append the
settings from `.env.example`; do not replace the file or existing Hugging Face
configuration. All secret values stay absent from logs, responses and Git.

Required names: `THREADS_APP_ID`, `THREADS_APP_SECRET`, `THREADS_REDIRECT_URI`.
`THREADS_ACCESS_TOKEN` is optional for an independently obtained User Access Token.
Leave it empty to use the OAuth encrypted vault. Do not put the App Secret there.
Tokens obtained by OAuth use the existing AES-256-GCM TokenVault under ignored
`.studio-data/threads-api/vault`; its key is derived with HKDF from local app
credentials. Secret rotation requires reauthorization. Protect/backup `.env`
separately from the vault. This is a single-account collector, not Publishing.

State expires after ten minutes, is browser-cookie bound, consumed atomically
before code exchange, and cannot be replayed. Cookies are Secure/HttpOnly/Lax.
Callback query strings are redacted by backend logging/error middleware.
Code exchange is never automatically retried. Short-lived token is exchanged
for a long-lived token, then debug-token app binding, expiry, scopes and `/me`
identity are verified. Expired credentials stop collection; automatic refresh
and unattended token lifecycle are outside this pilot.

Granted `threads_basic` and `threads_keyword_search` are required. Scope presence
alone does not establish App Review approval or coverage of arbitrary public
posts. Actual permissions/search results must be checked after authorization.
`auth/status` is cached verification with `checkedAt`; each collector start or
network resume verifies again. Missing/incomplete evidence blocks collection.

## Free local HTTPS callback — proposed, not installed

Meta's official sample uses a named local host and HTTPS rather than a localhost
redirect. A free local certificate avoids a paid domain or exposing Studio.
The following are setup instructions, NOT evidence of a working TLS endpoint.

1. Install mkcert from its official releases after reviewing the download.
   `mkcert -install` changes the local trust store and can require administrator
   approval. This task has not installed it, trusted a CA or modified hosts.
2. Add `127.0.0.1 threads-studio.test` to the Windows hosts file as administrator.
3. In a terminal at `1_nest_backend`, create the ignored TLS directory and issue
   a certificate (never share the CA private key):

   ```powershell
   New-Item -ItemType Directory -Force .studio-data/threads-api/tls
   mkcert -cert-file .studio-data/threads-api/tls/cert.pem -key-file .studio-data/threads-api/tls/key.pem threads-studio.test
   ```

4. Append the app ID and NEW rotated secret directly to backend `.env`. Set:

   ```dotenv
   THREADS_ACCESS_TOKEN=
   THREADS_REDIRECT_URI=https://threads-studio.test:3443/api/studio/threads/oauth/callback
   THREADS_TLS_CERT=.studio-data/threads-api/tls/cert.pem
   THREADS_TLS_KEY=.studio-data/threads-api/tls/key.pem
   ```

5. After TLS/hosts setup, the exact redirect URL to enter in the Meta Developer
   Dashboard's Threads API OAuth redirect/callback configuration is:

   **`https://threads-studio.test:3443/api/studio/threads/oauth/callback`**

   Match scheme, hostname, port and path exactly. Add/accept a Threads tester
   role if required by the app's development access. Request the two read scopes
   above and review the app's actual permission/access level in the Dashboard.
6. Restart only the verified main Studio backend to load edited environment:
   `npm run studio:start` (do not start a second backend on port 3000).
   In a separate terminal, run `node scripts/threads-oauth-proxy.cjs`.
   The small bridge binds **127.0.0.1:3443 only** and forwards only GET login and
   callback routes to the existing backend. It never serves Studio/data APIs.
7. Check the certificate is trusted, then open:
   `https://threads-studio.test:3443/api/studio/threads/oauth/login`.
   The user completes Meta authorization. Do not fabricate consent or tokens.
8. Read `http://127.0.0.1:3000/api/studio/threads/auth/status`. For an explicit
   fresh verification, POST `/api/studio/threads/auth/verify`. Proceed only with
   READY, both scopes, valid expiry and app binding. Verification makes up to
   two official requests. Stop the TLS bridge with Ctrl+C when finished.

Alternative: a free Cloudflare Quick Tunnel offers a temporary HTTPS hostname
without buying a domain, but exposes a route publicly and changes hostname on
restart. If chosen later, expose an OAuth-only bridge, not the entire Studio.
No tunnel has been installed or launched in DATA-02.

## Collector and DATA-01 integration

`POST /api/studio/threads/collector/runs`, explicit manual action only:

```json
{
  "keywords": ["công việc", "tâm sự"],
  "searchType": "RECENT",
  "perKeyword": 5,
  "maxRequests": 8,
  "maxRunMs": 120000,
  "requestId": "pilot-01"
}
```

This call may take the bounded pilot duration. GET `/collector/runs` or
`/collector/runs/:id` from another client for persisted progress/report JSON.
POST `/collector/runs/:id/resume` explicitly recovers an interrupted run.
Repeating the same requestId/input returns the same run; changed input conflicts.
All paths in this section have prefix `/api/studio/threads`.

Only verified official `TOP` and `RECENT` search modes are implemented. Max two
keywords, five results each, ten rows total, twelve requests and 180 seconds.
Defaults are eight requests and 120 seconds. Debug/profile and retries count
against budgets, reserved on disk BEFORE each HTTP attempt. Requests are serial.
Three attempts/page with 500/1000ms exponential waits only for transient failures;
401/403 stop without retry; 429 stops with at least one-hour cooldown. A response
is bounded to 2MiB, requests time out at <=15s and remaining network deadline.
No arbitrary URL is followed: only fixed official routes and extracted cursors.

Raw search pages are persisted before import under ignored
`.studio-data/threads-api/pages`; credential fields/URL parameters are redacted.
Content containing a known credential is rejected rather than rewritten.
DATA-01 receives original text, native numeric API ID AND permalink shortcode,
canonical URL, timestamp, query, raw row and collection-run provenance. Existing
canonical DATA-01 identity provides cross-source dedup; absent identity is
quarantined, not guessed. Missing engagement/avatar/topic fields remain null.
`rightsStatus=UNKNOWN` and mandatory discovery review prevent automatic queueing.
Accept/Reject/Needs Review continue through DATA-01's existing review API/UI.

Captured pages replay offline before new network calls. DATA-01's dataset hash,
immutable observations and saved evaluations make retry idempotent. Reports use
saved import results/evaluations, not estimated counts. Request reservations
survive interruption; a crash may consume a request without a saved response.
An expired run cannot gain a fresh network budget by resume. In-process locking
requires the existing single Studio backend; multi-host workers are not supported.

Reports include request attempts/responses, rows/new/source duplicates, exact
DATA-01 states, score/review/quarantine reasons, stored-page bytes and process RSS/
CPU observations. RSS is sampled at checkpoints, not a hardware peak profiler;
CPU includes unrelated work in the same backend. Heuristic scores and scheduler
qualification yield are NOT human-labelled precision. Precision@10 NOT MEASURED.

## Scheduler preparation

GET `/scheduler`; POST `/scheduler/configure`, `/pause`, `/resume`,
`/acknowledge-block`, `/tick`. Default **disabled AND paused**. No timer, cron,
watcher or startup worker is registered. Even enabling only permits an explicit
manual tick. Default six-hour interval, qualified/queued inventory threshold ten,
review backlog threshold twenty, same small pilot/request budgets. Cycles reserve
their next check before dispatch. Auth/permission blocks require manual action;
429 cooldown and low qualification yield increase the wait. Manual collector
calls cannot overlap scheduler collection. Do not configure recurring execution
before authorization and a human-reviewed pilot.

## Primary references and verification scope

- [Meta official sample, OAuth/HTTPS/search implementation](https://github.com/fbsamples/threads_api)
- [Meta official Threads API collection](https://www.postman.com/meta/threads/documentation/dht3nzz/threads-api)
- [Meta keyword search documentation](https://developers.facebook.com/docs/threads/keyword-search/)
  returned HTTP 429 during research; no attempt was made to bypass restrictions.
- [mkcert official setup/trust instructions](https://github.com/FiloSottile/mkcert)
- [Cloudflare official Quick Tunnels](https://developers.cloudflare.com/tunnel/get-started/quick-tunnels/)

OAuth, collector, DATA-01 recovery and scheduler tests use isolated temporary
stores and clearly marked synthetic data / mocked official HTTP responses. They
do not prove LIVE authorization, actual public search coverage or data quality.
