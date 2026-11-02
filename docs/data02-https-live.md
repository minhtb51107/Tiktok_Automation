# DATA-02 local HTTPS verification — 2026-11-03

## Verified local setup

- mkcert 1.4.4 was already installed by the user. Its root CA was found in the
  Windows **CurrentUser Root** store. The public root fingerprint matches the
  CA that signed the new leaf certificate. No Java trust-store changes were made.
- Created a certificate for `threads-studio.test`, valid until 2029-02-03, in
  backend `.studio-data/threads-api/tls`. Both certificate and private key are
  ignored runtime files; neither is committed.
- The hosts file required Administrator. After explicit user approval, a narrow
  elevated helper saved a verified byte-for-byte backup, appended only
  `127.0.0.1 threads-studio.test`, and verified that all pre-existing bytes were
  unchanged. Backup/result files remain in ignored runtime reports.
- Windows DNS now resolves that hostname to `127.0.0.1`.
- Backend `.env` has App ID, App Secret, redirect URI and TLS paths. No User Access
  Token is present in the environment. Secret values were not printed or copied
  from chat. Existing `.env` and Hugging Face token hashes remained unchanged
  during this continuation; the application only reloaded the file.
- Checked that no saved Studio job was QUEUED/RUNNING, verified the original main
  backend command line and parent, then restarted only that backend to reload
  environment. No Antigravity worktree/process was modified.
- Started the existing HTTPS bridge bound to loopback port 3443. It forwards only
  OAuth GET login/callback; it does not expose Studio or DATA APIs.

## Real HTTPS checks

These requests used .NET HttpClient with **default Windows certificate validation**,
automatic redirects disabled and no certificate-validation bypass:

| Route on `https://threads-studio.test:3443` | Actual result |
|---|---|
| `/api/studio/threads/oauth/login` | 302 to `https://www.threads.com/oauth/authorize` |
| OAuth redirect parameter | Exactly matches registered callback below |
| State cookie | Secure + HttpOnly present |
| `/api/studio/threads/oauth/callback` without code/state | 400, rejected; no exchange |
| `/studio` | 404, not exposed through bridge |

Registered OAuth redirect (user confirmed Meta Dashboard accepted it):

`https://threads-studio.test:3443/api/studio/threads/oauth/callback`

User login entry point:

`https://threads-studio.test:3443/api/studio/threads/oauth/login`

Normal Studio remains `http://127.0.0.1:3000/studio`. Both processes are kept
running for manual authorization. The bridge is explicitly started with
`node scripts/threads-oauth-proxy.cjs` from `1_nest_backend`; no Windows startup
service, tunnel, scheduler or browser automation was installed.

## Callback separation

The OAuth endpoint handles a browser GET with authorization code/state and a
browser-bound cookie. It is **not** a deauthorization or data-deletion handler.
Do not copy this URI into Meta's uninstall/deauthorization or data-deletion fields.
Those require separate, correctly implemented lifecycle handling. This local-only
bridge does not accept inbound server callbacks from Meta; no lifecycle callback
or deletion success is claimed. The other Dashboard fields have not been inspected.
If required for wider access/App Review, complete those separately with a publicly
reachable deployment. No existing source/session data is deleted in this task.

Official references: [Meta sample](https://github.com/fbsamples/threads_api),
[mkcert](https://github.com/FiloSottile/mkcert). Direct Meta documentation requests
for setup/data-deletion returned HTTP 429; no bypass or retry loop was attempted.

## Authorization checkpoint — pending, not LIVE success

The user reported returning from consent. Server-side verification at this
checkpoint still shows **BLOCKED_AUTH**, no stored verified User Access Token,
empty granted scopes and no expiry. The server recorded a browser login request,
but no new completed callback/code exchange. User-visible final page/error is
needed to distinguish an incomplete browser flow from a Meta refusal.

Do not infer a successful grant from a chat confirmation. No live pilot, token
verification API call or search is claimed. On an actual callback, verify app
binding, identity, granted `threads_basic` + `threads_keyword_search`, expiry and
real search access before running the bounded maximum-ten-row DATA-01 pilot.
Scheduler remains disabled/paused and content rights remain UNKNOWN.

## Regression evidence

- `npm test -- --runInBand threads-api`: **3 suites / 30 tests PASS**, exit 0,
  21.67 seconds wall time. These are MOCK tests, separate from the live HTTPS checks.
- All nine session JSON hashes unchanged, including reference session revision
  112. Existing DATA-01 has 16 saved JSON files; no pilot import was performed.
- Observed available RAM approximately 500 MiB; no build, render, TTS or browser
  worker was run alongside tests. No new package/model/runtime download.
- Source implementation is unchanged from the previously built baseline.
  Only this operational handover document is tracked by this milestone.

Ignored evidence: backend `.studio-data/reports/data02-https`, including hosts
backup/result, session/config hash baseline, test log and backend logs. Never
commit these files or copy callback query strings/cookies into reports.
