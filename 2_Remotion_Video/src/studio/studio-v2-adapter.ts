import type { StudioSession } from "../../../1_nest_backend/src/studio/studio.contracts";
import type { StudioJob } from "../../../1_nest_backend/src/studio/progress";
import type { RenderManifest } from "../../../1_nest_backend/src/studio/render.types";
import type { LibraryAsset } from "../../../1_nest_backend/src/studio/public-assets";
import { spokenAmbiguities } from "../../../1_nest_backend/src/studio/voice-settings";

/**
 * Studio V2 Telemetry & Autopilot Adapter.
 * Derives 100% real metrics from persisted StudioSession, StudioJob[], and RenderManifest[],
 * and provides clearly marked [SIMULATED / CONTRACT PREVIEW] data ONLY for future backend
 * pipeline features (Scheduled Discovery, Medallion Bronze/Silver/Gold Quarantine, Presets).
 */

export interface MedallionItem {
  id: string;
  itemIndex: number;
  author: string;
  handle: string;
  sourceUrl: string;
  tier: "GOLD" | "SILVER" | "BRONZE" | "QUARANTINE";
  qualityScore: number;
  selected: boolean;
  inclusion: string;
  wordCount: number;
  charCount: number;
  hasAvatar: boolean;
  spokenApproved: boolean;
  audioStatus: "APPROVED" | "DRAFT" | "STALE" | "MISSING";
  audioDurationSec: number | null;
  ambiguities: string[];
  proposalStatus: string;
  rejectionOrReviewReasons: string[];
  duplicateGroupId: string | null;
  revision: number;
  manualLocks: string[];
  originalText: string;
  displayText: string;
  spokenText: string;
  topic: string | null;
}

export interface DuplicateCluster {
  groupId: string;
  reason: string;
  itemIds: string[];
  canonicalId: string;
}

export interface DiscoverySchedulePreview {
  id: string;
  queryOrSource: string;
  category: string;
  cadence: string;
  rateLimit: string;
  lastRunStatus: string;
  simulated: true;
}

export function computeMedallionItems(session: StudioSession | null): {
  items: MedallionItem[];
  duplicates: DuplicateCluster[];
  counts: { gold: number; silver: number; bronze: number; quarantine: number };
} {
  if (!session) {
    return {
      items: [],
      duplicates: [],
      counts: { gold: 0, silver: 0, bronze: 0, quarantine: 0 },
    };
  }

  // Group near-duplicates by normalized text prefix or canonical URL
  const urlBuckets = new Map<string, string[]>();
  const textBuckets = new Map<string, string[]>();
  for (const item of session.items) {
    const uKey = (item.sourceUrl || "").trim().toLowerCase().replace(/\/$/, "");
    if (uKey) {
      urlBuckets.set(uKey, [...(urlBuckets.get(uKey) || []), item.id]);
    }
    const tKey = item.originalText.trim().toLowerCase().slice(0, 80);
    if (tKey.length > 20) {
      textBuckets.set(tKey, [...(textBuckets.get(tKey) || []), item.id]);
    }
  }

  const duplicates: DuplicateCluster[] = [];
  const itemDupMap = new Map<string, string>();
  let dupCounter = 1;

  for (const [url, ids] of urlBuckets.entries()) {
    if (ids.length > 1) {
      const gid = `DUP-URL-${dupCounter++}`;
      duplicates.push({
        groupId: gid,
        reason: `Identical source URL (${url.slice(0, 48)})`,
        itemIds: ids,
        canonicalId: ids[0],
      });
      ids.forEach((id) => itemDupMap.set(id, gid));
    }
  }
  for (const [, ids] of textBuckets.entries()) {
    if (ids.length > 1 && !ids.every((id) => itemDupMap.has(id))) {
      const gid = `DUP-TXT-${dupCounter++}`;
      duplicates.push({
        groupId: gid,
        reason: "Matching opening text fingerprint (80 chars)",
        itemIds: ids,
        canonicalId: ids[0],
      });
      ids.forEach((id) => itemDupMap.set(id, gid));
    }
  }

  const items: MedallionItem[] = session.items.map((item, idx) => {
    const words = item.spokenText.trim().split(/\s+/).filter(Boolean);
    const ambiguities = spokenAmbiguities(item.spokenText);
    const proposal = session.scriptProposals
      ?.filter((p) => p.itemId === item.id)
      .slice(-1)[0];
    const allAmb = Array.from(
      new Set([
        ...ambiguities,
        ...(proposal?.ambiguousTerms.map((a) => `${a.term} (${a.reason})`) || []),
      ]),
    );

    const assets =
      session.voiceAssets?.filter((a) => a.itemId === item.id) || [];
    const currentAsset = assets
      .slice()
      .reverse()
      .find(
        (a) =>
          a.status !== "STALE" &&
          a.voice === item.voiceSettings?.voice &&
          a.speed === item.voiceSettings?.speed &&
          a.spokenText === item.spokenText,
      );

    const audioStatus: MedallionItem["audioStatus"] = !currentAsset
      ? assets.length
        ? "STALE"
        : "MISSING"
      : currentAsset.status === "APPROVED"
        ? "APPROVED"
        : "DRAFT";

    const reasons: string[] = [];
    let score = 100;

    if (!item.metadata?.handle && !item.author.handle) {
      score -= 10;
      reasons.push("Missing verified @handle");
    }
    if (!item.metadata?.avatar && !session.sourceImages?.[item.id]) {
      score -= 8;
      reasons.push("Avatar uncached or missing");
    }
    if (words.length < 6) {
      score -= 25;
      reasons.push(`Very short post (${words.length} words)`);
    }
    if (allAmb.length > 0) {
      score -= 18 * Math.min(2, allAmb.length);
      reasons.push(`Ambiguous/slang terms: ${allAmb.join(", ")}`);
    }
    if (!item.spokenApproval?.valid) {
      score -= 12;
      reasons.push("Spoken text not yet approved (DRAFT)");
    }
    if (audioStatus === "MISSING" || audioStatus === "STALE") {
      score -= 15;
      reasons.push(
        audioStatus === "STALE"
          ? "Audio stale after text/voice change"
          : "No narration generated",
      );
    }
    const dupGroup = itemDupMap.get(item.id) || null;
    if (dupGroup) {
      score -= 30;
      reasons.push(`Duplicate cluster ${dupGroup}`);
    }

    score = Math.max(10, Math.min(100, score));

    let tier: MedallionItem["tier"] = "BRONZE";
    if (dupGroup || words.length < 4 || proposal?.approval === "REJECTED") {
      tier = "QUARANTINE";
    } else if (
      item.selected &&
      allAmb.length === 0 &&
      (audioStatus === "APPROVED" || audioStatus === "DRAFT") &&
      score >= 76
    ) {
      tier = "GOLD";
    } else if (item.selected || score >= 65) {
      tier = "SILVER";
    } else {
      tier = "BRONZE";
    }

    return {
      id: item.id,
      itemIndex: idx + 1,
      author: item.author.displayName || item.metadata?.author || "Unknown",
      handle: item.metadata?.handle || item.author.handle || "unknown",
      sourceUrl: item.sourceUrl,
      tier,
      qualityScore: score,
      selected: item.selected,
      inclusion: item.inclusion || "TARGET",
      wordCount: words.length,
      charCount: item.spokenText.length,
      hasAvatar: Boolean(item.metadata?.avatar || session.sourceImages?.[item.id]),
      spokenApproved: Boolean(item.spokenApproval?.valid),
      audioStatus,
      audioDurationSec: currentAsset ? currentAsset.durationMs / 1000 : null,
      ambiguities: allAmb,
      proposalStatus: proposal
        ? `${proposal.mode || "LIVE"} · ${proposal.approval}`
        : "NO_PROPOSAL",
      rejectionOrReviewReasons: reasons,
      duplicateGroupId: dupGroup,
      revision: item.revision,
      manualLocks: item.manualLocks,
      originalText: item.originalText,
      displayText: item.displayText,
      spokenText: item.spokenText,
      topic: item.contentMapping?.topic ?? item.metadata?.topic ?? null,
    };
  });

  const counts = {
    gold: items.filter((i) => i.tier === "GOLD").length,
    silver: items.filter((i) => i.tier === "SILVER").length,
    bronze: items.filter((i) => i.tier === "BRONZE").length,
    quarantine: items.filter((i) => i.tier === "QUARANTINE").length,
  };

  return { items, duplicates, counts };
}

export const SIMULATED_DISCOVERY_SCHEDULES: DiscoverySchedulePreview[] = [
  {
    id: "sched-01",
    queryOrSource: "threads.com/tag/cong-viec-tphcm",
    category: "SERIOUS · Career & Labor",
    cadence: "Manual only (Startup auto-scrape OFF)",
    rateLimit: "Max 5 URLs / batch · Loopback Chrome",
    lastRunStatus: "STANDBY",
    simulated: true,
  },
  {
    id: "sched-02",
    queryOrSource: "threads.com/tag/kinh-te-vi-mo",
    category: "SERIOUS · Finance & Economy",
    cadence: "Manual only (Startup auto-scrape OFF)",
    rateLimit: "Max 5 URLs / batch · Loopback Chrome",
    lastRunStatus: "STANDBY",
    simulated: true,
  },
];

export interface StudioHealthSummary {
  totalSessions: number;
  activeSessionTitle: string;
  activeRevision: number;
  collectedCount: number;
  qualifiedCount: number;
  quarantineCount: number;
  narrationReadyCount: number;
  completedRendersCount: number;
  runningJobsCount: number;
  failedJobsCount: number;
  attentionItemsCount: number;
  kokoroStatus: string;
  kokoroDevice: string;
  publishingGate: string;
}

export function buildHealthSummary(
  sessionsCount: number,
  session: StudioSession | null,
  jobs: StudioJob[],
  renders: RenderManifest[],
): StudioHealthSummary {
  const medallion = computeMedallionItems(session);
  const selected = session?.items.filter((i) => i.selected) || [];
  const narrationReady = medallion.items.filter(
    (i) => i.selected && (i.audioStatus === "DRAFT" || i.audioStatus === "APPROVED"),
  ).length;
  const completedRenders = renders.filter((r) => r.status === "COMPLETED").length;
  const runningJobs = jobs.filter((j) =>
    ["QUEUED", "RUNNING"].includes(j.status),
  ).length;
  const failedJobs = jobs.filter((j) => j.status === "FAILED").length;
  const attention =
    medallion.items.filter((i) => i.ambiguities.length > 0).length +
    failedJobs +
    (session?.errors.length || 0);

  return {
    totalSessions: sessionsCount,
    activeSessionTitle: session?.title || "No active session",
    activeRevision: session?.revision ?? 0,
    collectedCount: session?.items.length ?? 0,
    qualifiedCount: medallion.counts.gold + medallion.counts.silver,
    quarantineCount: medallion.counts.quarantine,
    narrationReadyCount: `${narrationReady}/${selected.length}` as unknown as number,
    completedRendersCount: completedRenders,
    runningJobsCount: runningJobs,
    failedJobsCount: failedJobs,
    attentionItemsCount: attention,
    kokoroStatus: session?.voiceRuntime?.status || "READY_ON_DEMAND",
    kokoroDevice: session?.voiceRuntime?.device || "cpu / local",
    publishingGate: "BLOCKED_SAFETY_GATE",
  };
}

export function formatBytes(bytes?: number | null): string {
  if (!bytes || bytes <= 0) return "—";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

export type PublicAssetSummary = {
  total: number;
  byCategory: Record<string, number>;
};

export function summarizePublicAssets(assets: LibraryAsset[]): PublicAssetSummary {
  const byCategory: Record<string, number> = {};
  for (const a of assets) {
    byCategory[a.category] = (byCategory[a.category] || 0) + 1;
  }
  return { total: assets.length, byCategory };
}
