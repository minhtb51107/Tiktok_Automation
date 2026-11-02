# DATA-02 OAuth recovery — live evidence, 2026-11-03 (Asia/Saigon)

## Root causes confirmed by real requests

The original controller swallowed every exception and returned a single generic
BLOCKED_AUTH message. Earlier callback logs could establish that state had been
consumed, but could not identify a historical Meta response. A fresh, explicitly
authorized callback with staged diagnostics reproduced the failure:

1. State/cookie validation, POST code exchange and encrypted short-token
   checkpoint all succeeded. The real response used numeric `user_id`; this was
   not the failing stage. No authorization code was reused.
2. Long-lived exchange with only a Bearer header failed: HTTP **400**, Meta code
   **452**, subcode **4279019**. Using the SAME saved short token with explicit
   `access_token` query parameter, as in Meta's official sample, succeeded.
   Hostname `graph.threads.com`, version `v1.0`, form POST code exchange and
   HTTPS callback were already functional; they did not need replacement.
3. Token verification then failed because it unconditionally required `app_id`
   in `debug_token`. Actual introspection omitted that field, including when
   explicitly requested. It did return validity, expiry, scopes and string user
   identity. The old mocks always supplied `app_id`, hiding this mismatch.

Long exchange now sends the documented grant, client secret and access token
parameters. These external request URLs are NEVER logged or returned. Short
response `user_id` is treated as informational (string/number/null/absent), not
coerced into an authoritative identity. Actual `debug_token` and `/me` identities
must still match before READY.

## App binding remains mandatory

An explicitly returned mismatching `app_id` always fails. If Threads omits it,
only this backend's encrypted OAuth exchange receipt is accepted: valid
browser-bound state, code exchange using the configured client ID/secret,
successful long-lived secret exchange, matching app hash, and an authenticated
AES-GCM vault record. A token supplied through ENV cannot use this fallback.
Validity, future expiry, both granted scopes and `/me` identity are also required.
This is not a fallback to accepting any valid token or trusting application names.

Live recovery returned **READY**, with:

- `threads_basic` and `threads_keyword_search`, no missing scopes;
- token validity, future expiry and matching `/me` identity verified;
- `appBindingMethod=OAUTH_EXCHANGE_RECEIPT`;
- expiry **2027-01-02 02:17:09 Asia/Saigon** at this observation;
- encrypted OAuth vault source, no User Access Token in frontend/environment.

Saved encrypted checkpoints allowed recovery without another authorization code.
The user-visible old failed callback must not be refreshed/replayed. Read current
state through `GET /api/studio/threads/auth/status` instead.

## Safe diagnostics and operations

- `GET /api/studio/threads/auth/diagnostics`: most recent stage report.
- `POST /api/studio/threads/auth/recover`: explicitly resume encrypted token
  checkpoint or reverify an existing verified vault token; never reuses a code.
- `POST /api/studio/threads/auth/verify`: fresh bounded token verification.

Reports contain random diagnostic run IDs, timestamps, stages, durations, fixed
error labels, numeric HTTP/API/subcodes and response field TYPES/presence only.
They contain no code, state, binding cookie, token, secret, raw Meta text,
authentication headers or sensitive URLs. Transport causes are allowlisted.
Each attempt is kept under ignored `threads-api/audit`; the latest pointer is
under `auth/last-attempt.json`. Short/long tokens remain AES-GCM encrypted.
Host rejection and busy callbacks fail without exposing exceptions. Existing
HTTPS bridge remains OAuth-only and loopback-bound, with no frontend changes.

## Controlled discovery — real, zero results

After READY, ran the existing collector sequentially, same two Vietnamese keywords
(`công việc`, `tâm sự`), limit five per keyword. A TOP check followed the empty
RECENT result, keeping the combined attempt at eight requests and <=10 returned
rows. There were no retries or concurrent calls.

| Mode / run | Requests | Returned/imported | New/duplicate posts | Elapsed |
|---|---:|---:|---:|---:|
| RECENT `237ef8f4-a995-4e1d-aee7-fd7c524270e4` | 4 | 0 / 0 | 0 / 0 | 2260 ms |
| TOP `a356f8f3-e0e7-4b2b-8530-0997c2193e41` | 4 | 0 / 0 | 0 / 0 | 1940 ms |

Each run counts two token/profile verification requests and two searches. All
responses were received, with no explicit permission error. Both search modes
returned `data: []`. Four actual saved response pages total **1066 bytes**;
two collector run manifests total **2988 bytes**. Stored-size metrics in run JSON
use compact serialization and differ from physical pretty-printed file size.

New Bronze/Silver/Gold/quarantine: **0 / 0 / 0 / 0**. No source record or content
was fabricated. No production queue action was taken. OAuth and API execution are
LIVE PASS; the objective of acquiring real posts is **PARTIAL**, because there
were no posts to import/evaluate. Empty search results do not establish missing
permission, App Review approval, public coverage, or lack of Vietnamese content.
App Review/search coverage remains UNVERIFIED; human-labelled precision remains
NOT MEASURED. Stop here rather than increasing budgets or bypassing the API.

These eight pilot requests exclude separate OAuth/token/route diagnostic calls.
Diagnostic calls were bounded and included two unauthenticated route probes,
one app-credentials check, token exchanges/introspection and recovery; no posting
or account changes were requested. No app token or sensitive response was printed.

## Regression and preservation

Final validation: backend `tsc --noEmit --incremental false` **exit 0**;
`npm run build` **exit 0**; complete offline Jest **27 suites / 163 tests PASS**.
The Threads-specific subset has **3 suites / 39 tests**. Mock regressions are
distinct from the actual Meta callback, encrypted recovery and live search calls.
After the final rebuild/restart, explicit backend verification again returned
READY with `config.oauthStatus=AUTHORIZED`; Studio returned HTTP 200, scheduler
readback remained disabled/paused. No further OAuth login was necessary.

Regression covers missing/present/mismatching app identity, rejection of unbound
ENV tokens, number/string/null/absent `user_id`, exact grant request shape,
state replay/expiry/cookie binding, transport causes, per-stage failures,
encrypted recovery without reusing codes, and diagnostic credential exclusion.

Nine source session hashes remain unchanged, including revision 112 and five
selected items in the reference session. All 16 existing DATA-01 files, complete
backend `.env`, and Hugging Face credential hash are unchanged. No source/media,
audio/render, model, frontend or Antigravity worktree files were modified.
Scheduler stays disabled and paused; rights UNKNOWN; no publishing.

Pilot checkpoint-sampled backend RSS: approximately **60.5 MiB** (RECENT) and
**47.1 MiB** (TOP). Backend process CPU delta: 140 ms and 219 ms respectively,
including unrelated work in that process. These are not continuous whole-machine
peak measurements. Heavy test/build processes ran sequentially; no browser/TTS/
render worker was started by this task.

Official references:
[Meta sample OAuth, long exchange and introspection](https://github.com/fbsamples/threads_api/blob/main/src/index.js),
[Meta Threads API collection](https://www.postman.com/meta/threads/documentation/dht3nzz/threads-api).
Direct Meta docs returned HTTP 429; no restriction was bypassed. Remaining live
work is to establish actual public-search coverage and obtain nonempty results
under a separately bounded, user-directed pilot, then use DATA-01 review.
