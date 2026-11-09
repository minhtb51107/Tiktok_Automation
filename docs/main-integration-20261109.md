# Main integration — 2026-11-09

User explicitly authorized a history-preserving main merge/push. No squash,
history rewriting, force push or branch deletion. All seven existing worktrees
were clean before integration and were left intact. A separate main worktree
isolates validation from running Studios and production data.

## Graph and identity

Fetched origin/main: `88fbcbd05a96a25771f24d800a361c2cb3fd4a21`.
Integrated feature tip: `de60514109e1afa844f2f71d7fcb4f56c70ef33f`.
Ahead/behind main: **62 / 0**. Every local feature/refactor/design branch tip is
an ancestor of de60514, including the Antigravity merge dfd6cf0; no independent
branch was silently omitted or merged twice. Merge has both original parents.

`git log --format=fuller` shows the same primary author and committer on all 62
commits: **minhtb51107 <binhminh51107@gmail.com>**. GitHub's commit API explicitly
links de60514 author/committer to **minhtb51107**; it is unsigned (verified=false),
which is separate from account association. One commit, e0d7c94, credits Copilot
in a co-author trailer. No primary author/committer in this range is a bot.
No identity metadata was rewritten. GitHub main's protected flag was false at
preflight; any actual push rejection remains authoritative and is not bypassed.

## Integration adjustments

- Existing media/history is preserved on disk/in old refs. Two source MP4s and
  seven synthetic WAV fixtures newly added relative to main are excluded from
  the **merge tip**. No new WAV/MP4 blob, model, token, session, raw capture or
  runtime output is staged. Their historical branch commits remain reachable
  because history is deliberately not rewritten.
- Global WAV/MP4 ignores prevent new runtime media commits. A lightweight source
  script recreates the seven synthetic preview tones on a fresh clone:
  `node scripts/generate-preview-audio.cjs` in `2_Remotion_Video`. These are TEST
  DATA, not Kokoro or real narration. Existing local files are never overwritten.
  User-owned background video must be supplied locally; no footage downloaded.
- CI Node 18 conflicted with installed NestJS engines >=20. CI now uses Node22,
  skips Puppeteer downloads, runs Jest sequentially and validates Studio/types/
  Remotion. No library/lockfile upgrade was made by this integration adjustment.
- AGENTS.md now allows main integration only when explicitly user-authorized.
  Routine milestones still use feature branches. No production/workflow module
  was activated. Existing CI only builds/tests; it does not publish/deploy.
- Whole-merge `diff --cached --check` exposed inherited trailing whitespace in
  12 legacy files (143 lines) and one trailing blank line in an E2E script. Only
  those whitespace issues were removed; `git diff -w --ignore-blank-lines de60514` for these paths
  is empty. No legacy workflow was activated or refactored.

## Validation: PASS

All heavy checks ran sequentially, no TTS/browser/render/crawler in parallel:

- Backend build: exit **0**, Node20.19.1, heap384 MiB.
- Jest: **43 suites / 285 tests PASS**, 106.793 s, runInBand, heap320 MiB.
  Used ts-jest isolated transpilation to limit memory; the separate backend
  TypeScript build validates types. Existing serious legacy test exclusion was
  unchanged. Mock/unit results are not LIVE data-source evidence.
- Frontend `tsc --noEmit`: exit **0**, heap320 MiB.
- Studio bundle: exit **0**, 2.2MB JS / 124.7KB CSS.
- Remotion bundle: exit **0**, heap384 MiB, no render/browser download.
- Fresh synthetic tone generation in a temporary directory: **7/7 measured
  durations match FFprobe**, not merely files that already existed locally.
- Main compiled AppModule/API smoke: loopback ephemeral server, `/` and session
  list HTTP200, empty isolated temp store, **zero worker spawns**, external fetch
  disabled; server closed. Production storage was not connected.
- `git diff --check`: PASS. Pattern secret scan across all 62 commits found no
  HF/GitHub token/private-key matches. This is a bounded pattern scan, not a
  mathematical guarantee that all possible credentials are absent.

Observed available RAM roughly 549–685 MiB before backend checks; Remotion build
briefly reached ~271 MiB, completed without OOM. No outside process was killed,
no dependency reinstallation, pagefile/system modification or production data
write. Existing Studio3110 and3111 continue from their original feature worktree;
the main build did not replace their running backend or store.

## Integrated commit inventory (original identities/history retained)

CI follow-up: GitHub run 42636486352 failed in one pre-existing test suite,
`conversation-media.spec.ts`: missing describe/test/expect imports with the test
TypeScript configuration. The other 42 suites / 283 tests passed. The repair
imports from `@jest/globals`, with no diagnostics suppression or skipped test.
The repaired spec passed a standalone TypeScript program check. Trying ts-jest's
combined type-checking process with a 384 MiB heap hit the V8 heap limit on this
laptop (not evidence of Windows OOM); no heap increase was forced. Runtime tests
use isolated transpilation locally, while CI retains the full type-checking
configuration. Remote CI must be checked again after the repair push.

- 21db111 chore: preserve recovery baseline WIP
- 837bbf4 chore: establish offline recovery baseline
- 441224d test: finalize offline recovery baseline
- 6b53285 feat: add editable video pipeline contracts
- 328aa6a feat: add interactive offline video preview
- 90bf715 feat: checkpoint local Content Studio exact-source review and reports
- 9c439b6 docs: persist verified milestone and safe feature-branch push rules
- 0056d4d feat(studio): checkpoint script voice and direct timeline editor with continuous backgrounds
- 2cf7caf docs(studio): verify five-scene draft narration and full preview coverage
- e033256 feat(studio): add local draft MP4 rendering with verified timeline and audio sync
- cf956ba fix(studio): normalize TTS numbers and verify offline draft quality
- 6f0851a chore(studio): preserve publishing foundation behind recovery safety gates
- d0ad9b2 feat(data): add durable offline Threads SERIOUS data engine
- 7f8db07 feat(studio): implement UX-01 Studio V2 operations IA, design system, and responsive NLE
- d7927ba feat(studio): add data review library and safe local pipeline API
- e1541ec feat(studio-v2): overhaul app shell and chromatic bento dashboard with live DATA-01 truth (UX-02 stage 1)
- 4308d95 feat(data): add bounded official Threads collector and OAuth foundation
- 109e7c0 docs(data): record DATA-02 validation and HTTPS authorization gate
- d162a01 feat(studio): implement UX-02 Stage 2 Data Review, Discovery & Production Queue
- eb788f9 docs(data): verify local HTTPS and record pending Threads consent
- e38646e fix(threads): diagnose OAuth stages and retain encrypted token recovery
- 66b8d59 fix(studio): complete UX-02 Stage 2.1 collector runs, OAuth vault & approval gates
- 54c001d fix(threads): align token exchange and app binding with verified live API
- 53ef635 feat(data): materialize reviewed queue snapshots as editable Studio projects
- 7472291 feat(data): reconnect controlled legacy Threads crawler to DATA-01
- 90451cf feat(data): add on-demand discovery and explainable Gold V2 shadow review
- 6b5b012 docs(integration): record verified runtime snapshot and isolated worktree
- dfd6cf0 merge(studio): integrate Antigravity shell with Codex backend baseline
- 8bc2c64 fix(integration): gate review by canonical identity and explicit target type
- 95ba696 feat(integration): connect controlled discovery and separate Gold feedback
- ef5cc78 feat(integration): bridge reviewed production queue and authoritative readiness
- e0d7c94 test(integration): browser E2E on isolated synthetic runtime; fix approval, provenance and review-count labels
- 35179ea fix(studio): verify real-data acceptance and evidence-based provenance
- 0974079 docs(data04): audit legacy reply extraction and evidence boundaries
- ea745d2 feat(data04): add evidence-aware popularity ranking contracts
- f182cbb feat(data04): collect replies only from explicit public relationship evidence
- e611856 feat(data04): score reply and conversation quality without LLMs
- f51736c feat(data04): persist resumable conversation shadows and human reply feedback
- bc14b09 feat(studio): review conversation evidence and reply quality independently
- faeb9b4 test(data04): verify isolated conversation review, recovery and data preservation
- 19f9647 feat(data05): define editorial feasibility and independent duration gates
- da58153 feat(data05): plan original scripts and extend guarded DATA03 draft handoff
- 0cad497 feat(data05): integrate editorial Studio and verify isolated long-form timing
- 2530c55 feat(uiops01): checkpoint guarded real-data Studio acceptance
- b05de67 docs(uiops02): audit navigation, catalog isolation and theme ownership
- 7dc4964 feat(uiops02): add isolated library review, full-run reports and collection plans
- a811249 feat(uiops02): connect project navigation and sandbox content workflows
- bf1536b fix(studio): correct job status, empty playback and topic-aware restore
- 134de76 feat(data04): preserve bounded live media pilot evidence
- 5ba5129 fix(restore01): reconnect observed source cards to draft sessions
- 205ab9b feat(restore01): retain bounded LIVE02 cards in editable sandbox
- 2c19d47 fix(source): export observed cards and add advisory quality projections
- f655c96 feat(live03): checkpoint bounded capture and resource-blocked pilot
- a8f33ca feat(e2e01): validate local narrated draft MP4 smoke
- 8e33831 fix(video): improve Threads media and optional narration settings
- ed9da9e feat(studio): add reviewed image OCR narration and source quality v2
- 088a3d7 fix(tts): guard low-memory starts and retain worker diagnostics
- a6591ea fix(tts): separate headroom warnings from approved bounded probes
- b19b789 docs(tts): record approved one-shot Kokoro probe measurements
- 299a0b8 Prepare hash-bound long image narration with unchanged resource guards
- ee0bf02 Record verified 591-character Kokoro draft and measured timeline
- de60514 Verify one image-narration draft MP4 and isolated playback Studio
