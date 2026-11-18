# Production Ready V2 delivery notes

## Automatic batch integration

SERIOUS DRAFT jobs now apply the existing deterministic normalization policy
before Kokoro. The operation changes `spokenText` only, records the policy and
input/output hashes, preserves ambiguous terms, and does not claim human
approval. A changed narration hash invalidates only stale audio and downstream
timeline state. A resource-guarded voice job remains resumable from the same
session without repeating collection or AI evaluation.

The default Threads visual remains DARK. The existing gameplay and background
music controls share the same preview/render contracts. BGM defaults to a low
gain and uses deterministic ducking with a short ramp around narration edges.

## Acceptance limits

The saved real Threads session remains the acceptance source. It preserves the
root and four verified replies, immutable originals, provenance, real root
metadata, and the available per-reply likes. Missing reply metadata remains
`NOT_PRESENT`; it is not converted to zero.

A later filesystem audit found the user-provided Minecraft Parkour clip in the
original frontend worktree and the tracked `bgm/lofi.mp3` and `bgm/sneaky.mp3`
files. The gameplay source remains untouched; an ignored runtime copy named
`backgrounds/user_gameplay.mp4` makes it available to this feature worktree.
Studio registers that clip and both BGM files through the existing public asset
API. SERIOUS automatic DRAFTs select `user_gameplay.mp4` and `lofi.mp3` when a
project has no saved background/music choice. Existing project choices are not
replaced. Rights remain `UNKNOWN/DRAFT_ONLY`, so publishing stays blocked.

The most recent Kokoro cold start was stopped by the existing emergency guard
after available physical memory fell below 256 MiB. Its five previous WAV files
are preserved but stale after the narration normalization changed their hashes.
No automatic retry is permitted; a new MP4 must not be claimed until current-hash
WAV files are generated and the 60–90 second duration gate passes.

## Verification

- Targeted Jest for the asset recovery: 5 suites / 35 tests passed, including
  automatic batch selection and idempotency. Earlier normalization/BGM suites
  remain covered.
- Backend Nest build, frontend TypeScript, and Studio bundle passed.
- Studio browser acceptance saved the preset at revision 46. The preview
  decoded the Minecraft background through the public-assets endpoint, muted
  its source audio, loaded `lofi.mp3` at volume 0.06, and showed both tracks on
  the editor timeline without console/page errors. The screenshot is the
  ignored runtime artifact `existing-assets-preview.png`.
- The production baseline remained 933/933 files byte-identical.
- Available physical memory fluctuated between 769 and 1,577 MiB while the
  owned backend was stopped, but stabilized around 1,033–1,147 MiB after the
  required sandbox restarted. The preceding Kokoro attempt recorded a 1,030.7
  MiB peak RSS; adding the unchanged 256 MiB emergency reserve requires more
  headroom than the running sandbox had. No unsafe retry or render was started.
