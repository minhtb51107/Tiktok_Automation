# DATA-05 — Verified conversation to editorial DRAFT

Base: faeb9b4; dedicated worktree Tiktok_Automation_data05 / codex/data05-editorial-production.

## Recovery audit

- DATA-04 exact target/relationship verifier and atomic conversation store reused unchanged. Public Schema.org parent evidence availability remains unverified LIVE.
- DATA-03 production consumer already enforces DATA-01 ACCEPT + QUEUED + confirmed identity + revision. Its adapter currently projects one root into one scene; extend this adapter, never bypass its gates.
- Studio has immutable originalText, separate display/spoken text, revision/locks, and matching audio cache invalidation.
- Existing buildVideoTimeline is the sole frame authority. Studio preview currently uses explicit silent placeholders when audio is absent; those cannot prove measured duration.
- Existing Kokoro/FFprobe manifests provide actual audio duration. No TTS/render/live collection runs in this task without further approval.
- Production baseline: 933/933 files unchanged, readable, manifest SHA-256 4897b40301b9452182147d1ea35d5c91c9867ffa47701d525f6ef65e890227e8. Runtime manifests remain Git-ignored.

## LIVE-01 gate

BLOCKED_TARGET / BLOCKED_APPROVAL. No target URL supplied; no automatic selection or LIVE call. Existing strict parent evidence standard is unchanged. Future pilot: one explicit target, <=20 verified replies, one browser, isolated store, no retry/cron/approval/production. Missing public relationship evidence means PARTIAL/BLOCKED.

## DATA-05A

Versioned deterministic feasibility separates material, substantive verified replies, structure and manually authored commentary. Popularity never overrides insufficient discussion. Missing hook/commentary/resolution stays visible; planner will not invent it. Duration uses an ESTIMATED 160–220 Vietnamese whitespace-token/minute advisory interval only. READY_FOR_SCRIPT is a planning recommendation, never measured-duration or factual approval. FUNNY remains disabled.

Boundary contract tests cover 59/60/61s, fixture versus measured, and padding that cannot compensate for insufficient narration. Release readiness always false in the duration-only assessment; independent human/content/audio/rights gates still apply.

## Checkpoint status

- Recovery/audit and DATA-05A feasibility contract: 7 synthetic unit tests PASS.
- Planning, handoff, UI and final regression: pending.
- LIVE collection / live narration / real >60s video acceptance: NOT RUN.

## DATA-05B/D — Planner and DATA-03 extension

Deterministic planner stores a hash-pinned immutable source bundle, ordered verified reply IDs, source/parent/permalink references and independent editorial selection. Quotes cannot be changed without PARAPHRASE labeling. Hook/commentary/resolution remain empty until manually written. Per-section locks and plan revision conflicts are enforced. Human quality labels remain separate from original heuristic scores. Missing quality returns UNKNOWN.

The existing ProductionConsumer now accepts a server-validated optional editorial snapshot. DATA-01 ACCEPT + QUEUED + confirmed POST, current Bronze body/identity, revision and explicit draft creation remain mandatory. Existing root-only behavior is preserved; a second job for the same queued source is blocked. Resume revalidates the pinned plan/selection and never overwrites an existing session. Script/audio/rights are not auto-approved. Targeted actual Studio/atomic store tests: 17 DATA05 + 10 DATA03 tests PASS.

Manual script approval is a separate operation and becomes STALE when script content changes. Voice and rights remain independent. DATA05 FINAL validation requires actual measured narration/timeline >60s plus script review; fixture duration cannot satisfy FINAL.

## DATA-05C — Duration evidence

Generated local synthetic tone WAV fixtures (not speech, no TTS): FFprobe durations 14, 18, 16, 25 and 8 seconds; total 81 seconds. Marked SYNTHETIC_FIXTURE in voice manifests and FIXTURE in AudioAssets. They test timing contracts only and cannot establish meaningful narration or LIVE TTS success. Muted/trimmed voice does not count its full manifest duration. Before TTS the estimate stays advisory; a duration-only pass never grants releaseReady.

LIVE pilot CLI has an absent-target/approval/resource gate, one explicit canonical target, isolated store and no retry. Running it without a URL returned BLOCKED_TARGET / exit 2 without collection. It has not run LIVE.
