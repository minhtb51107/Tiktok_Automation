# UI-05 measured validation — 2026-11-02

All runtime data, source sessions, audio, MP4s, screenshots and detailed reports stay
local under ignored storage. No credentials/models/browser runtime were installed
or published. The frontend/backend lockfiles and package versions were unchanged.

| Check | Actual result |
|---|---|
| Backend TypeScript/build | Exit 0 |
| Frontend TypeScript/Studio bundle/Remotion bundle | Exit 0 |
| Offline Jest | 20 suites, 70 tests pass |
| Real local narration | 5 DRAFT assets, My Yen 1.2x; original text preserved |
| 720p smoke after audio fix | H.264/AAC, 150 frames, 5 seconds, 3,074,419 bytes |
| Full DRAFT after audio fix | 1080×1920, 30 FPS, 2334 frames, 77.8 seconds |
| Video/audio/container durations | All 77.800000 seconds |
| Full MP4 size / container bitrate | 26,897,473 bytes / 2,765,806 bit/s |
| Render job | 07ec7e9c-fcd6-4e3d-87a0-a4bf4c856571 |
| Full render wall time | 337.150 seconds, including preparation/probe |
| RenderMedia / final AAC encode+mux | 325.214 / 3.099 seconds |
| Library frame pass / encoding metrics | 303.609 / 20.045 seconds |
| Average rendered frames per RenderMedia second | 7.177 |
| Narration waveform placement | 0–0.3125 ms lag at sampled beginning/end windows |
| Narration waveform correlation | Approximately 0.988–0.999 across five scenes |
| Global BGM sample at scene boundary | 0 ms lag, correlation 0.99998 |
| SFX isolated from known voice/BGM mix | 0 ms lag, correlation 0.99894, gain 0.14953 vs configured 0.15 |
| Cancel during actual rendering | CANCELLED after 9 frames; worker/browser closed |
| Download / seek | Full-file hash matches, byte-range HTTP 206; browser seeks five scenes |
| Reports | Copy/readback and valid JSON export checked in real browser |
| Save/reopen | Render manifest retained; source/Editor settings unchanged |

Background timing was verified against decoded source images, not just a seek
time: output frames 0/119/437 best match source frames 1200/1319/1637, corresponding
to 40.000000/43.966667/54.566667 seconds. A normalized grayscale top-background ROI
had SSIM 0.995604/0.985269/0.990186, higher than either adjacent source frame. Raw
high-resolution color SSIM alone was not treated as a frame-identity pass because
browser/FFmpeg resampling differs. Player decoded PTS independently matched these
times. Sixteen output frames were extracted around all scene boundaries/end.

The main project uses a static meme and has no selected GIF. A separate labelled
synthetic **one-second** MP4 contract test exercised the same composition/worker
with a two-frame GIF: frame 3 decoded red, frame 18 decoded blue. It did not change
the main project or introduce test media into its render.

The actual full export used Ryzen 5 6600H (6 cores/12 threads), 5.69 GiB usable RAM,
installed Chrome 156 and software H.264 encoding with render concurrency one.
Sampled render-process-family working/private memory maxima were about 663/979 MiB;
minimum available system RAM was about 414 MiB. These are sampled values including
child/probe processes, not an exact system commit peak. No OOM was observed.

The first diagnostic exports exposed an AAC/ADTS priming delay around 42.7 ms;
they were retained with warnings, not presented as synchronized final outputs.
The corrected path uses Remotion's lossless mix and direct AAC-in-MP4 encoding.
One intermediate smoke failed due to a mux argument/cancellation-error reporting
bug; both were fixed before the successful smoke/full results above. Old failed
and cancelled jobs remain visible as history.

## Remaining quality gates

- Exact comparison with the original Threads screenshot is PARTIAL (reference
  unavailable). Remote avatars are omitted by offline render with explicit warnings.
- User-saved global background remains 17.966 seconds while narration extends the
  project to 77.8 seconds. Later fallback/background gaps are intentional preservation,
  not a claim of continuous background coverage for the entire export.
- All audio remains DRAFT/unapproved; ambiguous slang is preserved for review.
  Measured waveform placement does not establish semantic/pronunciation quality.
- FINAL/publishing readiness is not claimed. Review content/media, deliberately
  adjust background coverage, approve audio and revalidate the current timeline
  before designing UI-06's explicit publishing gate.
