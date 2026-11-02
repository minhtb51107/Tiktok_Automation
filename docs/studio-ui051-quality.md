# UI-05.1: verified DRAFT quality recovery

## TTS input and cache

The installed Kokoro Vietnamese wrapper delegates text to vig2p. vig2p tokenizes
digits individually and applies tone-marker substitutions; the acoustic vocabulary
does not contain numeric characters. Passing `22`, `700` or `N4` directly therefore
does not reliably produce spoken numbers. Model weights and third-party packages
were not changed.

`spoken-numbers.ts` converts only the transport input to local TTS. Original,
display and user-edited spoken text remain unchanged. The manifest records the
actual TTS input, its hash and `vi-numbers-1`. Golden cases include Vietnamese
integers, dates, context ranges, count alternatives and decimal units. `N4`/`N2`
use the explicit phonetic convention `en bốn`/`en hai`; slang is not interpreted.
An unqualified `5,6` remains ambiguous and blocks synthesis for review; `5,6 quán`
is a count alternative, while `5,6 triệu` is decimal. The worker rejects remaining
digits rather than silently skipping them.

New synthesis keys include item ID, normalized input/version, model/config/voicepack
fingerprint, package/device, voice and synthesis rate. Postprocessing speed changes
the output key while retaining the same synthesis base. Previously verified assets
are retained; no cache/audio deletion or implicit approval was performed.

Three numeric narration assets were regenerated LIVE sequentially; two nonnumeric
assets were reused. All five remain DRAFT, My Yen at 1.2x. Measured durations in
scene order are 3.451, 10.525, 30.347, 23.180 and 9.588 seconds. Input/hash checks,
waveform and browser playback are verified. Human assessment of pronunciation and
ambiguous language is still required; automated evidence is not semantic approval.

## Avatars, card and background

Five actual public source avatars were downloaded, signature/decode validated and
stored under ignored session-scoped, content-addressed storage. DNS addresses and
every redirect are restricted to public HTTPS Instagram/Facebook CDN hosts, with
timeouts and size/redirect limits. Preview and renderer share these local URLs.
The source-provided default profile image is retained where that is the real image;
no avatar is fabricated. Offline browser smoke made zero external requests.

The card body explicitly uses left alignment, normal word/letter spacing and font
weight 400. Measured body width is 818 canvas pixels inside the saved 900-pixel card.
Decoded MP4 frames show all five avatars, source metadata, saved light/dark card
styles and intact text. The topic remains in the header and outside narration.
Exact fidelity to original Threads screenshots is PARTIAL because a complete
reference set is unavailable. Existing layout/media settings were not changed.

Background FIT/TRIM/LOOP are explicit Editor actions. Render defaults to SAVED;
FIT/LOOP may instead be chosen for a render snapshot without changing the Editor.
The Render Player uses the same composition/timeline and provides a frame seek
control to inspect those settings.

## Actual retained MP4

The interrupted render completed; it was not restarted or duplicated.

| Measurement | Actual |
|---|---|
| Job | b5a16c6d-59d5-4cf9-bb21-fbbddbb6d0e4 |
| Mode | DRAFT; not approved for publication |
| Video | H.264, 1080×1920, 30/1 FPS, 2390 frames |
| Video/container duration | 79.666667 seconds |
| Audio | AAC, 79.666000 seconds |
| Size | 97,585,691 bytes |
| Background snapshot | FIT; source 40.000–119.667 seconds, no loop |
| Saved background timing | Unchanged (17.966-second clip) |
| Bundle / browser init | 19.825 / 1.396 seconds |
| RenderMedia / final encode+mux | 476.513 / 3.308 seconds |
| End-to-end worker time | 517.160 seconds |
| Average frames per RenderMedia second | 5.016 |
| Sampled worker/browser tree peak private memory | 1,147,965,440 bytes |
| Minimum sampled available physical memory | 197,552 KiB |

Low-RAM CPU render used the existing Chrome runtime and concurrency 1. Samples are
periodic observations, not an exhaustive operating-system peak or a GPU benchmark.

Nineteen decoded frames were extracted around scene boundaries and the end. Seven
background ROIs, including 20s/40s/45.867s/69.567s/79.633s, best match the exact
expected source frame rather than its immediate neighbors (SSIM 0.985–0.993).
Blackdetect found no ≥0.1-second near-black interval at its configured 98% threshold.
This does not claim every possible visual defect has been excluded.

Narration waveform correlations at sampled beginning/end windows are 0.984–0.999,
with 0–0.3125 ms measured lag. The sampled global BGM window has 0 ms lag and
0.99998 correlation. FFprobe duration alone was not used as A/V-sync evidence.

Browser smoke verified five voice options, five audio playbacks, all five local
avatars, frame-accurate FIT Preview offsets, five exported MP4 seeks, HTTP 206,
manifest reopening, and zero runtime exceptions. Source text/metadata/locks and
Editor layout match the pre-task backup; eight other session hashes are unchanged.

Runtime evidence remains in ignored `.studio-data/reports/ui051/`; output remains
in ignored `.studio-data/renders/<session>/<job>/video.mp4`. No runtime file,
source post text, model, credential or output video belongs in the Git commit.

## Remaining publication blockers

Rights remain UNKNOWN, as explicitly declared by the user. The selected background
also visibly contains its existing third-party TikTok watermark; it was not removed
or disguised. Source content/media/model licensing and content/audio review must be
resolved before FINAL/Publishing. The DRAFT render is a local technical artifact.
