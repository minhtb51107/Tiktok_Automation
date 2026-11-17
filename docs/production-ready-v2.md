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

No rights-reviewed gameplay or BGM asset exists in this sandbox. Those portions
therefore remain `MISSING_GAMEPLAY_ASSET` and `MISSING_BGM_ASSET`, even though
their selection, layout, loop/trim, gain and ducking controls are implemented.

The most recent Kokoro cold start was stopped by the existing emergency guard
after available physical memory fell below 256 MiB. Its five previous WAV files
are preserved but stale after the narration normalization changed their hashes.
No automatic retry is permitted; a new MP4 must not be claimed until current-hash
WAV files are generated and the 60–90 second duration gate passes.

## Verification

- Targeted Jest: 6 suites / 39 tests passed; the final Product Pipeline rerun
  passed 14/14 tests after adding the automatic-normalization assertion.
- Backend Nest build, frontend TypeScript, and Studio bundle passed.
- Read-only Studio browser smoke returned HTTP 200, opened the saved five-scene
  collection, emitted no write requests or page errors, and preserved revision
  42. The screenshot is the ignored runtime artifact
  `production-ready-v2-editor.png`.
- The production baseline remained 933/933 files byte-identical.
- Available physical memory after browser cleanup was about 1,119 MiB. The
  preceding Kokoro attempt recorded a 1,030.7 MiB peak RSS and had already hit
  the 256 MiB emergency floor from a lower starting point, so no unsafe retry
  or render was started.
