# AI-AGENT-01 — Hugging Face Content Intelligence V1

## Architecture

The new integration lives inside the existing DATA engine and Studio module. It does not import the legacy Prisma-backed `AiModule`, start cron/Discord, or activate any crawler. The legacy `HuggingFaceService` remains preserved but is not used because it hardcodes an old model/route and is coupled to Prisma.

The active production stream is THREADS SERIOUS. FUNNY remains visible as a disabled legacy choice; the provider endpoints reject it rather than activating a second production workflow.

`ContentAiProvider` is the bounded provider interface. `HuggingFaceContentProvider` uses the Hugging Face Inference Providers chat-completion API. Model, provider route, timeout, maximum output tokens, request budget and token budget are backend environment settings. The access token is never returned by the status API or stored in an assessment.

The default model is `Qwen/Qwen3-14B` through route `auto`, with Qwen's
`/no_think` instruction when reasoning is disabled. HTTP 200 with only
`reasoning_content` and no final `content` is rejected rather than reported as
a successful assessment.

## Safety and data separation

- Threads text is untrusted input, never instructions.
- Every assessment candidate must reference an existing persisted source ID. Unknown or invented IDs fail strict validation.
- Rule score, popularity, conversation quality, AI assessment and editorial recommendation remain separate.
- AI results are `WAITING_REVIEW`; script proposals are `DRAFT_REQUIRES_HUMAN_REVIEW`.
- No AI operation changes Gold V2, DATA-01 review, production approval, rights status, TTS, render or publishing.
- Identical assessment inputs use an immutable content-hash cache, preventing duplicate requests.
- Candidate assessment is performed one source at a time, followed by a bounded
  summary request. This preserves strict source coverage under the 2,048 output
  token ceiling; missing source IDs fail closed.
- Provider errors are categorized without persisting prompts, raw responses, tokens or credentials.
- Human AI feedback and edited Script DRAFT reviews have independent revisions,
  idempotency keys and history. Neither record grants production approval.

## Research Agent V1

V1 uses a model-generated JSON plan rather than provider-native function calling. The backend validates the selected collection and exact tool sequence before executing anything. Its bounded allowlist is:

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
- `GET/POST /api/studio/data/ai/assessments/:id/feedback` — editorial
  selection/feedback only.
- `POST /api/studio/data/ai/agent/runs`, list/get/cancel endpoints.
- `GET/POST /api/studio/data/ai/script-proposals/:id/review` — editable DRAFT
  review with revision conflict protection.

All POST operations that can call the provider require `confirmLive: true` and a loopback Studio origin. Opening Studio never triggers AI.

## Verification boundary

Offline tests prove strict schema/source validation, idempotent cache, bounded orchestration and approval isolation. They are not evidence that Hugging Face billing, model routing or content quality works LIVE. LIVE status and capture-specific assessment must be reported separately, including model, provider route, latency, token usage and cost availability.

### LIVE acceptance result (2026-11-13)

The backend-loaded credential was independently verified as account
`minhtb51107` before this acceptance (the token itself was never printed or
stored). The final acceptance used `Qwen/Qwen3-14B`, route `auto`, over the saved
real captures `gnrtth` and `pngkhatu`:

- 42 successful sequential inference requests; 84,768 reserved output tokens.
- Provider-reported cost: USD 0.00498084. Three earlier schema-invalid requests
  were stopped without automatic retry, so the total request count for this
  development task was 45/100.
- Both assessments remained `WAITING_REVIEW` and
  `NEEDS_EDITORIAL_ENRICHMENT`; no unverified context was auto-selected.
- The model planner selected an existing collection ID, and the backend executed
  exactly the five allowed tools. The proposal cited only the existing root ID,
  remained `DRAFT_REQUIRES_HUMAN_REVIEW`, and was estimated at 7–10 seconds—not
  falsely stretched to the requested 65–90 seconds.
- Browser acceptance proved Studio display plus feedback and DRAFT edit
  save/reopen at revision 1. Opening Studio made no AI POST request.

This is evidence of LIVE provider integration and bounded orchestration, not a
claim that AI editorial accuracy is measured. The captures have zero
parent-verified replies, so the conservative result still requires human source
selection/enrichment.
