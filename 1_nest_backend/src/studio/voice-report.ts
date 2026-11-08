import type { StudioSession } from './studio.contracts';
import type { StageReport } from './stage-report';
import { VOICE_SPEED } from './voice-settings';
export function voiceReport(s: StudioSession): StageReport {
  const jobs = s.voiceJobs || [],
    assets = s.voiceAssets || [];
  const latest = jobs[jobs.length - 1];
  return {
    projectId: s.project.id,
    sessionId: s.id,
    stageName: 'VOICE',
    runId: latest?.assetId || 'voice-not-generated',
    status:
      s.voiceRuntime?.status === 'BLOCKED_RUNTIME'
        ? 'BLOCKED_RUNTIME'
        : latest?.status === 'ERROR'
          ? 'ERROR'
          : s.items.some((i) => i.selected) &&
              s.items
                .filter((i) => i.selected)
                .every((i) =>
                  assets.some(
                    (a) => a.itemId === i.id && a.status === 'APPROVED',
                  ),
                )
            ? 'READY'
            : jobs.length
              ? 'PARTIAL'
              : 'NOT_RUN',
    startedAt: latest?.startedAt || null,
    completedAt: latest?.completedAt || null,
    elapsedMs: latest?.elapsedMs ?? null,
    inputSummary: `${s.items.filter((i) => i.selected).length} selected scenes. DRAFT preview may use unapproved text; export approval remains explicit.`,
    outputSummary: `${assets.length} audio manifest entries; assets retained even when stale`,
    counts: {
      scenes: s.items.filter((i) => i.selected).length,
      generated: assets.filter((a) => a.status === 'GENERATED').length,
      approved: assets.filter((a) => a.status === 'APPROVED').length,
      stale: assets.filter((a) => a.status === 'STALE').length,
      errors: jobs.filter((j) => j.status === 'ERROR').length,
    },
    warnings: [...(s.voiceRuntime?.blockers||[]),...(s.voiceRuntime?.warnings||[])],
    errors: jobs.flatMap((j) => (j.error ? [j.error] : [])),
    artifacts: assets.map((a) => ({ id: a.id, kind: 'session-scoped-audio' })),
    revision: s.revision,
    metrics: {
      networkCost: 0,
      currency: null,
      browserNavigations: 0,
      domCandidates: 0,
      attemptElapsedMs: jobs.reduce((n, j) => n + j.elapsedMs, 0),
    },
    sources: [],
    unresolvedTargets: [],
    voice: {
      runtime: s.voiceRuntime || null,
      items: s.items
        .filter((i) => i.selected)
        .map((i) => ({
          itemId: i.id,
          revision: i.revision,
          spokenText: i.spokenText,
          spokenApproval: i.spokenApproval || null,
          settings: i.voiceSettings || {
            voice: null,
            speed: VOICE_SPEED.default,
          },
          audio: assets
            .filter((a) => a.itemId === i.id)
            .map(({ filePath, ...a }) => a),
          jobs: jobs.filter((j) => j.itemId === i.id),
        })),
    },
  };
}
