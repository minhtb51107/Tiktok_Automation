# Repository working agreements

Preserve existing user changes and local sessions. Inspect branch, status and diff
before editing; do not reset, clean, stash or overwrite unrelated work.

## Verified milestones and Git

- After each meaningful implemented and verified milestone, commit the reviewed
  source, tests and documentation with a clear message and push the completed
  checkpoint to GitHub on the authorized branch.
- Before the first push inspect remotes, branch and upstream. Follow the
  repository and branch management policy below. Report authentication and
  protection failures without bypassing them.
- Inspect the exact file list before staging. Do not blindly use `git add .`.
  Exclude credentials, API keys, `.env`, local runtime configuration, model weights,
  voicepacks, browser profiles/cookies, session data, generated audio/video, caches
  and build artifacts. Secret-scan proposed files without printing secret values.
- Fix failing tests before a completed milestone commit. If interrupted mid-task,
  a clearly labelled WIP checkpoint on the feature branch is allowed; document
  incomplete validation. Never label unfinished work complete.
- Report the working directory, active branch, commit SHA, push status,
  remaining worktree changes and blockers.

## Repository and Branch Management Policy

- `main` is the canonical integrated and tested version. Reuse the official
  `Tiktok_Automation_main` working directory. The original `Tiktok_Automation`
  checkout holds the shared Git directory and dependencies and must be preserved.
- Reuse the existing branch and worktree for small tasks. Use at most one active
  feature or fix branch unless the user explicitly needs parallel development.
- Integrate completed and tested work into `main` with user authorization.
  Prefer fast-forward integration when the history allows it.
- Remove merged local branches after verifying ancestry, worktree use and data
  preservation. Use tags for important milestones instead of keeping
  historical branches. Remote branch deletion requires user approval.
- Never force-push, rewrite shared history or delete unmerged work without
  explicit authorization.
- Keep secrets and runtime data out of Git. Maintain separate, access-controlled
  backups for important local runtime artifacts.
- Operator agents must not perform Git operations. Development handoffs must
  identify the active branch, commit and working directory.

## Studio safety and validation

- New production development follows THREADS SERIOUS → data pipeline → video
  production. FUNNY/Drama, Compilation and Lyrics are legacy: preserve their code,
  assets and sessions, and do not activate or add features to them in this stream.

- Reuse Studio contracts, timeline engine and Remotion compositions. Humans and
  agents invoke the same local backend operations.
- Original source is immutable. Preserve revisions, locks, provenance and assets.
  DRAFT audio/render is not content approval or publishing authorization.
- No automatic AI, scraping, TTS, render or publishing at startup. No production
  services, Discord, watchers, database migrations or publishing without explicit
  authorization. Keep local Studio bound to loopback.
- Use existing dependencies/models/browser. Run builds, tests, Kokoro and render
  sequentially on this low-RAM machine, with one heavy worker at a time. Monitor
  resources; do not kill unrelated processes.
- Distinguish unit/mock tests, live browser preview, live TTS and real MP4 evidence.
  Do not infer live success from mocks or render fidelity from preview alone.
- Operator work uses the restricted Production Harness interface. Set up the
  agent host without repository write or shell tools and follow
  [the Operator guide](docs/production-harness-v1.md).
