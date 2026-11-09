# INTEGRATION-03 — Isolated real-data acceptance

Verified 2026-11-05 (Asia/Saigon), integration branch only. Result: **PASS for
isolated acceptance; GO for a separately authorized limited real-store rollout**.
This report does not grant production mutation, crawling, inference or publishing.

## Handoff review

- Verified clean integration HEAD `e0d7c94`, remote/upstream and its ten changed
  files. Original source branches remain `90451cf` and `66b8d59`, clean.
- Retained Claude's checkpoint 6 work. Existing ignored browser report really
  contains 38 passing checks. Its UI/backend/controller/persistence paths are real;
  the crawler source is synthetic. One exception-path case intercepts an API
  response. It is not evidence of live Threads extraction or real-data acceptance.
- Explicit ACCEPT/enqueue separation, canonical ID mapping, UNKNOWN confirmation,
  revision conflicts and durable DATA-03 behavior were retained.
- Found limitations: synthetic=false alone was treated as REAL; Dashboard still
  hardcoded REAL DATA; Editor had no equivalent origin badge. QUALIFIED without
  a user decision was omitted from a state-only pending count. Opening Voice
  automatically submitted preflight, which writes a job/session revision even
  though it does not synthesize. The old synthetic test server did not technically
  block every outbound/write path; its tests established which paths were used,
  not that all other paths were impossible.

## Minimal fixes

- REAL requires explicit `synthetic=false`, recognized extraction identity
  evidence and matching canonical source ID. Synthetic marker takes precedence;
  missing, contradictory or mixed evidence is UNKNOWN. No automatic REAL fallback.
- Added derived catalog provenance counts/review summary; no persisted migration,
  scoring, filter or state-machine algorithm changed. Unreviewed automatic
  QUALIFIED remains pending human review. Raw target type remains UNKNOWN.
- Dashboard, shell, catalog cards and Editor use the same source-origin rules.
  Project origin is resolved by exact catalog identity; connection status and
  review/production approval remain separate concepts.
- Voice preflight is explicit, not a workspace-mount effect. Editor mount remains
  read-only; Save still explicitly prepares preview under existing operations.
- Gold evaluation profile is separate from discovery topic, so existing ALL-profile
  snapshots can be inspected without crawling/re-evaluating.
- Visual review found a green "ready" Inspector fallback despite UNKNOWN. Now
  actual review flags are surfaced, and absence of UI blockers never substitutes
  for user ACCEPT. Added visible canonical source links for all catalog cards.

REAL here describes persisted identity evidence from earlier extraction. It is
not a new online verification of source content, its factual truth, rights,
post-versus-reply type or production approval.

## Isolation and preservation

`test/integration03-snapshot.cjs` creates fresh, uniquely named acceptance copies.
Only DATA-01 contract records, one existing reference session, its session-owned
audio/media/local avatars and referenced public media are copied. Copy hashes are
verified. `.env`, OAuth vault, Threads API runtime, credentials and local Kokoro
configuration are excluded. Credential-like JSON keys fail the copy closed.

The test server CWD is a new external sandbox under `Tiktok_Automation_acceptance`;
no live-store junction is used. Dependency/runtime code remains in the integration
worktree. The server strips inherited credentials, only accepts GET/HEAD, rejects
OAuth mutation paths and disables outbound HTTP/fetch. Browser interception also
blocks remote requests and aborts unexpected mutations. No scheduler/worker starts.

Final evidence run (ignored/private artifacts):
`1_nest_backend/.studio-data/reports/integration03/20261105-8464be24-4cf7-41c8-b93f-6df455067b0e`.

| Preservation | Result |
|---|---|
| Original runtime files inspected | 933 |
| Copied files including referenced assets/frontend | 73 |
| Production differences / removed / added | 0 / 0 / 0 |
| Sandbox runtime differences / removed / added | 0 / 0 / 0 |
| Locked/unreadable/unverified files | 0; all three historically locked logs readable this time |

Production manifest SHA-256, identical before and after:
`96d93e97679f691f31130593a8d578f47a912625d213aff5d165f4d9ebac8d9c`.

Sandbox runtime manifest SHA-256, identical before and after:
`6f8f8de953f9ab5b2819dbf88936459452db41536c1f31952ee6748bbb015dcc`.

No old snapshot was overwritten or deleted. The first test attempt hit `/studio`
500 before UI load because Express sendFile rejected a sandbox under hidden
`.studio-data`. The sandbox was relocated outside hidden paths, preserving that
attempt. A later visual correction was verified in another fresh copy. All source
runtime manifests remained identical across attempts.

## Evidence and limits

| Check | Result |
|---|---|
| Exact stored catalog / original content / author / canonical permalink | 9/9 real posts, actual backend and exact copied JSON |
| UNKNOWN type preserved | 9/9, no active default POST/COMMENT selection |
| Gold V1/V2, bucket, processing version and breakdown | 9/9 persisted snapshots, no recomputation |
| Pending review count | 9 throughout catalog, navigation and Dashboard |
| ACCEPT / QUEUED / production jobs created | 0 / 0 / 0 |
| Voice/Editor page-open writes, prepare or preflight jobs | 0 |
| Outbound server requests / mutating browser requests | 0 / 0 |
| Browser acceptance | 17/17 PASS: 13 real-copy checks + 4 explicitly labelled UI response-override cases |
| SYNTHETIC/UNKNOWN Dashboard and Editor variants | UI response overrides only, backed by independent provenance unit tests; not new real-source records |
| Frontend/backend TypeScript, backend build, Studio bundle | PASS, exit 0 |
| Offline Jest | 35 suites / 221 tests PASS; focused regression also 4 suites / 20 tests PASS |
| Browser JavaScript errors / unexpected local HTTP errors | 0 / 0 |

The nine real posts have nine distinct authors. Same-author/different-post safety
is covered by retained synthetic E2E and current shared-identity regression, not a
nonexistent pair fabricated in this real dataset. This dataset occupies one page:
next/previous correctly disabled; API page 1 remains empty with total 9. >25 real
record pagination is not claimed tested.

Remote avatar/media requests were deliberately blocked. The five reference scenes
reuse copied local avatars/media; remote-only media completeness is PARTIAL, with
no new download or source substitution. No live crawl, production token, OAuth,
TTS, render, publishing or production write was used to establish acceptance.

RAM observations: 594 MiB available before browser, 537 MiB during Editor, 625 MiB
before browser close and 1,137 MiB afterward. These are samples, not continuous
peak-memory figures. Browser-driver RSS was 49–62 MiB, not total Chromium/Nest RAM.
Browser runs started only after build/test completion; test server and one browser
were the acceptance workers. Brief early compiler/check overlaps were corrected;
subsequent heavy reruns were serialized. Runtime 3101 was stopped after verification.

## Reproduction and next gate

From the integration backend, with existing dependencies/browser and current build:
1. `node test/integration03-snapshot.cjs` — keep the printed run path.
2. `node test/integration03-readonly-runtime.cjs <run>/isolation.json`.
3. `node test/integration03-browser.cjs <run>` — one browser only.
4. Stop the test server; `node test/integration03-snapshot.cjs verify <run>`.

GO means the integrated UI can be considered for an explicit controlled rollout;
the original live store has not been connected to this server. No original branch
is merged. With this PASS, the next proposed step is one separately approved
One-Click discovery run limited to **one post**. That LIVE run was not executed.
