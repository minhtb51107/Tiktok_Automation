# RESTORE-TIKTOK-PUBLISHING-01 recovery audit

Audited on 2026-11-24 from `codex/restore-tiktok-publishing-01` at
`eec9698`. This checkpoint is source/history analysis only. It does not enable
OAuth, upload a file, publish a post, or read a browser profile/token.

## Historical lineage

| Commit | Retained lesson | Reuse decision |
| --- | --- | --- |
| `d0b25f2` | The first Threads uploader coupled Prisma selection, newest-file lookup, a persistent browser profile, UI selectors, Discord approval, automatic post confirmation, deletion of the MP4, and an `isPublished` database flag. | Reuse only headed Creator Center navigation, user-managed profile persistence, exact file input and caption preparation. Reject stealth, newest-file lookup, automatic rights-dialog clicks, optimistic success and deletion. |
| `6128ce9` | Moved uploader/Discord into core modules and selected browser profiles from inferred content categories. | Keep the modular boundary and explicit Studio invocation. Account/profile selection is explicit; do not infer SERIOUS/DRAMA. |
| `88fbcbd` | Operational workflow still depended on Prisma/Discord/watchers and accelerated render/TTS. | Do not activate operational modules as a side effect of Studio startup. |
| `837bbf4` | Deliberately made Watcher, Discord, Prisma workflows and TikTok uploader dormant to keep recovery offline and prevent startup side effects. | Preserve this safety boundary. Publishing is invoked only through an explicit Studio action. |
| `6f0851a` | Introduced the Studio publishing foundation: drafts, account contracts, render/rights gates, provider allowlist, consent receipts, history and a Publishing workspace. | Use as the architectural base and complete the official Content Posting API/manual handoff paths. |

## Current capability classification

| Capability | State before this recovery | Action |
| --- | --- | --- |
| Bind a publication to `sessionId + renderJobId` | Present | Retain and add artifact identity to the durable job. Never select by file modification time. |
| Preview retained MP4 and choose cover position | Present in `PublishingWorkspace` | Retain and browser-test. |
| Caption, hashtags, mentions, privacy and disclosure editing | Present | Retain; settings remain editable until explicit confirmation. |
| Explicit account selection | Present | Retain. No category-based account inference. |
| FINAL/current-revision/timeline/audio/rights validation | Present | Retain and apply before both official transfer and manual handoff. |
| Durable draft and publication history | Present | Retain; strengthen lifecycle/status typing and restart recovery. |
| Duplicate protection | Present for MOCK request hashes | Extend to all official/manual submissions using exact render hash + account + payload. |
| TikTok Creator Info and status fetch | Present but LIVE-gated | Retain. No LIVE call in this task. |
| Official video initialization and file upload | Absent from provider allowlist | Add behind the existing LIVE/app-approval gates. |
| Platform-confirmed `PUBLISHED` | Absent for transfer path | Only set after TikTok status returns `PUBLISH_COMPLETE`; ambiguous outcomes remain `UNKNOWN`. |
| Browser-assisted upload queue | Present but disabled after the official-provider recovery | Restore as a separate, explicitly gated headed-browser method. Bind exact FINAL render/SHA, stop for login/challenge/UI changes, and require a second confirmation before any Post click. |
| Discord/Watcher/Prisma uploader | Dormant | Keep dormant; it is not imported by Studio. |
| Delete rendered MP4 after publishing | Legacy behavior | Permanently reject. Retained render remains available for history/review. |

## Security findings

- Legacy code referenced persistent TikTok browser-profile directories. Their
  contents are not required for recovery and must not be inspected, copied or
  committed.
- No credential value was read from Git history. Configuration inspection is
  limited to variable names and tracked path names.
- The current provider keeps client credentials server-side and the token vault
  key external. `.studio-data/publishing`, browser profiles, `.env`, tokens and
  generated media remain excluded from commits.
- If a credential was ever committed independently of the audited source files,
  the correct remediation is provider-side revocation/rotation and a separate
  history-rewrite plan. This task does not reveal or attempt to recover it.

## Recovery direction

The supported official architecture is:

`RenderStore exact FINAL artifact -> Studio review/draft -> explicit account ->
validation and rights -> short-lived confirmation -> official TikTok init/upload
-> status verification -> durable history`.

When LIVE eligibility, scopes or credentials are missing, Studio must stop before
network transfer and offer a checked manual handoff package for the selected MP4.
Manual handoff is never recorded as `PUBLISHED` without an explicit verified
platform result.

The separate browser-assisted architecture is:

`Exact FINAL render + SHA -> saved rights/review gates -> explicit account and
user-managed profile -> visible Chromium -> MP4/caption preparation -> human
preview -> separate confirmation -> Post -> observed platform completion`.

It is disabled by default. It never reads or copies browser-profile contents,
never uses stealth, and never runs concurrently with an active official job for
the same render. A missing completion signal becomes `UNKNOWN`, never an
optimistic `PUBLISHED` state.
