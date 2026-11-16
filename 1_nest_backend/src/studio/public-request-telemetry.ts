import { publicResource } from '../modules/core/scraper/public-discovery';

export interface RequestTelemetry {
  interceptionEvents: number;
  admittedRequests: number;
  blockedRequests: number;
  handlingFailures: number;
  coverage: 'INTERCEPTION_DECISIONS_NOT_SERVER_RECEIPTS';
}
export type PublicRequestDecisionReason =
  | 'ADMITTED'
  | 'BLOCKED_UNSUPPORTED_ORIGIN'
  | 'BLOCKED_EVENT_BUDGET'
  | 'BLOCKED_NAVIGATION_BUDGET'
  | 'BLOCKED_HEAVY_RESOURCE';
export interface PublicRequestDecision {
  admitted: boolean;
  reason: PublicRequestDecisionReason;
}

export const newRequestTelemetry = (): RequestTelemetry => ({
  interceptionEvents: 0,
  admittedRequests: 0,
  blockedRequests: 0,
  handlingFailures: 0,
  coverage: 'INTERCEPTION_DECISIONS_NOT_SERVER_RECEIPTS',
});

/** Preserves existing event-based budgets and exposes the exact admission reason. */
export function decidePublicRequestDetailed(
  telemetry: RequestTelemetry,
  url: string,
  kind: string,
  navigations: number,
  limits: { events: number; navigation: number; blockHeavy: boolean },
): PublicRequestDecision {
  telemetry.interceptionEvents++;
  let reason: PublicRequestDecisionReason = 'ADMITTED';
  if (!publicResource(url)) reason = 'BLOCKED_UNSUPPORTED_ORIGIN';
  else if (telemetry.interceptionEvents > limits.events)
    reason = 'BLOCKED_EVENT_BUDGET';
  else if (navigations > limits.navigation)
    reason = 'BLOCKED_NAVIGATION_BUDGET';
  else if (limits.blockHeavy && ['image', 'media', 'font'].includes(kind))
    reason = 'BLOCKED_HEAVY_RESOURCE';
  const admitted = reason === 'ADMITTED';
  if (admitted) telemetry.admittedRequests++;
  else telemetry.blockedRequests++;
  return { admitted, reason };
}

export function decidePublicRequest(
  telemetry: RequestTelemetry,
  url: string,
  kind: string,
  navigations: number,
  limits: { events: number; navigation: number; blockHeavy: boolean },
) {
  return decidePublicRequestDetailed(telemetry, url, kind, navigations, limits)
    .admitted;
}
