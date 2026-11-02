# Repository working agreements

Preserve existing user changes and local sessions. Inspect branch, status and diff
before editing; do not reset, clean, stash or overwrite unrelated work.

## Verified milestones and Git

- After each meaningful implemented and verified milestone, commit the reviewed
  source, tests and documentation with a clear message and push the feature branch.
  The user has authorized ordinary commits/pushes; no repeated approval is needed.
- Before the first push inspect remotes, branch and upstream. Never merge into main,
  force push, rewrite history or delete branches. Report authentication/protection
  failures without bypassing them.
- Inspect the exact file list before staging. Do not blindly use `git add .`.
  Exclude credentials, API keys, `.env`, local runtime configuration, model weights,
  voicepacks, browser profiles/cookies, session data, generated audio/video, caches
  and build artifacts. Secret-scan proposed files without printing secret values.
- Fix failing tests before a completed milestone commit. If interrupted mid-task,
  a clearly labelled WIP checkpoint on the feature branch is allowed; document
  incomplete validation. Never label unfinished work complete.
- Report commit SHA, branch, push status, remaining worktree changes and blockers.

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
