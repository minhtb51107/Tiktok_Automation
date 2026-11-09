# UI-04 completion checkpoint — 2026-11-02

This is a source-only handover; local sessions, narration, screenshots and reports
remain in ignored runtime storage. No user audio is approved by this checkpoint.

## Verified on the local SERIOUS project

- Five real selected items have matching Kokoro DRAFT narration, all My Yen at
  1.2x: measured durations 3451, 10076, 29013, 23072 and 9588 ms. The first was
  reused from cache; the other four were synthesized sequentially, without API
  calls, new models or dependencies. FFprobe and text hashes were checked.
- A real browser played all five assets and sought into all five scenes, checking
  scene identity and narration time. Five installed voice options were enabled.
- The timeline engine produced 2334 frames at 30 FPS (77.8 s). Original text,
  metadata, locks, item revisions, display/spoken text and saved Editor settings
  remain unchanged. Only missing voice settings were filled and audio added.
- `ledo.duta` topic remains in the header, excluded from spoken/body text.
- The saved background's source offset was checked at output frames 119 and 437;
  playback did not restart at those scene boundaries.
- Existing canvas/timeline gesture evidence from UI-04.4 is retained rather than
  repeating the entire heavy suite. Current backend build and offline tests pass.

## Explicit limitations, not false PASS

- The verified original Threads screenshot is unavailable; exact visual fidelity
  is PARTIAL. The Project1B Cut reference is not a Threads source screenshot.
- The user-saved global background covers 17.966 seconds. Adding real narration
  expands the timeline to 77.8 seconds. Its duration/source range was intentionally
  not changed: later fallback/background gaps remain visible and require an
  editing decision before a polished full-length export. Render must warn about
  this, not silently extend or loop the user's source segment.
- Slang/ambiguous terms remain unchanged. DRAFT narration is a technical listening
  artifact, not authorial normalization approval or permission to publish.
- Remote avatars may expire. Offline export must disclose omitted remote assets.

Detailed local evidence: `.studio-data/reports/ui05/audio-coverage.json`,
`preview-check.json` and screenshots `ui05-scene-1.png` through `ui05-scene-5.png`.
Runtime artifacts are excluded from Git.
