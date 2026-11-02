import type { StudioSession } from './studio.contracts';
import type { StageReport } from './stage-report';
import {
  qualityCases,
  offlineNormalize,
  realQualityCases,
} from './offline-normalization';
export function scriptReport(s: StudioSession): StageReport {
  const runs = s.scriptProposals || [];
  const latest = runs[runs.length - 1];
  const latency = runs.reduce((n, r) => n + r.latencyMs, 0);
  return {
    projectId: s.project.id,
    sessionId: s.id,
    stageName: 'SCRIPT',
    runId: latest?.runId || 'not-run',
    status: s.aiBillingBlocked
      ? 'BLOCKED_BILLING'
      : !latest
        ? 'NOT_RUN'
        : latest.error
          ? 'ERROR'
          : latest.approval === 'PENDING'
            ? 'PARTIAL'
            : 'READY',
    startedAt: latest?.startedAt || null,
    completedAt: latest?.completedAt || null,
    elapsedMs: latest?.latencyMs ?? null,
    inputSummary: `${s.items.filter((i) => i.selected).length} selected items; AI runs only on explicit request`,
    outputSummary: `${runs.length} proposals; no automatic application`,
    counts: {
      proposals: runs.length,
      accepted: runs.filter((r) => r.approval === 'ACCEPTED').length,
      rejected: runs.filter((r) => r.approval === 'REJECTED').length,
      pending: runs.filter((r) => r.approval === 'PENDING').length,
      errors: runs.filter((r) => r.error).length,
    },
    warnings: [...new Set(runs.flatMap((r) => r.warnings))],
    errors: runs.flatMap((r) => (r.error ? [r.error] : [])),
    artifacts: [{ id: s.id, kind: 'local-session-script-proposals' }],
    revision: s.revision,
    metrics: {
      networkCost: null,
      currency: null,
      browserNavigations: 0,
      domCandidates: 0,
      attemptElapsedMs: latency,
    },
    sources: [],
    unresolvedTargets: [],
    script: runs.map((r) => structuredClone(r)),
    normalizationQuality: {
      mode: 'OFFLINE',
      cases: qualityCases(),
      realTargetCases: realQualityCases(),
      liveComparisons: runs
        .filter((r) => r.mode === 'LIVE')
        .map((r) => {
          const item = s.items.find((i) => i.id === r.itemId);
          const expected =
            realQualityCases().find((c) => item?.sourceUrl.includes(c.targetId))
              ?.expected || null;
          const canon = (x: string) => x.replace(/\s+/g, ' ').trim();
          return {
            runId: r.runId,
            executionStatus: r.executionStatus,
            expected,
            actual: r.proposedSpokenText,
            expectedMatch:
              expected && r.proposedSpokenText
                ? canon(expected) === canon(r.proposedSpokenText)
                : null,
            semanticDrift:
              r.approval === 'ACCEPTED' ? 'USER_APPROVED' : 'NOT_REVIEWED',
            verdict:
              r.executionStatus === 'BLOCKED_BILLING'
                ? 'BLOCKED_BILLING'
                : r.executionStatus === 'SUCCESS' && r.approval === 'ACCEPTED'
                  ? 'LIVE_APPROVED'
                  : 'NOT_LIVE_PASS',
          };
        }),
      selectedItems: s.items
        .filter((i) => i.selected)
        .map((i) => {
          const p = offlineNormalize(i);
          return {
            itemId: i.id,
            input: i.spokenText,
            actual: p.proposedSpokenText,
            ambiguities: p.ambiguousTerms,
            labels: p.labels,
            semanticDrift: 'REQUIRES_HUMAN_REVIEW',
          };
        }),
    },
    scriptItems: s.items
      .filter((i) => i.selected)
      .sort((a, b) => a.order - b.order)
      .map((i) => ({
        itemId: i.id,
        order: i.order,
        originalText: i.originalText,
        displayText: i.displayText,
        spokenText: i.spokenText,
        revision: i.revision,
        manualLocks: [...i.manualLocks],
      })),
  };
}
