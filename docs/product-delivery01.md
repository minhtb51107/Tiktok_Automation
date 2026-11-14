# PRODUCT-DELIVERY-01 — usable URL → DRAFT MP4 path

## Product path

One persisted product job now coordinates the existing components:

`Threads URL → bounded Source collection → DATA-04 collection → AI assessment → explicit conversation review → reviewed AI Script → same Studio project → Voice → Editor → DRAFT MP4`

Opening or resuming a job never starts AI, TTS, rendering, publishing, or a scheduler. A canonical URL collection starts only from the explicit **Collect into DRAFT project** action.

| Stage | Implementation/evidence | Product status |
| --- | --- | --- |
| Source | Existing public Threads collector; exact target plus separately labelled observed context; persisted Studio session and DATA-04 import | WORKING when public access succeeds; relationship evidence may remain PARTIAL |
| AI quality | Existing Hugging Face/Qwen evaluator, durable assessments and ledger | WORKING LIVE previously; each new call remains explicit/budgeted |
| Human review | Existing DATA-04 feedback with revision, verified IDs and observed URLs kept separate | WORKING; ACCEPT is not rights or publishing approval |
| Script | Reviewed AI proposal is validated against the persisted selection and materialized into the same project | WORKING OFFLINE; real saved long proposal still requires user review |
| Voice | Existing Kokoro cache/settings/batch generation and measured duration | WORKING LIVE previously; not run by this checkpoint |
| Editor | Existing editor/timeline/Remotion Player and stale-audio handling | WORKING LIVE previously; no second editor created |
| MP4 | Existing render jobs, progress/cancel/download, H.264/AAC verification | WORKING LIVE previously; no new MP4 in this checkpoint |

## Evidence and immutability rules

- `PARENT_VERIFIED` remains restricted to technical parent evidence.
- Explicitly selected target-page observations carry `OBSERVED_RELATIONSHIP_UNVERIFIED`, `parentId=null`, exact permalink and immutable raw capture.
- Observed material can enter a DRAFT after human selection; it is never relabelled as a verified reply.
- AI `QUOTE`/`PARAPHRASE` source IDs must be the root or members of the exact persisted conversation selection. Commentary has no source ID.
- Applying the same proposal/review revision is idempotent. A newer script review creates a newer EditorialPlan revision in the same Studio session.
- Studio persistence marks mismatched audio stale and removes a stale timeline reference while preserving the audio files/cache.

## User operation

1. Open `/studio?area=Video%20Studio&view=projects` on the loopback Studio runtime.
2. Paste one canonical `https://www.threads.com/@handle/post/id` URL and choose **Collect into DRAFT project**.
3. Reopen the job and choose **AI quality / human review**.
4. Inspect root/context evidence. Save the conversation review. Use **Apply accepted review** only after the review decision is explicitly ACCEPT.
5. Open or create the AI Script DRAFT, edit it, and save its review revision.
6. Choose **Apply reviewed Script to this project**. Studio opens the same project in Script.
7. Edit/save, then use the existing Voice, Video Editor and MP4 Output steps. Each heavy action remains explicit.

## Build versus reuse versus integrate

- `tyl3rn/ai-shortform-video-generator`: useful reference for a persisted one-command job, but no repository license was found during the audit; no code copied.
- `fyrek1d/yt-automation`: MIT and demonstrates orchestration across TTS/video/upload. Integration was rejected because it would duplicate the existing Kokoro, timeline and Remotion stack.
- `remotion-dev/template-render-server`: useful start/status/cancel reference, but its package is unlicensed and this repository already has richer render job management. Existing Remotion compositions remain authoritative.
- Apify Threads reply actors advertise parent/depth fields but are paid/external and access reliability depends on the platform. They are not used or authorized in this checkpoint; a future optional adapter would need an explicit cost/access decision and evidence validation.

## Acceptance boundary

This checkpoint proves orchestration and Script scene materialization offline. It does **not** claim three new 65–90 second videos. Existing real captures do not yet contain three user-reviewed, sufficiently long scripts, and no new inference/TTS/render budget was authorized here. A new MP4 must only be reported after measured WAV and actual render verification.
