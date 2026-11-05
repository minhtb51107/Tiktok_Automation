import { useEffect, useState, useRef } from "react";
import type { EditorialPlan } from "../../../1_nest_backend/src/data-engine/editorial-contracts";
import { studioRequest, exportJson } from "./integration-api";
const base = "/data/editorial";
export function EditorialPanel({
  collectionId,
  selectionRevision,
}: {
  collectionId: string;
  selectionRevision: number;
}) {
  const [plan, setPlan] = useState<EditorialPlan | null>(null),
    [root, setRoot] = useState<any>(null),
    [job, setJob] = useState<any>(null);
  const [busy, setBusy] = useState(false),
    [dirty, setDirty] = useState(false),
    [error, setError] = useState(""),
    [selection, setSelection] = useState(false),
    [confirm, setConfirm] = useState(false);
  const lock = useRef(false);
  async function load(active = () => true) {
    const plans = await studioRequest<EditorialPlan[]>(base + "/plans"),
      p = plans.find(
        (x) =>
          x.collectionId === collectionId &&
          x.selectionRevision === selectionRevision,
      );
    if (!active()) return;
    setPlan(p || null);
    setDirty(false);
    if (p?.bundle.sourceLink) {
      const r = await studioRequest(
        "/data/posts/" + p.bundle.sourceLink.postId,
      );
      if (active()) setRoot(r);
    }
  }
  useEffect(() => {
    let active = true;
    setPlan(null);
    setRoot(null);
    setJob(null);
    setSelection(false);
    setConfirm(false);
    void load(() => active).catch((e) => {
      if (active) setError(e.message);
    });
    return () => {
      active = false;
    };
  }, [collectionId, selectionRevision]);
  async function action(fn: () => Promise<void>) {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setError("");
    try {
      await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Editorial operation failed");
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  const queued =
    root?.evaluation?.state === "QUEUED" &&
    root.evaluation.review?.decision === "ACCEPT" &&
    (root.bronze.itemType === "POST" ||
      root.evaluation.review.confirmedType === "POST");
  const ready = plan?.feasibility.status === "READY_FOR_SCRIPT";
  if (
    plan &&
    (plan.collectionId !== collectionId ||
      plan.selectionRevision !== selectionRevision)
  )
    return <p>Loading matching editorial plan…</p>;
  return (
    <section data-testid="editorial-panel" className="v2-card">
      <h3>DATA-05 · Conversation → Original Script DRAFT</h3>
      <p>
        Target 70–100s. Estimated duration is advisory. Selection, quality,
        DATA-01 review, rights, script and audio approvals are independent.
      </p>
      {error && <p role="alert">{error}</p>}
      {!plan ? (
        <>
          <label>
            <input
              type="checkbox"
              data-testid="editorial-selection-confirm"
              checked={selection}
              onChange={(e) => setSelection(e.target.checked)}
            />{" "}
            I explicitly confirm the saved reply selection for editorial
            planning.
          </label>
          <button
            data-testid="editorial-create-plan"
            disabled={busy || !selection}
            onClick={() =>
              void action(async () => {
                const p = await studioRequest<EditorialPlan>(base + "/plans", {
                  collectionId,
                  selectionRevision,
                  selectionConfirmed: true,
                  style: "SERIOUS",
                  requestId: crypto.randomUUID(),
                });
                setPlan(p);
                if (p.bundle.sourceLink)
                  setRoot(
                    await studioRequest(
                      "/data/posts/" + p.bundle.sourceLink.postId,
                    ),
                  );
              })
            }
          >
            Prepare editorial DRAFT
          </button>
        </>
      ) : (
        <>
          <p data-testid="editorial-feasibility">
            {plan.feasibility.status} · ESTIMATED{" "}
            {plan.feasibility.estimate.minimumSeconds}–
            {plan.feasibility.estimate.maximumSeconds}s · NOT MEASURED ·
            revision {plan.revision}
          </p>
          <p>{plan.feasibility.reasons.join(" ")}</p>
          <p>
            Missing:{" "}
            {plan.feasibility.missingEvidence.join(", ") ||
              "No heuristic structural gaps; human semantic review still required"}
          </p>
          <p>
            Original hook/commentary/resolution start empty. Add your own
            analysis without inventing facts. Change QUOTE to PARAPHRASE before
            rewriting sourced wording.
          </p>
          {plan.sections.map((s, index) => (
            <details
              key={s.id}
              open={s.kind === "COMMENTARY"}
              data-section-id={s.id}
            >
              <summary>
                {index + 1}. {s.stage} · {s.kind} ·{" "}
                {s.sourceId || "EDITOR ORIGINAL"}
              </summary>
              {s.permalink && (
                <a href={s.permalink} target="_blank" rel="noreferrer">
                  Source · parent {s.parentId || "root"}
                </a>
              )}
              <blockquote>
                {s.originalText ||
                  "No source quotation — original editorial commentary"}
              </blockquote>
              {s.sourceId && (
                <select
                  aria-label={"Kind " + s.id}
                  value={s.kind}
                  disabled={s.locked || busy}
                  onChange={(e) => {
                    setPlan({
                      ...plan,
                      sections: plan.sections.map((x) =>
                        x.id === s.id
                          ? {
                              ...x,
                              kind: e.target.value as "QUOTE" | "PARAPHRASE",
                            }
                          : x,
                      ),
                    });
                    setDirty(true);
                  }}
                >
                  <option>QUOTE</option>
                  <option>PARAPHRASE</option>
                </select>
              )}
              <label>
                Display text
                <textarea
                  aria-label={"Display " + s.id}
                  value={s.displayText}
                  disabled={busy || s.locked || s.kind === "QUOTE"}
                  onChange={(e) => {
                    setPlan({
                      ...plan,
                      sections: plan.sections.map((x) =>
                        x.id === s.id
                          ? { ...x, displayText: e.target.value }
                          : x,
                      ),
                    });
                    setDirty(true);
                  }}
                />
              </label>
              <label>
                Narration
                <textarea
                  data-testid={"editorial-narration-" + s.id}
                  value={s.narrationText}
                  rows={4}
                  disabled={busy || s.locked || s.kind === "QUOTE"}
                  onChange={(e) => {
                    setPlan({
                      ...plan,
                      sections: plan.sections.map((x) =>
                        x.id === s.id
                          ? {
                              ...x,
                              narrationText: e.target.value,
                              displayText:
                                x.kind === "COMMENTARY" &&
                                (x.displayText === "" ||
                                  x.displayText === x.narrationText)
                                  ? e.target.value
                                  : x.displayText,
                            }
                          : x,
                      ),
                    });
                    setDirty(true);
                  }}
                />
              </label>
              <label>
                <input
                  type="checkbox"
                  checked={s.locked}
                  onChange={(e) => {
                    setPlan({
                      ...plan,
                      sections: plan.sections.map((x) =>
                        x.id === s.id ? { ...x, locked: e.target.checked } : x,
                      ),
                    });
                    setDirty(true);
                  }}
                />{" "}
                Manual lock (save unlock separately before editing)
              </label>
              <button
                disabled={index === 0 || busy}
                onClick={() => {
                  const sections = [...plan.sections];
                  [sections[index - 1], sections[index]] = [
                    sections[index],
                    sections[index - 1],
                  ];
                  setPlan({ ...plan, sections });
                  setDirty(true);
                }}
              >
                Move up
              </button>
            </details>
          ))}
          <button
            data-testid="editorial-save"
            disabled={busy || !dirty}
            onClick={() =>
              void action(async () => {
                setPlan(
                  await studioRequest<EditorialPlan>(
                    base + "/plans/" + plan.id,
                    { revision: plan.revision, sections: plan.sections },
                  ),
                );
                setDirty(false);
              })
            }
          >
            Save editorial DRAFT
          </button>
          {dirty && (
            <p role="status">
              Unsaved editorial changes; save before project creation.
            </p>
          )}
          <button
            onClick={() =>
              void action(async () => {
                if (plan.bundle.sourceLink)
                  setRoot(
                    await studioRequest(
                      "/data/posts/" + plan.bundle.sourceLink.postId,
                    ),
                  );
              })
            }
          >
            Refresh DATA-01 gates
          </button>
          <p data-testid="editorial-production-gates">
            DATA-01 ACCEPT + QUEUED + confirmed POST:{" "}
            {queued ? "READY" : "REQUIRED"} · Rights UNKNOWN · Script DRAFT ·
            Audio absent/unapproved
          </p>
          <label>
            <input
              data-testid="editorial-confirm-project"
              type="checkbox"
              checked={confirm}
              onChange={(e) => setConfirm(e.target.checked)}
            />{" "}
            Create a local DRAFT project only; this does not approve
            content/audio/rights or publish.
          </label>
          <button
            data-testid="editorial-create-project"
            disabled={busy || dirty || !ready || !queued || !confirm}
            onClick={() =>
              void action(async () => {
                const e = root.evaluation,
                  key = "editorial-project-" + plan.id + "-" + plan.revision;
                let requestId = localStorage.getItem(key);
                if (!requestId) {
                  requestId = crypto.randomUUID();
                  localStorage.setItem(key, requestId);
                }
                setJob(
                  await studioRequest(base + "/plans/" + plan.id + "/project", {
                    postId: root.post.id,
                    evaluationId: e.id,
                    queueId: e.queue.id,
                    revision: e.revision,
                    planRevision: plan.revision,
                    requestId,
                    confirmDraftCreation: true,
                  }),
                );
              })
            }
          >
            Create DRAFT → Script
          </button>
          {job && (
            <p data-testid="editorial-project-result">
              {job.status} · {job.error || ""}{" "}
              {job.status === "SUCCEEDED" && (
                <a data-testid="editorial-open-script" href={job.studioUrl}>
                  Open Script → Voice → Timeline/Preview
                </a>
              )}
            </p>
          )}
          <button onClick={() => exportJson("editorial-plan.json", plan)}>
            Export editorial report
          </button>
          <button
            onClick={() =>
              void navigator.clipboard
                .writeText(JSON.stringify(plan, null, 2))
                .catch((e) => setError(e.message))
            }
          >
            Copy editorial report
          </button>
        </>
      )}
    </section>
  );
}
