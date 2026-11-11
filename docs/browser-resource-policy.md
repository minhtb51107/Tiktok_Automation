# Threads browser resource policy v2 — OFFLINE checkpoint

Branch: codex/browser-resource-policy, based on 69d39fb. No Threads API requests,
Chromium launch, crawler LIVE, TTS, render or publishing in this checkpoint.

## Audit and change

Old discovery visit and controlled exact-root extractor used freemem() <384 MiB
as a preflight ban/emergency condition. Commit reserve was not measured. Discovery
started its interval after launch, so cold-start had a monitoring gap. Cleanup
called browser.close() without a bounded verification of descendants; swallowed
close errors could conceal incomplete shutdown. The exact extractor also opened
a second tab beside Chromium's initial blank tab.

The existing TTS policy and approved MEDIA-NARRATION-03 render runner use physical
256 MiB / commit reserve 512 MiB emergency floors. The older generic render
runner has a different guard; this checkpoint does not change render or TTS.

New browser policy has one source of truth in browser-resource-policy.ts:

| Condition | Result |
| --- | --- |
| Available physical RAM <384 MiB | Advisory only; not a cold-start prohibition |
| Available physical RAM <256 MiB | RESOURCE_GUARD_STOP_PHYSICAL |
| System commit reserve <512 MiB | RESOURCE_GUARD_STOP_COMMIT |
| Exactly 256 physical / 512 commit | Emergency threshold not crossed |
| Missing/invalid native measurements or heartbeat stale >2 seconds | Measurement failure, stop rather than run unmonitored |
| Operation deadline | TIMEOUT, not a memory/OOM claim |

These are protective operating limits, not benchmarked minimum requirements or
proof that 256 MiB is sufficient. No floor is lowered based on one short result.
Warnings, minima, commit reserve, sampled process-tree RSS/private bytes, stop
code and cleanup proof are reported separately. RSS sums may double-count shared
pages; sampled peaks are not guaranteed instantaneous peaks. Windows OOM evidence
remains null; neither a guard stop, process exit nor an error containing OOM is
labelled Windows OOM. No Windows Event Log evidence is collected here.

## Owned lifecycle and safety

- Monitoring starts before launch. A small existing-Python native observer uses
  GlobalMemoryStatusEx/PSAPI, not Torch, psutil, PowerShell polling or a new model.
  It has an OS-only environment; no credentials, command lines or cookies leave
  this boundary. An unavailable observer is an explicit monitoring blocker,
  not a RAM minimum. There is no unmonitored fallback.
- One browser lifecycle per Node process. Studio's existing exclusive-operation
  and local-probe-lease gates remain unchanged. The planned standalone pilot
  checks competing workers and acquires only its own leases. No TTS/render is
  started or stopped by this policy.
- Native observer accepts only fresh Chrome/Edge children of its actual owner
  process. It validates current parent identity and creation time, discovers the
  descendant chain and retains process handles. Cleanup uses those captured
  handles, not taskkill, a process-name wildcard or an arbitrary PID. A reused PID
  cannot redirect a retained handle to another process. Pre-existing siblings
  are excluded. Test-only Node fixtures require an explicit helper test flag;
  normal collectors never set it.
- Puppeteer receives an abort signal and an operation deadline. Native emergency
  monitoring runs independently every ~250 ms. It can close only its captured
  owned processes, including retained descendants after their parent exits.
  Owner exit/native deadline also invokes cleanup.
- Normal cleanup first permits up to 3 seconds of graceful browser.close(), then
  asks the native guardian to close/verify captured survivors. A false or missing
  cleanup acknowledgement blocks subsequent browser launches in that Node
  process; no success or automatic retry is reported. Observer shutdown is
  bounded and its exit checked. An OS-level hang remains a reported cleanup
  blocker requiring inspection; no unrelated process is terminated to recover.
- Both discovery and exact-root extraction reuse the initial blank tab and retain
  existing request/domain/navigation/access-protection limits. Commit/physical
  thresholds are not weakened when transitioning to extraction. Exact extractor
  diagnostics and resource reports propagate to enrichment, including null
  request counts where telemetry is unavailable; null never means zero.

Existing sessions, raw captures, locks and previous attempt artifacts are not
rewritten. Historical consumed pilot scripts/data retain their original 384 MiB
settings as historical evidence; they are not the new entrypoint and must not be
rerun. Legacy ScraperService workflows remain unchanged and inactive. No new
scheduler/automation or startup worker is installed.

## Offline verification and limits

Boundary/unit tests demonstrate that 377/300/256 MiB are advisory/allowed when
commit reserve is sufficient; 255.99 physical or 511.99 commit stops. Tests cover
pre-launch failure, late launch/deadline cancellation, single lifecycle, stale or
failed measurements, cleanup reporting and fail-closed replacement prevention.

Native Windows integration uses only locally spawned Node process fixtures:
guardian force-closes our live parent/grandchild, while a sibling created before
the guardian remains alive and cannot be adopted as an owned root. No browser or
network is used. The sibling is stopped afterwards only by its test owner.

An initial orphan test expected a grandchild to survive child.kill(). On this
host it exited with its parent before cleanup, so that assertion failed. A
read-only diagnostic confirmed both were already gone, with no guardian forced
PIDs. The corrected real test verifies forced cleanup while the owned tree is
alive. A lingering orphan after root exit is tested with a simulated monitor;
forced orphan cleanup under actual Chromium remains LIVE-unproven. No failure
was relabelled browser LIVE PASS.

No new claim is made about discovery success, DOM availability, parent-reply
evidence or quality on real Threads. Previous discovery-access-02 is consumed.

Validation: related offline regression **4 suites / 58 tests PASS**, including
17 resource-policy/lifecycle cases and the native Windows process fixture, run
sequentially with 320 MiB heap/isolated ts-jest. Backend TypeScript/build, frontend
TypeScript, independent typecheck of the new spec, Python AST and runner syntax
checks: all exit 0. Full Jest was not rerun in this checkpoint. No test diagnostics
were suppressed in the separate TypeScript checks.

Preservation: **933/933** production baseline files still match size and SHA-256;
zero changed/unreadable. Baseline manifest hash:
`e19574bf84fc07c88a165aa3958f50e579a93c289b6aeef2c0664c1f35a6c1e7`.
Verification artifact stays ignored in backend
`.studio-data/reports/browser-resource-policy/preservation.json`. No Python
observer was left running after tests. Existing Studio runtimes were not
restarted or repointed; this code applies when the new branch's collector is
loaded, not retroactively to a process serving an older worktree bundle.

## Prepared browser-only pilot — approval REQUIRED, NOT RUN

Entrypoint: backend `scripts/browser-policy-live01.cjs`. Running without `run`
prints PLAN only. It requires a new explicit approval recorded for
browser-policy-live01 and a fresh single-use attempt file before any live call.
No API client, .env, OAuth vault or credentials are loaded.

Proposed scope:

1. Recheck physical RAM, system commit, pagefile observations and competing
   workers. If below emergency floors or unmeasurable, stop; no browser launch.
   Below 384 alone produces an advisory, not rejection. No other app is killed.
2. One public search page: https://www.threads.com/search?q=c%C3%B4ng+vi%E1%BB%87c .
   One browser worker/tab, one scroll, max five canonical candidates, 30-second
   discovery deadline and existing 150 request / four navigation visit limits.
3. If successful, enrich at most two roots from those candidates, sequentially:
   exact-root extraction <=20 seconds, relationship visit <=30 seconds, at most
   two scrolls and 20 verified replies/root. No URL substitution or parent
   inference from DOM order/author. Observations stay separately labelled.
4. Overall budget 180 seconds checked between operations; each in-flight visit
   has the stated deadline, native monitoring and bounded cleanup. No retry or
   extra query if empty, blocked, timed out or resource-stopped. Stop on login,
   CAPTCHA, access restriction or rate limit; no bypass.
5. Persist full captures, media references, resource reports and provenance in
   the existing ignored reports sandbox. Run quality evaluation offline. Report
   actual roots, observed/verified replies and candidate material without
   approval, project creation, TTS, render or publishing.

Default PLAN and syntax checking are not LIVE attempts. Do not create approval
or attempt files until the user separately approves this scope. Any future LIVE
result must be reported independently from the offline tests above.
