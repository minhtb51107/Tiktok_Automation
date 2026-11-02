import type { StudioSession } from "../../../1_nest_backend/src/studio/studio.contracts";
import type { LibraryAsset } from "../../../1_nest_backend/src/studio/public-assets";
import { spokenAmbiguities } from "../../../1_nest_backend/src/studio/voice-settings";

/**
 * Studio V2/V3 Data & Telemetry Adapter.
 *
 * Strictly distinguishes:
 * - REAL DATA: Persisted in `.studio-data` (StudioSession, RenderManifest, and `/api/studio/data` DATA-01 engine).
 * - NEEDS REVIEW: Real items requiring explicit human confirmation (e.g. DATA-01 `UNKNOWN` entity type or ambiguous terms).
 * - NOT CONNECTED: Backend endpoint unavailable or not yet imported.
 * - MOCK DATA: Explicitly labelled contract previews in Settings only (never shown as live dashboard metrics).
 */

export type DataProvenanceBadge =
  | "REAL DATA"
  | "NEEDS REVIEW"
  | "NOT CONNECTED"
  | "MOCK DATA";

export interface Data01CatalogRow {
  id: string;
  sourcePostId: string | null;
  sourceUrl: string | null;
  author: {
    name: string | null;
    handle: string | null;
    avatarUrl: string | null;
  };
  bodyPreview: string;
  state:
    | "DISCOVERED"
    | "VALIDATED"
    | "ELIGIBLE"
    | "SCORED"
    | "QUALIFIED"
    | "QUEUED"
    | "REJECTED"
    | "QUARANTINED"
    | "FAILED";
  score: number | null;
  labels: string[];
  duplicate: {
    postId: string;
    bronzeId: string;
    evaluationId: string;
    kind: "EXACT" | "NEAR";
    similarity: number;
  } | null;
  quarantine: string[];
  observations: number;
  revision: number;
}

export interface Data01CatalogResponse {
  schemaVersion: string;
  workflow: string;
  total: number;
  observations: number;
  matching: number;
  page: number;
  pageSize: number;
  counts: Record<string, number>;
  qualifiedRatio: number | null;
  ratioMeaning: string;
  precisionAt10: {
    status: string;
    value: number | null;
    reason: string;
  };
  rows: Data01CatalogRow[];
  runs: Array<{
    id: string;
    status: "RUNNING" | "COMPLETED" | "FAILED";
    cursor: number;
    inputCount?: number;
    elapsedMs: number;
    startedAt: string;
    completedAt: string | null;
    error: string | null;
  }>;
}

export interface MedallionItem {
  id: string;
  data01PostId: string | null;
  sourcePostId: string | null;
  itemIndex: number;
  author: string;
  handle: string;
  avatarUrl: string | null;
  sourceUrl: string;
  /**
   * Honest evaluation status from DATA-01 when connected, or session review state.
   * Never fabricates "Gold/Silver" approval when DATA-01 requires human review.
   */
  evaluationStatus:
    | "NEEDS_REVIEW"
    | "QUALIFIED"
    | "QUEUED"
    | "REJECTED"
    | "QUARANTINED"
    | "NOT_CONNECTED";
  data01State: string;
  provenanceBadge: DataProvenanceBadge;
  /** Experimental rule points from DATA-01 (not measured quality percentage) */
  ruleScore: number | null;
  data01Labels: string[];
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
  reviewReasons: string[];
  duplicateGroupId: string | null;
  revision: number;
  data01Revision: number | null;
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

function extractPostShortcode(url?: string | null): string | null {
  if (!url) return null;
  const m = url.match(/\/post\/([A-Za-z0-9_-]+)/);
  return m ? m[1] : null;
}

export async function fetchData01Catalog(): Promise<{
  connected: boolean;
  catalog: Data01CatalogResponse | null;
  error?: string;
}> {
  try {
    const res = await fetch("/api/studio/data?page=0");
    if (!res.ok) {
      return {
        connected: false,
        catalog: null,
        error: `HTTP ${res.status}`,
      };
    }
    const json = await res.json();
    const data = (json.data ?? json) as Data01CatalogResponse;
    if (!data || typeof data.total !== "number" || !Array.isArray(data.rows)) {
      return {
        connected: false,
        catalog: null,
        error: "Invalid DATA-01 response format",
      };
    }
    return { connected: true, catalog: data };
  } catch (err) {
    return {
      connected: false,
      catalog: null,
      error: (err as Error).message,
    };
  }
}

export function computeMedallionItems(
  session: StudioSession | null,
  data01Catalog?: Data01CatalogResponse | null,
  data01Connected = false,
): {
  items: MedallionItem[];
  duplicates: DuplicateCluster[];
  counts: {
    total: number;
    bronzeObservations: number;
    silverValidated: number;
    goldScored: number;
    needsReview: number;
    qualified: number;
    queued: number;
    quarantine: number;
  };
  dataProvenance: DataProvenanceBadge;
} {
  if (!session) {
    return {
      items: [],
      duplicates: [],
      counts: {
        total: 0,
        bronzeObservations: 0,
        silverValidated: 0,
        goldScored: 0,
        needsReview: 0,
        qualified: 0,
        queued: 0,
        quarantine: 0,
      },
      dataProvenance: data01Connected ? "REAL DATA" : "NOT CONNECTED",
    };
  }

  // Index DATA-01 rows by shortcode or handle
  const rowsByShortcode = new Map<string, Data01CatalogRow>();
  const rowsByHandle = new Map<string, Data01CatalogRow>();
  if (data01Catalog?.rows) {
    for (const r of data01Catalog.rows) {
      if (r.sourcePostId) rowsByShortcode.set(r.sourcePostId, r);
      const code = extractPostShortcode(r.sourceUrl);
      if (code) rowsByShortcode.set(code, r);
      if (r.author?.handle) {
        rowsByHandle.set(r.author.handle.replace(/^@/, "").toLowerCase(), r);
      }
    }
  }

  const duplicates: DuplicateCluster[] = [];
  const itemDupMap = new Map<string, string>();

  const items: MedallionItem[] = session.items.map((item, idx) => {
    const words = item.spokenText.trim().split(/\s+/).filter(Boolean);
    const ambiguities = spokenAmbiguities(item.spokenText);
    const proposal = session.scriptProposals
      ?.filter((p) => p.itemId === item.id)
      .slice(-1)[0];
    const allAmb = Array.from(
      new Set([
        ...ambiguities,
        ...(proposal?.ambiguousTerms.map((a) => `${a.term} (${a.reason})`) ||
          []),
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

    const handleRaw =
      item.metadata?.handle || item.author.handle || item.author.displayName || "unknown";
    const cleanHandle = handleRaw.replace(/^@/, "");
    const shortcode = extractPostShortcode(item.sourceUrl);

    const matchedRow =
      (shortcode ? rowsByShortcode.get(shortcode) : undefined) ||
      rowsByHandle.get(cleanHandle.toLowerCase()) ||
      null;

    const reasons: string[] = [];
    let evaluationStatus: MedallionItem["evaluationStatus"] = "NEEDS_REVIEW";
    let provenanceBadge: DataProvenanceBadge = "NEEDS REVIEW";
    let data01State = "NOT_IMPORTED";
    let ruleScore: number | null = null;
    let data01Labels: string[] = [];

    if (data01Connected && matchedRow) {
      data01State = matchedRow.state;
      ruleScore = matchedRow.score;
      data01Labels = matchedRow.labels || [];

      if (matchedRow.state === "QUARANTINED" || matchedRow.quarantine.length > 0) {
        evaluationStatus = "QUARANTINED";
        provenanceBadge = "NEEDS REVIEW";
        reasons.push(...matchedRow.quarantine);
      } else if (matchedRow.state === "QUEUED") {
        evaluationStatus = "QUEUED";
        provenanceBadge = "REAL DATA";
      } else if (matchedRow.state === "QUALIFIED") {
        evaluationStatus = "QUALIFIED";
        provenanceBadge = "REAL DATA";
      } else if (matchedRow.state === "REJECTED") {
        evaluationStatus = "REJECTED";
        provenanceBadge = "REAL DATA";
      } else {
        // SCORED / DISCOVERED / VALIDATED with NEEDS_REVIEW label
        evaluationStatus = "NEEDS_REVIEW";
        provenanceBadge = "NEEDS REVIEW";
        reasons.push(
          "Cần xác nhận loại thực thể (Bài đăng POST hay Bình luận COMMENT)",
        );
        if (data01Labels.includes("POLICY_RISK")) {
          reasons.push("DATA-01 phát hiện từ viết tắt / tiếng lóng cần người duyệt");
        }
      }

      if (matchedRow.duplicate) {
        const gid = `DUP-${matchedRow.duplicate.postId.slice(0, 6)}`;
        itemDupMap.set(item.id, gid);
        reasons.push(`Trùng lặp (${matchedRow.duplicate.kind})`);
      }
    } else if (!data01Connected) {
      evaluationStatus = "NOT_CONNECTED";
      provenanceBadge = "NOT CONNECTED";
      data01State = "API_NOT_CONNECTED";
      reasons.push("Chưa kết nối dữ liệu đánh giá từ API DATA-01 (/api/studio/data)");
    } else {
      evaluationStatus = "NEEDS_REVIEW";
      provenanceBadge = "NEEDS REVIEW";
      data01State = "UNIMPORTED_SESSION_ITEM";
      reasons.push("Bài viết chưa được import vào bộ đánh giá DATA-01");
    }

    if (allAmb.length > 0) {
      reasons.push(`Từ ngữ/số cần kiểm tra khi đọc: ${allAmb.join(", ")}`);
    }
    if (!item.spokenApproval?.valid) {
      reasons.push("Kịch bản đọc (spokenText) đang ở bản nháp DRAFT");
    }

    const localAvatar =
      session.sourceImages?.[item.id]?.uri || item.metadata?.avatar || null;

    return {
      id: item.id,
      data01PostId: matchedRow?.id ?? null,
      sourcePostId: matchedRow?.sourcePostId ?? shortcode,
      itemIndex: idx + 1,
      author: item.author.displayName || item.metadata?.author || cleanHandle,
      handle: cleanHandle,
      avatarUrl: localAvatar,
      sourceUrl: item.sourceUrl,
      evaluationStatus,
      data01State,
      provenanceBadge,
      ruleScore,
      data01Labels,
      selected: item.selected,
      inclusion: item.inclusion || "TARGET",
      wordCount: words.length,
      charCount: item.spokenText.length,
      hasAvatar: Boolean(localAvatar || item.metadata?.avatar),
      spokenApproved: Boolean(item.spokenApproval?.valid),
      audioStatus,
      audioDurationSec: currentAsset ? currentAsset.durationMs / 1000 : null,
      ambiguities: allAmb,
      proposalStatus: proposal
        ? `${proposal.mode || "LIVE"} · ${proposal.approval}`
        : "NO_PROPOSAL",
      reviewReasons: reasons,
      duplicateGroupId: itemDupMap.get(item.id) || null,
      revision: item.revision,
      data01Revision: matchedRow?.revision ?? null,
      manualLocks: item.manualLocks,
      originalText: item.originalText,
      displayText: item.displayText,
      spokenText: item.spokenText,
      topic: item.contentMapping?.topic ?? item.metadata?.topic ?? null,
    };
  });

  const total = data01Catalog?.total ?? items.length;
  const bronzeObservations = data01Catalog?.observations ?? items.length;
  const quarantine = items.filter((i) => i.evaluationStatus === "QUARANTINED").length;
  const silverValidated = data01Connected ? Math.max(0, total - quarantine) : 0;
  const goldScored = data01Connected
    ? (data01Catalog?.counts?.SCORED ?? 0) +
      (data01Catalog?.counts?.QUALIFIED ?? 0) +
      (data01Catalog?.counts?.QUEUED ?? 0)
    : 0;
  const needsReview = items.filter(
    (i) => i.evaluationStatus === "NEEDS_REVIEW" || i.evaluationStatus === "NOT_CONNECTED",
  ).length;
  const qualified = items.filter((i) => i.evaluationStatus === "QUALIFIED").length;
  const queued = items.filter((i) => i.evaluationStatus === "QUEUED").length;

  return {
    items,
    duplicates,
    counts: {
      total,
      bronzeObservations,
      silverValidated,
      goldScored,
      needsReview,
      qualified,
      queued,
      quarantine,
    },
    dataProvenance: data01Connected ? "REAL DATA" : "NOT CONNECTED",
  };
}

export const SIMULATED_DISCOVERY_SCHEDULES: DiscoverySchedulePreview[] = [
  {
    id: "sched-01",
    queryOrSource: "threads.com/tag/cong-viec-tphcm",
    category: "SERIOUS · Career & Labor",
    cadence: "Thủ công (Tắt tự động quét khi khởi động)",
    rateLimit: "Tối đa 5 URL / lượt · Trình duyệt cục bộ",
    lastRunStatus: "STANDBY",
    simulated: true,
  },
  {
    id: "sched-02",
    queryOrSource: "threads.com/tag/kinh-te-vi-mo",
    category: "SERIOUS · Finance & Economy",
    cadence: "Thủ công (Tắt tự động quét khi khởi động)",
    rateLimit: "Tối đa 5 URL / lượt · Trình duyệt cục bộ",
    lastRunStatus: "STANDBY",
    simulated: true,
  },
];

export function formatBytes(bytes?: number | null): string {
  if (!bytes || bytes <= 0) return "—";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
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
