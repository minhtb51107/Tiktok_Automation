# Browser-assisted TikTok uploader recovery acceptance

Date: 2026-11-24. Branch: `codex/restore-tiktok-browser-uploader`.

## Recovered behavior

- Studio binds a browser-assisted job to the exact `sessionId`, `renderJobId`,
  absolute retained MP4 path and SHA-256. It never scans for the newest file.
- A headed local Chrome/Edge instance uses an explicitly selected directory
  beneath the operator-configured, user-managed profile root.
- The driver opens TikTok Creator Center, selects the exact MP4 and prepares the
  saved caption/hashtags. It contains no stealth plugin, cookie import, private
  request replay, CAPTCHA bypass, automatic copyright-dialog acceptance or file
  deletion.
- Login/challenge gates pause as `AWAITING_USER_ACTION`. An unrecognized upload
  form becomes `FAILED`. A clicked Post without a platform completion signal is
  `UNKNOWN` and cannot be retried automatically.
- Preparation and actual Post are separate backend gates. A per-job confirmation
  token is required, and the real Post action remains disabled unless the local
  LIVE browser-post gate is separately enabled.
- Official Content Posting API and manual handoff remain present. Official and
  browser-assisted delivery cannot run concurrently for an active/ambiguous
  render. Duplicate browser queue requests reopen the existing durable item.
- FINAL/current-revision, spoken/audio approval, rights and disclosure/consent
  gates run before a browser job can be queued.

## Verification

| Check | Result |
| --- | --- |
| Browser driver mock: exact MP4/caption, no Post during preparation | PASS |
| Login/challenge pause and resume | PASS |
| Upload-form failure checkpoint | PASS |
| Separate LIVE gate | PASS |
| Platform-confirmed success vs ambiguous UNKNOWN | PASS |
| UNKNOWN retry lock and retained MP4 | PASS |
| Durable queue save/reopen and idempotency | PASS |
| DRAFT rejection before browser preparation | PASS |
| Existing Official API/manual publishing regression | PASS |
| Backend TypeScript/Nest build | PASS |
| Frontend TypeScript and Studio bundle | PASS |
| Studio browser smoke on isolated saved session | PASS |
| Read-only smoke changed persisted publishing files | NO |
| TikTok LIVE login/upload/Post | NOT RUN — not authorized |

Targeted Jest result: 3 suites, 22 tests passed after the fixture correction.
The isolated Studio smoke used
`http://127.0.0.1:3132/studio?area=Video%20Studio&step=Publish&session=200b0443-5c05-4a8b-8897-feb7e01ed7b6`.
It observed Official API, manual handoff and browser-assisted panels together,
with preparation enabled, Live Post disabled, zero mutating HTTP requests and no
unexpected 4xx responses. Runtime screenshot:
`publishing-acceptance01/publishing-browser-assisted-final.png` (not committed).

## LIVE limitations

No real TikTok profile, cookie, login, upload or Post was accessed. Current
TikTok selectors and platform completion signals therefore remain
`BLOCKED_LIVE_VERIFICATION`. If the UI differs, the driver stops rather than
guessing. The operator must separately configure the local profile root, review
content rights and FINAL render, authorize a real acceptance, and keep the LIVE
browser-post gate disabled until that acceptance.
