import type { StudioSession } from './studio.contracts';
export type StageName =
  | 'SOURCE'
  | 'SCRIPT'
  | 'VOICE'
  | 'EDITOR'
  | 'RENDER'
  | 'PUBLISH';
export interface StageReport {
  projectId: string;
  sessionId: string;
  stageName: StageName;
  runId: string;
  status: 'READY' | 'PARTIAL' | 'ERROR' | 'NOT_RUN';
  startedAt: string | null;
  completedAt: string | null;
  elapsedMs: number | null;
  inputSummary: string;
  outputSummary: string;
  counts: Record<string, number>;
  warnings: string[];
  errors: string[];
  artifacts: { id: string; kind: string }[];
  revision: number;
  metrics: {
    networkCost: number | null;
    currency: string | null;
    browserNavigations: number | null;
    domCandidates: number | null;
    attemptElapsedMs: number;
  };
  sources: {
    originalUrl: string;
    resolvedUrl: string | null;
    canonicalUrl: string | null;
    matchedTargetId: string | null;
    matchMethod: string;
    author: string | null;
    originalText: string | null;
    metadataAvailability: Record<string, boolean>;
    mediaReferences: string[];
    excludedContextCount: number;
    excludedReason: string;
    status: string;
  }[];
  unresolvedTargets: string[];
}
const safeUrl = (value: string | null) => {
  if (!value) return null;
  try {
    const u = new URL(value);
    u.search = '';
    u.hash = '';
    return u.href;
  } catch {
    return null;
  }
};
export function sourceReport(s: StudioSession): StageReport {
  const attempts = s.attempts || [];
  const unique = new Map<string, (typeof attempts)[number]>();
  for (const a of attempts) unique.set(a.canonicalUrl || a.originalUrl, a);
  const sources = [...unique.values()].map((a) => {
    const raw = a.matchedTargetId ? a.records[0] : undefined;
    return {
      originalUrl: safeUrl(a.originalUrl) || '',
      resolvedUrl: safeUrl(a.resolvedUrl),
      canonicalUrl: safeUrl(a.canonicalUrl),
      matchedTargetId: a.matchedTargetId || null,
      matchMethod: a.matchMethod || 'UNVERIFIED',
      author: raw?.author || null,
      originalText: raw?.text || null,
      metadataAvailability: {
        text: !!raw?.text,
        handle: !!raw?.handle,
        avatar: !!raw?.avatar,
        createdAt: !!raw?.createdAt,
        media: !!raw?.media.length,
        likeCount: raw?.likeCount != null,
        replyCount: raw?.replyCount != null,
        repostCount: raw?.repostCount != null,
        parent: !!raw?.parentReference,
      },
      mediaReferences:
        raw?.media.map((m) => safeUrl(m.url) || '').filter(Boolean) || [],
      excludedContextCount:
        a.contextCandidates?.filter(
          (c) => !s.items.some((i) => i.sourceUrl === c.url),
        ).length ?? Math.max(0, a.records.length - 1),
      excludedReason:
        'Non-target permalink or unverified context; not explicitly added to project content.',
      status: a.matchedTargetId ? a.status : 'UNRESOLVED',
    };
  });
  const unresolved = sources
    .filter((x) => !x.matchedTargetId)
    .map((x) => x.originalUrl);
  return {
    projectId: s.project.id,
    sessionId: s.id,
    stageName: 'SOURCE',
    runId: s.sourceRun?.runId || 'not-run',
    status: !attempts.length
      ? 'NOT_RUN'
      : unresolved.length
        ? 'ERROR'
        : sources.some((x) => x.status === 'PARTIAL')
          ? 'PARTIAL'
          : 'READY',
    startedAt: s.sourceRun?.startedAt || null,
    completedAt: s.sourceRun?.completedAt || null,
    elapsedMs: s.sourceRun?.elapsedMs ?? null,
    inputSummary: `${attempts.length} input URLs; scope ${s.scope || 'TARGET_ONLY'}`,
    outputSummary: `${s.items.length} project items, ${s.items.filter((i) => i.selected).length} selected; originals and manual changes stored separately`,
    counts: {
      inputUrls: attempts.length,
      distinctTargets: sources.length,
      resolvedTargets: sources.filter((x) => x.matchedTargetId).length,
      unresolvedTargets: unresolved.length,
      excludedContext: sources.reduce((n, x) => n + x.excludedContextCount, 0),
      projectItems: s.items.length,
      selected: s.items.filter((i) => i.selected).length,
    },
    warnings: [
      ...new Set(
        attempts.flatMap((a) =>
          a.diagnostics
            .filter((d) => d.code !== 'RESOLVED' && d.code !== 'DOM_FOUND')
            .map((d) => d.stage + ': ' + d.code),
        ),
      ),
    ],
    errors: unresolved.map((u) => 'Unresolved exact target: ' + u),
    artifacts: [
      { id: s.id, kind: 'local-session' },
      { id: 'source-attempts', kind: 'persisted-public-extraction' },
    ],
    revision: s.revision,
    metrics: {
      networkCost: null,
      currency: null,
      browserNavigations: attempts.every(
        (a) => a.browserNavigations !== undefined,
      )
        ? attempts.reduce((n, a) => n + a.browserNavigations!, 0)
        : null,
      domCandidates: attempts.every((a) => a.domCandidates !== undefined)
        ? attempts.reduce((n, a) => n + a.domCandidates!, 0)
        : null,
      attemptElapsedMs: attempts.reduce((n, a) => n + a.elapsedMs, 0),
    },
    sources,
    unresolvedTargets: unresolved,
  };
}
export function reportMarkdown(r: StageReport): string {
  return [
    `# ${r.stageName} Stage Report`,
    `Session: ${r.sessionId} | Project: ${r.projectId}`,
    `Run: ${r.runId} | Revision: ${r.revision} | Status: ${r.status}`,
    `Started: ${r.startedAt ?? 'unavailable'} | Completed: ${r.completedAt ?? 'unavailable'} | Elapsed: ${r.elapsedMs ?? 'unavailable'} ms`,
    '',
    r.inputSummary,
    r.outputSummary,
    '',
    ...Object.entries(r.counts).map(([k, v]) => `- ${k}: ${v}`),
    '',
    ...r.sources.flatMap((s, i) => [
      `## Target ${i + 1}: ${s.status}`,
      `- Original URL: ${s.originalUrl}`,
      `- Resolved URL: ${s.resolvedUrl ?? 'unavailable'}`,
      `- Canonical URL: ${s.canonicalUrl ?? 'unavailable'}`,
      `- Matched ID: ${s.matchedTargetId ?? 'UNRESOLVED'} (${s.matchMethod})`,
      `- Author: ${s.author ?? 'unavailable'}`,
      `- Metadata availability: ${JSON.stringify(s.metadataAvailability)}`,
      `- Excluded context: ${s.excludedContextCount}; ${s.excludedReason}`,
      '',
      'Original text:',
      ...(s.originalText || 'unavailable')
        .split('\n')
        .map((line) => '> ' + line),
      '',
      ...s.mediaReferences.map((u) => `- Media: ${u}`),
      '',
    ]),
    `## Warnings / errors`,
    ...r.warnings.concat(r.errors).map((x) => '- ' + x),
    '',
    `Metrics: ${JSON.stringify(r.metrics)}`,
    'Costs: unavailable (not measured).',
    `Artifacts: ${r.artifacts.map((a) => a.kind + ': ' + a.id).join(', ')}`,
  ].join('\n');
}
