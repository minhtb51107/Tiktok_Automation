import { useEffect, useState } from "react";
import type { StudioSession } from "../../../1_nest_backend/src/studio/studio.contracts";
import type {
  Bronze,
  DataPost,
  Evaluation,
} from "../../../1_nest_backend/src/data-engine/contracts";
import { copyReport } from "./copy-report";
import "./data.css";
async function api<T = any>(url: string, body?: unknown): Promise<T> {
  const r = await fetch("/api/studio/data" + url, {
    method: body ? "POST" : "GET",
    headers: { "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  const j = await r.json();
  if (!r.ok)
    throw Error(j.error?.message || j.message || "Data request failed");
  return j.data ?? j;
}
type Detail = {
  post: DataPost;
  bronze: Bronze | null;
  evaluation: Evaluation | null;
  observationCount: number;
};
export function DataWorkspace({ session }: { session: StudioSession }) {
  const [catalog, setCatalog] = useState<any>(null),
    [detail, setDetail] = useState<Detail | null>(null),
    [layer, setLayer] = useState("BRONZE"),
    [state, setState] = useState(""),
    [page, setPage] = useState(0),
    [pending, setPending] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [reason, setReason] = useState(""),
    [confirmedType, setConfirmedType] = useState(""),
    [report, setReport] = useState("");
  const refresh = async () =>
    setCatalog(
      await api("?state=" + encodeURIComponent(state) + "&page=" + page),
    );
  useEffect(() => {
    let alive = true;
    void api("?state=" + encodeURIComponent(state) + "&page=" + page)
      .then((v) => {
        if (alive) setCatalog(v);
      })
      .catch((e) => setError(e.message));
    return () => {
      alive = false;
    };
  }, [state, page]);
  const run = async (fn: () => Promise<void>) => {
    if (pending) return;
    setPending(true);
    setError("");
    try {
      await fn();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setPending(false);
    }
  };
  const choose = async (id: string) => {
    setDetail(await api("/posts/" + id));
    setReason("");
    setConfirmedType("");
  };
  const review = async (decision: string) => {
    if (!detail?.evaluation) return;
    await api("/posts/" + detail.post.id + "/review", {
      revision: detail.evaluation.revision,
      decision,
      reason,
      confirmedType: confirmedType || undefined,
    });
    await choose(detail.post.id);
    await refresh();
    setNotice(
      "Data review saved. Studio source/audio approvals were not changed.",
    );
  };
  const exportReport = async (json = false) => {
    const current = await api(
        "?state=" + encodeURIComponent(state) + "&page=" + page,
      ),
      selected = detail ? await api("/posts/" + detail.post.id) : null,
      out = {
        stageName: "THREADS_DATA",
        generatedAt: new Date().toISOString(),
        sessionId: session.id,
        sourceSessionRevision: session.revision,
        catalog: current,
        selected,
        notes: [
          "Deterministic score is not measured content quality.",
          "Rights remain UNKNOWN; queued content is DRAFT_ONLY, no automatic production.",
        ],
      };
    const text = json
      ? JSON.stringify(out, null, 2)
      : "# DATA-01 Report\n\n```json\n" +
        JSON.stringify(out, null, 2) +
        "\n```";
    setReport(text);
    if (json) {
      const u = URL.createObjectURL(
          new Blob([text], { type: "application/json" }),
        ),
        a = document.createElement("a");
      a.href = u;
      a.download = "data01-report.json";
      a.click();
      URL.revokeObjectURL(u);
    } else {
      await copyReport(text);
      setNotice("Persisted Data Report copied.");
    }
  };
  const e = detail?.evaluation,
    b = detail?.bronze;
  return (
    <section className="data-workspace">
      <header>
        <div>
          <h2>Threads SERIOUS / Data Library</h2>
          <p>
            Saved extraction → Bronze → Silver → Gold → manual DRAFT production
            queue
          </p>
        </div>
        <div className="actions">
          <button
            disabled={pending}
            onClick={() => void run(() => exportReport())}
          >
            Copy Report
          </button>
          <button
            disabled={pending}
            onClick={() => void run(() => exportReport(true))}
          >
            Export JSON
          </button>
        </div>
      </header>
      {error && (
        <p className="alert error" role="alert">
          {error}
        </p>
      )}
      {notice && <p role="status">{notice}</p>}
      <div className="panel">
        <strong>
          {catalog?.total ?? 0} posts · {catalog?.observations ?? 0} source
          observations
        </strong>
        <p>
          Qualified/queued coverage:{" "}
          {catalog?.qualifiedRatio === null
            ? "unavailable"
            : ((catalog?.qualifiedRatio || 0) * 100).toFixed(1) + "%"}{" "}
          — pipeline coverage, not quality accuracy. Precision@10: NOT MEASURED
          (ground truth required).
        </p>
        <p>
          Source session {session.id} · revision {session.revision}. Import is
          read-only for the source; no crawl, LLM, TTS or render.
        </p>
        <button
          disabled={pending}
          onClick={() =>
            void run(async () => {
              const r = await api("/import-session", { sessionId: session.id });
              await refresh();
              setNotice(
                `${r.status} · ${r.cursor}/${r.inputCount} observations · ${r.reused ? "existing completed run reused" : r.id}`,
              );
            })
          }
        >
          Import selected saved targets
        </button>
      </div>
      <div className="actions">
        <label>
          Layer
          <select value={layer} onChange={(x) => setLayer(x.target.value)}>
            {["BRONZE", "SILVER", "GOLD"].map((x) => (
              <option key={x}>{x}</option>
            ))}
          </select>
        </label>
        <label>
          State
          <select
            value={state}
            onChange={(x) => {
              setState(x.target.value);
              setPage(0);
            }}
          >
            <option value="">All states</option>
            {[
              "DISCOVERED",
              "VALIDATED",
              "ELIGIBLE",
              "SCORED",
              "QUALIFIED",
              "QUEUED",
              "REJECTED",
              "QUARANTINED",
              "FAILED",
            ].map((x) => (
              <option key={x}>{x}</option>
            ))}
          </select>
        </label>
        <button
          disabled={pending || page === 0}
          onClick={() => setPage(page - 1)}
        >
          Previous
        </button>
        <span>
          Page {page + 1} · {catalog?.matching ?? 0} matching posts
        </span>
        <button
          disabled={pending || (page + 1) * 25 >= (catalog?.matching || 0)}
          onClick={() => setPage(page + 1)}
        >
          Next
        </button>
      </div>
      <div className="data-grid">
        <div className="panel data-list">
          {!catalog?.rows.length && (
            <p>
              No records in this filter. Import the saved targets explicitly.
            </p>
          )}
          {catalog?.rows.map((r: any) => (
            <button
              className={detail?.post.id === r.id ? "current" : ""}
              key={r.id}
              onClick={() => void run(() => choose(r.id))}
            >
              <strong>
                {r.author?.handle || r.author?.name || "Author unavailable"}
              </strong>
              <span>
                {r.state} · {r.score === null ? "unscored" : r.score + " / 100"}
              </span>
              <p>{r.bodyPreview}</p>
              <small>
                {r.labels.join(", ")} · {r.observations} observations
              </small>
              {r.duplicate && (
                <small>
                  {r.duplicate.kind} → {r.duplicate.postId.slice(0, 12)}
                </small>
              )}
              {r.quarantine.length > 0 && (
                <small>{r.quarantine.join("; ")}</small>
              )}
            </button>
          ))}
        </div>
        <div className="panel data-inspector">
          {!detail ? (
            <p>
              Select a post to inspect persisted source and evaluation evidence.
            </p>
          ) : (
            <>
              <h3>{b?.author.handle || b?.author.name || detail.post.id}</h3>
              <p>
                {e?.state} · evaluation revision {e?.revision} · Rights: UNKNOWN
              </p>
              {b?.sourceUrl &&
                /^https:\/\/(?:www\.)?threads\.(?:com|net)\/@/.test(
                  b.sourceUrl,
                ) && (
                  <a href={b.sourceUrl} target="_blank" rel="noreferrer">
                    Open original permalink
                  </a>
                )}
              {layer === "BRONZE" ? (
                <>
                  <p>
                    Immutable source · {detail.observationCount} observations
                  </p>
                  <p>{b?.originalBody}</p>
                  <p>
                    Type: {b?.itemType} · Topic:{" "}
                    {b?.topic ?? "not present in raw extraction"} · Published:{" "}
                    {b?.publishedAt ?? "unavailable"} · Fetched:{" "}
                    {b?.fetchedAt ?? "unavailable"}
                  </p>
                  <p>{JSON.stringify(b?.engagement)} (null is unavailable)</p>
                  <details>
                    <summary>Raw payload, hashes & provenance</summary>
                    <pre>{JSON.stringify(b, null, 2)}</pre>
                  </details>
                  <details>
                    <summary>Observation history</summary>
                    {detail.post.observations.map((id) => (
                      <button
                        key={id}
                        onClick={() =>
                          void run(async () => {
                            const observation = await api(
                              "/posts/" +
                                detail.post.id +
                                "/observations/" +
                                id,
                            );
                            setReport(JSON.stringify(observation, null, 2));
                          })
                        }
                      >
                        {id.slice(0, 20)}
                      </button>
                    ))}
                  </details>
                </>
              ) : layer === "SILVER" ? (
                <>
                  <p>{e?.silver?.normalized.body}</p>
                  <pre>{JSON.stringify(e?.silver, null, 2)}</pre>
                </>
              ) : (
                <>
                  <p>
                    Score: {e?.gold?.score ?? "not scored"} / 100 ·{" "}
                    {e?.gold?.eligibility ?? "quarantined/not evaluated"}
                  </p>
                  <pre>{JSON.stringify(e?.gold, null, 2)}</pre>
                </>
              )}
              <details>
                <summary>State transition audit / review / queue</summary>
                <pre>
                  {JSON.stringify(
                    {
                      transitions: e?.transitions,
                      review: e?.review,
                      queue: e?.queue,
                    },
                    null,
                    2,
                  )}
                </pre>
              </details>
              <label>
                Review reason
                <textarea
                  value={reason}
                  onChange={(x) => setReason(x.target.value)}
                  maxLength={1000}
                />
              </label>
              {b?.itemType === "UNKNOWN" && (
                <label>
                  Confirm target type for acceptance
                  <select
                    value={confirmedType}
                    onChange={(x) => setConfirmedType(x.target.value)}
                  >
                    <option value="">Not confirmed</option>
                    <option value="POST">Post</option>
                    <option value="COMMENT">Comment/reply</option>
                  </select>
                </label>
              )}
              <div className="actions">
                {["ACCEPT", "REJECT", "NEEDS_REVIEW"].map((decision) => (
                  <button
                    key={decision}
                    disabled={
                      pending ||
                      !reason.trim() ||
                      !e?.silver ||
                      !e.gold ||
                      e.silver.status === "QUARANTINED" ||
                      e.state === "QUEUED"
                    }
                    onClick={() => void run(() => review(decision))}
                  >
                    {decision}
                  </button>
                ))}
              </div>
              <button
                disabled={pending || e?.state !== "QUALIFIED"}
                onClick={() =>
                  void run(async () => {
                    await api("/posts/" + detail.post.id + "/enqueue", {
                      revision: e!.revision,
                    });
                    await choose(detail.post.id);
                    await refresh();
                    setNotice(
                      "Queued for manual DRAFT production only. No pipeline was started.",
                    );
                  })
                }
              >
                Add qualified snapshot to production queue
              </button>
            </>
          )}
        </div>
      </div>
      <details className="panel">
        <summary>Durable import runs / recovery</summary>
        {catalog?.runs.map((r: any) => (
          <div key={r.id}>
            <code>{r.id}</code>
            <p>
              {r.status} · {r.cursor}/{r.inputCount} · elapsed{" "}
              {(r.elapsedMs / 1000).toFixed(3)}s
            </p>
            {r.error && <p role="alert">{r.error}</p>}
            {r.status !== "COMPLETED" && (
              <button
                disabled={pending}
                onClick={() =>
                  void run(async () => {
                    await api("/runs/" + r.id + "/resume", {});
                    await refresh();
                  })
                }
              >
                Resume last durable checkpoint
              </button>
            )}
          </div>
        ))}
      </details>
      {report && (
        <details open>
          <summary>Readable Data Report / observation</summary>
          <textarea
            readOnly
            value={report}
            style={{ width: "100%", minHeight: 200 }}
          />
        </details>
      )}
    </section>
  );
}
