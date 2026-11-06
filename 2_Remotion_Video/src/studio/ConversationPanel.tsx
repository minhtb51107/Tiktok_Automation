import {useRuntimeSafety} from './RuntimeSafety';
import {EditorialPanel} from './EditorialPanel';
import { useEffect, useRef, useState } from "react";
import type {
  ConversationRun,
  ConversationReview,
  ThreadCollection,
  ConversationEvaluation,
  ReplyLabel,
} from "../../../1_nest_backend/src/data-engine/conversation-contracts";
import { studioRequest, exportJson } from "./integration-api";
type View = {
  record: {
    id: string;
    collection: ThreadCollection;
    evaluation: ConversationEvaluation;
    rightsStatus: "UNKNOWN";
  };
  review: ConversationReview;
};
const base = "/data/conversations";
const score = (value: number | null | undefined) =>
  value === null || value === undefined ? "UNKNOWN" : String(value);
function sameSource(a: string, b: string) {
  try {
    const left = new URL(a), right = new URL(b);
    const valid = (u: URL) => u.protocol === 'https:' && !u.port && !u.username && !u.password && ['www.threads.com','threads.com','www.threads.net','threads.net'].includes(u.hostname);
    return valid(left) && valid(right) && left.pathname.replace(/\/$/,'') === right.pathname.replace(/\/$/,'');
  } catch { return false; }
}
export function ConversationPanel({
  sourceUrl,
}: {
  sourceUrl?: string | null;
}) {
  const {locked,runtime}=useRuntimeSafety();const reviewLocked=locked&&!runtime.capabilities?.review;
  const [options, setOptions] = useState<any>(null),
    [runs, setRuns] = useState<ConversationRun[]>([]),
    [runId, setRunId] = useState(""),
    [collectionId, setCollectionId] = useState(""),
    [view, setView] = useState<View | null>(null);
  const [keyword, setKeyword] = useState("công việc"),
    [limit, setLimit] = useState(1),
    [selected, setSelected] = useState<string[]>([]),
    [labels, setLabels] = useState<Record<string, ReplyLabel>>({}),
    [decision, setDecision] = useState("NEEDS_REVIEW"),
    [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [dirty, setDirty] = useState(false);
  const lock = useRef(false);
  const visibleRuns = sourceUrl ? runs.filter(r => r.results.some(x => sameSource(x.url, sourceUrl)) || r.request.urls?.some(url=>sameSource(url,sourceUrl))) : runs;
  const run = visibleRuns.find((x) => x.id === runId) || visibleRuns[0];
  const collections = run?.results.filter(r=>!sourceUrl||sameSource(r.url,sourceUrl)) || [];
  const viewMatches = !sourceUrl || (view && sameSource(view.record.collection.root.url, sourceUrl));
  const c = viewMatches ? view?.record.collection : undefined,
    q = viewMatches ? view?.record.evaluation : undefined;
  const resultKey = collections.map((x) => x.collectionId).join(",");
  async function load() {
    const [o, rs] = await Promise.all([
      studioRequest<any>(base + "/options"),
      studioRequest<ConversationRun[]>(base + "/runs"),
    ]);
    setOptions(o);
    setRuns(rs);
    if (!runId && rs[0]) setRunId(rs[0].id);
  }
  useEffect(() => {
    void load().catch((e) => setError(e.message));
  }, []);
  useEffect(() => {
    if (!collections.length) {
      setCollectionId("");
      setView(null);
      return;
    }
    setCollectionId((old) =>
      collections.some((x) => x.collectionId === old)
        ? old
        : collections[0].collectionId,
    );
  }, [run?.id, resultKey]);
  useEffect(() => {
    let cancelled = false;
    setView(null);
    if (!collectionId) return;
    void studioRequest<View>(base + "/collections/" + collectionId)
      .then((v) => {
        if (cancelled) return;
        setView(v);
        setSelected(v.review.selectedReplyIds);
        setLabels(v.review.replyLabels || {});
        setReason(v.review.reason);
        setDecision(v.review.decision);
        setDirty(false);
      })
      .catch((e) => {
        if (!cancelled) setError(e.message);
      });
    return () => {
      cancelled = true;
    };
  }, [collectionId]);
  useEffect(() => {
    if (!busy && run?.status !== "RUNNING") return;
    const timer = setInterval(
      () => void load().catch((e) => setError(e.message)),
      2000,
    );
    return () => clearInterval(timer);
  }, [busy, run?.status]);
  async function action(fn: () => Promise<void>) {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await fn();
      await load();
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "Conversation operation failed",
      );
    } finally {
      setBusy(false);
      lock.current = false;
    }
  }
  function canSwitch() {
    return !dirty || window.confirm("Bỏ thay đổi feedback chưa lưu?");
  }
  async function start() {
    await action(async () => {
      const input = sourceUrl
        ? { urls: [sourceUrl], limit: 1 }
        : { keyword, limit };
      const key = "data04-intent",
        saved = JSON.parse(localStorage.getItem(key) || "null");
      const signature = JSON.stringify(input),
        body =
          saved?.signature === signature
            ? saved.body
            : { ...input, requestId: crypto.randomUUID() };
      localStorage.setItem(key, JSON.stringify({ signature, body }));
      const r = await studioRequest<ConversationRun>(base + "/runs", body);
      setRuns((old) => [r, ...old.filter((x) => x.id !== r.id)]);
      setRunId(r.id);
      setCollectionId(r.results[0]?.collectionId || "");
      if (r.status === "COMPLETED") localStorage.removeItem(key);
    });
  }
  function reportMarkdown() {
    return `# DATA-04 Conversation Report\n\nExecution: ${run?.execution || "UNKNOWN"}\nRun: ${run?.id || "—"}\nStatus: ${run?.status || "UNKNOWN"}\nElapsed: ${run?.elapsedMs ?? "—"} ms\nRanking: ${run?.ranking?.status || "UNKNOWN"} — ${run?.ranking?.reasons.join("; ") || ""}\n\n## Exact source\n${c?.root.url || ""}\n@${c?.root.author.handle || ""}\n${c?.root.originalText || ""}\n\nCollection: ${c?.status || "UNKNOWN"}\nReported replies: ${c?.reportedReplyCount ?? "UNKNOWN"}; observed: ${c?.observedReplyCount ?? 0}; verified: ${c?.verifiedReplyCount ?? 0}; unverified: ${c?.unverifiedCandidateCount ?? 0}\nPopularity: ${score(q?.popularity.score)}; Conversation: ${score(q?.conversation.score)}; Video suitability: ${score(q?.videoSuitability.score)}\nRatios apply only to VERIFIED_OBSERVED_SAMPLE. Precision@10: NOT_MEASURED. Rights: UNKNOWN. Production approval: unchanged.\n\n## Verified replies\n${c?.replies.map((r) => `${r.id} @${r.author.handle} → parent ${r.parentId}\n${r.url}\n${r.originalText}\nQuality: ${q?.replyQuality.find((x) => x.replyId === r.id)?.label}\nEvidence: ${r.evidence.kind}\n`).join("\n") || "No verified replies; not evidence of no comments."}\n## Persisted human review\n${JSON.stringify(view?.review, null, 2)}\n\nWarnings: ${c?.warnings.join("; ") || ""}`;
  }
  return (
    <details className="v2-card" data-testid="conversation-panel">
      <summary>
        <strong>DATA-04 · Conversation Review</strong> — Popularity ≠ quality ≠
        approval
      </summary>
      {locked&&!visibleRuns.length&&<p data-testid="conversation-empty">PARTIAL · No verified conversation collection exists in this real-data copy. Reply/Editorial tools require a separately approved DATA-04 LIVE pilot; no synthetic replies are substituted.</p>}
      <p>
        Public relationship evidence only. Cron OFF · LIVE{" "}
        {options?.liveEnabled
          ? "enabled explicitly"
          : "locked pending pilot approval"}{" "}
        · max 1 browser / 2 roots / 20 verified replies per root.
      </p>
      {sourceUrl ? (
        <a href={sourceUrl} target="_blank" rel="noreferrer">
          Selected catalog source
        </a>
      ) : (
        <>
          <label>
            Keyword{" "}
            <input
              data-testid="conversation-keyword"
              value={keyword}
              onChange={(e) => setKeyword(e.target.value)}
            />
          </label>
          <label>
            Roots{" "}
            <select
              value={limit}
              onChange={(e) => setLimit(Number(e.target.value))}
            >
              <option value={1}>1</option>
              <option value={2}>2</option>
            </select>
          </label>
        </>
      )}
      <button
        data-testid="conversation-start"
        disabled={locked || busy || !(options?.liveEnabled || options?.syntheticEnabled)}
        onClick={() => void start()}
      >
        {sourceUrl ? "Enrich selected source" : "Discover conversations"}
      </button>
      <button
        disabled={busy}
        onClick={() => void load().catch((e) => setError(e.message))}
      >
        Refresh conversations
      </button>
      {error && <p role="alert">{error}</p>}
      {notice && <p role="status">{notice}</p>}
      {busy && <progress aria-label="Conversation stage in progress" />}
      {dirty && <p role="status">Feedback chưa lưu</p>}
      <label>
        Run{" "}
        <select
          data-testid="conversation-runs"
          value={run?.id || ''}
          onChange={(e) => {
            if (canSwitch()) setRunId(e.target.value);
          }}
        >
          <option value="">Select run</option>
          {visibleRuns.map((r) => (
            <option key={r.id} value={r.id}>
              {r.execution} · {r.id.slice(0, 8)} · {r.status}
            </option>
          ))}
        </select>
      </label>
      {run && (
        <>
          <p data-testid="conversation-run-status">
            {run.execution} · {run.stage} · {run.status === "RUNNING" ? Math.max(0, Date.now()-Date.parse(run.startedAt)) : run.elapsedMs} ms · ranking{" "}
            {run.ranking?.status}: {run.ranking?.reasons.join("; ")}
          </p>
          <details>
            <summary>Candidate popularity ranking</summary>
            {run.candidates?.map((x) => (
              <p key={x.url}>
                <a href={x.url} target="_blank" rel="noreferrer">
                  {x.url}
                </a>{" "}
                ·{" "}
                {x.post
                  ? `likes ${x.post.engagement.likes ?? "UNKNOWN"} / replies ${x.post.engagement.replies ?? "UNKNOWN"}`
                  : "Metadata unavailable"}{" "}
                ·{" "}
                {run.ranking?.selected.includes(x.url)
                  ? "SELECTED FOR ENRICHMENT"
                  : "Not enriched"}
              </p>
            ))}
          </details>
          {run.status === "FAILED" && (
            <>
              <p role="alert">{run.error}</p>
              <button
                disabled={locked || busy || !options?.liveEnabled}
                onClick={() =>
                  void action(async () => {
                    const r = await studioRequest<ConversationRun>(
                      base + "/runs/" + run.id + "/resume",
                      {},
                    );
                    setRuns((old) => old.map((x) => (x.id === r.id ? r : x)));
                    setCollectionId(r.results[0]?.collectionId || "");
                  })
                }
              >
                Resume checkpoint
              </button>
            </>
          )}
          <label>
            Collection{" "}
            <select
              data-testid="conversation-collections"
              value={collectionId}
              onChange={(e) => {
                if (canSwitch()) setCollectionId(e.target.value);
              }}
            >
              {collections.map((r) => (
                <option key={r.collectionId} value={r.collectionId}>
                  {r.url}
                </option>
              ))}
            </select>
          </label>
        </>
      )}
      {c && q && (
        <article data-testid="conversation-result">
          <h3>
            @{c.root.author.handle} ·{" "}
            {c.root.provenance.synthetic
              ? "SYNTHETIC"
              : "REAL public observation"}
          </h3>
          <a href={c.root.url} target="_blank" rel="noreferrer">
            Exact source
          </a>
          <p style={{ whiteSpace: "pre-wrap" }}>{c.root.originalText}</p>
          <p>{c.root.publishedAt || "Publication time UNKNOWN"}</p>
          <p>
            Likes {c.root.engagement.likes ?? "UNKNOWN"} · Replies{" "}
            {c.root.engagement.replies ?? "UNKNOWN"} · Reposts{" "}
            {c.root.engagement.reposts ?? "UNKNOWN"} · Shares{" "}
            {c.root.engagement.shares ?? "UNKNOWN"}
          </p>
          <p data-testid="conversation-counts">
            {c.status} · reported {c.reportedReplyCount ?? "UNKNOWN"} · observed{" "}
            {c.observedReplyCount} · verified {c.verifiedReplyCount} ·
            unverified {c.unverifiedCandidateCount}
          </p>
          <p>
            Popularity {score(q.popularity.score)} · Conversation{" "}
            {score(q.conversation.score)} · Video suitability{" "}
            {score(q.videoSuitability.score)} · Substantive{" "}
            {q.sample.substantive}/{q.sample.verified} · low information{" "}
            {q.sample.lowInformation} · spam/duplicate {q.sample.spamDuplicate}
          </p>
          <p>
            Ratios are for the verified observed sample only. Precision@10
            NOT_MEASURED.
          </p>
          {c.warnings.map((w) => (
            <p key={w}>{w}</p>
          ))}
          {c.replies.map((r) => {
            const quality = q.replyQuality.find((x) => x.replyId === r.id);
            return (
              <article
                key={r.id}
                data-reply-id={r.id}
                style={{
                  border: "1px solid var(--v2-border, #777)",
                  padding: 12,
                  marginBlock: 8,
                }}
              >
                <label>
                  <input
                    data-testid="reply-selected"
                    type="checkbox"
                    checked={selected.includes(r.id)}
                    onChange={(e) => {
                      setSelected((old) =>
                        e.target.checked
                          ? [...old, r.id]
                          : old.filter((x) => x !== r.id),
                      );
                      setDirty(true);
                    }}
                  />{" "}
                  Select reply
                </label>
                <strong> @{r.author.handle}</strong>
                <p>{r.originalText}</p>
                <a href={r.url} target="_blank" rel="noreferrer">
                  Reply permalink
                </a>
                <p>
                  Parent {r.parentId} · {r.evidence.kind} · {quality?.label}
                </p>
                <select
                  aria-label={"Human quality " + r.id}
                  value={labels[r.id] || ""}
                  onChange={(e) => {
                    setLabels((old) => ({
                      ...old,
                      [r.id]: e.target.value as ReplyLabel,
                    }));
                    setDirty(true);
                  }}
                >
                  <option value="" disabled>
                    Unlabelled
                  </option>
                  {[
                    "SUBSTANTIVE",
                    "LOW_INFORMATION",
                    "SPAM",
                    "DUPLICATE",
                    "UNCERTAIN",
                  ].map((x) => (
                    <option key={x}>{x}</option>
                  ))}
                </select>
                <details>
                  <summary>Quality reasons / relationship evidence</summary>
                  <pre style={{ maxHeight: 240, overflow: "auto" }}>
                    {JSON.stringify({ quality, evidence: r.evidence }, null, 2)}
                  </pre>
                </details>
              <EditorialPanel collectionId={collectionId} selectionRevision={view!.review.revision}/>
        </article>
            );
          })}
          <details>
            <summary>Unverified context — excluded from selection</summary>
            {c.unverified.map((x, i) => (
              <p key={i}>
                {x.url || "Unknown URL"} · {x.reason}
              </p>
            ))}
          </details>
          <details>
            <summary>All score breakdowns</summary>
            <pre style={{ maxHeight: 300, overflow: "auto" }}>
              {JSON.stringify(q, null, 2)}
            </pre>
          </details>
          <label>
            Quality decision{" "}
            <select
              data-testid="conversation-decision"
              value={decision}
              onChange={(e) => {
                setDecision(e.target.value);
                setDirty(true);
              }}
            >
              {["NEEDS_REVIEW", "ACCEPT", "REJECT"].map((x) => (
                <option key={x}>{x}</option>
              ))}
            </select>
          </label>
          <input
            data-testid="conversation-reason"
            value={reason}
            maxLength={1000}
            onChange={(e) => {
              setReason(e.target.value);
              setDirty(true);
            }}
            placeholder="Reason / quality feedback, not production approval"
          />
          <button
            data-testid="conversation-feedback-save"
            disabled={reviewLocked || busy || !reason.trim()}
            onClick={() =>
              void action(async () => {
                const review = await studioRequest<ConversationReview>(
                  base + "/collections/" + collectionId + "/feedback",
                  {
                    requestId: crypto.randomUUID(),
                    revision: view!.review.revision,
                    selectedReplyIds: selected,
                    replyLabels: labels,
                    decision,
                    reason,
                  },
                );
                setView({ ...view!, review });
                setDirty(false);
                setNotice(
                  "Feedback saved. DATA-01 ACCEPT/queue and production approvals unchanged.",
                );
              })
            }
          >
            Save reply selection & feedback
          </button>
          <button
            data-testid="conversation-copy-report"
            onClick={() =>
              void navigator.clipboard
                .writeText(reportMarkdown())
                .then(() => setNotice("Persisted report copied"))
                .catch((e) => setError(e.message))
            }
          >
            Copy Report
          </button>
          <button
            data-testid="conversation-export-json"
            onClick={() =>
              exportJson("conversation-report.json", {
                run,
                record: view!.record,
                review: view!.review,
              })
            }
          >
            Export JSON
          </button>
          <button
            onClick={() =>
              void action(async () =>
                exportJson(
                  "conversation-source-bundle.json",
                  await studioRequest(
                    base + "/collections/" + collectionId + "/bundle",
                  ),
                ),
              )
            }
          >
            Export source bundle
          </button>
          <details>
            <summary>
              Feedback history · revision {view!.review.revision}
            </summary>
            <pre>{JSON.stringify(view!.review.history, null, 2)}</pre>
          </details>
        </article>
      )}
    </details>
  );
}
