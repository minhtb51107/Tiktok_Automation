# RESTORE-01 — PARTIAL recovery checkpoint

Base 134de76; branch codex/restore01-url-draft. No LIVE request, inference,
TTS, render, scheduler or production write was executed in this task.

## Functional regression audit

At main/88fbcbd the serious service calls scrapeThreadsUrl, retains realPost /
realComments and produces script/audio/Remotion input. The serious module exports
the service but does not register a serious controller. Merely finding that
service does not prove an HTTP entry point was reachable in that revision.
The older drama controller exposes POST workflows/threads-drama/generate and
calls processDramaVideo(url), not the serious service. Recovery baseline later
added workflows/threads-serious/script-draft, :id/process-assets and :id/render.
These call phase1_CreateScript, phase2_ProcessAssets and phase3_RenderVideo.
The operational modules are now intentionally absent from AppModule; starting
the old module wholesale would activate unwanted dependencies.

Current serious phase1 persists SCRIPT_READY, aiScriptDraft chunks and
finalScriptData {realPost,realComments} via Prisma. Phase2 accepts editedChunks,
creates TTS assets and maps comments by author; phase3 renders. It depends on
Prisma, AI, TTS and Remotion. Author-based mapping can confuse different posts
by the same author. Legacy main and pre-reorganization are inspected with git
show, never checked out over the active worktree.

scrapeThreadsUrl takes uniquePosts[0] as root and slice(1) as comments, dedups by
the first 40 characters and infers replyTo from author/DOM order. Those operations
can merge distinct texts and misattribute suggested/context posts. Its browser
launch does not explicitly select the installed executable; DOM compatibility
and actual legacy LIVE success have NOT been revalidated here.

Studio uses explicit revisioned sessions rather than that DB workflow. Its exact
target reader stores one target in records and auxiliary cards in contextCandidates.
Confirmed regressions fixed:

1. WITH_CONTEXT read records.slice(1), always losing auxiliary cards. It now reads
   contextCandidates, preserving raw text, author, media references and source URL.
2. Explicit add-context created a second project POST. It now creates a draft
   COMMENT slot associated with the target project, with relationshipStatus
   OBSERVED_ON_TARGET_PAGE and evidence.parentId=null. This is an editorial grouping,
   never technical proof of parentage.
3. DATA04 discarded context text/author. Future bounded captures now preserve a
   unique card observation separately from verified replies. A missing observation
   remains UNKNOWN. Gold/verified reply algorithms are unchanged.

Source lists observed cards automatically. Human selection can add them to a
draft and then existing Script/Voice/Editor operate on the same Studio items.
New context defaults unselected. The Source UI labels observation and parent
uncertainty. Original text is immutable and revisions follow existing persistence.
PARENT_VERIFIED is reserved for independently verified edges; no observed card is
promoted. DATA05's strict verified-conversation gate remains unchanged.

## Existing pilot replay and missing evidence

The preserved LIVE01 collection contains root DfWJxiID7E5, its downloaded JPEG,
and 13 unverified URLs/reasons. It contains NO original text/author payload for
those 13 candidates. The prior import-capture script also contains only those
URLs, not full card content. Browser JSON/report exports reproduce that loss.
No source text was invented or fetched again. Thus full pilot comment display /
script creation from these 13 records remains BLOCKED_MISSING_SAVED_CONTENT.
The legacy algorithm cannot be replayed exactly: raw DOM, innerText and ordered
span nodes were not saved. Legacy would have treated non-root containers as
comments; their actual parent relationship cannot be established from this archive.

## Verification and limits

- Backend build exit 0 (includes TypeScript compilation).
- Frontend TypeScript and Studio bundle exit 0.
- Offline actual StudioService isolated-temp test exit 0: WITH_CONTEXT import,
  explicit selection/save/reopen, TARGET_ONLY add-context, repeated add dedup,
  immutable original content and unverified parent labels.
- Test source response is explicitly synthetic; no LIVE claim.
- New TTS/render were NOT RUN. No measured audio exists for these missing cards,
  so this checkpoint does not claim full audio/timeline/export acceptance.
- No browser acceptance of new capture was possible without missing saved content.
- Existing pilot data and production storage were only read; no migration,
  snapshot overwrite, review decision or production job was created.

## Remaining work

The saved 3106 pilot can still show its root/image and 13 URL-only exclusions.
To demonstrate the restored one-URL experience on this exact post, a separately
approved bounded recapture must retain full context card payloads. Until that
approval, this checkpoint is PARTIAL. The DATA04 conversation UI still restricts
its source bundle to verified replies; observed draft selection currently uses
the existing Project Source workspace, not DATA05 verified-conversation approval.
The sandbox runtime intentionally continues to block new collection/TTS/render.
No new LIVE action should run just because this recovery code is present.
