# Production Quality V1 — DRAFT acceptance

Date: 2026-11-18

Branch: `codex/threads-acquisition-05`

Session: `b9ffc11c-41bc-485c-a50e-fb28396bd0d1`

## Result

`PARTIAL` — Threads card, metadata provenance, safe normalization, Studio
preview, and local runtime configuration are verified. A new MP4 was not
rendered because the only authorized Kokoro batch stopped at the existing
emergency memory floor before producing a current-hash WAV.

## Verified product behavior

- New SERIOUS scenes default to a dark Threads card. Existing saved scene
  choices remain explicit and are not migrated implicitly.
- The interaction row is left aligned with stable spacing. Header fields wrap
  inside the card, and long text continues to use the existing pagination.
- Exact saved metadata is carried to Remotion with per-field status, raw label,
  source, and observation time. Missing metrics remain `null`/`NOT_PRESENT`.
- The root has a cached local avatar and observed metrics 430 likes, 127
  replies, 26 reposts, and 26 shares. The four replies have observed likes
  4/4/3/1; unavailable reply/repost/share values remain missing. Their saved
  captures contain no avatar URL, so the neutral fallback is used.
- The `THREADS_DARK_GAMEPLAY` preset reuses the existing background-track
  controls and never chooses or downloads footage. No rights-reviewed gameplay
  or BGM asset exists in this sandbox, so acceptance records
  `MISSING_GAMEPLAY_ASSET` and `MISSING_BGM_ASSET`.
- AI normalization uses the existing Hugging Face provider and durable ledger.
  One Qwen request completed for the root; provider cost was unavailable, so
  the existing budget guard prevented the four remaining requests before
  network access. It was not bypassed.
- The versioned deterministic dictionary changed only `spokenText`, including
  `vierjc → việc`, `NNA → ngôn ngữ Anh`, `KCN → khu công nghiệp`,
  `QA → kiu ây`, `HN → Hà Nội`, `vp → văn phòng`, `yc → yêu cầu`,
  `sx → sản xuất`, `cty → công ty`, `FDI → ép đi ai`,
  `XNK → xuất nhập khẩu`, and `HR → nhân sự`. Ambiguous `t`, `k`, and `bh`
  remain unchanged for exception review. `originalText` and display source are
  unchanged.

## Voice attempt and resource evidence

The ignored local runtime configuration now points at the previously verified
Python 3.14.6 environment, Kokoro-Vietnamese 0.1.0, existing model/config,
`my_yen` voicepack, FFmpeg, and FFprobe. Runtime preflight returned `READY`.
No model or package was downloaded.

Before the real batch, available physical RAM was 713.6 MiB and commit reserve
was 5,899.8 MiB. During cold start the first scene reached 229.21 MiB available,
below the unchanged 256 MiB emergency floor. The owned worker stopped with
`RESOURCE_GUARD_STOP`; no current-hash WAV was produced. The five previous WAVs
remain present for rollback but are correctly marked `STALE` after the
`spokenText` hashes changed. No render was attempted.

The batch implementation now stops all remaining scenes after the first
resource emergency instead of starting another worker. Regression covers that
behavior.

## Validation

- Targeted Jest: 4 suites / 22 tests PASS.
- Backend Nest build: PASS.
- Frontend TypeScript: PASS.
- Studio bundle: PASS.
- Read-only browser smoke: HTTP 200, five real scenes visible, dark preview,
  zero POST/PUT/PATCH/DELETE while opening.
- Production preservation: 933/933 baseline files unchanged.
- Studio screenshot (ignored runtime artifact):
  `.studio-data/reports/product-mvp-live02/production-quality-v1-editor.png`.

## Remaining acceptance blockers

1. Obtain sufficient memory headroom and run one fresh Kokoro batch for the five
   changed hashes; do not retry automatically.
2. Measure the resulting WAVs and render only if the real timeline is 60–90 s.
3. Supply rights-reviewed gameplay and music assets before claiming gameplay or
   BGM QA PASS.
4. Reply avatars remain unknown unless a future authorized source capture
   supplies exact avatar URLs.
