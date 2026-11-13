# HF-DIAG-01 — Existing Hugging Face account diagnosis

## Verified configuration path

The AI-AGENT-01 feature worktree has no `1_nest_backend/.env`. A normal backend launch from that worktree therefore has no Hugging Face credential. The earlier bounded LIVE command explicitly set `DOTENV_CONFIG_PATH` to the older `Tiktok_Automation/1_nest_backend/.env`. No process/user/machine-level `HUGGINGFACE_API_KEY`, model or provider override was present during this audit.

The older `.env` has fingerprint `81d13af375a4` (first 12 hexadecimal characters of SHA-256). `whoami-v2` returned HTTP 200 and identified this token as:

- account: `minhtb123`;
- token display name: `tiktok`;
- role: `read`;
- type: ordinary user access token, not the fine-grained token described in the current Dashboard evidence.

Therefore the previous 402 request did not run against the stated `minhtb51107` / `tiktok_automation` credential. It is not evidence that `minhtb51107` exhausted its credits.

## Routing and model metadata

The code constructs `InferenceClient` with a Hugging Face token and `provider=auto`. It supplies no custom provider API key and no organization billing header, so its mode is **Hugging Face Routed Request**.

Public metadata currently reports:

- `Qwen/Qwen3-14B`: live on `deepinfra` and `featherless-ai`.
- `openai/gpt-oss-20b`: live on `deepinfra`, `groq`, `featherless-ai` and `ovhcloud`; one additional `novita` mapping reports error.

Model availability metadata does not prove that billing or authorization will succeed. The state of custom provider keys and provider preference order is managed in Hugging Face account settings and is not exposed by a documented read API used by this diagnostic. No provider-specific key is present in the local runtime environment.

## Error observability fix

`HuggingFaceContentProvider` now retains a maximum 800-character diagnostic extracted from the provider response. Bearer credentials, Hugging Face tokens, secret/key fields and URL queries are removed. The stable category remains `AI_BLOCKED_BILLING`, `AI_BLOCKED_AUTH`, `AI_RATE_LIMITED`, and so on. Regression tests prove that the useful 402 message survives while a test token does not.

## Required operator action

Place the intended `tiktok_automation` token directly in the feature worktree's ignored `1_nest_backend/.env`, then run `hf-account-diagnostic.cjs` again. Do not paste the token into chat. The gate is satisfied only when `whoami-v2` reports `minhtb51107` and the expected token display name/permissions.

Only after that identity check should two separately approved inference probes be considered:

1. `Qwen/Qwen3-14B`, provider `auto`, JSON `{ "ok": true }`, temperature 0, maximum 24 output tokens, one request, no retry.
2. `openai/gpt-oss-20b`, same payload and limits, one request, no retry.

These probes isolate model routing while keeping the account/token constant. Neither result alone proves general evaluator quality or account-wide billing health.
