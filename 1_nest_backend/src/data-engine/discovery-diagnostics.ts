/** Fixed diagnostic labels only: never persist raw errors, tokens or paging URLs. */
export type DiscoveryOutcome = 'ACCESS_EMPTY' | 'RESOURCE_GUARD_STOP' |
  'PARSER_FAILURE' | 'NO_RESULTS' | 'RATE_LIMIT' | 'UNKNOWN' | 'RESULTS';

export function discoveryFailure(error: unknown): DiscoveryOutcome {
  const e = error as {message?: string; kind?: string; httpStatus?: number};
  const code = typeof e?.message === 'string' ? e.message : '';
  if (/RESOURCE_BELOW|RESOURCE_GUARD/.test(code)) return 'RESOURCE_GUARD_STOP';
  if (e?.kind === 'RATE_LIMITED' || e?.httpStatus === 429 || /HTTP_429/.test(code)) return 'RATE_LIMIT';
  if (e?.kind === 'INVALID_RESPONSE' || /CONVERSATION_PARSER_FAILURE/.test(code)) return 'PARSER_FAILURE';
  if (/CONVERSATION_NO_RESULTS/.test(code)) return 'NO_RESULTS';
  if (/CONVERSATION_ACCESS_EMPTY|ACCESS_BLOCKED|HTTP_40[13]/.test(code) || ['BLOCKED_AUTH','BLOCKED_PERMISSION'].includes(e?.kind ?? '')) return 'ACCESS_EMPTY';
  // NO_PUBLIC_CANDIDATES alone cannot distinguish an empty page, changed DOM or access wall.
  return 'UNKNOWN';
}

/** An empty API result is real, but its cause and public scope are not proven. */
export function inspectSearchPage(page: unknown) {
  const p = page as {data?: unknown; paging?: {cursors?: {after?: unknown}; next?: unknown}};
  if (!Array.isArray(p?.data)) return {outcome:'PARSER_FAILURE' as DiscoveryOutcome,count:null,paging:'UNKNOWN',publicAccess:'UNKNOWN',reason:'INVALID_DATA_ARRAY'};
  const cursor = p.paging?.cursors?.after;
  const continuationObserved = typeof cursor === 'string' && !!cursor || typeof p.paging?.next === 'string' && !!p.paging.next;
  return {outcome:(p.data.length ? 'RESULTS':'ACCESS_EMPTY') as DiscoveryOutcome,count:p.data.length,
    paging:continuationObserved?'CONTINUATION_OBSERVED':'NOT_PRESENT', publicAccess:'UNKNOWN',
    reason:p.data.length?'ROWS_RECEIVED_PUBLIC_SCOPE_NOT_INFERRED':'EMPTY_RESPONSE_CAUSE_UNDETERMINED'};
}

/** No page text/HTML leaves this structural probe. Absence of DOM cards is not proof of no results. */
export function inspectPublicDiscovery(input:{cards:number; permalinkAnchors:number; candidates:number; explicitNoResults:boolean}):DiscoveryOutcome {
  if(input.candidates>0)return 'RESULTS';
  if(input.explicitNoResults)return 'NO_RESULTS';
  if(input.cards>0&&input.permalinkAnchors>0)return 'PARSER_FAILURE';
  return 'UNKNOWN';
}

/** Preserve a swallowed extractor stop even if partial root metadata survived. */
export function extractionStop(diagnostics:Array<{code:string;message:string}>) {
  if(diagnostics.some(d=>d.code==='RESOURCE_BELOW_384MIB'))return 'CONVERSATION_RESOURCE_BELOW_384MIB';
  if(diagnostics.some(d=>d.message==='Navigation HTTP 429'))return 'CONVERSATION_HTTP_429';
  if(diagnostics.some(d=>d.message==='Public access requires login; no login attempted'||d.message==='Public access protection encountered; stopped without bypass'))return 'CONVERSATION_ACCESS_BLOCKED';
  if(diagnostics.some(d=>/^Navigation HTTP (401|403)$/.test(d.message)))return 'CONVERSATION_ACCESS_BLOCKED';
  return null;
}
