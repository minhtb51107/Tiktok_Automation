# UI-OPS-02 capability corrections / DATA-04 LIVE-01 preparation

Base `a811249`; dedicated branch `codex/uiops02-capability-fixes`. No LIVE collection, inference, rendering, publishing, review decision or production mutation is authorized by this checkpoint.

## Corrections

- Technical Queue: only valid finite completed/total measurements produce a percentage. Missing/invalid totals use indeterminate progress for pending records; terminal records without measurements do not invent 100%. All six workflow statuses have separate labels; only SUCCEEDED is complete. Queue and Dashboard pending counts are explicitly persisted records, not worker heartbeat evidence. REAL_DATA_COPY cancellation controls are disabled with a reason.
- Dashboard: Play is disabled with a visible reason when the current project has no COMPLETED output. Failed outputs and outputs belonging to another session cannot become the player source. Playback/decode failures produce visible errors; playing state follows media events rather than a premature success flag.
- Source/Script: Restore uses the verified topic/body mapping. Display restores the source body; narration excludes the topic unless includeTopicInTts was explicitly enabled. REVIEW_REQUIRED/unmapped content is not heuristically split. Original text, source identity and manual locks remain unchanged; normal backend save/revision/stale checks apply. The actual Restore control is in project Source, not a second Script restore implementation.

## Offline evidence

`node --max-old-space-size=256 test/uiops02-fixes.cjs`: **6/6 groups PASS**, exit 0. Tests bundle the actual frontend components/helper and use React server rendering, plus the existing StudioService in an owned OS temp store. No browser, Python, crawler or external API is started. Temporary source data is explicitly SYNTHETIC TEST DATA; the ledo topic/body wording is a regression case, not a claim of new extraction.

Coverage: absent/zero/NaN/infinite progress; all six labels; actual Queue indeterminate markup; actual Dashboard disabled Play for absent/failed/wrong-project output; verified versus review-required topic restoration and explicit TTS opt-in; actual session save/reopen, unchanged originals/raw/source/locks, one item revision increment, stale save rejection, no extra item revision for unchanged text.

Frontend `tsc --noEmit`: PASS, exit 0 (V8 heap 384 MiB). Studio esbuild bundle: PASS, exit 0. No dependency/version/lockfile change. Backend source was not changed; its existing compiled service is used by the isolated persistence regression. Full Jest and browser interaction tests are not rerun for this bounded offline correction; SSR is not a claim of browser playback or LIVE collection.

## DATA-04 LIVE-01 candidates (saved catalog only)

| Canonical permalink | Type evidence in the REAL_DATA_COPY | Reported replies | Verified replies available |
| --- | --- | --- | --- |
| https://www.threads.com/@ledo.duta/post/Dbx5Tv7Epv- | Human-confirmed POST in sandbox review; raw Bronze UNKNOWN; final decision NEEDS_REVIEW | 355 | 0 |
| https://www.threads.com/@twice_._not/post/Db2WUVcoAhp | UNKNOWN; no human type confirmation | 49 | 0 |
| https://www.threads.com/@dang.hoang88/post/Db0hzkvj7zk | UNKNOWN; no human type confirmation | null / unavailable | 0 |

Suggested target: ledo.duta, because it has explicit sandbox type confirmation, an existing topic/body mapping and a reported discussion count. This does not prove public availability, parent evidence, reply quality, completeness or rights. These permalinks were read from persisted records; no target page was opened or resolved online. The confirmation is not a production ACCEPT decision and does not authorize publishing.

**STOP: waiting for the user to choose a URL and separately approve LIVE-01.** If authorized later: one root, at most 20 verified replies, one browser, existing DATA-04 budgets and a separate pilot store. Stop at login/CAPTCHA/access protection or missing parent evidence; preserve unverified candidates separately. Reported reply counts are not collected reply counts. Scheduler, auto-ACCEPT/enqueue, TTS, render and publishing stay OFF.

Production preservation is checked read-only against the existing 933-file manifest; results and final commit/push SHA are supplied in the handoff. Runtime frontend refresh archives the preceding bundle/config and changes only the sandbox's frontend pin, never source/session/audio data.
