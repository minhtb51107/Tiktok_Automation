import { matchCatalogIdentity, canonicalTarget, pendingReviewCount, combinedProvenance, sourceProvenance, type SourceProvenance } from "../../../1_nest_backend/src/data-engine/studio-integration";
import type { StudioSession } from "../../../1_nest_backend/src/studio/studio.contracts";
import type { LibraryAsset } from "../../../1_nest_backend/src/studio/public-assets";
import { spokenAmbiguities } from "../../../1_nest_backend/src/studio/voice-settings";

/**
 * Studio V2/V3 Data & Telemetry Adapter.
 *
 * Strictly distinguishes:
 * - REAL: explicit non-synthetic marker plus verified canonical source identity.
 * - SYNTHETIC / UNKNOWN: explicit test data, or source evidence unavailable/mixed.
 * - NOT CONNECTED: Backend endpoint unavailable or not yet imported.
 * Source origin is independent of review/approval. Legacy badge strings remain type-compatible.
 */

export type DataProvenanceBadge =
  | "REAL" | "SYNTHETIC" | "UNKNOWN"
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
  /** True when the stored observation is labelled synthetic/mock; never shown as REAL DATA. */
  synthetic?: boolean;
  provenance?: SourceProvenance;
}

export interface Data01CatalogResponse {
  provenanceCounts?:Record<SourceProvenance,number>;
  reviewSummary?:{pending:number;accepted:number;rejected:number;quarantined:number};
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

export interface Data01Transition {
  at: string;
  from: string | null;
  to: string;
  inputHash: string;
  version: string;
  outcome: "OK" | "ERROR";
  reason: string;
  error: string | null;
}

export interface Data01ScoreBreakdownItem {
  value: number;
  weight: number;
  contribution: number;
  reason: string;
}

export interface Data01PostDetailResponse {
  post: {
    id: string;
    ordinal: number;
    sourcePostId: string | null;
    sourceUrl: string | null;
    observations: string[];
    evaluationIds: string[];
    currentBronzeId: string;
    currentEvaluationId: string | null;
  };
  bronze: {
    provenance?:{synthetic?:boolean;identityEvidence?:string};
    id: string;
    postId: string;
    sourcePlatform: string;
    sourcePostId: string | null;
    sourceUrl: string | null;
    author: {
      name: string | null;
      handle: string | null;
      avatarUrl: string | null;
    };
    originalBody: string | null;
    topic: string | null;
    itemType: "POST" | "COMMENT" | "UNKNOWN";
    publishedAt: string | null;
    fetchedAt: string | null;
    engagement: {
      likes: number | null;
      replies: number | null;
      reposts: number | null;
      shares: number | null;
    };
    fetch: {
      source: string;
      query: string | null;
    };
  } | null;
  evaluation: {
    id: string;
    postId: string;
    bronzeId: string;
    revision: number;
    state: string;
    asOf: string;
    silver: {
      status: "VALIDATED" | "QUARANTINED";
      normalized: {
        body: string;
        topic: string | null;
        bodySource: string;
        sourceUrl: string | null;
        itemType: "POST" | "COMMENT" | "UNKNOWN";
      };
      language: {
        code: string;
        method: string;
        evidence: string[];
      };
      flags: string[];
      quarantineReasons: string[];
    } | null;
    gold: {
      eligibility: "ELIGIBLE" | "NEEDS_REVIEW" | "REJECTED";
      labels: string[];
      reasons: string[];
      score: number;
      breakdown: Record<string, Data01ScoreBreakdownItem>;
      selectionReasons: string[];
      queueState: "NOT_QUEUED" | "WAITING_MANUAL_PRODUCTION";
    } | null;
    transitions: Data01Transition[];
    review: {
      decision: "ACCEPT" | "REJECT" | "NEEDS_REVIEW";
      reason: string;
      at: string;
      confirmedType: "POST" | "COMMENT" | null;
    } | null;
    queue: {
      id: string;
      workflow: string;
      mode: string;
      rightsStatus: string;
      at: string;
    } | null;
  } | null;
  observationCount: number;
}

export interface ThreadsAuthStatusResponse {
  config: {
    environmentFile: string;
    present: {
      THREADS_APP_ID: boolean;
      THREADS_APP_SECRET: boolean;
      THREADS_ACCESS_TOKEN: boolean;
      THREADS_REDIRECT_URI: boolean;
    };
    redirectValid: boolean;
    oauthStatus: "CONFIGURED_NOT_AUTHORIZED" | "BLOCKED_AUTH" | string;
    requestedScopes: string[];
  };
  status:
    | "READY"
    | "BLOCKED_AUTH"
    | "BLOCKED_PERMISSION"
    | "RATE_LIMITED"
    | "FAILED";
  reason: string;
  scopes: string[];
  missingScopes?: string[];
  expiresAt: number | null;
  checkedAt?: string;
  appBindingVerified?: boolean;
  tokenSource?: string;
}

export interface ThreadsCollectorRunItem {
  id: string;
  execution: "LIVE" | "MOCK";
  input: {
    keywords: string[];
    searchType: "TOP" | "RECENT";
    perKeyword: number;
    maxRequests: number;
    maxRunMs: number;
    requestId: string;
  };
  status: string;
  stage: string;
  startedAt: string;
  completedAt: string | null;
  deadlineAt?: number;
  queryIndex?: number;
  counts?: number[];
  cursor?: string | null;
  inFlight?: string | null;
  requestAttempts: number;
  responsesReceived: number;
  newPosts: number;
  sourceDuplicates: number;
  returned: number;
  imported: number;
  dataStates: Record<string, number>;
  reviewReasons: Record<string, number>;
  items?: Array<{
    postId: string;
    sourceUrl: string | null;
    author: string | null;
    state: string;
    score: number | null;
    reasons: string[];
  }>;
  errors: string[];
  warnings: string[];
  cooldownUntil?: number;
  metrics?: {
    elapsedMs: number;
    observedPeakProcessRssBytes?: number;
    cpuUserMicros?: number;
    cpuSystemMicros?: number;
    storedPageBytes?: number;
  };
}

export interface ThreadsSchedulerStatus {
  enabled: boolean;
  paused: boolean;
  intervalMs: number;
  minimumInventory: number;
  reviewBacklogLimit: number;
  keywords: string[];
  searchType: "TOP" | "RECENT";
  perKeyword: number;
  maxRequests: number;
  maxRunMs: number;
  nextCheckAt: number;
  lastRunId: string | null;
  blockedReason: string | null;
}

export interface ReviewBlockerSignal {
  code: string;
  title: string;
  hint: string;
  severity: "warning" | "danger" | "info";
}

export interface MedallionItem {
  sessionItemId?:string|null;
  identityVerified?:boolean;
  id: string;
  data01PostId: string | null;
  sourcePostId: string | null;
  itemIndex: number;
  author: string;
  handle: string;
  avatarUrl: string | null;
  sourceUrl: string;
  publishedAt: string | null;
  entityType: "POST" | "COMMENT" | "UNKNOWN";
  likesCount: number | null;
  repliesCount: number | null;
  repostsCount: number | null;
  sharesCount: number | null;
  /**
   * Honest evaluation status from DATA-01 when connected, or session review state.
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
  positiveSignals: string[];
  reviewBlockers: ReviewBlockerSignal[];
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

export async function fetchData01Catalog(page = 0): Promise<{
  connected: boolean;
  catalog: Data01CatalogResponse | null;
  error?: string;
}> {
  try {
    const res = await fetch(`/api/studio/data?page=${page}`);
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

export async function fetchData01PostDetail(
  postId: string,
): Promise<Data01PostDetailResponse | null> {
  try {
    const res = await fetch(`/api/studio/data/posts/${postId}`);
    if (!res.ok) return null;
    const json = await res.json();
    return (json.data ?? json) as Data01PostDetailResponse;
  } catch {
    return null;
  }
}

export async function fetchThreadsDiscoveryState(): Promise<{
  connected: boolean;
  auth: ThreadsAuthStatusResponse | null;
  runs: ThreadsCollectorRunItem[];
  scheduler: ThreadsSchedulerStatus | null;
}> {
  try {
    const [aRes, rRes, sRes] = await Promise.all([
      fetch("/api/studio/threads/auth/status"),
      fetch("/api/studio/threads/collector/runs"),
      fetch("/api/studio/threads/scheduler"),
    ]);
    if (!aRes.ok) {
      return { connected: false, auth: null, runs: [], scheduler: null };
    }
    const aJson = await aRes.json();
    const rJson = rRes.ok ? await rRes.json() : { data: [] };
    const sJson = sRes.ok ? await sRes.json() : { data: null };
    return {
      connected: true,
      auth: (aJson.data ?? aJson) as ThreadsAuthStatusResponse,
      runs: ((rJson.data ?? rJson) || []) as ThreadsCollectorRunItem[],
      scheduler: (sJson.data ?? sJson) as ThreadsSchedulerStatus | null,
    };
  } catch {
    return { connected: false, auth: null, runs: [], scheduler: null };
  }
}

/** Posts the user still has to decide on, counted across the whole catalog (not the open session). */
export function catalogPendingReview(
  catalog: Data01CatalogResponse | null | undefined,
): number {
  return catalog?.reviewSummary?.pending ?? pendingReviewCount(catalog?.counts);
}

export function formatCompactNumber(value?: number | null): string {
  if (value === null || value === undefined) return "—";
  if (value >= 1000000) return `${(value / 1000000).toFixed(1)}M`;
  if (value >= 1000) return `${(value / 1000).toFixed(1)}K`;
  return String(value);
}

export function formatVietnameseDate(isoOrDate?: string | null): string {
  if (!isoOrDate) return "Chưa rõ ngày đăng";
  const parsed = Date.parse(isoOrDate);
  if (Number.isNaN(parsed)) return isoOrDate;
  const d = new Date(parsed);
  return d.toLocaleDateString("vi-VN", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
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
    rejected: number;
    quarantine: number;
  };
  dataProvenance: DataProvenanceBadge;
} {
  if (!session) {
    return {
      items: [],
      duplicates: [],
      counts: {
        total: data01Catalog?.total || 0,
        bronzeObservations: data01Catalog?.observations || 0,
        silverValidated: 0,
        goldScored: 0,
        needsReview: data01Connected ? catalogPendingReview(data01Catalog) : 0,
        qualified: 0,
        queued: 0,
        rejected: 0,
        quarantine: 0,
      },
      dataProvenance: data01Connected ? catalogProvenance(data01Catalog) : "NOT CONNECTED",
    };
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

    const matchedRow = matchCatalogIdentity(item.sourceUrl, data01Catalog?.rows || []);

    const reasons: string[] = [];
    const positiveSignals: string[] = [];
    const reviewBlockers: ReviewBlockerSignal[] = [];

    let evaluationStatus: MedallionItem["evaluationStatus"] = "NEEDS_REVIEW";    let data01State = "NOT_IMPORTED";
    let ruleScore: number | null = null;
    let data01Labels: string[] = [];

    // Positive signals in plain human language
    if (words.length >= 12 && words.length <= 130) {
      positiveSignals.push(`Độ dài nhịp đọc tốt (${words.length} từ)`);
    }
    const likes = item.metadata?.likeCount ?? null;
    const replies = item.metadata?.replyCount ?? null;
    const reposts = item.metadata?.repostCount ?? null;
    const shares = item.metadata?.shareCount ?? null;
    if (likes !== null && likes >= 500) {
      positiveSignals.push(
        `Tương tác cao (${formatCompactNumber(likes)} lượt thích)`,
      );
    }
    const localAvatar =
      session.sourceImages?.[item.id]?.uri || item.metadata?.avatar || null;
    if (localAvatar) {
      positiveSignals.push("Có ảnh đại diện tác giả rõ nét");
    }
    if (currentAsset) {
      positiveSignals.push(
        `Đã có giọng đọc (${(currentAsset.durationMs / 1000).toFixed(1)}s)`,
      );
    }

    const rawEntityType: "POST" | "COMMENT" | "UNKNOWN" =
      (item.metadata?.type as "POST" | "COMMENT" | "UNKNOWN") ||
      (item.sourceReference?.entityType as "POST" | "COMMENT" | "UNKNOWN") ||
      "UNKNOWN";

    if (data01Connected && matchedRow) {
      data01State = matchedRow.state;
      ruleScore = matchedRow.score;
      data01Labels = matchedRow.labels || [];

      if (ruleScore !== null && ruleScore >= 75) {
        positiveSignals.unshift(
          `Điểm cấu trúc & nội dung tốt (${ruleScore.toFixed(0)}/100)`,
        );
      }

      if (matchedRow.state === "QUARANTINED" || matchedRow.quarantine.length > 0) {
        evaluationStatus = "QUARANTINED";        reasons.push(...matchedRow.quarantine);
        reviewBlockers.push({
          code: "QUARANTINE",
          title: "Bài viết bị cách ly kiểm tra",
          hint: matchedRow.quarantine.join("; ") || "Thiếu trường dữ liệu bắt buộc",
          severity: "danger",
        });
      } else if (matchedRow.state === "QUEUED") {
        evaluationStatus = "QUEUED";      } else if (matchedRow.state === "QUALIFIED") {
        evaluationStatus = "QUALIFIED";      } else if (matchedRow.state === "REJECTED") {
        evaluationStatus = "REJECTED";      } else {
        evaluationStatus = "NEEDS_REVIEW";        reasons.push(
          "Cần xác nhận đây là Bài đăng gốc hay Bình luận",
        );
        reviewBlockers.push({
          code: "ENTITY_TYPE_UNKNOWN",
          title: "Chưa xác nhận loại bài (Bài gốc hay Bình luận)",
          hint: "Chọn 'Bài đăng gốc' hoặc 'Bình luận' trước khi bấm Chấp nhận.",
          severity: "warning",
        });
        if (data01Labels.includes("POLICY_RISK")) {
          reasons.push("Có từ viết tắt / tiếng lóng cần kiểm tra trước khi đọc");
          reviewBlockers.push({
            code: "POLICY_RISK",
            title: "Phát hiện từ viết tắt / tiếng lóng (clm, đcđ...)",
            hint: "Kiểm tra lời đọc TTS để đảm bảo giọng đọc tự nhiên, phù hợp.",
            severity: "warning",
          });
        }
      }

      if (matchedRow.duplicate) {
        const gid = `DUP-${matchedRow.duplicate.postId.slice(0, 6)}`;
        itemDupMap.set(item.id, gid);
        reasons.push(`Trùng lặp (${matchedRow.duplicate.kind})`);
        reviewBlockers.push({
          code: "DUPLICATE",
          title: "Nội dung gần giống bài khác",
          hint: `Độ tương đồng ${(matchedRow.duplicate.similarity * 100).toFixed(0)}%`,
          severity: "info",
        });
      }
    } else if (!data01Connected) {
      evaluationStatus = "NOT_CONNECTED";      data01State = "API_NOT_CONNECTED";
      reasons.push("Chưa kết nối dữ liệu đánh giá từ API DATA-01 (/api/studio/data)");
      reviewBlockers.push({
        code: "DISCONNECTED",
        title: "Chưa kết nối bộ chấm điểm DATA-01",
        hint: "Đang hiển thị dữ liệu từ phiên cục bộ.",
        severity: "info",
      });
    } else {
      evaluationStatus = "NEEDS_REVIEW";      data01State = "UNIMPORTED_SESSION_ITEM";
      reasons.push("Bài viết chưa được đồng bộ vào bộ đánh giá DATA-01");
      reviewBlockers.push({
        code: "UNIMPORTED",
        title: "Chưa đồng bộ sang DATA-01",
        hint: "Nhấn 'Đồng bộ phiên vào DATA-01' để chấm điểm tự động.",
        severity: "info",
      });
    }

    if (allAmb.length > 0) {
      reasons.push(`Từ ngữ/số cần kiểm tra khi đọc: ${allAmb.join(", ")}`);
    }

    return {
      id: item.id,
      data01PostId: matchedRow?.id ?? null,
      sourcePostId: matchedRow?.sourcePostId ?? shortcode,
      itemIndex: idx + 1,
      author: item.author.displayName || item.metadata?.author || cleanHandle,
      handle: cleanHandle,
      avatarUrl: localAvatar,
      sourceUrl: item.sourceUrl,
      publishedAt: item.metadata?.createdAt ?? null,
      entityType: rawEntityType,
      likesCount: likes,
      repliesCount: replies,
      repostsCount: reposts,
      sharesCount: shares,
      evaluationStatus,
      data01State,
      provenanceBadge: matchedRow ? rowProvenance(matchedRow) : "UNKNOWN",
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
      positiveSignals,
      reviewBlockers,
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
  const quarantine = data01Connected ? data01Catalog?.counts?.QUARANTINED || 0 : items.filter((i) => i.evaluationStatus === "QUARANTINED").length;
  const silverValidated = data01Connected ? Math.max(0, total - quarantine) : 0;
  const goldScored = data01Connected
    ? (data01Catalog?.counts?.SCORED ?? 0) +
      (data01Catalog?.counts?.QUALIFIED ?? 0) +
      (data01Catalog?.counts?.QUEUED ?? 0)
    : 0;
  const needsReview = data01Connected ? catalogPendingReview(data01Catalog) : items.filter(i=>i.evaluationStatus==="NEEDS_REVIEW"||i.evaluationStatus==="NOT_CONNECTED").length;
  const qualified = items.filter((i) => i.evaluationStatus === "QUALIFIED").length;
  const queued = items.filter((i) => i.evaluationStatus === "QUEUED").length;
  const rejected = items.filter((i) => i.evaluationStatus === "REJECTED").length;

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
      rejected,
      quarantine,
    },
    dataProvenance: data01Connected ? catalogProvenance(data01Catalog) : "NOT CONNECTED",
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

/** Separate projections: global catalog identity is never a scene index or author handle. */
export interface CatalogPostView extends MedallionItem { scope:"CATALOG_POST"; sessionItemId:string|null; identityVerified:boolean; }
export interface SessionSceneView { scope:"SESSION_SCENE"; sessionId:string; itemId:string; revision:number; order:number; }
export function catalogPostView(row:Data01CatalogRow, detail:Data01PostDetailResponse|null, session:StudioSession|null):CatalogPostView {
 const b=detail?.bronze,e=detail?.evaluation;
 const exact=b&&b.sourcePostId===row.sourcePostId&&canonicalTarget(b.sourceUrl)===row.sourcePostId&&detail?.post.id===row.id;
 const item=session?.items.find(i=>matchCatalogIdentity(i.sourceUrl,[row])) || null;
 const raw=b?.originalBody??row.bodyPreview??"";
 const type=b?.itemType??"UNKNOWN";
 const state=e?.state??row.state;
 const status:MedallionItem["evaluationStatus"]=state==="QUARANTINED"?"QUARANTINED":state==="QUEUED"?"QUEUED":state==="QUALIFIED"?"QUALIFIED":state==="REJECTED"?"REJECTED":"NEEDS_REVIEW";
 return {id:row.id,data01PostId:row.id,sourcePostId:row.sourcePostId,itemIndex:0,
 author:b?.author?.name||row.author?.name||row.author?.handle||"Unknown",handle:b?.author?.handle||row.author?.handle||"",avatarUrl:(item&&session?.sourceImages?.[item.id]?.uri)||b?.author?.avatarUrl||null,
 sourceUrl:row.sourceUrl||"",publishedAt:b?.publishedAt||null,entityType:type,
 likesCount:b?.engagement?.likes??null,repliesCount:b?.engagement?.replies??null,repostsCount:b?.engagement?.reposts??null,sharesCount:b?.engagement?.shares??null,
 evaluationStatus:status,data01State:state,provenanceBadge:detail?.bronze?sourceProvenance(detail.bronze):rowProvenance(row),ruleScore:e?.gold?.score??row.score,data01Labels:e?.gold?.labels||row.labels,
 selected:item?.selected??false,inclusion:"TARGET",wordCount:raw.trim().split(/\s+/).filter(Boolean).length,charCount:raw.length,hasAvatar:!!b?.author?.avatarUrl,
 spokenApproved:!!item?.spokenApproval?.valid,audioStatus:"MISSING",audioDurationSec:null,ambiguities:spokenAmbiguities(item?.spokenText||raw),proposalStatus:"NO_PROPOSAL",
 reviewReasons:[...(e?.gold?.reasons||[]),...(e?.silver?.quarantineReasons||[])],positiveSignals:[],reviewBlockers:exact?(!e?.review||e.review.decision!=="ACCEPT" ? [...new Set([...(e?.silver?.flags||[]),...(type==="UNKNOWN"&&!e?.review?.confirmedType?["UNKNOWN_ENTITY_TYPE"]:[])])].map(code=>({code,title:code==="UNKNOWN_ENTITY_TYPE"?"Chưa xác nhận bài gốc hay bình luận":"Nội dung cần người dùng kiểm tra",hint:code,severity:"warning" as const})):[]):[{code:"DETAIL_REQUIRED",title:"Loading verified source identity",hint:"Review requires full post details",severity:"warning"}],
 duplicateGroupId:row.duplicate?.postId||null,revision:item?.revision??0,data01Revision:e?.revision??row.revision,manualLocks:item?.manualLocks||[],
 originalText:raw,displayText:item?.displayText??raw,spokenText:item?.spokenText??raw,topic:b?.topic??null,
 scope:"CATALOG_POST",sessionItemId:item?.id||null,identityVerified:!!exact};
}

export function rowProvenance(row:Data01CatalogRow):SourceProvenance {
 if(row.synthetic===true)return 'SYNTHETIC';
 return ['REAL','SYNTHETIC','UNKNOWN'].includes(row.provenance||'')?row.provenance!:'UNKNOWN';
}
export function catalogProvenance(catalog:Data01CatalogResponse|null|undefined):SourceProvenance {
 if(!catalog?.total)return 'UNKNOWN';
 if(catalog.provenanceCounts){const entries=Object.entries(catalog.provenanceCounts).filter(([,n])=>n>0);return entries.length===1&&entries[0][1]===catalog.total?entries[0][0] as SourceProvenance:'UNKNOWN';}
 return catalog.rows.length===catalog.total?combinedProvenance(catalog.rows.map(rowProvenance)):'UNKNOWN';
}
export function sessionProvenance(session:StudioSession|null,catalog:Data01CatalogResponse|null|undefined):SourceProvenance {
 if(!session)return 'UNKNOWN';
 const editorial=session.project.editorialPlan,origin=session.productionOrigin?.conversation;
 if(editorial&&origin?.bundleHash===editorial.bundleHash&&editorial.bundle.sourceLink?.postId===session.productionOrigin?.postId&&JSON.stringify(origin.selectedReplyIds)===JSON.stringify(editorial.selectedReplyIds)&&['REAL','SYNTHETIC','UNKNOWN'].includes(origin.sourceProvenance||''))return origin.sourceProvenance!;
 if(editorial&&session.productionOrigin?.conversation?.bundleHash===editorial.bundleHash&&editorial.bundle.collection.root.provenance.synthetic===true&&session.project.sources.length>0&&session.project.sources.every(s=>s.synthetic===true))return 'SYNTHETIC';
 return combinedProvenance(session.items.filter(i=>i.selected).map(i=>{const row=matchCatalogIdentity(i.sourceUrl,catalog?.rows||[]);return row?rowProvenance(row):'UNKNOWN';}));
}
