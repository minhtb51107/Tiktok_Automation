import { useState } from "react";
import type {
  StudioSession,
  StudioItem,
} from "../../../1_nest_backend/src/studio/studio.contracts";
import { StageReportPanel } from "./StageReportPanel";
function TextDifferences({ before, after }: { before: string; after: string }) {
  const a = before.match(/\s+|\S+/g) || [],
    b = after.match(/\s+|\S+/g) || [];
  let start = 0,
    end = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start++;
  while (
    end < a.length - start &&
    end < b.length - start &&
    a[a.length - end - 1] === b[b.length - end - 1]
  )
    end++;
  return (
    <div className="change-list">
      <small>Actual text differences (computed locally)</small>
      <p>
        {a.slice(0, start).join("")}
        <del>{a.slice(start, a.length - end).join("")}</del>
        {end ? a.slice(-end).join("") : ""}
      </p>
      <p>
        {b.slice(0, start).join("")}
        <mark>{b.slice(start, b.length - end).join("")}</mark>
        {end ? b.slice(-end).join("") : ""}
      </p>
    </div>
  );
}
export function ScriptWorkspace({
  session,
  edit,
  save,
  propose,
  proposeAll,
  decide,
  busy,
  dirty,
}: {
  session: StudioSession;
  edit: (id: string, p: Partial<StudioItem>) => void;
  save: () => void;
  propose: (id: string, mode?: "LIVE" | "OFFLINE") => void;
  proposeAll: () => void;
  decide: (run: string, action: "ACCEPT" | "REJECT" | "ACCEPT_LOCKED") => void;
  busy: boolean;
  dirty: boolean;
}) {
  const [focusId, setFocusId] = useState<string>("ALL");
  const selectedRows = session.items.filter((i) => i.selected).sort((a, b) => a.order - b.order);
  return (
    <>
      <section className="source-header">
        <div>
          <h2>02 / Script & spoken text</h2>
          <p>
            Correct spelling and TTS pronunciation. Review every AI proposal
            before applying.
          </p>
        </div>
        <div className="actions">
          <button
            disabled={busy || dirty}
            title={dirty ? "Save script edits first" : ""}
            onClick={proposeAll}
          >
            Normalize offline — all selected
          </button>
          <button className="primary" disabled={busy} onClick={save}>
            Save script edits
          </button>
        </div>
      </section>
      <StageReportPanel
        id={session.id}
        revision={session.revision}
        dirty={dirty}
        stage="SCRIPT"
      />
      {session.aiBillingBlocked && (
        <div role="alert" className="alert error">
          BLOCKED_BILLING — Hugging Face requires credits. No automatic retry or
          provider switch. Use manual editing or the clearly labelled offline
          rules.
        </div>
      )}
      {selectedRows.length > 1 && (
        <div className="v2-scene-jumpbar" role="toolbar" aria-label="Script scene filter">
          <span>SCENE FOCUS:</span>
          <button className={focusId === "ALL" ? "active" : ""} onClick={() => setFocusId("ALL")}>All ({selectedRows.length})</button>
          {selectedRows.map((item) => (
            <button key={item.id} className={focusId === item.id ? "active" : ""} onClick={() => setFocusId(item.id)}>#{item.order + 1} {item.author.displayName}</button>
          ))}
        </div>
      )}
      {selectedRows
        .filter((i) => focusId === "ALL" || i.id === focusId)
        .map((item) => {
          const p = session.scriptProposals
            ?.filter((p) => p.itemId === item.id)
            .slice(-1)[0];
          return (
            <article className="panel script-item" key={item.id}>
              <div className="panel-top">
                <h3>
                  {item.order + 1}. {item.author.displayName}
                </h3>
                <small>
                  Revision {item.revision} · Locks:{" "}
                  {item.manualLocks.join(", ") || "none"}
                </small>
              </div>
              <label>Original text · read only</label>
              <blockquote>{item.originalText}</blockquote>
              <div className="edit-grid">
                <label>
                  Display text
                  <textarea
                    disabled={busy}
                    value={item.displayText}
                    onChange={(e) =>
                      edit(item.id, { displayText: e.target.value })
                    }
                    rows={4}
                  />
                </label>
                <label>
                  Spoken text
                  <textarea
                    disabled={busy}
                    value={item.spokenText}
                    onChange={(e) =>
                      edit(item.id, { spokenText: e.target.value })
                    }
                    rows={4}
                  />
                </label>
              </div>
              <button
                disabled={busy || dirty || session.aiBillingBlocked}
                onClick={() => propose(item.id, "LIVE")}
              >
                AI sửa chính tả
              </button>
              <button
                disabled={busy || dirty}
                onClick={() => propose(item.id, "OFFLINE")}
              >
                Normalize offline — conservative rules
              </button>
              <small>
                {" "}
                Hugging Face / Qwen · one request · cost unavailable · no
                auto-apply
              </small>
              {dirty && (
                <p>Save edits before requesting or deciding on a proposal.</p>
              )}
              {p && (
                <section className="ai-proposal">
                  <div className="panel-top">
                    <h3>
                      Proposal · {p.mode || "LIVE"} ·{" "}
                      {p.executionStatus || p.approval} · {p.approval}
                    </h3>
                    <small>
                      {p.model} · {p.latencyMs} ms
                    </small>
                  </div>
                  {p.error && (
                    <div role="alert" className="alert error">
                      {p.error}
                    </div>
                  )}
                  <p className="proposal-text">
                    {p.proposedSpokenText || "No valid proposal returned."}
                  </p>
                  {p.proposedSpokenText && (
                    <TextDifferences
                      before={p.inputText}
                      after={p.proposedSpokenText}
                    />
                  )}
                  <div className="change-list">
                    {p.labels?.map((l, n) => (
                      <p key={"label" + n}>
                        <b>{l.category}</b>: {l.term}{" "}
                        {l.replacement !== l.term
                          ? "→ " + (l.replacement || "(omit spoken only)")
                          : ""}{" "}
                        <small>{l.reason}</small>
                      </p>
                    ))}
                    {p.changes.map((c, n) => (
                      <p key={n}>
                        <del>{c.before}</del> → <mark>{c.after}</mark>{" "}
                        <small>{c.reason}</small>
                      </p>
                    ))}
                  </div>
                  {p.ambiguousTerms.length > 0 ? (
                    <div role="alert" className="alert error">
                      <strong>
                        {p.ambiguousTerms.length} ambiguous term(s) need your
                        review before approval:
                      </strong>
                      {p.ambiguousTerms.map((a, n) => (
                        <p key={n}>
                          <mark>{a.term}</mark> — {a.reason}
                        </p>
                      ))}
                    </div>
                  ) : (
                    <p>
                      <strong>Ambiguous terms:</strong> None reported; user
                      review still required.
                    </p>
                  )}
                  {p.warnings.map((w, n) => (
                    <p className="warning" key={n}>
                      {w}
                    </p>
                  ))}
                  <small>
                    Token usage: {JSON.stringify(p.tokenUsage)} · Estimated
                    cost: {p.estimatedCost ?? "Unavailable"}
                  </small>
                  {p.approval === "PENDING" && (
                    <div className="actions">
                      <button
                        disabled={
                          busy ||
                          dirty ||
                          item.manualLocks.includes("NARRATION_TEXT") ||
                          item.revision !== p.baseRevision
                        }
                        className="primary"
                        onClick={() => decide(p.runId, "ACCEPT")}
                      >
                        Accept spoken text
                      </button>
                      <button
                        disabled={busy || dirty}
                        onClick={() => decide(p.runId, "REJECT")}
                      >
                        Reject proposal
                      </button>
                      {item.manualLocks.includes("NARRATION_TEXT") && (
                        <small>
                          Why “Accept” is disabled: this scene's spoken text is
                          manually locked. Use “Apply reviewed proposal to
                          locked text…”.
                        </small>
                      )}
                      {item.revision !== p.baseRevision && (
                        <small>
                          This proposal is out of date (the scene changed).
                          Request a new one.
                        </small>
                      )}
                      {item.manualLocks.includes("NARRATION_TEXT") && (
                        <button
                          disabled={
                            busy || dirty || item.revision !== p.baseRevision
                          }
                          onClick={() => {
                            if (
                              window.confirm(
                                "Replace this item’s locked spoken text with the reviewed proposal? Other fields remain unchanged and the spoken lock stays enabled.",
                              )
                            )
                              decide(p.runId, "ACCEPT_LOCKED");
                          }}
                        >
                          Apply reviewed proposal to locked text…
                        </button>
                      )}
                    </div>
                  )}
                </section>
              )}
            </article>
          );
        })}
      {!session.items.some((i) => i.selected) && (
        <div className="panel">Select source content first.</div>
      )}
    </>
  );
}
