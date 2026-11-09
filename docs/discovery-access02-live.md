# discovery-access-02 — authorized single-use LIVE result

Date: 2026-11-09. Parent checkpoint 59c50de, branch
codex/discovery-access-diagnostics. User explicitly approved this attempt only.
**Verdict: BLOCKED_RESOURCE / PARTIAL API diagnosis. No LIVE collection success.**

## Actual execution

The consumed attempt is stored in the existing ignored backend reports directory
`discovery-access-02/attempt.json`. It cannot be rerun by the supplied script.
There was no retry, credential refresh, production write, TTS, render, scheduler,
upload or publishing. No replay or synthetic post replaced missing live data.

| Stage | Actual result |
| --- | --- |
| Token debug | HTTP 200, valid, correct app-bound OAuth exchange receipt |
| Granted scopes | threads_basic, threads_keyword_search |
| Token expiry | 2027-01-01T19:17:09Z |
| công việc / TOP / KEYWORD / limit 2 | HTTP 200, data=[] |
| công việc / RECENT / KEYWORD / limit 2 | HTTP 200, data=[] |
| gia đình / TOP / KEYWORD / limit 2 | HTTP 200, data=[] |
| gia đình / RECENT / KEYWORD / limit 2 | HTTP 200, data=[] |
| Paging | Absent on all four pages; sixth request not used |
| Browser | One launch; resource stop before search page navigation |
| Root / replies / parent-verified | 0 / 0 / 0 collected |
| New >=60-second candidates | 0; quality/duplicate ratio/precision NOT MEASURED |

All four exact sanitized search response files contain only `{"data":[]}`.
No API 401/403/429, field-validation error or network error was observed. These
successful empty responses establish ACCESS_EMPTY, not global NO_RESULTS or
advanced-access approval/denial. The known standard/advanced-access distinction
remains a plausible cause; this attempt cannot isolate it from actual query
coverage because no known own-post control was available. No account content was
created to manufacture a control.

The browser root process launched, but the 250 ms resource guard observed
available RAM 377.078 MiB, below the unchanged 384 MiB floor. It closed the owned
browser before the patched launch returned a usable browser to the collector.
Thus page.goto was not reached: zero collector search-page navigations, zero
public-visit audit events, zero exact-root/media HTTPS calls. The launch footprint
is real; DOM/parser availability, login/CAPTCHA state and public search content
remain NOT TESTED. This is RESOURCE_GUARD_STOP, not evidence of Windows OOM.

## Resource evidence

- Initial read-only audit before preparation: available 575.10 MiB, system commit
  19,894.47 / 28,593.83 MiB, no Kokoro/render/collector worker detected.
- OS spot check after build: approximately 693 MiB available.
- Runner's own audit snapshot: available 453.19 MiB; conditions were still above
  the configured floor. RAM fluctuated; these snapshots are not a peak benchmark.
- Runtime minimum (250 ms Node samples): **377.078 MiB**.
- Seven read-only Windows native monitor samples (one second interval).
- Peak sampled owned-browser process-tree summed RSS: **265.01 MiB**.
- Peak sampled summed private bytes: **120.10 MiB**.
- Peak sampled system commit: **20,084.44 MiB**; minimum sampled commit reserve:
  **8,509.39 MiB**. This was physical-memory pressure, not commit exhaustion.
- Monitor itself used approximately 16–18 MiB RSS. OS available-RAM measurements
  include that observer; shared pages can be counted in multiple process RSSs.
  These sampled maxima are not guaranteed instantaneous peaks.
- End-to-end attempted API/browser phase: **7,932 ms**, excludes initial audit.
- Available after closing browser: **670.90 MiB**.

Seven browser-tree PIDs were observed; all seven were absent in the post-run
existence check. Monitor exited, both project leases were released. No external
process was terminated and Windows/pagefile configuration was not changed.

## Root–reply provenance

No root was retrieved, so the relationship parser was not reached. Zero collected
replies does not mean either keyword or any thread has no replies. No observed
card was relabelled parent-verified. Existing exact-root/JSON-LD chain rules are
unchanged. The current token has no threads_read_replies scope; this attempt did
not request a new scope, add an API reply adapter or infer native-ID mappings.

## Artifacts and preservation

Local-only path: backend `.studio-data/reports/discovery-access-02/`:

- `before.json`, `attempt.json`, `checkpoint.json`, `report.json`.
- `api-page-0.json` through `api-page-3.json`: full sanitized empty responses.
- `memory.ndjson`, `exit-verification.json`, `preservation.json`.
- `candidates.json` and `collections.json`: empty arrays, not fabricated content.

No credentials, OAuth vault or session was copied into this sandbox. Token vault
was read via the existing app-bound auth logic only; no production status save or
refresh occurred. Production: **933/933** baseline files matched size and SHA-256,
zero changed/unreadable. Manifest SHA-256:
`e19574bf84fc07c88a165aa3958f50e579a93c289b6aeef2c0664c1f35a6c1e7`.
Existing Studios on 3110/3111 remained HTTP 200 without restart.

## Implementation and verification

`discovery-access02-pilot.cjs` records a single-use attempt, sequential API calls,
explicit phase budgets, existing auth-receipt fallback for introspection lacking
app_id, isolated storage and owned-browser cleanup. Default mode prints PLAN
without network. `discovery-memory.py` reuses the existing native memory helper;
it reads Windows process-tree memory without Torch, psutil or termination.
Discovery accepts an optional validated result cap (default six unchanged), so
the pilot can enforce the approved five-browser-candidate limit.

Backend build exit 0, runner JS syntax and Python AST checks passed before LIVE.
No new model or dependency was installed. Offline regression results are recorded
below separately; they do not establish live Threads collection success.

Post-run offline regression: **4 suites / 55 tests PASS**, exit 0, runInBand with
320 MiB heap. Includes bounded discovery argument rejection before browser launch,
source selection, parent evidence and official API persistence/error tests.
Full Jest was not rerun in this pilot checkpoint (the parent checkpoint had
45 suites / 319 tests); that old total is not claimed as current validation.
`git diff --check` and script syntax checks passed. No frontend changes.

## Next decision — no automatic additional attempt

Do not rerun this consumed pilot. Before another explicitly authorized attempt,
the user can free memory or authorize stopping identified unused project runtimes.
Those runtimes are heavily paged out, so their actual reclaimable RAM may be small.
Do not lower the guard from this measurement. A separate host with sufficient
headroom is another option, not automatically provisioned or paid for here.

For the API, inspect actual Meta Dashboard keyword-search access level/App Review
state and, if available, test a known own-post query as a future authorized control.
Four empty responses alone do not prove scope coverage. Until either route returns
new posts, there is no ranked live content list or >=60-second material to review.
