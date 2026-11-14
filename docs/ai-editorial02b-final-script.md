# AI-EDITORIAL-02B — final Script acceptance

Date: 2026-11-14 (Asia/Saigon)

## Status

**PASS OFFLINE / BLOCKED_BUDGET_CONFIRMATION / LIVE SCRIPT NOT RUN**

The Script-proposal schema, source identity, approval isolation and durable
inference accounting are implemented and tested. No Qwen request was sent in
this checkpoint because the current cost/request balance cannot be established
from a documented read API and the three historical schema failures did not
persist usage.

## Durable inference ledger

Every new Hugging Face request now appends and fsyncs a JSONL event before the
network call:

- internal ledger ID;
- model and provider route;
- SHA-256 input hash;
- requested output-token ceiling;
- timestamp and `PENDING` status.

Subsequent events record:

- provider request ID;
- token usage and provider-reported cost when available;
- latency;
- `PROVIDER_SUCCEEDED` or a classified `PROVIDER_FAILED`;
- `VALIDATED` or `VALIDATION_FAILED` after application schema validation;
- a redacted model-output copy only for validation failure.

The ledger never records the API key, prompt payload, or reasoning content.
Failed HTTP 200 responses with empty final content retain usage when the provider
reports it. An interrupted request remains `PENDING`, which is intentionally not
silently converted into success or zero cost.

The API status labels the ledger scope as `AI_EDITORIAL02B_AND_LATER` and reports
historical accounting as `UNKNOWN_NOT_MIGRATED_DO_NOT_INFER_ZERO`. Old attempts
are not synthesized into the new ledger.

Default ignored runtime location:

`<STUDIO_DATA_ROOT>/ai-inference-ledger.jsonl`

It can be overridden with ignored local configuration
`HUGGINGFACE_LEDGER_PATH`.

## Authentication and billing gate

The read-only diagnostic made zero inference requests and confirmed:

- account: `minhtb51107`;
- token display name: `tiktok_automation`;
- fingerprint: `77f11edc536e` (one-way SHA-256 prefix);
- `Qwen/Qwen3-14B` has live provider mappings through DeepInfra and
  Featherless AI;
- routing mode is Hugging Face Routed Requests.

Hugging Face's documented endpoints used here do not expose the current credit
balance or an authoritative request ledger. The user previously reported a
dashboard balance, but it is not a current machine-verifiable balance. The
historical project usage remains a range rather than an exact total. Therefore
the explicit task rule requires stopping before inference.

## Source and selection gate

The intended real capture remains `gnrtth / DeI-TuzEc_9`. The reference set is:

- `DeJDn2kCT-g`
- `DeJMMM6k4fW`
- `DeJby5QI9d6`
- `DeJOhgZgauo`

These IDs exist in the saved collection as contexts observed on the target page.
They are not parent-verified. The reference file is evaluation material, not a
user approval record.

The recovery runner no longer writes an `ACCEPT` decision from this reference.
It now requires an existing explicit feedback record with decision `ACCEPT`, an
exact revision, and exactly these selected IDs before one Qwen Script request can
be made. The general acceptance runner stores the reference as
`REFERENCE_ONLY_NOT_USER_APPROVAL` and does not create a reviewed proposal.

The source-only material is approximately 1,202 characters / 276 estimator
tokens, producing a non-authoritative 58–80 second estimate at speed 1.3. It is
plausible material for a 65–90 second edit, but it is not a complete AI Script
and not measured audio.

## Mock acceptance

The mock path verifies:

- valid QUOTE/PARAPHRASE source IDs only;
- COMMENTARY remains unattributed original commentary;
- invalid or missing Script sections fail with `AI_SCRIPT_SCHEMA_INVALID`;
- an invalid proposal is not persisted;
- schema failure is reported to the inference ledger with the sanitized output;
- feedback revision and production approval remain isolated.

## Validation

- Targeted Jest: 4 suites / 39 tests PASS.
- Backend build: PASS.
- Read-only Hugging Face identity/model metadata diagnostic: PASS, 0 inference.
- New Qwen Script request: NOT RUN.
- TTS/render/crawler/publishing: NOT RUN by scope.

## Required next authorization

To complete LIVE Script acceptance, grant a new budget independent of the
unreconstructable historical attempts. A sufficient bounded authorization is:

- exactly one `Qwen/Qwen3-14B` request;
- maximum 2,048 output tokens;
- maximum USD 0.05;
- no retry and no model/provider fallback;
- the four-source selection explicitly confirmed for DRAFT editorial use, while
  remaining unverified as parent relationships.

On success, the result must still pass source-ID/schema validation and the final
text estimator must report 65–90 seconds. Otherwise the outcome remains PARTIAL.
