import type { StudioSession } from './studio.contracts';
import {analyzeSourceCardsV2,cleanSourceProjection} from './source-quality';
export type StageName =
  | 'SOURCE'
  | 'SCRIPT'
  | 'VOICE'
  | 'EDITOR'
  | 'RENDER'
  | 'PUBLISH';
export interface StageReport {
  imageNarration?:Array<{itemId:string;records:unknown[];applied:boolean}>;
  sourceCards?: Array<{role:'ROOT'|'CONTEXT';author:string;permalink:string|null;originalText:string;displayText:string|null;spokenText:string|null;selected:boolean;materialized:boolean;relationship:string;evidence:unknown;media:unknown[];quality:unknown;warnings:string[]}>;
  timing?: {crawlMs:number;studioImportMs:number|null;reportMs:number|null};
  voice?: {
    runtime: import('./voice.types').VoiceRuntime | null;
    items: unknown[];
  };
  normalizationQuality?: unknown;
  scriptItems?: {
    itemId: string;
    order: number;
    originalText: string;
    displayText: string;
    spokenText: string;
    revision: number;
    manualLocks: string[];
  }[];
  reportGenerationElapsedMs?: number;
  script?: import('./normalization.types').TextProposal[];
  projectId: string;
  sessionId: string;
  stageName: StageName;
  runId: string;
  status:
    | 'READY'
    | 'PARTIAL'
    | 'ERROR'
    | 'NOT_RUN'
    | 'BLOCKED_BILLING'
    | 'BLOCKED_RUNTIME';
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
    metadataValues?: Record<string, unknown>;
    fieldStates?: Record<string, import('./metadata-fields').ObservedField>;
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
    const item = s.items.find((i) => i.sourceUrl === a.canonicalUrl);
    const meta = item?.metadata || raw;
    return {
      originalUrl: safeUrl(a.originalUrl) || '',
      resolvedUrl: safeUrl(a.resolvedUrl),
      canonicalUrl: safeUrl(a.canonicalUrl),
      matchedTargetId: a.matchedTargetId || null,
      matchMethod: a.matchMethod || 'UNVERIFIED',
      author: raw?.author || null,
      metadataValues: meta
        ? {
            topic:item?.contentMapping?.topic??meta.topic??null,
            bodyText:item?.contentMapping?.bodyText??meta.bodyText??null,
            topicEvidence:item?.contentMapping?.evidence??meta.topicEvidence??null,
            createdAt: meta.createdAt,
            avatar: meta.avatar,
            likeCount: meta.likeCount,
            replyCount: meta.replyCount,
            repostCount: meta.repostCount,
            shareCount: meta.shareCount ?? null,
            media: meta.media,
            observedAt:
              item?.metadataObservations?.slice(-1)[0]?.observedAt ??
              a.retrievedAt,
          }
        : undefined,
      fieldStates: {
        ...Object.fromEntries(
          [
            'likeCount',
            'replyCount',
            'repostCount',
            'shareCount',
            'createdAt',
            'avatar',
            'media',
          ].map((key) => [
            key,
            {
              status: 'UNVERIFIED' as const,
              value: null,
              raw: null,
              source: 'No labelled observation stored for this field',
            },
          ]),
        ),
        ...meta?.fields,
      },
      originalText: raw?.text || null,
      metadataAvailability: {
        text: !!raw?.text,
        handle: !!raw?.handle,
        avatar: !!meta?.avatar,
        createdAt: !!meta?.createdAt,
        media: !!meta?.media.length,
        likeCount: meta?.likeCount != null,
        replyCount: meta?.replyCount != null,
        repostCount: meta?.repostCount != null,
        shareCount: meta?.shareCount != null,
        parent: !!raw?.parentReference,
      },
      mediaReferences:
        meta?.media.map((m) => safeUrl(m.url) || '').filter(Boolean) || [],
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
  const sourceCards: NonNullable<StageReport['sourceCards']>=[];
  for(const a of unique.values()){
    const context=a.contextCandidates||[];
    const images=Object.fromEntries(context.map((raw,n)=>{const item=s.items.find(i=>i.sourceUrl===raw.url),ocr=Object.values(item?.mediaOcr||{}).filter(o=>o.review==='REVIEWED');return [n,{reviewed:ocr.length>0,text:ocr.map(o=>o.correctedText).join('\n')}]}));
    const quality=analyzeSourceCardsV2(context,a.records[0]?.text||'','SERIOUS',images);
    for(const [index,raw] of [...(a.records[0]?[a.records[0]]:[]),...(a.contextCandidates||[])].entries()){
      const url=typeof raw.url==='string'?raw.url:index===0?a.canonicalUrl:null;
      const item=s.items.find(i=>i.sourceUrl===url);
      sourceCards.push({role:index===0?'ROOT':'CONTEXT',author:raw.author,permalink:url,originalText:raw.text,displayText:item?.displayText??null,spokenText:item?.spokenText??null,selected:item?.selected??false,materialized:!!item,relationship:item?.observationEvidence?.level||(index===0?'UNKNOWN':'OBSERVED_ON_TARGET_PAGE'),evidence:item?.observationEvidence||{targetUrl:a.canonicalUrl,observedAt:a.retrievedAt,parentId:null},media:raw.media.map(m=>({...m,url:safeUrl(m.url)})),quality:index===0?cleanSourceProjection(raw):quality[index-1],warnings:['Observed context is not parent verification; rights UNKNOWN.']});
    }
  }
  return {
    sourceCards,
    timing:{crawlMs:attempts.reduce((n,a)=>n+a.elapsedMs,0),studioImportMs:s.sourceRun?.elapsedMs??null,reportMs:null},
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
      observed:sourceCards.length,
      observedContext:sourceCards.filter(c=>c.role==='CONTEXT').length,
      materialized:sourceCards.filter(c=>c.materialized).length,
      excluded:sourceCards.filter(c=>!c.selected).length,
      parentVerified:sourceCards.filter(c=>c.relationship==='PARENT_VERIFIED').length,
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
    ...(r.sourceCards||[]).flatMap((c,i)=>[`## ${c.role} ${i+1} — ${c.author}`,`${c.permalink||'URL UNKNOWN'} | selected=${c.selected} | materialized=${c.materialized} | ${c.relationship}`,'Original text:',c.originalText,`Evidence: ${JSON.stringify(c.evidence)}`,`Media: ${c.media.length} references (see JSON)`,`Quality: ${JSON.stringify(c.quality)}`,...c.warnings,'']),
    '',
    ...r.sources.flatMap((s, i) => [
      `## Target ${i + 1}: ${s.status}`,
      `- Original URL: ${s.originalUrl}`,
      `- Resolved URL: ${s.resolvedUrl ?? 'unavailable'}`,
      `- Canonical URL: ${s.canonicalUrl ?? 'unavailable'}`,
      `- Matched ID: ${s.matchedTargetId ?? 'UNRESOLVED'} (${s.matchMethod})`,
      `- Author: ${s.author ?? 'unavailable'}`,
      `- Metadata availability: ${JSON.stringify(s.metadataAvailability)}`,
      `- Metadata values: ${JSON.stringify(s.metadataValues ?? {})}`,
      `- Field states: ${JSON.stringify(s.fieldStates ?? {})}`,
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
    ...(r.scriptItems || []).flatMap((i) => [
      `## Selected script content ${i.order + 1}`,
      `Item: ${i.itemId} | Revision: ${i.revision} | Locks: ${i.manualLocks.join(', ') || 'none'}`,
      'Original text:',
      ...i.originalText.split('\n').map((l) => '> ' + l),
      'Display text:',
      ...i.displayText.split('\n').map((l) => '> ' + l),
      'Spoken text:',
      ...i.spokenText.split('\n').map((l) => '> ' + l),
      '',
    ]),
    ...(r.script || []).flatMap((p) => [
      `## Script item ${p.itemId}`,
      `Run: ${p.runId} | Approval: ${p.approval} | Provider/model: ${p.provider} / ${p.model}`,
      `Mode: ${p.mode || 'LIVE'} | Execution: ${p.executionStatus || 'unclassified'} | Labels: ${JSON.stringify(p.labels || [])}`,
      ...(p.diagnostic
        ? [`Provider diagnostic (redacted): ${JSON.stringify(p.diagnostic)}`]
        : []),
      `Explicit approval replacing locked text: ${p.explicitLockedTextApproval === true}`,
      'Original text:',
      ...p.originalText.split('\n').map((l) => '> ' + l),
      'AI proposal:',
      ...(p.proposedSpokenText || 'No proposal')
        .split('\n')
        .map((l) => '> ' + l),
      `Changes: ${JSON.stringify(p.changes)}`,
      `Ambiguous terms: ${JSON.stringify(p.ambiguousTerms)}`,
      `Latency: ${p.latencyMs} ms | Token usage: ${JSON.stringify(p.tokenUsage)} | Estimated cost: ${p.estimatedCost ?? 'unavailable'}`,
      `Warnings: ${JSON.stringify(p.warnings)} | Error: ${p.error ?? 'none'}`,
      '',
    ]),
    ...(r.normalizationQuality
      ? [
          '## Normalization quality (OFFLINE; not live AI)',
          JSON.stringify(r.normalizationQuality, null, 2),
        ]
      : []),
    ...(r.voice
      ? [
          '## Voice runtime and scene manifest',
          JSON.stringify(r.voice, null, 2),
        ]
      : []),
    ...(r.imageNarration?.length?['## Image OCR / narration (not publication approval)',JSON.stringify(r.imageNarration,null,2)]:[]),
    `## Warnings / errors`,
    ...r.warnings.concat(r.errors).map((x) => '- ' + x),
    '',
    `Metrics: ${JSON.stringify(r.metrics)}`,
    'Costs: unavailable (not measured).',
    `Artifacts: ${r.artifacts.map((a) => a.kind + ': ' + a.id).join(', ')}`,
  ].join('\n');
}

/** Full bodies, concise metadata; no signed CDN URLs. */
export function sourceQuickMarkdown(r:StageReport){
 return [`# SOURCE quick report`, `Session ${r.sessionId} · revision ${r.revision}`,JSON.stringify(r.counts),`Crawl ${r.timing?.crawlMs??'UNKNOWN'} ms · Studio import ${r.timing?.studioImportMs??'UNKNOWN'} ms · report ${r.reportGenerationElapsedMs??'UNKNOWN'} ms`,...(r.sourceCards||[]).flatMap(c=>[`\n## ${c.role} · ${c.author}`,c.permalink||'URL UNKNOWN',`Selected ${c.selected} · ${c.relationship} · media ${c.media.length}`,c.originalText]),'Parent verification is independent of editorial selection. Rights UNKNOWN.'].join('\n');
}
