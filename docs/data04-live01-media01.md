# DATA-04 LIVE-01 + MEDIA-01 handover

Date: 2026-11-07 (Asia/Saigon). Branch: `codex/data04-live01-media01`, base
`bf1536b`. The only approved source was
`https://www.threads.com/share/GCp_ap7Nk`.

## Verdict: PARTIAL

The bounded public run resolved the share URL with one HTTP 302 to the unique
canonical target `https://www.threads.com/@baongocghetmatcha/post/DfWJxiID7E5`.
The exact card matched that ID by its own DOM permalink. It exposed the handle
`baongocghetmatcha`, a publication timestamp, topic `THPTQG 2027`, visible body,
one exact-card image, and labelled engagement controls. The type remains
`UNKNOWN`: neither permalink shape nor DOM order proves POST versus COMMENT.

The public thread view reported 624 replies and exposed 13 other permalinks.
It exposed no accepted JSON-LD `Comment.parentItem`/`comment` relationship for
those records. Therefore verified replies are **0**, all 13 candidates remain
`DOM_CONTEXT_WITHOUT_RELATIONSHIP_EVIDENCE`, conversation/video-suitability
scores remain `UNKNOWN`, and PASS LIVE is not claimed. Reported reply count is
not collected reply count.

Meta's official reply/conversation endpoints return `root_post` and
`replied_to`, but require an eligible API thread ID plus `threads_read_replies`.
This credential-free pilot store had neither. No token was copied and the public
shortcode was not treated as a Graph API ID. No API fallback, login, CAPTCHA
bypass, context permalink crawl, retry, scheduler, TTS, render or publishing ran.

## Media evidence

The image was selected only from the exact root DOM card, excluding its avatar
and all context cards. The public CDN copy passed URL/DNS restrictions, signature
inspection, FFmpeg decode and FFprobe:

- JPEG / `image/jpeg`, 1080 x 344, 50,842 bytes.
- SHA-256 `c03981ab1b2b131c7ff80e39a884cc531de0222a9883e01c2d5175ed0052ca13`.
- OCR `NOT_RUN`; rights `UNKNOWN`.
- Stored only under the external ignored LIVE-01 pilot directory.

New contract fields distinguish `DOWNLOADED`, `URL_ONLY`, and `UNAVAILABLE`,
retain the source URL and exact-root relationship evidence, and expose only a
validated content-hash path. The Studio report includes media provenance and
explicitly states that OCR and rights were not inferred.

## Isolated persistence and Studio

External store:
`D:\LCOM108_NMLT\code\100_bai_code\Tiktok_Automation_data04_live01\GCp_ap7Nk\backend\.studio-data`.
It contains one LIVE run, one root import and one conversation collection. The
run is `COMPLETED / WAITING_HUMAN_REVIEW`; this means persistence completed, not
that conversation verification passed. The sandbox review remains
`NEEDS_REVIEW`; saving it does not ACCEPT, enqueue or approve production.

Studio URL: `http://127.0.0.1:3106/studio?area=Discovery`. The runtime strips all
credential-like environment variables, blocks outbound access after capture,
allows only GET/HEAD plus conversation feedback, and leaves LIVE collection OFF.
The UI shows the exact root, local image, counts, 0 verified replies, 13 excluded
context records, feedback history, Copy Report, Markdown and JSON export.

Artifacts (not committed):

- `reports/data04-live01-report.json`
- `reports/data04-live01-report.md`
- `reports/production-preservation.json`
- `screenshots/live01-studio-1920x1080.png`
- `screenshots/live01-conversation-detail.png`

## Verification

- Backend TypeScript: exit 0.
- Backend build: exit 0 (twice, including media endpoint fix).
- Frontend TypeScript: exit 0.
- Studio bundle: exit 0 (twice, including report fallback/export).
- Lightweight media helper regression: 2/2 PASS.
- Browser/API: exact root, 1080x344 local image, 13 excluded context records,
  feedback save/reopen, Copy Report, Markdown and JSON export PASS.
- Targeted Jest attempted at 384 MiB heap: OOM before assertions, exit 134.
  Full Jest: `NOT_RUN_RESOURCE_BLOCKED`; no false PASS claim.
- Production manifest: 933 files compared, 0 changed, 0 unreadable; baseline
  manifest SHA-256
  `e19574bf84fc07c88a165aa3958f50e579a93c289b6aeef2c0664c1f35a6c1e7`.

The next compliant step is not another public crawl. To obtain verified replies,
the app would need an approved official API identity/scope that can resolve this
exact target, or Threads would need to expose explicit public parent evidence.
Until then, the strict verifier must keep these candidates unverified.
