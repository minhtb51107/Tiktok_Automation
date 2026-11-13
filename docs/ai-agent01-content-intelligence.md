# AI-AGENT-01 — Hugging Face Content Intelligence V1

## Architecture

The new integration lives inside the existing DATA engine and Studio module. It does not import the legacy Prisma-backed `AiModule`, start cron/Discord, or activate any crawler. The legacy `HuggingFaceService` remains preserved but is not used because it hardcodes an old model/route and is coupled to Prisma.

The active production stream is THREADS SERIOUS. FUNNY remains visible as a disabled legacy choice; the provider endpoints reject it rather than activating a second production workflow.

`ContentAiProvider` is the bounded provider interface. `HuggingFaceContentProvider` uses the Hugging Face Inference Providers chat-completion API. Model, provider route, timeout, maximum output tokens, request budget and token budget are backend environment settings. The access token is never returned by the status API or stored in an assessment.

The default model is `openai/gpt-oss-20b` through route `auto`; both are configuration defaults, not a compatibility claim. A real health check is required to establish availability for the configured account and route.

## Safety and data separation

- Threads text is untrusted input, never instructions.
- Every assessment candidate must reference an existing persisted source ID. Unknown or invented IDs fail strict validation.
- Rule score, popularity, conversation quality, AI assessment and editorial recommendation remain separate.
- AI results are `WAITING_REVIEW`; script proposals are `DRAFT_REQUIRES_HUMAN_REVIEW`.
- No AI operation changes Gold V2, DATA-01 review, production approval, rights status, TTS, render or publishing.
- Identical assessment inputs use an immutable content-hash cache, preventing duplicate requests.
- Provider errors are categorized without persisting prompts, raw responses, tokens or credentials.

## Research Agent V1

V1 uses deterministic backend orchestration and does **not** claim model-driven function calling. Its bounded sequence is:

1. `search_threads` — only the persisted collection IDs supplied by the user; no LIVE crawler.
2. `get_post_details`.
3. `get_conversation`.
4. `evaluate_candidates`.
5. `propose_script`.

The backend validates every input, permits at most three collections and eight tool calls, supports cancellation, and persists a resumable/idempotent run record. It cannot execute shell, SQL, arbitrary files, acceptance, TTS, render or publishing.

## Configuration

Place the real key only in `1_nest_backend/.env`. See `.env.example` for placeholders. Optional cost-rate settings are deliberately blank: when the selected provider route does not return cost and verified rates are not configured, Studio reports cost as `UNAVAILABLE` instead of guessing.

## API

- `GET /api/studio/data/ai/status` — safe configuration/availability metadata; no live call.
- `POST /api/studio/data/ai/health` — one explicit bounded live health request.
- `POST /api/studio/data/ai/collections/:id/evaluate` — explicit cached assessment.
- `GET /api/studio/data/ai/assessments` and `/:id`.
- `POST /api/studio/data/ai/agent/runs`, list/get/cancel endpoints.

All POST operations that can call the provider require `confirmLive: true` and a loopback Studio origin. Opening Studio never triggers AI.

## Verification boundary

Offline tests prove strict schema/source validation, idempotent cache, bounded orchestration and approval isolation. They are not evidence that Hugging Face billing, model routing or content quality works LIVE. LIVE status and capture-specific assessment must be reported separately, including model, provider route, latency, token usage and cost availability.

### LIVE-01 result (2026-11-13)

The single bounded health request used `openai/gpt-oss-20b` through route `auto` and returned HTTP 402, categorized as `BLOCKED_BILLING`. The run stopped immediately: no assessment or proposal request followed, no retry/provider switch occurred, and token usage/cost were unavailable. Therefore AI content quality and real tool orchestration remain **NOT MEASURED LIVE** even though the offline integration is verified.
