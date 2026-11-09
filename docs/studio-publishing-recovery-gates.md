# Publishing WIP retained with recovery gates

The recovery task preserves the existing Publishing foundation WIP. It does not
enable TikTok account access or expand the current task into account onboarding.

## Current state

- `PublishingService.liveAccounts` is false. OAuth start/callback, account refresh,
  revoke, LIVE Creator Info and LIVE publication-status requests are blocked before
  any token or network operation. No OAuth was performed in recovery.
- LIVE video init/upload/post routes are absent from the provider allowlist. App
  approval cannot be enabled by a request body or an environment declaration.
- Studio shows BLOCKED_AUTH / BLOCKED_APP_APPROVAL and UNKNOWN rights. The main
  session has no supplied rights evidence and five DRAFT audio assets. It is not
  publishable. No rights or audio were automatically approved.
- Existing draft form/contracts can be saved locally. The inbox flow explicitly
  describes caption/cover/privacy/disclosures as TikTok-side steps, not applied
  settings. Direct-post privacy comes only from fresh Creator Info; no default
  privacy or enabled interaction is assumed.
- Any future submission requires retained FINAL output, matching timeline hash,
  current revision, spoken/audio approval, source/media/model rights evidence,
  explicit disclosures/consents and a short-lived exact-payload confirmation.
- MOCK jobs are labelled simulations with no byte progress and no LIVE posting
  claim. Consent/deduplication/history tests use temporary synthetic fixtures, not
  the main session or a real TikTok account.

## Security and evidence

The retained OAuth skeleton uses a one-use, expiring state bound to an HttpOnly
Secure SameSite cookie and a registered static HTTPS callback origin. The vault
encrypts per-account token blobs with AES-256-GCM and account-bound AAD. Its key
must be supplied separately by `STUDIO_TOKEN_KEY` (32 bytes, base64); no actual key
or token was created or stored in this task. Windows directory permissions and a
managed secret store require review before any real account integration.

Configuration reports presence/absence only for TIKTOK_CLIENT_KEY,
TIKTOK_CLIENT_SECRET, TIKTOK_REDIRECT_URI and STUDIO_TOKEN_KEY. All are absent on the
audited machine. OAuth query strings are redacted from HTTP logs/error paths;
provider failures do not return authentication bodies. Ignored local storage is
`.studio-data/publishing/`; it must never be staged.

Nine offline MOCK tests cover encryption isolation, error redaction, provider
route restrictions, FINAL/rights/revision/hash gates, explicit consent, duplicate
submission, persisted draft/history, creator limits, disabled interactions and
browser-bound/expired/one-use OAuth state. They do not prove a LIVE TikTok login,
upload or post. Real browser smoke checked the blocked screen and Copy Report
without creating/connecting an account or making external requests.

## Official references and eligibility

Reviewed on 2026-11-02:

- [Content sharing guidelines](https://developers.tiktok.com/docs/en/content-sharing-guidelines)
- [Login Kit web](https://developers.tiktok.com/docs/en/login-kit-web)
- [Token lifecycle](https://developers.tiktok.com/docs/en/oauth-user-access-token-management)
- [Creator Info](https://developers.tiktok.com/docs/en/content-posting-api-reference-query-creator-info)
- [Direct Post](https://developers.tiktok.com/docs/en/content-posting-api-reference-direct-post)
- [Inbox upload](https://developers.tiktok.com/docs/en/content-posting-api-reference-upload-video)
- [Publish status](https://developers.tiktok.com/docs/en/content-posting-api-reference-get-video-status)

The current internal utility / third-party Threads reuse has unresolved intended-use
eligibility under TikTok's guidelines. No app/audit approval evidence is available.
The recovery must not work around those restrictions using passwords, scraping
cookies, browser upload automation, an assumed public privacy value or a silent
switch to another account/provider. Future LIVE work needs a separate explicit
request, verified eligibility/permissions and per-post confirmation.
